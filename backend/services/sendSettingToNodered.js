const axios = require("axios");
const Settings = require("../models/Settings");
const logger = require("../utils/logger");

// Same whitelist logic used in your routes — keeps payload in sync with schema
const VALID_FIELDS = Object.keys(Settings.schema.paths).filter(
  (k) => !["_id", "__v", "createdAt", "updatedAt"].includes(k)
);

const NODE_RED_URL =
  process.env.NODE_RED_SETTINGS_URL || "http://localhost:1880/settings-receive";

const AUTO_SEND_INTERVAL_MS = 10000; // 10 sec

let isSending = false;   // overlapping calls ko rokne ke liye
let intervalHandle = null;

/**
 * DB se latest settings uthao (UNMASKED — Node-RED ko real values chahiye)
 * aur Node-RED ke endpoint pe push karo.
 */
async function pushSettingsToNodeRed() {
  if (isSending) {
    console.log("⏭️  Previous send still in progress, skipping this tick");
    return;
  }
  isSending = true;

  try {
    const settingsDoc = await Settings.findOne().lean(); // lean = plain JS object, unmasked
    if (!settingsDoc) {
      console.warn("⚠️  No settings found in DB, skipping Node-RED push");
      return;
    }

    const payload = VALID_FIELDS.reduce((acc, key) => {
      acc[key] = settingsDoc[key] ?? "";
      return acc;
    }, {});

    const res = await axios.post(NODE_RED_URL, payload, {
      timeout: 5000,
    });

    if (res.status === 200) {
      // console.log(`✅ [${new Date().toISOString()}] Settings pushed to Node-RED`);
      // logger.info(`✅ [${new Date().toISOString()}] Settings pushed to Node-RED`)
    } else {
      console.warn(`⚠️  Node-RED responded with status ${res.status}`);
    }
  } catch (err) {
    console.error("❌ Failed to push settings to Node-RED:", err.message);
  } finally {
    isSending = false;
  }
}

/**
 * Scheduler start karo — har 10 sec me settings Node-RED ko push honge.
 * Server start hote hi ek baar call karo, e.g. app.js / server.js me DB connect hone ke baad.
 */
function startSettingsAutoSend() {
  if (intervalHandle) {
    console.log("ℹ️  Settings auto-send already running");
    return;
  }

  // Server start hote hi ek baar turant bhejo
  pushSettingsToNodeRed();

  intervalHandle = setInterval(pushSettingsToNodeRed, AUTO_SEND_INTERVAL_MS);
  console.log(`🔁 Settings auto-send to Node-RED started (every ${AUTO_SEND_INTERVAL_MS / 1000}s)`);
}

/**
 * Scheduler stop karne ke liye (graceful shutdown, tests, etc.)
 */
function stopSettingsAutoSend() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("🛑 Settings auto-send to Node-RED stopped");
  }
}

module.exports = {
  startSettingsAutoSend,
  stopSettingsAutoSend,
  pushSettingsToNodeRed, // manual/one-off trigger ke liye bhi export (e.g. route se call karna ho)
};