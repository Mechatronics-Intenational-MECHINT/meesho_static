// workers/inscanApiWorker.js
const fp                 = require("fastify-plugin");
const { Worker }         = require("bullmq");
const axios              = require("axios");
const redisConnection    = require("../config/redisConnection");
const { withTokenRetry } = require("../config/tokenManager");
const Boxdata            = require("../models/Boxdata");
const InscanAuditLog     = require("../models/InscanAuditLog");

const INSCAN_API_URL      = process.env.MEESHO_INSCAN_URL || "https://prod-app.valmo.in/api/v1/sorter/awb/inscan";
const INSCAN_MAX_ATTEMPTS = 5;
const INSCAN_RETRY_DELAY  = 3000;

// ENV se slave_sorter_id fetch ki gayi hai
const PHYSICAL_SORTER_ID  = process.env.SLAVE_SORTER_ID || "";

const bullConnection = { ...redisConnection, maxRetriesPerRequest: null };

// ── Inscan API call with retry ────────────────────────────────────────────────

async function callInscanApi(wbn) {
  // physical_sorter_id ko payload mein add kiya gaya hai
  const payload = {
    waybill_no: String(wbn || "").trim(),
    physical_sorter_id: PHYSICAL_SORTER_ID,
  };

  let lastErr;

  for (let attempt = 1; attempt <= INSCAN_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await withTokenRetry(async (token) => {
        let cleanToken = String(token || "").trim();
        if (cleanToken.toLowerCase().startsWith("bearer ")) {
          cleanToken = cleanToken.slice(7).trim();
        }

        console.log(`\n📤 [inscanApi] Attempt ${attempt}/${INSCAN_MAX_ATTEMPTS} Calling Inscan API...`);
        console.log("📦 Payload:", JSON.stringify(payload));
        console.log("🔑 Token (masked):", cleanToken ? `***${cleanToken.slice(-6)}` : "MISSING");

        return await axios.post(INSCAN_API_URL, payload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: cleanToken,
          },
          timeout: 10_000,
        });
      });

      console.log(`✅ [inscanApi] HTTP ${response.status} Success:`, response.data);

      return {
        success:  true,
        payload,
        response: response.data,
        status:   response.status,
        attempts: attempt,
      };

    } catch (err) {
      const status = err.response?.status;
      const respData = err.response?.data;
      console.error(`❌ inscanApi [attempt ${attempt}/${INSCAN_MAX_ATTEMPTS}]: status=${status} response=`, JSON.stringify(respData || err.message));
      lastErr = err;

      // 400 Bad Request par retry na karein (invalid barcode / bad schema)
      if (status === 400) {
        console.warn(`⚠️  inscanApi: 400 Bad Request — not retrying`);
        return {
          success:  false,
          payload,
          response: respData || { error: err.message },
          status,
          attempts: attempt,
        };
      }

      if (attempt < INSCAN_MAX_ATTEMPTS) {
        const delay = INSCAN_RETRY_DELAY * attempt; // 3s, 6s, 9s, 12s
        console.warn(`⏳ inscanApi: retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  return {
    success:  false,
    payload,
    response: lastErr?.response?.data || { error: lastErr?.message || "Max attempts reached" },
    status:   lastErr?.response?.status || 0,
    attempts: INSCAN_MAX_ATTEMPTS,
  };
}

// ── Persist results ────────────────────────────────────────────────────────────

async function insertAuditLog(wbn, result) {
  try {
    await InscanAuditLog.create({
      barcode:    wbn,
      success:    result.success,
      statusCode: result.status,
      attempts:   result.attempts,
      payload:    result.payload,
      response:   result.response,
    });
  } catch (err) {
    console.error(`❌ inscanWorker: audit log insert failed barcode=${wbn}:`, err.message);
  }
}

async function updateBoxdataInscanResult(wbn, result) {
  try {
    await Boxdata.findOneAndUpdate(
      { barcode: wbn },
      {
        $set: {
          inscanSent:        result.success ? "success" : "failed",
          inscanProcessing:  false,
          inscanLastAttempt: new Date(),
          inscanLastError:   result.success ? "" : (result.response?.error || JSON.stringify(result.response)),
          ...(result.success ? { InScan_Status: true } : {}),
        },
        $inc: { inscanRetryCount: 1 },
      }
    );
  } catch (err) {
    console.error(`❌ inscanWorker: Boxdata update failed barcode=${wbn}:`, err.message);
  }
}

// ── Fastify Plugin ─────────────────────────────────────────────────────────────

module.exports = fp(async function inscanApiWorkerPlugin(fastify) {

  const worker = new Worker(
    "process-inscan",
    async (job) => {
      const { id, wbn } = job.data;

      await Boxdata.findOneAndUpdate({ barcode: wbn }, { $set: { inscanProcessing: true } });

      const result = await callInscanApi(wbn);

      await Promise.all([
        insertAuditLog(wbn, result),
        updateBoxdataInscanResult(wbn, result),
      ]);

      return result;
    },
    {
      connection:  bullConnection,
      concurrency: Number(process.env.INSCAN_WORKER_CONC || 5),
      attempts:    1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`❌ inscanWorker job ${job?.id} failed:`, err.message);
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  console.log(`⚙️  inscanApiWorker plugin started (physical_sorter_id="${PHYSICAL_SORTER_ID}")`);
});