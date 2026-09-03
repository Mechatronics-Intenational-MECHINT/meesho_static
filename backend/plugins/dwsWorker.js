const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const moment = require("moment-timezone");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");

const BoxMaster = require("../models/BoxMaster");
const Setting = require("../models/Settings");

module.exports = fp(async function dwsWorker(fastify) {

  let cachedSettings = null;
  let s3Client = null;

  async function loadSettings() {
    try {
      cachedSettings = await Setting.findOne();

      if (cachedSettings) {
        s3Client = new S3Client({
          region: "ap-south-1",
          credentials: {
            accessKeyId: cachedSettings.accessKeyId,
            secretAccessKey: cachedSettings.secretAccessKey,
          },
        });
      }
    } catch (e) {
      fastify.log.error("❌ Failed to load settings:", e.message);
    }
  }

  // 🔁 IMAGE LOAD WITH RETRY
  async function loadImageWithRetry(filePath, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🖼️ Attempt ${i + 1} loading image:`, filePath);
        return await loadImage(filePath);
      } catch (err) {
        console.log(`❌ Image load failed (Attempt ${i + 1}):`, err.message);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error("Image load failed after retries");
  }

  fastify.addHook("onReady", async () => {
    console.log("🔥 DWS Worker Started");

    await loadSettings();
    setInterval(loadSettings, 10000);

    const connection = new IORedis({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });

    const worker = new Worker(
      "box-processing",
      async (job) => {

        if (!cachedSettings) {
          throw new Error("Settings not loaded");
        }

        const box = job.data;
        const settings = cachedSettings;
        const ist = moment().tz("Asia/Kolkata");

        console.log("📦 Processing box:", box.barcode);

        /* ---------------- GI API ---------------- */
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
          fastify.log.error("❌ GI API error:", err.message);
        }

        /* ---------------- WEIGHT API ---------------- */
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
          fastify.log.error("❌ Weight API error:", err.message);
        }

        /* ---------------- S3 UPLOAD ---------------- */
        let s3Status = "not sent";
        let s3Path = "";

        try {
          console.log("📸 Raw imagePath from box:", box.imagePath);

          // CLEAN PATH (remove leading slash if exists)
          const cleanPath = box.imagePath.startsWith("/")
            ? box.imagePath.slice(1)
            : box.imagePath;

          // FULL FILE PATH
          const imagePath = path.join(process.cwd(), cleanPath);

          console.log("📂 Final image path:", imagePath);

          // CHECK FILE EXISTS
          if (!fs.existsSync(imagePath)) {
            throw new Error(`Image not found at path: ${imagePath}`);
          }

          const image = await loadImageWithRetry(imagePath);

          console.log("✅ Image loaded successfully");

          const canvas = createCanvas(image.width, image.height);
          const ctx = canvas.getContext("2d");

          ctx.drawImage(image, 0, 0, image.width, image.height);

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

          const fileName = `${box.barcode}-${ist.format("YYYY_MM_DD-HH_mm_ss")}.jpg`;
          const folder = `profiler/mechatronics/${settings.centerName} (${settings.state})/${ist.year()}/${ist.month() + 1}/${ist.date()}`;
          const s3Key = `${folder}/${fileName}`;

          console.log("☁️ Uploading to S3:", s3Key);

          await s3Client.send(
            new PutObjectCommand({
              Bucket: settings.bucketName,
              Key: s3Key,
              Body: buffer,
              ContentType: "image/jpeg",
            })
          );

          s3Status = "sent";
          s3Path = `s3://${settings.bucketName}/${s3Key}`;

          console.log("✅ S3 upload success:", s3Path);

        } catch (err) {
          console.log("❌ S3 error:", err.message);
        }

        /* ---------------- SAVE MASTER ---------------- */
        await BoxMaster.create({
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
          s3Status,
          s3Path,
          processedAt: ist.toDate(),
        });

        console.log("💾 Saved to BoxMaster:", box.barcode);

        return true;
      },
      { connection, concurrency: 2 }
    );

    worker.on("completed", (job) =>
      fastify.log.info(`✅ Job ${job.id} done`)
    );

    worker.on("failed", (job, err) =>
      fastify.log.error(`❌ Job ${job?.id} failed: ${err.message}`)
    );

    fastify.addHook("onClose", async () => {
      await worker.close();
    });
  });
});