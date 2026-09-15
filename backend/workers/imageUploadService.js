// workers/imageUploadService.js
const fp = require("fastify-plugin");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const { withTokenRetry } = require("../config/tokenManager");
const ImageRequest = require("../models/ImageRequest");
const ImageUploadLog = require("../models/ImageUploadLog");
const Boxdata = require("../models/Boxdata");
const logger = require("../utils/logger");

const UPLOAD_API_URL =
  process.env.MEESHO_IMAGE_UPLOAD_URL ||
  "https://prod-app.valmo.in/api/v1/sorter/image/upload";
const PER_IMAGE_TIMEOUT_MS = 10_000;
const TICK_INTERVAL_MS = 15_000;
const MAX_IMAGE_BYTES = 1 * 1024 * 1024; // 1 MB per doc
const MAX_RETRIES = 5;

// Env variable se slave_sorter_id read kiya gaya hai
const PHYSICAL_SORTER_ID = process.env.SLAVE_SORTER_ID || "";

let timer = null;

// UTC ISO format ending in Z per doc (e.g. 2026-06-12T14:03:11Z)
function toDocTimestamp(raw) {
  try {
    if (!raw) return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

async function resolveAwbImages(box) {
  if (!box?.imagePath || box.imagePath === "image_missing") {
    console.warn(`⚠️  [imageUpload] Boxdata imagePath missing or marked 'image_missing' for AWB: ${box?.barcode}`);
    return [];
  }

  const cleanPath = box.imagePath.startsWith("/") ? box.imagePath.slice(1) : box.imagePath;
  const fullPath = path.isAbsolute(box.imagePath) ? box.imagePath : path.join(process.cwd(), cleanPath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  [imageUpload] File not found on disk at: ${fullPath}`);
    return [];
  }

  return [
    {
      path: fullPath,
      scan_time: toDocTimestamp(box.scantime),
      flow_type: "FWD",
    },
  ];
}

async function resolveDboIboImages() {
  return [];
}

function isWithinSizeCap(filePath) {
  try {
    const size = fs.statSync(filePath).size;
    return size <= MAX_IMAGE_BYTES;
  } catch {
    return false;
  }
}

async function uploadOne({ type, awb, imagePath, scan_time, flow_type }) {
  const form = new FormData();
  form.append("type", type);
  form.append("awb", String(awb).trim());
  form.append("scan_time", scan_time);
  
  // Physical sorter ID requirement appended
  form.append("physical_sorter_id", PHYSICAL_SORTER_ID);

  if (type === "AWB") {
    form.append("flow_type", flow_type || "FWD");
  }
  form.append("image", fs.createReadStream(imagePath));

  console.log(`📤 [imageUpload] Uploading image -> AWB: ${awb}, physical_sorter_id: ${PHYSICAL_SORTER_ID}, ScanTime: ${scan_time}, Path: ${imagePath}`);

  return withTokenRetry(async (token) => {
    let cleanToken = String(token || "").trim();
    if (cleanToken.toLowerCase().startsWith("bearer ")) {
      cleanToken = cleanToken.slice(7).trim();
    }

    const headers = {
      ...form.getHeaders(),
      Authorization: cleanToken,
    };

    return axios.post(UPLOAD_API_URL, form, {
      headers,
      timeout: PER_IMAGE_TIMEOUT_MS,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  });
}

async function logAttempt({ request, img, res, err, attempt }) {
  try {
    await ImageUploadLog.create({
      requestId: request._id,
      type: request.type,
      awb: request.awb,
      imagePath: img.path,
      scan_time: img.scan_time,
      flow_type: img.flow_type,
      statusCode: res ? res.status : err?.response?.status || 0,
      success: !!res,
      response: res ? res.data : err?.response?.data || { error: err?.message },
      attempt,
    });
  } catch (logErr) {
    console.error("❌ imageUpload: logAttempt DB error:", logErr.message);
  }
}

async function releaseBoxLock(awb, patch) {
  await Boxdata.updateOne({ barcode: awb }, patch);
}

async function processRequest(request) {
  request.attempts += 1;

  let box = null;
  if (request.type === "AWB") {
    box = await Boxdata.findOne({ barcode: request.awb });

    if (!box) {
      console.warn(`⚠️  [imageUpload] No matching Boxdata row for AWB: ${request.awb}`);
      request.status = "no_match";
      request.lastError = "no matching Boxdata row for this AWB";
      await request.save();
      return;
    }

    if (box.imageRetryCount >= MAX_RETRIES) {
      console.warn(`⚠️  [imageUpload] Max retries reached for AWB: ${request.awb}`);
      request.status = "failed";
      request.lastError = "max retries exceeded";
      await request.save();
      return;
    }

    const locked = await Boxdata.findOneAndUpdate(
      { barcode: request.awb, imageProcessing: false },
      { $set: { imageProcessing: true } },
      { new: true }
    );

    if (!locked) {
      console.log(`⚠️  [imageUpload] AWB ${request.awb} is currently being processed by another worker.`);
      return;
    }
    box = locked;
  }

  let images = [];
  try {
    images = request.type === "AWB" ? await resolveAwbImages(box) : await resolveDboIboImages(request);
  } catch (err) {
    request.status = "failed";
    request.lastError = `resolve error: ${err.message}`;
    await request.save();
    if (box) {
      await releaseBoxLock(request.awb, {
        $set: { imageProcessing: false, imageLastError: err.message },
        $inc: { imageRetryCount: 1 },
      });
    }
    return;
  }

  if (!images.length) {
    request.status = "no_match";
    request.lastError = "no local image found on disk";
    await request.save();
    if (box) {
      await releaseBoxLock(request.awb, {
        $set: { imageProcessing: false, imageLastError: "no local image found" },
      });
    }
    return;
  }

  const matchedPaths = [];
  let anyFailed = false;

  for (const img of images) {
    if (!isWithinSizeCap(img.path)) {
      console.warn(`⚠️  [imageUpload] Image exceeds 1MB limit: ${img.path}`);
      continue;
    }

    try {
      const res = await uploadOne({
        type: request.type,
        awb: request.awb,
        imagePath: img.path,
        scan_time: img.scan_time,
        flow_type: img.flow_type,
      });

      console.log(`✅ [imageUpload] Upload success for ${request.awb}! Response:`, res.data);
      await logAttempt({ request, img, res, attempt: request.attempts });
      matchedPaths.push(img.path);
    } catch (err) {
      anyFailed = true;
      const respErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`❌ [imageUpload] Upload failed for ${request.awb}:`, respErr);
      await logAttempt({ request, img, err, attempt: request.attempts });
    }
  }

  request.matchedImagePaths = matchedPaths;
  request.status = anyFailed ? "failed" : matchedPaths.length ? "uploaded" : "no_match";
  request.lastError = anyFailed ? "one or more images failed upload" : "";
  await request.save();

  if (box) {
    if (!anyFailed && matchedPaths.length) {
      await releaseBoxLock(request.awb, {
        $set: {
          imageSent: "success",
          imageProcessing: false,
          imageLastError: "",
        },
      });
    } else {
      await releaseBoxLock(request.awb, {
        $set: {
          imageProcessing: false,
          imageLastError: request.lastError || "upload failed",
        },
        $inc: { imageRetryCount: 1 },
      });
    }
  }
}

async function uploadTick() {
  try {
    const pending = await ImageRequest.find({
      status: { $in: ["pending", "failed"] },
      attempts: { $lt: MAX_RETRIES },
    })
      .sort({ createdAt: 1 })
      .limit(20);

    if (!pending.length) {
      return;
    }

    console.log(`📤 [imageUpload] Found ${pending.length} pending image upload request(s). Processing sequentially...`);
    for (const request of pending) {
      await processRequest(request);
    }
  } catch (err) {
    console.error("❌ [imageUpload] uploadTick error:", err.message);
  }
}

module.exports = fp(async function imageUploadPlugin(fastify) {
  console.log(`⚙️  imageUploadService plugin registered (physical_sorter_id="${PHYSICAL_SORTER_ID}")`);
  setTimeout(() => uploadTick(), 10_000);
  timer = setInterval(() => uploadTick(), TICK_INTERVAL_MS);

  fastify.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    console.log("🛑 imageUploadService stopped");
  });
});