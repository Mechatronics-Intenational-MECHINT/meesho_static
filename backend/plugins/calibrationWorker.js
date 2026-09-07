const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
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

// Refresh settings every 10 seconds
setInterval(loadSettings, 10000);

const connection = new IORedis({
  maxRetriesPerRequest: null
});

const worker = new Worker(
  "calibration-processing",

  async (job) => {

    if (!cachedSettings) {
      throw new Error("Settings not loaded");
    }

    const box = job.data;
    const settings = cachedSettings;
    const timestamp = moment().tz("Asia/Kolkata");

    /* ========== Local Tolerance Check ========== */

    const checkTolerance = (val, def, tol) =>
      val >= def - tol && val <= def + tol;

    const lengthMM = parseFloat(box.length);
    const widthMM = parseFloat(box.breadth);
    const heightMM = parseFloat(box.height);
    const weightG = parseFloat(box.weight);

    const lengthStatus = checkTolerance(
      lengthMM,
      settings.calibrateLength,
      settings.calibrateToleranceLength
    )
      ? "pass"
      : "fail";

    const widthStatus = checkTolerance(
      widthMM,
      settings.calibrateWidth,
      settings.calibrateToleranceWidth
    )
      ? "pass"
      : "fail";

    const heightStatus = checkTolerance(
      heightMM,
      settings.calibrateHeight,
      settings.calibrateToleranceHeight
    )
      ? "pass"
      : "fail";

    const weightStatus = checkTolerance(
      weightG,
      settings.calibrateWeight,
      settings.calibrateToleranceWeight
    )
      ? "pass"
      : "fail";

    const finalResult =
      [
        lengthStatus,
        widthStatus,
        heightStatus,
        weightStatus
      ].every(status => status === "pass")
        ? "pass"
        : "fail";


    /* ========== Store Directly in Database ========== */

    await CalibrationBoxLogs.create({
      barcode: box.barcode,

      index: `PB${Math.floor(
        10000 + Math.random() * 90000
      )}`,

      id: uuidv4(),

      length: box.length,
      width: box.breadth,
      height: box.height,
      weight: box.weight,
      volumetricWeight: (box.volumetricWeight),

      calibrateLength:
        settings.calibrateLength.toString(),

      calibrateWidth:
        settings.calibrateWidth.toString(),

      calibrateHeight:
        settings.calibrateHeight.toString(),

      calibrateWeight:
        settings.calibrateWeight.toString(),

      weightTolerance:
        settings.calibrateToleranceWeight.toString(),

      lengthStatus,
      widthStatus,
      heightStatus,
      weightStatus,

      finalResult,

      lengthVariance:
        +(lengthMM - settings.calibrateLength).toFixed(1),

      widthVariance:
        +(widthMM - settings.calibrateWidth).toFixed(1),

      heightVariance:
        +(heightMM - settings.calibrateHeight).toFixed(1),

      weightVariance:
        +(weightG - settings.calibrateWeight).toFixed(1),

      scantime: box.scantime,
      dwstime: box.dwstime,

      // API is no longer called.
      // Marking successful because DB insertion is completed.
      apiStatus: "success",

      dimensionTolerance:
        `L±${settings.calibrateToleranceLength}, ` +
        `W±${settings.calibrateToleranceWidth}, ` +
        `H±${settings.calibrateToleranceHeight}`,

      timestamp: timestamp.toDate(),
    });

    logger.info(
      `✅ Calibration data stored successfully for barcode: ${box.barcode}`
    );
  },

  {
    connection,
    concurrency: 2
  }
);


worker.on("completed", (job) => {
  console.info(
    `✅ Calibration Job ${job.id} completed`
  );
});


worker.on("failed", (job, err) => {
  console.error(
    `❌ Calibration Job ${job?.id} failed: ${err.message}`
  );
});


logger.info("⚙️ Calibration Worker started");

});
});
