// server.js (Fastify + BullMQ + WS)

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const fastify = require("fastify")({ logger: false });
const fastifyCors = require("@fastify/cors");
const fastifyStatic = require("@fastify/static");
const { WebSocketServer } = require("ws");
const fsp = require("fs/promises");
const logger = require("./utils/logger");

const Setting = require("./models/Settings");
const Status = require("./models/Status");
const Boxdata = require("./models/Boxdata");



const startAlarmDurationWatcher = require("./services/alarmDurationWatcher");
const { init: initTokenManager } = require("./config/tokenManager");

// Routes
const userRoutes = require("./routes/userRoutes");
const statusRoutes = require("./routes/statusRoutes");
const boxDataRoutes = require("./routes/boxDataRoutes");
const settingsRoutes = require("./routes/settings");
const alarmLogRoutes = require("./routes/alarmLogRoutes");
const calibrationBoxLogsRoutes = require("./routes/calibrationBoxRoutes");
const boxMasterRoutes = require("./routes/boxmaster");

// Queues
const inscanQueue = require("./queues/inscanQueue");
const imageQueue = require("./queues/imageQueue");
const calibrationQueue = require("./queues/calibrationQueue");

// Bull Board
const { createBullBoard } = require("@bull-board/api");
const { FastifyAdapter } = require("@bull-board/fastify");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { startSettingsAutoSend, stopSettingsAutoSend } = require("./services/sendSettingToNodered");
// DWS Image Folder
const dwsImageDir = "D:\\Images";

// ---------------- IMAGE MATCH HELPER (shared by inline retry + reconciliation) ----------------
async function tryMatchImage(barcode) {
  try {
    const files = await fsp.readdir(dwsImageDir);
    const matches = files.filter((f) => f.startsWith(barcode));
    if (!matches.length) return null;

    matches.sort((a, b) => b.localeCompare(a));

    const uploadDir = path.join(__dirname, "uploads");
    await fsp.mkdir(uploadDir, { recursive: true });

    const destFile = `${barcode}-${Date.now()}.jpg`;
    await fsp.copyFile(path.join(dwsImageDir, matches[0]), path.join(uploadDir, destFile));

    return `/uploads/${destFile}`;
  } catch (err) {
    logger.info("🖼️ Image error:", err.message);
    return null;
  }
}

async function recoverPendingJobs() {
  logger.info("🔁 Recovering pending jobs...");

  const pendingBoxes = await Boxdata.find({
    $or: [
      { inscanSent: "pending", inscanRetryCount: { $lt: 5 } },
      { imageSent: "pending", imageRetryCount: { $lt: 5 } },
    ],
  }).limit(200);

  for (const box of pendingBoxes) {
    try {
      if (box.inscanSent === "pending" && box.inscanRetryCount < 5) {
        await inscanQueue.add(
          "process-inscan",
          { id: box._id, wbn: box.barcode },
          { jobId: `inscan-${box._id}` }
        );
      }

      // if (box.imageSent === "pending" && box.imageRetryCount < 5) {
      //   await imageQueue.add(
      //     "process-image",
      //     { id: box._id },
      //     { jobId: `img-${box._id}` }
      //   );
      // }

    } catch (err) {
      logger.info("❌ Recovery queue error:", err.message);
    }
  }

  logger.info(`♻️ Recovered ${pendingBoxes.length} boxes`);
}

// ---------------- MONGO ----------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    logger.info("✅ MongoDB Connected");

    startAlarmDurationWatcher();

    try {
      await initTokenManager();
    } catch (err) {
      logger.info("❌ tokenManager init failed:", err.message);
    }

    await recoverPendingJobs();
  })
  .catch((err) => {
    logger.info("❌ Mongo Error:", err);
    process.exit(1);
  });


// ---------------- ROUTES ----------------
fastify.register(userRoutes, { prefix: "/api/users" });
fastify.register(statusRoutes, { prefix: "/api/status" });
fastify.register(boxDataRoutes, { prefix: "/api/boxdata" });
fastify.register(settingsRoutes, { prefix: "/api/settings" });
fastify.register(alarmLogRoutes, { prefix: "/api/alarms" });
fastify.register(calibrationBoxLogsRoutes, { prefix: "/api/calibration-data" });
fastify.register(boxMasterRoutes, { prefix: "/api" });

// ---------------- CORS ----------------
fastify.register(fastifyCors, {
  origin: "http://localhost:3001",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
});

