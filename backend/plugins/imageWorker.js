const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { createCanvas, loadImage } = require("canvas");
const moment = require("moment-timezone");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

const Boxdata = require("../models/Boxdata");
const BoxMaster = require("../models/BoxMaster");
const Setting = require("../models/Settings");

module.exports = fp(async function imageWorker(fastify) {

  let cachedSettings = null;

  async function loadSettings() {
    try {
      cachedSettings = await Setting.findOne();
    } catch (e) {
      logger.error(`❌ Settings load failed: ${e.message}`);
    }
  }

  fastify.addHook("onReady", async () => {
    logger.info("🔥 Image Worker Started");

    await loadSettings();
    setInterval(loadSettings, 10000);

    const connection = new IORedis({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });

    const worker = new Worker(
      "box-image-processing",
      async (job) => {

        const ist = moment().tz("Asia/Kolkata");

        /* 🔒 LOCK */
        const box = await Boxdata.findOneAndUpdate(
          {
            _id: job.data.id,
            imageSent: "pending",
            imageProcessing: false
          },
          {
            imageProcessing: true,
            lastAttempt: new Date()
          }
        );

        if (!box) {
          logger.warn(`⚠️ Skipped Image: ${job.data.id}`);
          return;
        }

        logger.info(`🖼️ Processing image: ${box.barcode}`);

        const settings = cachedSettings;

        let s3Status = "not sent";
        let s3Path = "";

        try {
          /* 🔥 STRICT SETTINGS CHECK */
          if (
            !cachedSettings ||
            !cachedSettings.accessKeyId ||
            !cachedSettings.secretAccessKey ||
            !cachedSettings.bucketName
          ) {
            throw new Error("AWS settings missing");
          }

          /* 🔥 CREATE FRESH S3 CLIENT */
          const s3 = new S3Client({
            region: "ap-south-1",
            credentials: {
              accessKeyId: cachedSettings.accessKeyId,
              secretAccessKey: cachedSettings.secretAccessKey,
            },
          });

          /* 🔥 IMAGE PATH */
          const cleanPath = box.imagePath?.startsWith("/")
            ? box.imagePath.slice(1)
            : box.imagePath;

          const imagePath = path.join(process.cwd(), cleanPath);

          if (!fs.existsSync(imagePath)) {
            throw new Error(`Image not found: ${imagePath}`);
          }

          const image = await loadImage(imagePath);

          const canvas = createCanvas(image.width, image.height);
          const ctx = canvas.getContext("2d");

          ctx.drawImage(image, 0, 0);

          /* 🔥 LABEL OVERLAY */
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(0, 0, canvas.width, 160);

          ctx.fillStyle = "#00FF00";
          ctx.font = "18px monospace";
          ctx.textBaseline = "top";

          ctx.fillText(`AWB: ${box.barcode}`, 10, 10);
          ctx.fillText(`Dimensions: ${box.length} x ${box.breadth} x ${box.height} cm`, 10, 30);
          ctx.fillText(`Weight: ${box.weight} gm`, 10, 50);
          ctx.fillText(`Volume: ${box.Volume} cm3`, 10, 70);
          ctx.fillText(`Real Volume: ${box.RealVolume} cm3`, 10, 90);
          ctx.fillText(`Profiler ID: ${settings.machineUsername}`, 10, 110);
          ctx.fillText(`Center: ${settings.centerName} (${settings.state})`, 10, 130);
          ctx.fillText(`Time: ${ist.format("YYYY-MM-DD HH:mm:ss")}`, 10, 150);

          const buffer = canvas.toBuffer("image/jpeg");

          /* 🔥 S3 KEY — MATCHES DWS WORKER FOLDER STRUCTURE */
          const fileName = `${box.barcode}-${ist.format("YYYY_MM_DD-HH_mm_ss")}.jpg`;
          const folder = `profiler/mechatronics/${cachedSettings.centerName} (${cachedSettings.state})/${ist.year()}/${ist.month() + 1}/${ist.date()}`;
          const key = `${folder}/${fileName}`;

          logger.info(`☁️ Uploading: ${key}`);

          await s3.send(new PutObjectCommand({
            Bucket: cachedSettings.bucketName,
            Key: key,
            Body: buffer,
            ContentType: "image/jpeg"
          }));

          s3Status = "sent";
          s3Path = `s3://${cachedSettings.bucketName}/${key}`;

          logger.info(`✅ S3 Upload: ${s3Path}`);

        } catch (err) {
          logger.error(`❌ Image error: ${err.message}`);

          /* 🔥 RELEASE LOCK + KEEP PENDING FOR RETRY */
          await Boxdata.updateOne(
            { _id: box._id },
            {
              imageProcessing: false,
              lastError: err.message
            }
          );

          return;
        }

        /* ✅ UPDATE BOXDATA */
        await Boxdata.updateOne(
          { _id: box._id },
          {
            imageSent: "success",
            imageProcessing: false
          }
        );

        /* ✅ UPDATE BOXMASTER */
        await BoxMaster.updateOne(
          { barcode: box.barcode },
          {
            s3Status,
            s3Path
          },
          { upsert: true }
        );

        logger.info(`✅ Image Done: ${box.barcode}`);
      },
      { connection, concurrency: 2 }
    );

    fastify.addHook("onClose", async () => {
      await worker.close();
    });
  });
});