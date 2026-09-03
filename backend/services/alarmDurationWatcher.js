const axios = require("axios");
const alarmDictionary = require("../config/alarmDictionary");
const Alarm = require("../models/AlarmLog");
const logger = require("../utils/logger");

// Backend in-memory state (better than frontend)
const activeAlarms = {}; // code: { arrivedAt }

async function pollAlarms() {
  try {
    const res = await axios.get(
      "http://127.0.0.1:5001/api/status/status-latest"
    );

    const statusData = res.data;
    const now = new Date();

    for (const [key, value] of Object.entries(statusData)) {
      if (!/^\d+$/.test(key)) continue;

      const code = key;
      const details = alarmDictionary[code];
      if (!details) continue;

      const alarm = activeAlarms[code];

      // 🔔 Alarm START
      if (value === 1 && !alarm) {
        activeAlarms[code] = { arrivedAt: now };
      }

      // ✅ Alarm RESOLVE
      if (value === 0 && alarm) {
        await Alarm.create({
          code,
          message: details.message,
          cause: details.cause,
          machine_status: details.machine_status,
          remarks: details.remarks,
          arrivedAt: alarm.arrivedAt, // Date
          resolvedAt: now,             // Date
        });

        delete activeAlarms[code];
      }
    }
  } catch (err) {
    logger.error("❌ Backend alarm watcher error:", err.message);
  }
}

module.exports = function startAlarmDurationWatcher() {
  logger.info("🚨 AlarmDurationWatcher started");
  setInterval(pollAlarms, 3000);
};
