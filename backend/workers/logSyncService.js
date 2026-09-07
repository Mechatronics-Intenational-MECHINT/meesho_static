// workers/logSyncService.js
//
// DWS Log Sync Service — Fastify Plugin
//
// Runs every 1 hour. Picks up to 250 Boxdata docs pending log sync,
// builds the Meesho logs payload, posts it, and marks them sent.
//
// A doc is "ready to log" when:
//   - logSent = 'pending' AND logProcessing = false
//   - DWS_Status = true (dimensions measured — required for measured_dimensions)
//
// Inscan fields (api_status, api_response_code, api_retry_count,
// inscan_upload_timestamp) come from the LATEST InscanAuditLog entry per barcode.
// If no audit log exists yet, those fields go out as "" / 0 per spec.
//
// Every POST attempt (success or failure) is also recorded in the
// `api_status` collection via the ApiStatus model — payload, status code,
// response body, and attempt number — for later debugging/auditing.
//
// Everything outside the 7 dynamic fields is static — DWS has no
// bag/chute/routing concept, so those stay as fixed defaults matching
// the sample payload shape.

const fp        = require("fastify-plugin");
const axios      = require("axios");
const { withTokenRetry } = require("../config/tokenManager");
const Boxdata         = require("../models/Boxdata");
const InscanAuditLog  = require("../models/InscanAuditLog");
const Settings        = require("../models/Settings");
const ApiStatus       = require("../models/ApiStatus");
const logger = require("../utils/logger");

const LOGS_API_URL   = process.env.MEESHO_LOGS_URL || "https://prod-app.valmo.in/api/v1/sorter/logs";
const BATCH_SIZE      = 250;
const INTERVAL_MS     = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS    = 3;
const RETRY_DELAY_MS  = 5_000;

// ── IST string for a real Date-like value (Date object / ISO string) ─────────

function toIST(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
      .replace(" ", "T") + "+05:30";
  } catch { return ""; }
}

// ── Parse box.scantime's locale-formatted IST wall-clock string ──────────────
// Format seen in Boxdata: "27/8/2026, 7:46:48 pm"  →  D/M/YYYY, h:mm:ss am/pm
// This is already IST local time — NOT UTC — so no timezone shift is applied,
// just reformatted straight to ISO-with-offset.