// ---------------- BULL BOARD ----------------
const serverAdapter = new FastifyAdapter();

createBullBoard({
  queues: [
    new BullMQAdapter(inscanQueue),
    // new BullMQAdapter(imageQueue),
    new BullMQAdapter(calibrationQueue),
  ],
  serverAdapter,
});

fastify.register(serverAdapter.registerPlugin(), {
  prefix: "/admin/queues",
});

// ---------------- STATIC UPLOADS ----------------
fastify.register(fastifyStatic, {
  root: path.join(__dirname, "uploads"),
  prefix: "/uploads/",
  decorateReply: false,
});

// ---------------- REACT BUILD ----------------
fastify.register(fastifyStatic, {
  root: path.join(__dirname, "../wms-frontend/build"),
  prefix: "/",
});

// ---------------- WORKERS ----------------
// fastify.register(require("./plugins/dwsWorker"));
fastify.register(require("./plugins/inscanApiWorker"));
fastify.register(require("./plugins/imageWorker"));
fastify.register(require("./plugins/calibrationWorker"));
fastify.register(require("./workers/logSyncService"));
fastify.register(require("./workers/imageFetchService")) 
fastify.register(require("./workers/imageUploadService"))

// ---------------- WEBSOCKET ----------------
const server = fastify.server;
const wss = new WebSocketServer({ server });

// ---------------- IMAGE RECONCILIATION (catches camera lag beyond the inline retry) ----------------
async function reconcileMissingImages() {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);

    const missing = await Boxdata.find({
      imagePath: "image_missing",
      createdAt: { $gte: cutoff },
    }).limit(100);

    for (const box of missing) {
      const found = await tryMatchImage(box.barcode);
      if (!found) continue;

      box.imagePath = found;
      await box.save();

      logger.info(`🖼️ Late image matched for ${box.barcode}`);

      wss.clients.forEach((client) => {
        if (client.readyState === 1 && client._path === "/bin-data") {
          client.send(JSON.stringify({
            type: "image-update",
            barcode: box.barcode,
            imagePath: box.imagePath,
          }));
        }
      });
    }
  } catch (err) {
    console.error("❌ Image reconciliation error:", err.message);
  }
}

const imageReconcileTimer = setInterval(reconcileMissingImages, 5000);

