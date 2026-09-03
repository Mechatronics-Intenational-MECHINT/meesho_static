const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const moment = require("moment-timezone");
const { v4: uuidv4 } = require("uuid");

const CalibrationBoxLogs = require("../models/CalibrateBoxLogs");
const Settings = require("../models/Settings");
const logger = require("../utils/logger");

module.exports = fp(async function calibrationWorker(fastify) {

  let cachedSettings = null;

  async function loadSettings() {
    try {
      cachedSettings = await Settings.findOne();
    } catch (e) {
      logger.error("❌ Failed to load calibration settings:", e.message);
    }
  }

  fastify.addHook("onReady", async () => {

    await loadSettings();
    setInterval(loadSettings, 10000);

    const connection = new IORedis({ maxRetriesPerRequest: null });

    const worker = new Worker(
      "calibration-processing",
      async (job) => {

        if (!cachedSettings) throw new Error("Settings not loaded");

        const box = job.data;
        const settings = cachedSettings;
        const timestamp = moment().tz("Asia/Kolkata");

        /* ========== Build Payload ========== */
        const payload = {
          version: "v1",
          data: {
            wbn: box.barcode,
            length: box.length,
            breadth: box.breadth,
            height: box.height,
            weight: box.weight,
            rv: box.RealVolume,
            boxvolume: box.Volume,
            time: timestamp.toISOString(),
            machineusername: settings.machineUsername,
            scanlocation: `${settings.centerName} (${settings.state})`,
            source: "PROFILER",
            defined_l: (settings.calibrateLength / 10).toFixed(1),
            defined_b: (settings.calibrateWidth / 10).toFixed(1),
            defined_h: (settings.calibrateHeight / 10).toFixed(1),
            defined_wt: settings.calibrateWeight.toFixed(1),
          },
          schema_name: "profiler-weight",
        };

        const headers = {
          Accept: "application/json",
          Application: "PROFILER",
          Authorization: settings.authorizationBearer,
          "Content-Type": "application/json",
        };

        /* ========== Calibration API (Bull handles retry) ========== */
        let apiStatus = "failed";
        try {
          const res = await axios.post("https://stream.delhivery.com/v1", payload, { headers });
          if (res.status === 200) apiStatus = "success";
        } catch (err) {
          throw err; // let Bull retry
        }

        /* ========== Local Tolerance Check ========== */
        const checkTolerance = (val, def, tol) => val >= def - tol && val <= def + tol;

        const lengthMM = parseFloat(box.length) * 10;
        const widthMM = parseFloat(box.breadth) * 10;
        const heightMM = parseFloat(box.height) * 10;
        const weightG = parseFloat(box.weight);

        const lengthStatus = checkTolerance(lengthMM, settings.calibrateLength, settings.calibrateToleranceLength) ? "pass" : "fail";
        const widthStatus  = checkTolerance(widthMM,  settings.calibrateWidth,  settings.calibrateToleranceWidth)  ? "pass" : "fail";
        const heightStatus = checkTolerance(heightMM, settings.calibrateHeight, settings.calibrateToleranceHeight) ? "pass" : "fail";
        const weightStatus = checkTolerance(weightG,   settings.calibrateWeight, settings.calibrateToleranceWeight) ? "pass" : "fail";

        const finalResult =
          [lengthStatus, widthStatus, heightStatus, weightStatus].every(s => s === "pass")
            ? "pass"
            : "fail";

        /* ========== Store Result ========== */
        await CalibrationBoxLogs.create({
          barcode: box.barcode,
          index: `PB${Math.floor(10000 + Math.random() * 90000)}`,
          id: uuidv4(),
          length: box.length,
          width: box.breadth,
          height: box.height,
          weight: box.weight,
          calibrateLength: settings.calibrateLength.toString(),
          calibrateWidth: settings.calibrateWidth.toString(),
          calibrateHeight: settings.calibrateHeight.toString(),
          calibrateWeight: settings.calibrateWeight.toString(),
          weightTolerance: settings.calibrateToleranceWeight.toString(),
          lengthStatus,
          widthStatus,
          heightStatus,
          weightStatus,
          finalResult,
          lengthVariance: +(lengthMM - settings.calibrateLength).toFixed(1),
          widthVariance: +(widthMM - settings.calibrateWidth).toFixed(1),
          heightVariance: +(heightMM - settings.calibrateHeight).toFixed(1),
          weightVariance: +(weightG - settings.calibrateWeight).toFixed(1),
          scantime: box.scantime,
          dwstime: box.dwstime,
          apiStatus,
          dimensionTolerance: `L±${settings.calibrateToleranceLength}, W±${settings.calibrateToleranceWidth}, H±${settings.calibrateToleranceHeight}`,
          timestamp: timestamp.toDate(),
        });

      },
      { connection, concurrency: 2 }
    );

    worker.on("completed", (job) =>
      console.info(`✅ Calibration Job ${job.id} completed`)
    );

    worker.on("failed", (job, err) =>
      console.error(`❌ Calibration Job ${job?.id} failed: ${err.message}`)
    );

    logger.info("⚙️ Calibration Worker started");
  });
});