function parseCustomISTString(raw) {
  if (typeof raw !== "string") return null;

  const m = raw.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i
  );
  if (!m) return null;

  let [, day, month, year, hour, minute, second, meridiem] = m;
  day = Number(day); month = Number(month); year = Number(year);
  hour = Number(hour); minute = Number(minute); second = Number(second);
  meridiem = meridiem.toLowerCase();

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+05:30`;
}

// ── Resolve box.scantime to the ISO-with-offset format the logs API expects ──

function toISTScanTimestamp(raw) {
  if (!raw) return "";

  const parsed = parseCustomISTString(raw);
  if (parsed) return parsed;

  // Fallback for any scantime values that are already real Date objects
  // or proper ISO strings rather than the locale-formatted string above
  const fallback = toIST(raw);
  if (fallback.startsWith("InvalidTDate") || fallback.includes("Invalid Date")) {
    console.warn(`⚠️  logSync: unparseable scantime value:`, JSON.stringify(raw));
    return "";
  }
  return fallback;
}

// ── Mask a bearer/auth header value for safe console logging ─────────────────

function maskAuthHeader(value) {
  if (!value) return value;
  const visible = value.slice(-6);
  return `***${visible}`;
}

// ── Record one POST attempt in the api_status collection ─────────────────────

async function recordApiStatus({ apiName, url, payload, statusCode, success, response, attempt }) {
  try {
    await ApiStatus.create({ apiName, url, payload, statusCode, success, response, attempt });
  } catch (err) {
    console.error("❌ logSync: failed to record api_status:", err.message);
  }
}

// ── Build one item ─────────────────────────────────────────────────────────────

function buildItem(box, auditLog) {
  // ── Dynamic fields (the 7 you asked to update) ──────────────────────────
  const wbn = box.barcode || "";

  const measured_dimensions = {
    length: parseFloat(box.length)  || null,
    width:  parseFloat(box.breadth) || null, // Boxdata uses "breadth", payload wants "width"
    height: parseFloat(box.height)  || null,
    weight: parseFloat(box.weight)  || null,
  };

  const scan_timestamp = toISTScanTimestamp(box.scantime);

  const api_status          = auditLog ? (auditLog.success ? "SUCCESS" : "FAILURE") : "";
  const api_response_code   = auditLog?.statusCode != null ? String(auditLog.statusCode) : "";
  const api_retry_count     = auditLog?.attempts ?? 0;
  const inscan_upload_ts    = auditLog ? toIST(auditLog.createdAt) : "";

  // ── Static fields — no bag/chute/routing concept in DWS ──────────────────
  return {
    entity_id: wbn,
    entity_flow: "FWD",
    entity_status: "SUCCESS",
    entity_reason: "",
    feedline_name: "",
    scan_timestamp,
    api_status,
    api_response_code,
    api_retry_count,
    package_type: "BOX",
    real_volume: parseFloat(box.RealVolume) || null,
    primary_bay_id: "",
    secondary_bay_id: "",
    waybills: [],
    failed_waybills: [],
    shipment_count_on_ls: null,
    chute_blocking_time: null,
    operator_id: "",       // filled in with settings.sorter_id in buildPayload
    bag_closing_timestamp: "",
    destination_name: "",
    defined_dimensions: { length: null, width: null, height: null, weight: null },
    measured_dimensions,
    tolerance: { weight: 50.0, dimension: 1 },
    metadata: {
      waybill_scanned: wbn,
      inscan_mode: "AU",
      active_bin_config: "",
      cycle_count: 1,
      inscan_upload_timestamp: inscan_upload_ts,
      end_node: "",
      next_node: "",
      api_remarks: "",
      primary_sorting_timestamp: "",
      physical_count_in_bag: null,
    },
  };
}

// ── Build full payload ────────────────────────────────────────────────────────

function buildPayload(boxes, auditLogMap, settings) {
  return {
    entity_type: "PARCEL",
    vendor_name: settings.vendor_name || "",
    sorter_id: settings.sorter_id || "",
    sorter_location: settings.sorter_location || "",
    items: boxes.map(box => {
      const item = buildItem(box, auditLogMap.get(box.barcode));
      item.operator_id = settings.sorter_id || "";
      return item;
    }),
  };
}

// ── Post to Meesho logs API ───────────────────────────────────────────────────

async function postLogs(payload) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTokenRetry(async (token) => {
        const headers = {
          "Content-Type": "application/json",
          "Authorization": `${token}`,
        };

        logger.info(`📦 logSync [attempt ${attempt}/${MAX_ATTEMPTS}] URL:`, LOGS_API_URL);
        logger.info(`📦 logSync [attempt ${attempt}/${MAX_ATTEMPTS}] Headers:`, {
          ...headers,
          Authorization: maskAuthHeader(headers.Authorization),
        });
        // logger.info(`📦 logSync [attempt ${attempt}/${MAX_ATTEMPTS}] Payload:`, JSON.stringify(payload, null, 2));

        return axios.post(LOGS_API_URL, payload, { headers, timeout: 30_000 });
      });

      logger.info(`✅ logSync: POST ${LOGS_API_URL} HTTP ${res.status} items=${payload.items.length}`);

      await recordApiStatus({
        apiName: "logSync",
        url: LOGS_API_URL,
        payload,
        statusCode: res.status,
        success: true,
        response: res.data,
        attempt,
      });

      return true;
    } catch (err) {
      const status = err.response?.status || 0;
      const timeout = err.code === "ECONNABORTED" || err.message.includes("timeout");
      console.error(`❌ logSync: attempt ${attempt}/${MAX_ATTEMPTS} failed — ${timeout ? "TIMEOUT" : `HTTP ${status}`}`);
      lastErr = err;

      await recordApiStatus({
        apiName: "logSync",
        url: LOGS_API_URL,
        payload,
        statusCode: status,
        success: false,
        response: err.response?.data || { error: err.message },
        attempt,
      });

      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  console.error("❌ logSync: all attempts exhausted —", lastErr?.message);
  return false;
}

// ── Main sync tick ────────────────────────────────────────────────────────────

async function syncTick() {
  try {
    // ── Settings (vendor_name, sorter_id, sorter_location) ───────────────
    const settings = await Settings.findOne({});
    if (!settings) {
      console.warn("⚠️  logSync: settings document not found — skipping");
      return;
    }

    // ── Fetch up to 250 ready-to-log boxes ────────────────────────────────
    const boxes = await Boxdata.find({
      logSent: "pending",
      logProcessing: false,
      DWS_Status: true, // dimensions must be measured
    })
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE);

    if (!boxes.length) {
      logger.info("logSync: no unsent parcels — skipping");
      return;
    }

    logger.info(`📤 logSync: ${boxes.length} parcel(s) ready to send`);

    // ── Mark as in-progress so nothing double-picks these ─────────────────
    const boxIds = boxes.map(b => b._id);
    await Boxdata.updateMany({ _id: { $in: boxIds } }, { $set: { logProcessing: true } });

    // ── Latest InscanAuditLog per barcode (one batched lookup) ────────────
    const barcodes = boxes.map(b => b.barcode).filter(Boolean);
    const auditLogs = await InscanAuditLog.aggregate([
      { $match: { barcode: { $in: barcodes } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$barcode", doc: { $first: "$$ROOT" } } },
    ]);
    const auditLogMap = new Map(auditLogs.map(a => [a._id, a.doc]));

    // ── Build payload and POST ─────────────────────────────────────────────
    const payload = buildPayload(boxes, auditLogMap, settings);
    const success = await postLogs(payload);

    const now = new Date();

    if (!success) {
      // Release the in-progress lock, leave logSent as "pending" for retry next tick
      await Boxdata.updateMany(
        { _id: { $in: boxIds } },
        {
          $set: { logProcessing: false, logLastAttempt: now, logLastError: "API call failed" },
          $inc: { logRetryCount: 1 },
        }
      );
      console.warn("⚠️  logSync: API call failed — rows NOT marked sent, will retry next tick");
      return;
    }

    // ── Mark sent ────────────────────────────────────────────────────────
    await Boxdata.updateMany(
      { _id: { $in: boxIds } },
      { $set: { logSent: "success", logProcessing: false, logLastAttempt: now, logLastError: "" } }
    );

    logger.info(`✅ logSync: marked ${boxIds.length} row(s) as sent`);

    // ── If full batch, schedule immediate follow-up ────────────────────────
    if (boxes.length === BATCH_SIZE) {
      logger.info(" logSync: full batch — scheduling immediate follow-up");
      setTimeout(() => syncTick(), 5_000);
    }

  } catch (err) {
    console.error("❌ logSync tick error:", err.message);
  }
}

// ── Fastify Plugin ────────────────────────────────────────────────────────────

module.exports = fp(async function logSyncPlugin(fastify) {
  setTimeout(() => syncTick(), 10_000);
  const interval = setInterval(() => syncTick(), INTERVAL_MS);

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
    logger.info("🛑 logSyncService stopped");
  });

  logger.info(`⚙️  logSyncService started (interval=${INTERVAL_MS / 60000} min, batch=${BATCH_SIZE})`);
});