// config/tokenManager.js (DWS / MongoDB)
const axios       = require("axios");
const redisClient = require("./redisClient");
const AuthToken   = require("../models/AuthToken");
const Settings    = require("../models/Settings"); // adjust path to your existing settings model

let cachedToken    = null;
let expiresAt      = 0;
let refreshPromise = null;

const REDIS_KEY = "dws:access_token"; // separate namespace from meesho:access_token
const BUFFER_MS = 50_000;
const BASE_URL  = process.env.MEESHO_AUTH_URL || "https://prod-app.valmo.in/api/v1/oauth/token";

async function init() {
  await restoreFromRedis();
  if (!tokenIsValid()) await restoreFromDb();
  if (!tokenIsValid()) await doRefresh();
  console.log("✅ tokenManager (DWS) initialized");
}

function tokenIsValid() {
  return !!(cachedToken && Date.now() < expiresAt - BUFFER_MS);
}

async function restoreFromRedis() {
  try {
    const raw = await redisClient.get(REDIS_KEY);
    if (raw) {
      const { token, expires_at } = JSON.parse(raw);
      cachedToken = token;
      expiresAt   = expires_at;
      console.log("🔑 tokenManager: token restored from Redis");
    }
  } catch (err) {
    console.warn("⚠️  tokenManager: Redis restore failed:", err.message);
  }
}

async function restoreFromDb() {
  try {
    const doc = await AuthToken.findOne({}); // empty filter — single-doc collection
    if (doc?.access_token) {
      cachedToken = doc.access_token;
      expiresAt   = doc.expires_at.getTime();
      console.log("🔑 tokenManager: token restored from DB");
    }
  } catch (err) {
    console.warn("⚠️  tokenManager: DB restore failed:", err.message);
  }
}

async function getSettings() {
  const settings = await Settings.findOne({}); // same empty-filter pattern as settings routes
  if (!settings) throw new Error("tokenManager: settings document not found");
  const { sorter_id, authorization_token } = settings;
  if (!authorization_token || !sorter_id) {
    throw new Error("tokenManager: missing authorization_token or sorter_id in settings");
  }
  return { sorter_id, authorization_token };
}

async function doRefresh() {
  const { sorter_id, authorization_token } = await getSettings();

  console.log("🔑 tokenManager: calling Meesho auth API...");
  const response = await axios.post(
    BASE_URL,
    { sorter_id },
    {
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${authorization_token}`,
      },
      timeout: 10_000,
    }
  );
console.log("response",response.data,authorization_token)
  const { access_token, expiry_at } = response.data;
  if (!access_token) throw new Error("tokenManager: no access_token in auth response");

  const newExpiresAt = Number(expiry_at) * 1000; // epoch seconds → ms
  if (!Number.isFinite(newExpiresAt) || newExpiresAt <= Date.now()) {
    throw new Error(`tokenManager: invalid expiry_at from auth response: ${expiry_at}`);
  }

  cachedToken = access_token;
  expiresAt   = newExpiresAt;

  await AuthToken.findOneAndUpdate(
    {},
    { access_token, expires_at: new Date(newExpiresAt), updated_at: new Date() },
    { upsert: true, new: true }
  );

  const ttlSeconds = Math.floor((newExpiresAt - Date.now()) / 1000);
  if (ttlSeconds > 0) {
    await redisClient.set(
      REDIS_KEY,
      JSON.stringify({ token: access_token, expires_at: newExpiresAt }),
      "EX",
      ttlSeconds
    );
    console.log(`✅ tokenManager: token cached in Redis for ${ttlSeconds}s`);
  } else {
    console.warn(`⚠️  tokenManager: skipped Redis cache — ttlSeconds=${ttlSeconds}`);
  }

  console.log(`✅ tokenManager: token refreshed, expires at ${new Date(newExpiresAt).toISOString()}`);
  return cachedToken;
}

async function getValidToken() {
  if (tokenIsValid()) return cachedToken;
  if (refreshPromise) return await refreshPromise;
  refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  return await refreshPromise;
}

async function forceRefresh() {
  console.warn("⚠️  tokenManager: force refresh triggered (401 received)");
  cachedToken = null;
  expiresAt   = 0;
  return await getValidToken();
}

async function withTokenRetry(requestFn) {
  try {
    const token = await getValidToken();
    return await requestFn(token);
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn("⚠️  tokenManager: 401 — refreshing and retrying...");
      const freshToken = await forceRefresh();
      return await requestFn(freshToken);
    }
    throw err;
  }
}

module.exports = { init, getValidToken, forceRefresh, withTokenRetry, tokenIsValid };