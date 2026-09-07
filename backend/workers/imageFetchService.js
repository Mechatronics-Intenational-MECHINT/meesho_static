// workers/imageFetchService.js
//
// DWS Image Fetch Service — Fastify Plugin
//
// Periodically polls Meesho's cursor-based image-request API to find out
// which AWBs / DBO-IBO ranges need images pushed, and queues each result
// into ImageRequest for imageUploadService to pick up independently.
//
// Cursor lives on the AuthToken doc's `next_cursor` field (shared with the
// rest of the auth layer) so it survives restarts. Scheduling follows
// Meesho's own `next_call_after_seconds` (kept in memory only — not
// persisted, since losing it just means the next tick falls back to the
// default delay and Meesho's next response re-syncs the rhythm).

const fp = require("fastify-plugin");
const axios = require("axios");
const { withTokenRetry } = require("../config/tokenManager");
const AuthToken = require("../models/AuthToken");
const ImageRequest = require("../models/ImageRequest");
const ApiStatus = require("../models/ApiStatus");
const logger = require("../utils/logger");

const FETCH_API_URL =
  process.env.MEESHO_IMAGE_FETCH_URL ||
  "https://env16115-app.dev.meeshogcp.in/api/v1/sorter/image/get";
const DEFAULT_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

let timer = null;

async function recordApiStatus({ apiName, url, payload, statusCode, success, response, attempt }) {
  try {
    await ApiStatus.create({ apiName, url, payload, statusCode, success, response, attempt });
  } catch (err) {
    logger.error(`❌ imageFetch: failed to record api_status: ${err.message}`);
  }
}

async function getCursor() {
  const doc = await AuthToken.findOne({});
  return doc?.next_cursor || null;
}

async function saveCursor(cursor) {
  await AuthToken.findOneAndUpdate(
    {},
    { next_cursor: cursor, updated_at: new Date() },
    { upsert: true }
  );
}

// Idempotent via unique index on {type, awb} for AWB rows — re-running the
// same cursor after a failure won't duplicate queued requests.
async function queueResults(data) {
  const ops = [];

  for (const awb of data.awb || []) {
    ops.push({
      updateOne: {
        filter: { type: "AWB", awb },
        update: {
          $setOnInsert: { type: "AWB", awb, status: "pending", createdAt: new Date() },
        },
        upsert: true,
      },
    });
  }

  if (data["dbo/ibo"] && Array.isArray(data["dbo/ibo_ranges"])) {
    for (const range of data["dbo/ibo_ranges"]) {
      ops.push({
        updateOne: {
          filter: { type: "DBO/IBO", dbo_ibo_from: range.from, dbo_ibo_to: range.to },
          update: {
            $setOnInsert: {
              type: "DBO/IBO",
              dbo_ibo_from: range.from,
              dbo_ibo_to: range.to,
              status: "pending",
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (ops.length) {
    await ImageRequest.bulkWrite(ops, { ordered: false });
    logger.info(`📥 imageFetch: queued ${ops.length} request(s)`);
  }
}

async function fetchTick() {
  const payload = { cursor: await getCursor() };
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTokenRetry(async (token) => {
        const headers = { "Content-Type": "application/json", Authorization: `${token}` };
        return axios.post(FETCH_API_URL, payload, { headers, timeout: 15_000 });
      });

      await recordApiStatus({
        apiName: "imageFetch",
        url: FETCH_API_URL,
        payload,
        statusCode: res.status,
        success: true,
        response: res.data,
        attempt,
      });

      await queueResults(res.data);

      // Cursor advances only on success — a failed attempt reuses the same
      // cursor next time, so nothing gets skipped or duplicated.
      if (res.data.next_cursor) await saveCursor(res.data.next_cursor);

      const delayMs =
        Number(res.data.next_call_after_seconds) > 0
          ? Number(res.data.next_call_after_seconds) * 1000
          : DEFAULT_DELAY_MS;

      logger.info(`✅ imageFetch: tick done, next call in ${delayMs / 1000}s`);
      scheduleNext(delayMs);
      return;
    } catch (err) {
      const status = err.response?.status || 0;
      lastErr = err;
      logger.error(`❌ imageFetch: attempt ${attempt}/${MAX_ATTEMPTS} failed — HTTP ${status}`);

      await recordApiStatus({
        apiName: "imageFetch",
        url: FETCH_API_URL,
        payload,
        statusCode: status,
        success: false,
        response: err.response?.data || { error: err.message },
        attempt,
      });

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  logger.error(`❌ imageFetch: all attempts exhausted — ${lastErr?.message}`);
  scheduleNext(DEFAULT_DELAY_MS);
}

function scheduleNext(delayMs) {
  timer = setTimeout(() => fetchTick(), delayMs);
}

module.exports = fp(async function imageFetchPlugin(fastify) {
  setTimeout(() => fetchTick(), 10_000);

  fastify.addHook("onClose", async () => {
    if (timer) clearTimeout(timer);
    logger.info("🛑 imageFetchService stopped");
  });
console.log("⚙️  imageFetchService started (cursor-driven)")
  logger.info("⚙️  imageFetchService started (cursor-driven)");
});
