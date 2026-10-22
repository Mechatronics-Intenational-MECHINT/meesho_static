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

const UPLOAD_API_URL =
  process.env.MEESHO_IMAGE_UPLOAD_URL ||
  "https://prod-app.valmo.in/api/v1/sorter/image/upload";

const PER_IMAGE_TIMEOUT_MS = 15_000;
const TICK_INTERVAL_MS = 15_000;
const GAP_BETWEEN_UPLOADS_MS = 200;     // ek image ka response aane ke baad chhota gap
const MAX_IMAGE_BYTES = 1 * 1024 * 1024; // 1 MB per image
const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = 60_000;         // attempt * 60s
const REQUESTS_PER_TICK = 20;
const DBO_IMAGES_PER_TICK = 200;         // bada range ho to tick-by-tick chalega

const PHYSICAL_SORTER_ID = process.env.SLAVE_SORTER_ID || "";

let timer = null;
let running = false;
let stopped = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- helpers ---------------- */

// UTC ISO ending in Z (e.g. 2026-06-12T14:03:11Z)
function toDocTimestamp(raw) {
  const d = raw ? new Date(raw) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  return valid.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Images kahan se milengi: env IMAGE_BASE_DIR (agar set ho) warna cwd / server entry folder
const IMAGE_BASE_DIR = process.env.IMAGE_BASE_DIR || "";

// Return: { img, reason } -> image mili to img, warna reason me exact wajah
function resolveBoxImage(box) {
  const stored = box?.imagePath;

  if (!stored || stored === "image_missing") {
    return { img: null, reason: `imagePath is '${stored || ""}' in Boxdata (image was never saved)` };
  }

  // NOTE: '/uploads/x.jpg' ko path.isAbsolute() Windows par bhi true deta hai, aur use seedha
  // use karne par woh D:\uploads\x.jpg ban jaata hai (project ke andar wala folder nahi).
  // Isliye leading slash hatakar base folder se join karte hain.
  const rel = stored.replace(/^[/\\]+/, "");
  const entryDir = require.main?.filename ? path.dirname(require.main.filename) : process.cwd();

  const candidates = [
    ...(IMAGE_BASE_DIR ? [path.join(IMAGE_BASE_DIR, rel)] : []),
    path.join(process.cwd(), rel),
    path.join(entryDir, rel),
    ...(/^[a-zA-Z]:[\\/]/.test(stored) ? [stored] : []), // sachmuch ka drive-letter path
  ];

  const fullPath = candidates.find((p) => fs.existsSync(p));
  if (!fullPath) {
    return { img: null, reason: `file not found on disk. tried: ${candidates.join(" | ")}` };
  }

  return {
    img: {
      awb: String(box.barcode).trim(),
      path: fullPath,
      storedPath: stored, // DB wala original path (progress tracking ke liye)
      // box.date = real UTC Date; scantime locale string hai jo parse nahi hoti
      scan_time: toDocTimestamp(box.date || box.dwstime || box.time),
      flow_type: "FWD",
    },
    reason: "",
  };
}

function isWithinSizeCap(filePath) {
  try {
    return fs.statSync(filePath).size <= MAX_IMAGE_BYTES;
  } catch {
    return false;
  }
}

// 4xx (auth/rate-limit chhodkar) = is image me hi problem hai, retry se theek nahi hogi
function isPermanentImageError(err) {
  const s = err?.response?.status || 0;
  return s >= 400 && s < 500 && ![401, 403, 408, 429].includes(s);
}

const updateRequest = (request, update) => ImageRequest.updateOne({ _id: request._id }, update);

async function failRequest(request, message) {
  const attempts = (request.attempts || 0) + 1;
  await updateRequest(request, {
    $set: {
      status: "failed",
      attempts,
      lastError: message,
      nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS * attempts),
    },
  });
}

/* ---------------- single image upload ---------------- */

