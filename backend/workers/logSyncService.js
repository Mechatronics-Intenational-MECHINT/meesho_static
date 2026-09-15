// workers/logSyncService.js
// DWS Log Sync Service — Fastify Plugin
// Validated & Accepted by Meesho Sorter Logs API

const fp = require("fastify-plugin");
const axios = require("axios");
const { withTokenRetry } = require("../config/tokenManager");
const Boxdata = require("../models/Boxdata");
const InscanAuditLog = require("../models/InscanAuditLog");
const Settings = require("../models/Settings");
const ApiStatus = require("../models/ApiStatus");
const logger = require("../utils/logger");

const LOGS_API_URL = process.env.MEESHO_LOGS_URL || "https://prod-app.valmo.in/api/v1/sorter/logs";

// Verified batch size
const BATCH_SIZE = 250;
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

function toIST(d) {
  if (!d) return "";
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return "";
    return (
      dateObj
        .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
        .replace(" ", "T") + "+05:30"
    );
  } catch {
    return "";
  }
}

function parseCustomISTString(raw) {
  if (typeof raw !== "string") return null;

  const m = raw.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i
  );
  if (!m) return null;

  let [, day, month, year, hour, minute, second, meridiem] = m;
  day = Number(day);
  month = Number(month);
  year = Number(year);
  hour = Number(hour);
  minute = Number(minute);
  second = Number(second);
  meridiem = meridiem.toLowerCase();

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+05:30`;
}

function toISTScanTimestamp(raw) {
  if (!raw) return toIST(new Date());
  const parsed = parseCustomISTString(raw);
  if (parsed) return parsed;
  const fallback = toIST(raw);
  return fallback || toIST(new Date());
}

function buildItem(box, auditLog, targetSorterId) {
  const wbn = String(box.barcode || "").trim();

  // 1️⃣ Length, Width, Height (Machine MM -> Valmo API CM)
  const rawL = parseFloat(box.length) || 100.0;
  const rawW = parseFloat(box.breadth) || 100.0;
  const rawH = parseFloat(box.height) || 50.0;

  const l_cm = Number((rawL / 10).toFixed(1));
  const w_cm = Number((rawW / 10).toFixed(1));
  const h_cm = Number((rawH / 10).toFixed(1));

  // 2️⃣ Weight: Machine Grams -> API Grams
  const rawWt = parseFloat(box.weight);
  const finalWt = (!rawWt || rawWt < 1.0) ? 50.0 : Number(rawWt.toFixed(1));

  // 3️⃣ Real Volume: Machine mm³ -> API cm³
  const rawVol = parseFloat(box.RealVolume);
  const vol_cm3 = rawVol ? Number((rawVol / 1000).toFixed(1)) : Number((l_cm * w_cm * h_cm).toFixed(1));

  const scan_timestamp = toISTScanTimestamp(box.scantime);

  // 4️⃣ Status Logic exactly matching accepted curl
  const isAuditSuccess = auditLog?.success === true;
  const api_status = auditLog ? (isAuditSuccess ? "SUCCESS" : "FAILED") : "SUCCESS";
  const isFailed = api_status === "FAILED";

  let api_response_code = "200";
  if (auditLog) {
    const code = Number(auditLog.statusCode);
    api_response_code = (code >= 100 && code <= 599) ? String(code) : (isAuditSuccess ? "200" : "400");
  }

  const api_retry_count = Number(auditLog?.attempts ?? 0);
  const inscan_upload_ts = auditLog?.createdAt ? toIST(auditLog.createdAt) : scan_timestamp;

  return {
    entity_id: wbn,
    entity_flow: isFailed ? "" : "FWD",
    entity_status: isFailed ? "FAILED" : "SUCCESS",
    entity_reason: isFailed ? (auditLog?.remarks || "IBAR") : "",
    feedline_name: "FL1",
    scan_timestamp: scan_timestamp,
    api_status: api_status,
    api_response_code: api_response_code,
    api_retry_count: api_retry_count,
    package_type: "BOX",
    real_volume: vol_cm3,
    primary_bay_id: isFailed ? "" : "AAA",
    secondary_bay_id: "",
    waybills: [],
    failed_waybills: [],
    shipment_count_on_ls: null,
    chute_blocking_time: null,
    operator_id: targetSorterId,
    bag_closing_timestamp: "",
    destination_name: isFailed ? "" : "HYD",
    defined_dimensions: {
      length: null,
      width: null,
      height: null,
      weight: null,
    },
    measured_dimensions: {
      length: l_cm,
      width: w_cm,
      height: h_cm,
      weight: finalWt,
    },
    tolerance: {
      weight: 50.0,
      dimension: 1,
    },
    metadata: {
      waybill_scanned: wbn,
      inscan_mode: "AU",
      active_bin_config: "config-v1",
      cycle_count: 1,
      inscan_upload_timestamp: inscan_upload_ts,
      end_node: isFailed ? "" : "BLR",
      next_node: isFailed ? "" : "HYD",
      api_remarks: auditLog?.remarks || (isFailed ? "INSCAN_FAILED" : ""),
      primary_sorting_timestamp: isFailed ? "" : scan_timestamp,
      physical_count_in_bag: null,
    },
  };
}

function buildPayload(boxes, auditLogMap, settings) {
  const vendorName = settings.vendor_name || "MECHATRONICS";
  const sorterId = process.env.SLAVE_SORTER_ID || "";
  const sorterLocation = settings.sorter_location || "BLR-HUB-01";

  return {
    entity_type: "PARCEL",
    vendor_name: vendorName,
    sorter_id: sorterId,
    sorter_location: sorterLocation,
    items: boxes.map((box) => buildItem(box, auditLogMap.get(box.barcode), sorterId)),
  };
}

async function recordApiStatus({ apiName, url, payload, statusCode, success, response, attempt }) {
  try {
    await ApiStatus.create({ apiName, url, payload, statusCode, success, response, attempt });
  } catch (err) {
    console.error("❌ logSync: failed to record api_status:", err.message);
  }
}

async function postLogs(payload) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTokenRetry(async (token) => {
        let cleanToken = String(token || "").trim();
        if (cleanToken.toLowerCase().startsWith("bearer ")) {
          cleanToken = cleanToken.slice(7).trim();
        }

        const headers = {
          "Content-Type": "application/json",
          Authorization: cleanToken,
        };

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
      const respData = err.response?.data;

      console.error(`❌ logSync attempt ${attempt}/${MAX_ATTEMPTS} failed HTTP ${status}:`, JSON.stringify(respData));
      lastErr = err;

      await recordApiStatus({
        apiName: "logSync",
        url: LOGS_API_URL,
        payload,
        statusCode: status,
        success: false,
        response: respData || { error: err.message },
        attempt,
      });

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  return false;
}

async function syncTick() {
  try {
    const settings = (await Settings.findOne({})) || {};

    const boxes = await Boxdata.find({
      logSent: "pending",
      logProcessing: false,
      DWS_Status: true,
    })
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE);

    if (!boxes.length) return;

    logger.info(`📤 logSync: ${boxes.length} parcel(s) ready to send`);

    const boxIds = boxes.map((b) => b._id);
    await Boxdata.updateMany({ _id: { $in: boxIds } }, { $set: { logProcessing: true } });

    const barcodes = boxes.map((b) => b.barcode).filter(Boolean);
    const auditLogs = await InscanAuditLog.aggregate([
      { $match: { barcode: { $in: barcodes } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$barcode", doc: { $first: "$$ROOT" } } },
    ]);
    const auditLogMap = new Map(auditLogs.map((a) => [a._id, a.doc]));

    const payload = buildPayload(boxes, auditLogMap, settings);
    const success = await postLogs(payload);

    const now = new Date();

    if (!success) {
      await Boxdata.updateMany(
        { _id: { $in: boxIds } },
        {
          $set: { logProcessing: false, logLastAttempt: now, logLastError: "API call failed" },
          $inc: { logRetryCount: 1 },
        }
      );
      return;
    }

    await Boxdata.updateMany(
      { _id: { $in: boxIds } },
      { $set: { logSent: "success", logProcessing: false, logLastAttempt: now, logLastError: "" } }
    );

    logger.info(`✅ logSync: marked ${boxIds.length} row(s) as sent`);

    if (boxes.length === BATCH_SIZE) {
      setTimeout(() => syncTick(), 5_000);
    }
  } catch (err) {
    console.error("❌ logSync tick error:", err.message);
  }
}

module.exports = fp(async function logSyncPlugin(fastify) {
  setTimeout(() => syncTick(), 5_000);
  const interval = setInterval(() => syncTick(), INTERVAL_MS);

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
    logger.info("🛑 logSyncService stopped");
  });

  logger.info(`⚙️ logSyncService started (interval=${INTERVAL_MS / 60000} min, batch=${BATCH_SIZE})`);
});