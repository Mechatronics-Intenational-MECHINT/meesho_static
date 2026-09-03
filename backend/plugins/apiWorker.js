const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const moment = require("moment-timezone");

const Boxdata = require("../models/Boxdata");
const BoxMaster = require("../models/BoxMaster");
const Setting = require("../models/Settings");
const logger = require("../utils/logger");

module.exports = fp(async function apiWorker(fastify) {

  let cachedSettings = null;

  async function loadSettings() {
    try {
      cachedSettings = await Setting.findOne();
    } catch (e) {
      logger.error(`❌ Settings load failed: ${e.message}`);
    }
  }

  fastify.addHook("onReady", async () => {
    logger.info("🔥 API Worker Started");

    await loadSettings();
    setInterval(loadSettings, 10000);

    const connection = new IORedis({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });

    const worker = new Worker(
      "box-api-processing",
      async (job) => {

        if (!cachedSettings) throw new Error("Settings not loaded");

        const settings = cachedSettings;
        const ist = moment().tz("Asia/Kolkata");

        /* 🔒 LOCK + FETCH */
        const box = await Boxdata.findOneAndUpdate(
          {
            _id: job.data.id,   // ✅ FIX
            apiSent: "pending",
            apiProcessing: false
          },
          {
            apiProcessing: true,
            lastAttempt: new Date()
          }
        );

        if (!box) {
          logger.warn(`⚠️ Skipped API: ${job.data.id}`);
          return;
        }

        logger.info(`📦 API Processing: ${box.barcode}`);

        let giStatus = "not sent";
        let giResponse = 0;

        try {
          const giRes = await axios.post(
            "https://track.delhivery.com/api/mob-loc/mi/",
            {
              center: `${settings.centerName} (${settings.state})`,
              ref_ids: [box.barcode],
              large: "true",
            },
            {
              timeout: 5000,
              headers: {
                Authorization: settings.weightApiToken,
                Accept: "application/json",
                Application: "PROFILER",
                "Content-Type": "application/json",
              },
            }
          );

          if (giRes.status === 200) {
            giStatus = "sent";
            giResponse = giRes.data.status;
          }
        } catch (err) {
          logger.error(`❌ GI API error: ${err.message}`);
        }

        let weightStatus = "not sent";
        let weightResponse = "";

        try {
          const weightRes = await axios.post(
            "https://track.delhivery.com/api/p/update/",
            {
              wbn: box.barcode,
              l: box.length.toString(),
              b: box.breadth.toString(),
              h: box.height.toString(),
              wt: box.weight.toString(),
              v: box.Volume.toString(),
              rv: box.RealVolume.toString(),
            },
            {
              timeout: 5000,
              headers: {
                Authorization: settings.weightApiToken,
                Accept: "application/json",
                Application: "PROFILER",
                "Content-Type": "application/json",
              },
            }
          );

          if (weightRes.status === 200) {
            weightStatus = "sent";
            weightResponse = weightRes.data.msg;
          }
        } catch (err) {
          logger.error(`❌ Weight API error: ${err.message}`);
        }

        /* ✅ UPDATE SAME DOCUMENT */
        await Boxdata.updateOne(
          { _id: box._id },
          {
            apiSent: "success",
            apiProcessing: false
          }
        );

        /* ✅ UPSERT BOXMASTER (NO S3 FIELDS HERE) */
        await BoxMaster.updateOne(
          { barcode: box.barcode },
          {
            barcode: box.barcode,
            length: box.length.toString(),
            breadth: box.breadth.toString(),
            height: box.height.toString(),
            weight: box.weight.toString(),
            volume: box.Volume.toString(),
            realVolume: box.RealVolume.toString(),

            giStatus,
            giResponse,
            weightStatus,
            weightResponse,

            processedAt: ist.toDate(),
          },
          { upsert: true }
        );

        logger.info(`✅ API Done: ${box.barcode}`);
      },
      { connection, concurrency: 3 }
    );

    worker.on("failed", async (job, err) => {
      await Boxdata.updateOne(
        { _id: job.data.id },
        {
          $inc: { retryCount: 1 },
          apiProcessing: false,
          lastError: err.message,
          lastAttempt: new Date()
        }
      );
    });

    fastify.addHook("onClose", async () => {
      await worker.close();
    });
  });
});