async function uploadOne({ type, awb, imagePath, scan_time, flow_type }) {
  console.log(`📤 [imageUpload] Uploading -> type: ${type}, AWB: ${awb}, Path: ${imagePath}`);

  const res = await withTokenRetry(async (token) => {
    let cleanToken = String(token || "").trim();
    if (cleanToken.toLowerCase().startsWith("bearer ")) {
      cleanToken = cleanToken.slice(7).trim();
    }

    // Form + stream har attempt me naya (token retry par purana stream consume ho chuka hota hai)
    const form = new FormData();
    form.append("type", type);
    form.append("awb", awb);
    form.append("flow_type", flow_type || "FWD");
    form.append("scan_time", scan_time);
    form.append("physical_sorter_id", PHYSICAL_SORTER_ID);
    const stream = fs.createReadStream(imagePath);
    form.append("image", stream);

    const length = await new Promise((resolve, reject) =>
      form.getLength((e, l) => (e ? reject(e) : resolve(l)))
    );

    try {
      return await axios.post(UPLOAD_API_URL, form, {
        headers: {
          ...form.getHeaders(),
          "Content-Length": length,
          Authorization: cleanToken,
        },
        timeout: PER_IMAGE_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } finally {
      stream.destroy();
    }
  });

  // HTTP 200 par bhi {"success": false} aa sakta hai
  if (res.data?.success !== true) {
    const e = new Error(`API did not return success:true -> ${JSON.stringify(res.data)}`);
    e.response = res;
    throw e;
  }
  return res;
}

async function logAttempt({ request, img, res, err, attempt }) {
  try {
    await ImageUploadLog.create({
      requestId: request._id,
      type: request.type,
      awb: img.awb,
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

// upload + log; kabhi throw nahi karta
async function uploadAndLog(request, img) {
  const attempt = (request.attempts || 0) + 1;
  try {
    const res = await uploadOne({
      type: request.type,
      awb: img.awb,
      imagePath: img.path,
      scan_time: img.scan_time,
      flow_type: img.flow_type,
    });
    console.log(`✅ [imageUpload] Uploaded ${img.awb}`);
    await logAttempt({ request, img, res, attempt });
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ [imageUpload] Upload failed for ${img.awb}: ${msg}`);
    await logAttempt({ request, img, err, attempt });
    return { ok: false, err, msg };
  }
}

/* ---------------- AWB request ---------------- */

async function processAwb(request) {
  const box = await Boxdata.findOne({ barcode: request.awb }).sort({ date: -1 });

  if (!box) {
    console.warn(`⚠️  [imageUpload] No Boxdata row for AWB: ${request.awb}`);
    await updateRequest(request, { $set: { status: "no_match", lastError: "no matching Boxdata row for this AWB" } });
    return;
  }

  if ((box.imageRetryCount || 0) >= MAX_RETRIES) {
    await updateRequest(request, { $set: { status: "failed", attempts: MAX_RETRIES, lastError: "max retries exceeded" } });
    return;
  }

  const locked = await Boxdata.findOneAndUpdate(
    { _id: box._id, imageProcessing: { $ne: true } },
    { $set: { imageProcessing: true } },
    { new: true }
  );
  if (!locked) {
    console.log(`⚠️  [imageUpload] AWB ${request.awb} already being processed.`);
    return;
  }

  let boxPatch = { $set: { imageProcessing: false } };
  try {
    const { img, reason } = resolveBoxImage(locked);

    if (!img) {
      console.warn(`⚠️  [imageUpload] AWB ${request.awb}: ${reason}`);
      await updateRequest(request, { $set: { status: "no_match", lastError: reason } });
      boxPatch = { $set: { imageProcessing: false, imageLastError: reason } };
      return;
    }

    if (!isWithinSizeCap(img.path)) {
      console.warn(`⚠️  [imageUpload] Image exceeds 1MB: ${img.path}`);
      await updateRequest(request, { $set: { status: "no_match", lastError: "image exceeds 1MB limit" } });
      boxPatch = { $set: { imageProcessing: false, imageLastError: "image exceeds 1MB" } };
      return;
    }

    const result = await uploadAndLog(request, img);

    if (result.ok) {
      await updateRequest(request, {
        $set: { status: "uploaded", lastError: "", matchedImagePaths: [img.path] },
      });
      boxPatch = { $set: { imageSent: "success", imageProcessing: false, imageLastError: "" } };
    } else {
      await failRequest(request, result.msg);
      boxPatch = {
        $set: { imageProcessing: false, imageLastError: result.msg },
        $inc: { imageRetryCount: 1 },
      };
    }
  } catch (err) {
    console.error(`❌ [imageUpload] AWB ${request.awb} unexpected error:`, err.message);
    await failRequest(request, `unexpected: ${err.message}`);
    boxPatch = { $set: { imageProcessing: false, imageLastError: err.message }, $inc: { imageRetryCount: 1 } };
  } finally {
    // lock hamesha release hoga
    await Boxdata.updateOne({ _id: box._id }, boxPatch).catch((e) =>
      console.error("❌ imageUpload: lock release failed:", e.message)
    );
  }
}

/* ---------------- DBO/IBO request ---------------- */

async function processDboIbo(request) {
  const from = new Date(request.dbo_ibo_from);
  const to = new Date(request.dbo_ibo_to);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    await updateRequest(request, { $set: { status: "failed", attempts: MAX_RETRIES, lastError: "invalid DBO/IBO range" } });
    return;
  }

  const alreadyDone = [...(request.matchedImagePaths || []), ...(request.skippedImagePaths || [])];

  // Range ke andar jinki image abhi tak upload/skip nahi hui
  const boxes = await Boxdata.find({
    date: { $gte: from, $lte: to }, // `date` = ISODate (UTC), range bhi UTC "Z" me aati hai
    imagePath: { $nin: [null, "", "image_missing", ...alreadyDone] },
  })
    .sort({ date: 1 })
    .limit(DBO_IMAGES_PER_TICK + 1);

  const hasMore = boxes.length > DBO_IMAGES_PER_TICK;
  const batch = hasMore ? boxes.slice(0, DBO_IMAGES_PER_TICK) : boxes;

  if (!batch.length) {
    const uploadedBefore = (request.matchedImagePaths || []).length > 0;
    await updateRequest(request, {
      $set: {
        status: uploadedBefore ? "uploaded" : "no_match",
        lastError: uploadedBefore ? "" : "no Boxdata images found in this range",
      },
    });
    return;
  }

  console.log(`📦 [imageUpload] DBO/IBO ${request.dbo_ibo_from} -> ${request.dbo_ibo_to}: ${batch.length} image(s) this tick`);

  for (const box of batch) {
    if (stopped) return;

    const { img, reason } = resolveBoxImage(box);
    if (!img) console.warn(`⚠️  [imageUpload] DBO/IBO ${box.barcode}: ${reason}`);

    // File nahi hai / 1MB se badi -> skip list me daalo taaki baar-baar na aaye
    if (!img || !isWithinSizeCap(img.path)) {
      await updateRequest(request, { $addToSet: { skippedImagePaths: box.imagePath } });
      continue;
    }

    // Ek image upload -> uska response -> tabhi agli image
    const result = await uploadAndLog(request, img);

    if (result.ok) {
      await updateRequest(request, { $addToSet: { matchedImagePaths: img.storedPath } });
    } else if (isPermanentImageError(result.err)) {
      await updateRequest(request, { $addToSet: { skippedImagePaths: img.storedPath } });
    } else {
      // network / 5xx / auth / rate-limit -> yahin rukk jao, backoff ke baad dobara
      await failRequest(request, result.msg);
      return;
    }

    await sleep(GAP_BETWEEN_UPLOADS_MS);
  }

  // hasMore => agle tick me bacha hua range, attempts waste nahi honge
  await updateRequest(request, {
    $set: { status: hasMore ? "pending" : "uploaded", lastError: "" },
  });
}

/* ---------------- scheduler ---------------- */

async function processRequest(request) {
  try {
    if (request.type === "AWB") await processAwb(request);
    else if (request.type === "DBO/IBO") await processDboIbo(request);
    else await updateRequest(request, { $set: { status: "failed", attempts: MAX_RETRIES, lastError: `unknown type ${request.type}` } });
  } catch (err) {
    console.error(`❌ [imageUpload] processRequest error (${request._id}):`, err.message);
    await failRequest(request, `unexpected: ${err.message}`).catch(() => {});
  }
}

async function uploadTick() {
  if (running || stopped) return;
  running = true;
  try {
    const pending = await ImageRequest.find({
      status: { $in: ["pending", "failed"] },
      attempts: { $lt: MAX_RETRIES },
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
    })
      .sort({ createdAt: 1 })
      .limit(REQUESTS_PER_TICK);

    if (pending.length) {
      console.log(`📤 [imageUpload] ${pending.length} pending request(s). Processing one by one...`);
    }
    for (const request of pending) {
      if (stopped) break;
      await processRequest(request);
    }
  } catch (err) {
    console.error("❌ [imageUpload] uploadTick error:", err.message);
  } finally {
    running = false;
    scheduleNext(TICK_INTERVAL_MS);
  }
}

function scheduleNext(ms) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(uploadTick, ms);
}

module.exports = fp(async function imageUploadPlugin(fastify) {
  console.log(`⚙️  imageUploadService plugin registered (physical_sorter_id="${PHYSICAL_SORTER_ID}")`);
  scheduleNext(10_000);

  fastify.addHook("onClose", async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    console.log("🛑 imageUploadService stopped");
  });
});
