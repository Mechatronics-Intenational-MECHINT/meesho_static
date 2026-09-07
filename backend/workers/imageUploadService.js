// workers/imageUploadService.js
//
// DWS Image Upload Service — Fastify Plugin
//
// Picks up ImageRequest docs, resolves each to a local image file, and
// pushes to Meesho's upload API strictly one image at a time (next image
// only after the previous one succeeds or a 5s timeout — per API contract).
// Meesho owns GCS storage now; this service never touches S3.
//
// For type=AWB requests, the corresponding Boxdata row's imageSent /
// imageProcessing / imageRetryCount / imageLastError fields are kept in
// sync — same pattern already used for inscanSent / logSent on that model.

const fp = require("fastify-plugin");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { withTokenRetry } = require("../config/tokenManager");
const ImageRequest = require("../models/ImageRequest");
const ImageUploadLog = require("../models/ImageUploadLog");
const Boxdata = require("../models/Boxdata");
const logger = require("../utils/logger");

const UPLOAD_API_URL =
  process.env.MEESHO_IMAGE_UPLOAD_URL ||
  "https://env16115-app.dev.meeshogcp.in/api/v1/sorter/image/upload";
const PER_IMAGE_TIMEOUT_MS = 5_000;
const TICK_INTERVAL_MS = 15_000;
const MAX_IMAGE_BYTES = 1 * 1024 * 1024;
const MAX_RETRIES = 5;

let timer = null;

// ── AWB → local image(s), via existing Boxdata.imagePath ──────────────────
async function resolveAwbImages(box) {
  if (!box?.imagePath || box.imagePath === "image_missing") return [];

  const cleanPath = box.imagePath.startsWith("/") ? box.imagePath.slice(1) : box.imagePath;
  const fullPath = path.join(process.cwd(), cleanPath);
  if (!fs.existsSync(fullPath)) return [];

  return [{ path: fullPath, scan_time: box.scantime, flow_type: "FWD" }];
}

// TODO: implement once DBO/IBO local capture layout (folder/hub tagging) is confirmed.
async function resolveDboIboImages(/* request */) {
  logger.warn("⚠️  imageUpload: DBO/IBO resolution not implemented yet — skipping");
  return [];
}

function isWithinSizeCap(filePath) {
  return fs.statSync(filePath).size <= MAX_IMAGE_BYTES;
}

async function uploadOne({ type, awb, imagePath, scan_time, flow_type }) {
  const form = new FormData();
  form.append("type", type);
  form.append("awb", awb);
  form.append("scan_time", scan_time || moment().tz("Asia/Kolkata").format("YYYY-MM-DDTHH:mm:ss"));
  if (type === "AWB") form.append("flow_type", flow_type || "FWD");
  form.append("image", fs.createReadStream(imagePath));

  const doUpload = withTokenRetry(async (token) => {
    const headers = { ...form.getHeaders(), Authorization: `${token}` };
    return axios.post(UPLOAD_API_URL, form, { headers, timeout: PER_IMAGE_TIMEOUT_MS });
  });

  const timeoutGuard = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("upload timed out after 5s")), PER_IMAGE_TIMEOUT_MS)
  );

  return Promise.race([doUpload, timeoutGuard]);
}

async function logAttempt({ request, img, res, err, attempt }) {
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
}

async function releaseBoxLock(awb, patch) {
  await Boxdata.updateOne({ barcode: awb }, patch);
}

async function processRequest(request) {
  request.attempts += 1;

  // Lock + retry-cap check only applies to AWB requests — DBO/IBO has no barcode.
  let box = null;
  if (request.type === "AWB") {
    box = await Boxdata.findOne({ barcode: request.awb });

    if (!box) {
      request.status = "no_match";
      request.lastError = "no matching Boxdata row for this AWB";
      await request.save();
      return;
    }

    if (box.imageRetryCount >= MAX_RETRIES) {
      request.status = "failed";
      request.lastError = "max retries exceeded";
      await request.save();
      return;
    }

    const locked = await Boxdata.findOneAndUpdate(
      { barcode: request.awb, imageProcessing: false },
      { imageProcessing: true },
      { new: true }
    );
    if (!locked) {
      logger.warn(`⚠️  imageUpload: skipped, already processing: ${request.awb}`);
      return;
    }
    box = locked;
  }

  let images = [];
  try {
    images =
      request.type === "AWB" ? await resolveAwbImages(box) : await resolveDboIboImages(request);
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
    request.lastError = "no local image found";
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
      logger.warn(`⚠️  imageUpload: skipping oversize image ${img.path}`);
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

      await logAttempt({ request, img, res, attempt: request.attempts });
      matchedPaths.push(img.path);

      // DBO/IBO images can be dropped locally once pushed; AWB images stay
      // on disk for the dashboard, per the Meesho doc.
      if (request.type === "DBO/IBO") fs.unlink(img.path, () => {});
    } catch (err) {
      anyFailed = true;
      await logAttempt({ request, img, err, attempt: request.attempts });
      logger.error(`❌ imageUpload: failed for ${request.awb || request._id}: ${err.message}`);
    }
  }

  request.matchedImagePaths = matchedPaths;
  request.status = anyFailed ? "failed" : matchedPaths.length ? "uploaded" : "no_match";
  request.lastError = anyFailed ? "one or more images failed — will retry" : "";
  await request.save();

  // ── Sync back onto Boxdata (AWB requests only) ──────────────────────────
  if (box) {
    if (!anyFailed && matchedPaths.length) {
      await releaseBoxLock(request.awb, {
        imageSent: "success",
        imageProcessing: false,
        imageLastError: "",
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
      .limit(50);

    if (!pending.length) return;

    logger.info(`📤 imageUpload: processing ${pending.length} request(s)`);
    for (const request of pending) {
      await processRequest(request); // sequential — enforces the one-at-a-time rule
    }
  } catch (err) {
    logger.error(`❌ imageUpload tick error: ${err.message}`);
  }
}

module.exports = fp(async function imageUploadPlugin(fastify) {
  setTimeout(() => uploadTick(), 15_000);
  timer = setInterval(() => uploadTick(), TICK_INTERVAL_MS);

  fastify.addHook("onClose", async () => {
    clearInterval(timer);
    logger.info("🛑 imageUploadService stopped");
  });

  logger.info("⚙️  imageUploadService started");
});
