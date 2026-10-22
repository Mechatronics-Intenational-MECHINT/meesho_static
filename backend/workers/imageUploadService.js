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
const OPEN_RANGE_RECHECK_MS = 5 * 60_000; // range ka `to` abhi future me hai -> naye boxes aa sakte hain, 5 min baad dobara dekho

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

/* ===== OVERLAY START ===== */

// Overlay fail hone par raw image bhej do? Default: nahi (taaki bina text wali image Valmo na chali jaye)
const OVERLAY_FALLBACK_RAW = process.env.OVERLAY_FALLBACK_RAW === "true";

// ---- TEST / PREVIEW options (sirf testing ke liye) ----
// SAVE_STAMPED_PREVIEW=true -> overlay wali image upload se pehle ek alag folder me save hogi (upload bhi hoga)
// UPLOAD_DRY_RUN=true       -> preview save hoga, par Valmo ko upload NAHI hoga aur request/box ka status nahi badlega
const UPLOAD_DRY_RUN = process.env.UPLOAD_DRY_RUN === "true";
const SAVE_PREVIEW = UPLOAD_DRY_RUN || process.env.SAVE_STAMPED_PREVIEW === "true";
const DRY_RUN_RECHECK_MS = 60 * 60_000;   // dry run me wahi requests baar-baar na chalein
const DRY_RUN_MAX_DBO_IMAGES = 10;        // dry run me ek DBO/IBO range ki sirf itni images
// Default: uploads folder ke barabar me (uploads ke saath), naam "uploads_stamped_test"
const PREVIEW_DIR =
  process.env.STAMPED_PREVIEW_DIR ||
  path.join(process.env.IMAGE_BASE_DIR || process.cwd(), "uploads_stamped_test");

async function savePreview(filename, buffer) {
  try {
    await fs.promises.mkdir(PREVIEW_DIR, { recursive: true });
    const target = path.join(PREVIEW_DIR, filename);
    await fs.promises.writeFile(target, buffer);
    console.log(`🖼️  [imageUpload] Preview saved: ${target}`);
  } catch (e) {
    console.warn(`⚠️  [imageUpload] Preview save failed: ${e.message}`); // upload ko rokna nahi hai
  }
}

const LOCAL_BACKUP_DIR = "D:\\meesho_static2.0\\Uploaded";
async function saveLocalCopy(filename, buffer) {
  try {
    await fs.promises.mkdir(LOCAL_BACKUP_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(LOCAL_BACKUP_DIR, filename), buffer);
    console.log(`💾 [imageUpload] Copied to local backup: ${path.join(LOCAL_BACKUP_DIR, filename)}`);
  } catch (e) {
    console.warn(`⚠️  [imageUpload] Local backup save failed: ${e.message}`);
  }
}

// canvas library: @napi-rs/canvas ya node-canvas (jo bhi installed ho)
let _canvasLib = null;
let _isNapi = false;
function getCanvasLib() {
  if (_canvasLib) return _canvasLib;
  try {
    _canvasLib = require("@napi-rs/canvas");
    _isNapi = true;
  } catch {
    try {
      _canvasLib = require("canvas");
      _isNapi = false;
    } catch {
      const e = new Error("canvas library not installed (npm i @napi-rs/canvas)");
      e.permanent = false;
      throw e;
    }
  }
  return _canvasLib;
}

function encodeJpeg(canvas, quality) {
  // @napi-rs/canvas: quality 0-100 | node-canvas: { quality: 0-1 }
  return _isNapi
    ? canvas.toBuffer("image/jpeg", Math.round(quality * 100))
    : canvas.toBuffer("image/jpeg", { quality });
}

// Profiler ID / Center / State: Settings model se (60 sec cache), warna env se
let _settingsCache = { at: 0, value: null };
async function getOverlaySettings() {
  if (_settingsCache.value && Date.now() - _settingsCache.at < 60_000) return _settingsCache.value;

  let doc = null;
  try {
    // NOTE: apne project me jo Settings model hai uska sahi path yahan rakhiye
    const Settings = require("../models/Settings");
    doc = await Settings.findOne({}).lean();
  } catch (e) {
    console.warn("⚠️  [imageUpload] Settings model read failed, env fallback used:", e.message);
  }

  const value = {
    machineUsername: doc?.machineUsername || process.env.PROFILER_ID || "",
    centerName: doc?.centerName || process.env.CENTER_NAME || "",
    state: doc?.state || process.env.CENTER_STATE || "",
  };
  _settingsCache = { at: Date.now(), value };
  return value;
}