wss.on("connection", (ws, req) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  ws._path = pathname;

  /* ---------- BIN DATA ---------- */
  if (pathname === "/bin-data") {
    logger.info("📡 bin-data connected");

    let settings = null;

    const fetchSettings = async () => {
      try {
        settings = await Setting.findOne();
      } catch (e) {
        console.error("⚠️ Settings load failed:", e.message);
      }
    };

    fetchSettings();
    const settingsTimer = setInterval(fetchSettings, 10000);

    ws.on("close", () => clearInterval(settingsTimer));

    ws.on("message", async (message) => {
      try {
        if (!settings) return;

        const data = JSON.parse(message);
        const { barcode, ...boxInfo } = data;
        logger.info(data);

        if (!barcode) return;

        const weight = parseFloat(boxInfo.weight || 0);
                /* ================= VALIDATION ================= */
        const isValidDim =
          boxInfo.length >= settings.boxlengthMin &&
          boxInfo.length <= settings.boxlengthMax &&
          boxInfo.breadth >= settings.boxbreadthMin &&
          boxInfo.breadth <= settings.boxbreadthMax &&
          boxInfo.height >= settings.boxheightMin &&
          boxInfo.height <= settings.boxheightMax &&
          weight >= settings.boxweightMin &&
          weight <= settings.boxweightMax;

        /* ================= CALIBRATION CHECK (must run first — no duplicate check, no regex) ================= */
        const isCalibration =
          settings.calibrationWaybillNumber &&
          barcode === settings.calibrationWaybillNumber;

        if (isCalibration) {
          logger.info("🧪 Calibration box detected:", barcode);

          /* ---- Image match (bounded retry for camera lag) ---- */
          let calImagePath = "image_missing";
          for (let attempt = 0; attempt < 3 && calImagePath === "image_missing"; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
            const found = await tryMatchImage(barcode);
            if (found) calImagePath = found;
          }

          const calibrationRecord = {
            barcode,
            ...boxInfo,
            weight,
            imagePath: calImagePath,
            createdAt: new Date(),
          };

          try {
            await calibrationQueue.add("calibration-processing", calibrationRecord);
          } catch (e) {
            console.error("❌ Calibration queue push failed:", e.message);
          }

          wss.clients.forEach((client) => {
            if (client.readyState === 1 && client._path === "/bin-data") {
              client.send(JSON.stringify(calibrationRecord));
            }
          });

          return;
        }

        /* ================= DUPLICATE CHECK (only against previously PASSED parcels) ================= */
        let isDuplicate = false;
        try {
          const existing = await Boxdata.findOne({ barcode, status: "pass" }).lean();
          isDuplicate = Boolean(existing);
        } catch (e) {
          console.error("⚠️ Duplicate check failed:", e.message);
        }

        /* ================= VALIDATION (barcode regex) — skipped if already a duplicate ================= */
        let isValid = false;
        if (!isDuplicate) {
          try {
            const pattern = new RegExp(settings.regexPattern);
            isValid = pattern.test(barcode);
          } catch (e) {
            console.error("⚠️ Invalid regexPattern in settings:", e.message);
            isValid = false;
          }
        }

        const scanStatus = isDuplicate ? "duplicate" : (isValid && isValidDim ? "pass" : "rejected");

        /* ================= IMAGE MATCH (bounded retry for camera lag) ================= */
        let imagePath = "image_missing";
        for (let attempt = 0; attempt < 3 && imagePath === "image_missing"; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
          const found = await tryMatchImage(barcode);
          if (found) imagePath = found;
        }

        const boxRecord = {
          barcode,
          ...boxInfo,
          weight,
          imagePath,
          status: scanStatus,
          createdAt: new Date(),
        };

        /* ================= STORE DB (shipments only — duplicates stored too, for audit) ================= */
        let savedBox = null;

        try {
          savedBox = await Boxdata.create(boxRecord);
        } catch (e) {
          logger.info("❌ Boxdata insert failed:", e.message);
        }

        /* ================= NORMAL PROCESSING (only on a real pass) ================= */
        if (scanStatus === "pass") {
          try {
            await inscanQueue.add(
              "process-inscan",
              { id: savedBox._id, wbn: barcode },
              { jobId: `inscan-${savedBox._id}` }
            );

            // await imageQueue.add(
            //   "process-image",
            //   { id: savedBox._id },
            //   { jobId: `img-${savedBox._id}` }
            // );

            logger.info(`📦 ${barcode} queued (Inscan + Image)`);

          } catch (e) {
            logger.info("❌ Queue push failed:", e.message);
          }

        } else {
          logger.info(`⛔ Box skipped from processing: ${barcode} (${scanStatus})`);
        }

        /* ================= BROADCAST TO /bin-data CLIENTS ================= */
        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client._path === "/bin-data") {
            client.send(JSON.stringify(boxRecord));
          }
        });

      } catch (err) {
        console.error("❌ bin-data handler error:", err);
      }
    });
  }

  /* ---------- MACHINE STATUS ---------- */
  else if (pathname === "/machine-status") {
    logger.info("📡 machine-status connected");

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);

        await Status.findOneAndUpdate(
          {},
          { ...data, timestamp: new Date() },
          { upsert: true }
        );

        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client._path === "/machine-status") {
            client.send(JSON.stringify(data));
          }
        });

      } catch (err) {
        logger.info("❌ machine-status error:", err);
      }
    });
  }

  /* ---------- LIVE WEIGHT ---------- */
  else if (pathname === "/live-weight") {
    logger.info("📡 live-weight connected");

    ws.on("message", (message) => {
      try {
        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client._path === "/live-weight") {
            client.send(message.toString());
          }
        });
      } catch (err) {
        logger.info("❌ live-weight error:", err.message);
      }
    });
  }

  else {
    ws.close();
  }
});


// ---------------- FALLBACK ----------------
fastify.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith("/api")) {
    reply.code(404).send({ error: "API not found" });
  } else {
    reply.sendFile("index.html");
  }
});
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => {
//     console.log("✅ MongoDB connected");
//     startSettingsAutoSend(); // <-- yahan se 10-sec loop shuru hoga
//   })
//   .catch((err) => console.error("❌ MongoDB connection failed:", err.message));

// // Graceful shutdown
// process.on("SIGTERM", () => {
//   stopSettingsAutoSend();
//   process.exit(0);
// });
// ---------------- START ----------------
fastify.listen({ port: 5001, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    logger.info(err);
    process.exit(1);
  }
  console.log(`🚀 Server running on ${address}`);
  logger.info(`🚀 Server running on ${address}`);
});