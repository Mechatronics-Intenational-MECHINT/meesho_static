// workers/imageFetchService.js
const fp = require("fastify-plugin");
const axios = require("axios");
const { withTokenRetry } = require("../config/tokenManager");
const AuthToken = require("../models/AuthToken");
const ImageRequest = require("../models/ImageRequest");
const ApiStatus = require("../models/ApiStatus");
const logger = require("../utils/logger");

const FETCH_API_URL =
  process.env.MEESHO_IMAGE_FETCH_URL ||
  "https://prod-app.valmo.in/api/v1/sorter/image/get";
const DEFAULT_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

let timer = null;

async function recordApiStatus({ apiName, url, payload, statusCode, success, response, attempt }) {
  try {
    await ApiStatus.create({ apiName, url, payload, statusCode, success, response, attempt });
  } catch (err) {
    console.error("❌ imageFetch: DB logging failed:", err.message);
  }
}

async function getCursor() {
  try {
    const doc = await AuthToken.findOne({});
    return doc?.next_cursor || "";
  } catch (err) {
    console.error("❌ imageFetch: Failed to read cursor from DB:", err.message);
    return "";
  }
}

async function saveCursor(cursor) {
  if (!cursor) return;
  try {
    await AuthToken.findOneAndUpdate(
      {},
      { $set: { next_cursor: cursor, updated_at: new Date() } },
      { upsert: true }
    );
    console.log(`💾 imageFetch: Saved next_cursor -> ${cursor}`);
  } catch (err) {
    console.error("❌ imageFetch: Failed to save cursor:", err.message);
  }
}

async function queueResults(data) {
  const ops = [];

  const awbList = Array.isArray(data?.awb) ? data.awb : [];
  for (const awb of awbList) {
    const cleanAwb = String(awb).trim();
    if (!cleanAwb) continue;

    ops.push({
      updateOne: {
        filter: { type: "AWB", awb: cleanAwb },
        update: {
          $setOnInsert: { type: "AWB", awb: cleanAwb, status: "pending", createdAt: new Date() },
        },
        upsert: true,
      },
    });
  }

  const dboList = data?.["dbo/ibo_ranges"] || [];
  if (Array.isArray(dboList)) {
    for (const range of dboList) {
      if (!range?.from || !range?.to) continue;
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
    // console.log(`📥 imageFetch: Successfully queued ${ops.length} request(s) in ImageRequest collection`);
  } else {
    console.log(`ℹ️  imageFetch: No AWBs or DBO/IBO ranges requested in this cycle.`);
  }
}

async function fetchTick() {
  const currentCursor = await getCursor();

  // Exactly matches doc: only "cursor" key
  const payload = {
    cursor: currentCursor || "",
  };

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

        return axios.post(FETCH_API_URL, payload, { headers, timeout: 15_000 });
      });

      // console.log(`✅ [imageFetch] HTTP ${res.status} Response:`, JSON.stringify(res.data, null, 2));

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

      if (res.data?.next_cursor) {
        await saveCursor(res.data.next_cursor);
      }

      const nextIntervalSeconds = Number(res.data?.next_call_after_seconds);
      const delayMs = nextIntervalSeconds > 0 ? nextIntervalSeconds * 1000 : DEFAULT_DELAY_MS;

      // console.log(`⏱️  [imageFetch] Next call scheduled in ${delayMs / 1000} seconds.`);
      scheduleNext(delayMs);
      return;
    } catch (err) {
      const status = err.response?.status || 0;
      const respData = err.response?.data;
      lastErr = err;

      console.error(`❌ [imageFetch ERROR Attempt ${attempt}/${MAX_ATTEMPTS}] HTTP ${status}:`, JSON.stringify(respData || err.message));

      await recordApiStatus({
        apiName: "imageFetch",
        url: FETCH_API_URL,
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

  console.error(`❌ [imageFetch] All attempts exhausted: ${lastErr?.message}`);
  scheduleNext(DEFAULT_DELAY_MS);
}

function scheduleNext(delayMs) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => fetchTick(), delayMs);
}

module.exports = fp(async function imageFetchPlugin(fastify) {
  console.log("⚙️  imageFetchService plugin registered. Triggering initial fetch in 5 seconds...");
  setTimeout(() => fetchTick(), 5_000);

  fastify.addHook("onClose", async () => {
    if (timer) clearTimeout(timer);
    console.log("🛑 imageFetchService stopped");
  });
});