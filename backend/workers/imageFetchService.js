// workers/imageFetchService.js
const fp = require("fastify-plugin");
const axios = require("axios");
const { withTokenRetry } = require("../config/tokenManager");
const AuthToken = require("../models/AuthToken");
const ImageRequest = require("../models/ImageRequest");
const ApiStatus = require("../models/ApiStatus");

const FETCH_API_URL = "http://localhost:4000/api/mock-response";

const DEFAULT_DELAY_MS = 60_000;      // API ne time nahi diya / error aaya
const MIN_DELAY_MS = 5_000;           // API kabhi 0 bheje to hammering na ho
const MAX_DELAY_MS = 24 * 60 * 60_000;
const HAS_MORE_DELAY_MS = 2_000;      // has_more=true -> jaldi next page
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

let timer = null;
let running = false;
let stopped = false;

/* ---------------- helpers ---------------- */

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

const isValidDate = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/* ---------------- queue AWB / DBO-IBO ---------------- */

async function queueResults(data) {
  const ops = [];

  // 1) AWB list
  const awbList = Array.isArray(data?.awb) ? data.awb : [];
  const seen = new Set();
  for (const awb of awbList) {
    const cleanAwb = String(awb ?? "").trim();
    if (!cleanAwb || seen.has(cleanAwb)) continue;
    seen.add(cleanAwb);

    ops.push({
      updateOne: {
        filter: { type: "AWB", awb: cleanAwb },
        update: { $setOnInsert: { status: "pending", createdAt: new Date() } },
        upsert: true,
      },
    });
  }

  // 2) DBO/IBO ranges (sirf jab API ne needed bola ho)
  const dboNeeded = data?.["dbo/ibo_needed"] !== false;
  const dboList = data?.["dbo/ibo_ranges"];
  if (dboNeeded && Array.isArray(dboList)) {
    for (const range of dboList) {
      if (!isValidDate(range?.from) || !isValidDate(range?.to)) {
        console.warn("⚠️ imageFetch: Invalid DBO/IBO range skipped:", JSON.stringify(range));
        continue;
      }
      ops.push({
        updateOne: {
          filter: { type: "DBO/IBO", dbo_ibo_from: range.from, dbo_ibo_to: range.to },
          update: { $setOnInsert: { status: "pending", createdAt: new Date() } },
          upsert: true,
        },
      });
    }
  }

  if (!ops.length) {
    console.log("ℹ️  imageFetch: No AWBs or DBO/IBO ranges requested in this cycle.");
    return;
  }

  try {
    await ImageRequest.bulkWrite(ops, { ordered: false });
    console.log(`📥 imageFetch: ${ops.length} request(s) queued (AWB: ${seen.size})`);
  } catch (err) {
    // duplicate key (race) ignore, baaki sab throw
    if (err?.code !== 11000) throw err;
  }
}

/* ---------------- API call with retry ---------------- */

async function callFetchApi(payload) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTokenRetry(async (token) => {
        let cleanToken = String(token || "").trim();
        if (cleanToken.toLowerCase().startsWith("bearer ")) {
          cleanToken = cleanToken.slice(7).trim();
        }
        return axios.post(FETCH_API_URL, payload, {
          headers: { "Content-Type": "application/json", Authorization: cleanToken },
          timeout: 15_000,
        });
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

      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status || 0;
      const respData = err.response?.data;

      console.error(
        `❌ [imageFetch ERROR Attempt ${attempt}/${MAX_ATTEMPTS}] HTTP ${status}:`,
        JSON.stringify(respData || err.message)
      );

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
  return null;
}

/* ---------------- scheduler ---------------- */

function computeDelay(data) {
  // Aur data baaki hai -> turant agla page
  if (data?.has_more === true) return HAS_MORE_DELAY_MS;

  const secs = Number(data?.next_call_after_seconds);
  if (Number.isFinite(secs) && secs > 0) {
    return Math.min(Math.max(secs * 1000, MIN_DELAY_MS), MAX_DELAY_MS);
  }
  return DEFAULT_DELAY_MS;
}

function scheduleNext(delayMs) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  console.log(`⏱️  [imageFetch] Next call in ${Math.round(delayMs / 1000)}s`);
  timer = setTimeout(fetchTick, delayMs);
}

async function fetchTick() {
  if (running || stopped) return;
  running = true;

  let nextDelay = DEFAULT_DELAY_MS;
  try {
    const cursor = await getCursor();
    const data = await callFetchApi({ cursor: cursor || "" });

    if (data) {
      // Pehle queue, phir cursor save: queue fail hua to same cursor se dobara aayega
      await queueResults(data);
      await saveCursor(data.next_cursor);
      nextDelay = computeDelay(data);
    }
  } catch (err) {
    console.error("❌ [imageFetch] Tick failed:", err.message);
  } finally {
    running = false;
    scheduleNext(nextDelay); // chahe kuch bhi ho, loop marna nahi chahiye
  }
}

module.exports = fp(async function imageFetchPlugin(fastify) {
  console.log("⚙️  imageFetchService plugin registered. Triggering initial fetch in 5 seconds...");
  timer = setTimeout(fetchTick, 5_000);

  fastify.addHook("onClose", async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    console.log("🛑 imageFetchService stopped");
  });
});