// "2026-10-15T17:04:04+05:30" format (IST)
function toIstIso(raw) {
  if (typeof raw === "string" && /\+05:30$/.test(raw)) return raw;
  const d = raw ? new Date(raw) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Date(valid.getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+05:30");
}
function toOverlayTime(raw) {
  const iso = toIstIso(raw);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}` : iso;
}
function buildOverlayLines(box, st) {
  const l = Number(box.length) || 0;
  const b = Number(box.breadth) || 0;
  const h = Number(box.height) || 0;
  const volumetricWeight = ((l * b * h) / 100).toFixed(2);

  return [
    `AWB: ${box.barcode}`,
    `Dimension (LxBxH): ${box.length} x ${box.breadth} x ${box.height} mm`,
    `Volumetric Weight: ${volumetricWeight}`,
    `Weight: ${box.weight} (gm)`,
    `Real Volume: ${box.RealVolume} cm3`,
    `Volume: ${box.Volume} cm3`,
    `timestamp: ${toOverlayTime(box.dwstime || box.time || box.date)}`,
    `ProfilerID: SC_D17S_MECHINT_SLAVE_PROFILER_2026_001_001`,
    `Location: ${st.centerName}`,
  ];
}

// Raw image buffer -> text overlay wali JPEG buffer (<= MAX_IMAGE_BYTES ki koshish)
async function stampImage(raw, box) {
  const lib = getCanvasLib();

  let image;
  try {
    image = await lib.loadImage(raw);
  } catch (e) {
    const err = new Error(`cannot decode image: ${e.message}`);
    err.permanent = true; // kharab image, retry se theek nahi hogi
    throw err;
  }

  const lines = buildOverlayLines(box, await getOverlaySettings());
  let last = null;

  // Pehle quality kam karo, phir size 85% / 70% / 55% karo, jab tak 1MB ke andar na aaye
  for (const scale of [1, 0.85, 0.7, 0.55]) {
    const w = Math.round(image.width * scale);
    const h = Math.round(image.height * scale);
    const canvas = lib.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, w, h);

    // Text size image ki width ke hisaab se
    const fontPx = Math.max(14, Math.round(w / 90));
    const lineH = Math.round(fontPx * 1.4);
    const pad = Math.round(fontPx * 0.6);
    const bannerH = lines.length * lineH + pad * 2;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, bannerH);

    ctx.fillStyle = "#00FF00";
    ctx.font = `bold ${fontPx}px Consolas, "Courier New", monospace`;
    ctx.textBaseline = "top";
    lines.forEach((t, i) => ctx.fillText(t, pad, pad + i * lineH));

    for (const q of [0.9, 0.8, 0.7, 0.6]) {
      last = encodeJpeg(canvas, q);
      if (last.length <= MAX_IMAGE_BYTES) return last;
    }
  }
  return last;
}

// img.buffer / img.filename set karta hai. Return: { ok } ya { ok:false, reason, permanent }
async function prepareImage(box, img) {
  try {
    const raw = await fs.promises.readFile(img.path);
    let buffer;
    try {
      buffer = await stampImage(raw, box);
    } catch (e) {
      if (OVERLAY_FALLBACK_RAW && !e.permanent) {
        console.warn(`⚠️  [imageUpload] Overlay failed, raw image will be uploaded: ${e.message}`);
        buffer = raw;
      } else {
        return { ok: false, permanent: e.permanent === true, reason: `overlay failed: ${e.message}` };
      }
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, permanent: true, reason: `image exceeds 1MB even after compression (${buffer.length} bytes)` };
    }

    img.buffer = buffer;
    img.filename = path.basename(img.path);
    await saveLocalCopy(img.filename, buffer);
    if (SAVE_PREVIEW) await savePreview(img.filename, buffer);
    return { ok: true };
  } catch (e) {
    return { ok: false, permanent: false, reason: `image prepare error: ${e.message}` };
  }
}

/* ===== OVERLAY END ===== */

async function uploadOne({ type, awb, buffer, filename, scan_time, flow_type }) {
  console.log(`📤 [imageUpload] Uploading -> type: ${type}, AWB: ${awb}, File: ${filename}, ${buffer.length} bytes`);

  const res = await withTokenRetry(async (token) => {
    let cleanToken = String(token || "").trim();
    if (cleanToken.toLowerCase().startsWith("bearer ")) {
      cleanToken = cleanToken.slice(7).trim();
    }

    // Har attempt me naya form (buffer reuse safe hai)
    const form = new FormData();
    form.append("type", type);
    form.append("awb", awb);
    form.append("flow_type", flow_type || "FWD");
    form.append("scan_time", scan_time);
    form.append("physical_sorter_id", PHYSICAL_SORTER_ID);
    form.append("image", buffer, { filename, contentType: "image/jpeg" });

    const length = await new Promise((resolve, reject) =>
      form.getLength((e, l) => (e ? reject(e) : resolve(l)))
    );

    return axios.post(UPLOAD_API_URL, form, {
      headers: {
        ...form.getHeaders(),
        "Content-Length": length,
        Authorization: cleanToken,
      },
      timeout: PER_IMAGE_TIMEOUT_MS,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
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
      buffer: img.buffer,
      filename: img.filename,
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

    // Overlay text lagao + 1MB check
    const prep = await prepareImage(locked, img);
    if (!prep.ok) {
      console.warn(`⚠️  [imageUpload] AWB ${request.awb}: ${prep.reason}`);
      if (prep.permanent) {
        await updateRequest(request, { $set: { status: "no_match", lastError: prep.reason } });
        boxPatch = { $set: { imageProcessing: false, imageLastError: prep.reason } };
      } else {
        await failRequest(request, prep.reason);
        boxPatch = { $set: { imageProcessing: false, imageLastError: prep.reason }, $inc: { imageRetryCount: 1 } };
      }
      return;
    }

    if (UPLOAD_DRY_RUN) {
      console.log(`🧪 [imageUpload] DRY RUN: AWB ${request.awb} preview saved, upload skipped`);
      await updateRequest(request, { $set: { nextAttemptAt: new Date(Date.now() + DRY_RUN_RECHECK_MS) } });
      return; // finally block lock release karega
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

  // Range ke andar sirf REJECTED boxes, jinki image abhi tak upload/skip nahi hui
  const boxes = await Boxdata.find({
    date: { $gte: from, $lte: to }, // `date` = ISODate (UTC), range bhi UTC "Z" me aati hai
    status: { $regex: /^rejected$/i }, // sirf rejected (case-insensitive)
    imagePath: { $nin: [null, "", "image_missing", ...alreadyDone] },
  })
    .sort({ date: 1 })
    .limit(DBO_IMAGES_PER_TICK + 1);

  const hasMore = boxes.length > DBO_IMAGES_PER_TICK;
  const batch = hasMore ? boxes.slice(0, DBO_IMAGES_PER_TICK) : boxes;

  if (!batch.length) {
    // Range abhi chal rahi hai (to > now): abhi "done" mat karo, naye scan hue boxes bhi upload hone chahiye
    if (to.getTime() > Date.now()) {
      await updateRequest(request, {
        $set: { status: "pending", lastError: "", nextAttemptAt: new Date(Date.now() + OPEN_RANGE_RECHECK_MS) },
      });
      return;
    }
    const uploadedBefore = (request.matchedImagePaths || []).length > 0;
    await updateRequest(request, {
      $set: {
        status: uploadedBefore ? "uploaded" : "no_match",
        lastError: uploadedBefore ? "" : "no rejected Boxdata images found in this range",
      },
    });
    return;
  }

  console.log(`📦 [imageUpload] DBO/IBO ${request.dbo_ibo_from} -> ${request.dbo_ibo_to}: ${batch.length} rejected image(s) this tick`);

  let dryCount = 0;
  for (const box of batch) {
    if (stopped) return;

    const { img, reason } = resolveBoxImage(box);
    if (!img) console.warn(`⚠️  [imageUpload] DBO/IBO ${box.barcode}: ${reason}`);

    // File nahi hai -> skip list me daalo taaki baar-baar na aaye
    if (!img) {
      await updateRequest(request, { $addToSet: { skippedImagePaths: box.imagePath } });
      continue;
    }

    // Overlay text lagao + 1MB check
    const prep = await prepareImage(box, img);
    if (!prep.ok) {
      console.warn(`⚠️  [imageUpload] DBO/IBO ${box.barcode}: ${prep.reason}`);
      if (prep.permanent) {
        await updateRequest(request, { $addToSet: { skippedImagePaths: img.storedPath } });
        continue;
      }
      await failRequest(request, prep.reason); // config problem (jaise canvas missing) -> ruk jao
      return;
    }

    if (UPLOAD_DRY_RUN) {
      dryCount += 1;
      if (dryCount >= DRY_RUN_MAX_DBO_IMAGES) break;
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
  if (UPLOAD_DRY_RUN) {
    console.log(`🧪 [imageUpload] DRY RUN: DBO/IBO ${request.dbo_ibo_from} -> ${request.dbo_ibo_to}: ${dryCount} preview(s), upload skipped`);
    await updateRequest(request, { $set: { nextAttemptAt: new Date(Date.now() + DRY_RUN_RECHECK_MS) } });
    return;
  }

  if (hasMore) {
    await updateRequest(request, { $set: { status: "pending", lastError: "" } });
  } else if (to.getTime() > Date.now()) {
    // range abhi khuli hai -> thodi der baad dobara check
    await updateRequest(request, {
      $set: { status: "pending", lastError: "", nextAttemptAt: new Date(Date.now() + OPEN_RANGE_RECHECK_MS) },
    });
  } else {
    await updateRequest(request, { $set: { status: "uploaded", lastError: "" } });
  }
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