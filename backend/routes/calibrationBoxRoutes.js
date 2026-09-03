const CalibrateBoxLogs = require("../models/CalibrateBoxLogs");
const moment = require("moment-timezone");

async function calibrationBoxLogsRoutes(fastify, options) {
  // Ensure indexes exist
  CalibrateBoxLogs.collection.createIndex({ createdAt: -1 });  // ✅ index on createdAt (used for filtering)
  CalibrateBoxLogs.collection.createIndex({ timestamp: -1 });
  CalibrateBoxLogs.collection.createIndex({ barcode: 1 });

  // 📌 POST - Save dimension validation result
  fastify.post("/dimension-status", async (request, reply) => {
    try {
      const saved = await CalibrateBoxLogs.create(request.body);
      reply.code(201).send({ success: true, data: saved });
    } catch (err) {
      fastify.log.error("❌ Failed to store dimension status", err);
      reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // 📌 GET - Fetch paginated calibration data
  fastify.get("/dimension-status", async (request, reply) => {
    try {
      const page  = Math.max(parseInt(request.query.page) || 1, 1);
      const limit = Math.min(parseInt(request.query.limit) || 50, 1000);
      const skip  = (page - 1) * limit;

      const search = (request.query.search || "").trim();
      const startQ = request.query.start ? new Date(request.query.start) : null;
      const endQ   = request.query.end   ? new Date(request.query.end)   : null;

      // Make end inclusive to last millisecond
      const endDate = endQ ? new Date(endQ.getTime()) : null;
      if (endDate) endDate.setMilliseconds(999);

      const filter = {};

      // ✅ FIX: use createdAt (same as summary route) — timestamp field may differ
      if (startQ && endDate) {
        filter.createdAt = { $gte: startQ, $lte: endDate };
      }

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.barcode = rx;
      }

      const [data, total] = await Promise.all([
        CalibrateBoxLogs.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        CalibrateBoxLogs.countDocuments(filter),
      ]);

      // Add computed dimensionResult
      const enrichedData = data.map((item) => ({
        ...item,
        dimensionResult:
          item.lengthStatus === "pass" &&
          item.widthStatus  === "pass" &&
          item.heightStatus === "pass"
            ? "pass"
            : "fail",
      }));

      reply.send({ success: true, data: enrichedData, total, page, limit });
    } catch (err) {
      fastify.log.error("❌ GET /dimension-status failed", err);
      reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // 📌 GET - Export all (ignores pagination)
  fastify.get("/dimension-status/export", async (request, reply) => {
    try {
      const search = (request.query.search || "").trim();
      const startQ = request.query.start ? new Date(request.query.start) : null;
      const endQ   = request.query.end   ? new Date(request.query.end)   : null;

      const endDate = endQ ? new Date(endQ.getTime()) : null;
      if (endDate) endDate.setMilliseconds(999);

      const filter = {};

      // ✅ FIX: use createdAt (same as summary route)
      if (startQ && endDate) {
        filter.createdAt = { $gte: startQ, $lte: endDate };
      }

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.barcode = rx;
      }

      const data = await CalibrateBoxLogs.find(filter)
        .sort({ createdAt: -1 })
        .lean();

      const enrichedData = data.map((item) => ({
        ...item,
        dimensionResult:
          item.lengthStatus === "pass" &&
          item.widthStatus  === "pass" &&
          item.heightStatus === "pass"
            ? "pass"
            : "fail",
      }));

      reply.send({ success: true, data: enrichedData });
    } catch (err) {
      fastify.log.error("❌ GET /dimension-status/export failed", err);
      reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // 📌 DELETE - Remove specific record
  fastify.delete("/dimension-status/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const deleted = await CalibrateBoxLogs.findByIdAndDelete(id);
      if (!deleted) {
        return reply.code(404).send({ success: false, message: "Record not found" });
      }
      reply.send({ success: true, message: "Record deleted", data: deleted });
    } catch (err) {
      fastify.log.error("❌ Failed to delete record", err);
      reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // 📌 DELETE - Clear all
  fastify.delete("/dimension-status", async (request, reply) => {
    try {
      await CalibrateBoxLogs.deleteMany({});
      reply.send({ success: true, message: "All calibration entries deleted" });
    } catch (error) {
      fastify.log.error("❌ Failed to clear calibration entries", error);
      reply.code(500).send({ success: false, message: "Failed to delete entries", error });
    }
  });

  // 📊 GET - Calibration summary (aggregated with time filters)
  fastify.get("/summary", async (request, reply) => {
    try {
      const { range, start, end } = request.query;

      let startDate = null;
      let endDate   = null;

      const now = moment().tz("Asia/Kolkata");

      if (range === "today") {
        startDate = now.clone().startOf("day").toDate();
        endDate   = now.clone().endOf("day").toDate();
      } else if (range === "week") {
        startDate = now.clone().startOf("week").toDate();
        endDate   = now.clone().endOf("day").toDate();
      } else if (range === "month") {
        startDate = now.clone().startOf("month").toDate();
        endDate   = now.clone().endOf("day").toDate();
      } else if (start && end) {
        // ✅ Use the UTC ISO strings directly (frontend sends correct UTC)
        startDate = new Date(start);
        endDate   = new Date(end);
        endDate.setMilliseconds(999);
      }

      const matchStage = {};
      if (startDate && endDate) {
        matchStage.createdAt = { $gte: startDate, $lte: endDate };
      }

      const [result] = await CalibrateBoxLogs.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalBoxes:             { $sum: 1 },
            totalAccuracyCount:     { $sum: { $cond: [{ $eq: ["$finalResult", "pass"] }, 1, 0] } },
            dimensionAccurateCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$lengthStatus", "pass"] },
                      { $eq: ["$widthStatus",  "pass"] },
                      { $eq: ["$heightStatus", "pass"] },
                    ]
                  },
                  1, 0
                ]
              }
            },
            weightAccurateCount: { $sum: { $cond: [{ $eq: ["$weightStatus", "pass"] }, 1, 0] } },
          }
        },
        {
          $project: {
            _id: 0,
            totalBoxes: 1,
            totalAccuracyCount: 1,
            dimensionAccurateCount: 1,
            weightAccurateCount: 1,
            totalAccuracyPercent: {
              $cond: [{ $eq: ["$totalBoxes", 0] }, 0,
                { $multiply: [{ $divide: ["$totalAccuracyCount", "$totalBoxes"] }, 100] }]
            },
            dimensionAccuracyPercent: {
              $cond: [{ $eq: ["$totalBoxes", 0] }, 0,
                { $multiply: [{ $divide: ["$dimensionAccurateCount", "$totalBoxes"] }, 100] }]
            },
            weightAccuracyPercent: {
              $cond: [{ $eq: ["$totalBoxes", 0] }, 0,
                { $multiply: [{ $divide: ["$weightAccurateCount", "$totalBoxes"] }, 100] }]
            },
          }
        }
      ]);

      reply.send({
        success: true,
        range: range || "custom",
        data: result || {
          totalBoxes: 0, totalAccuracyCount: 0, totalAccuracyPercent: 0,
          dimensionAccurateCount: 0, dimensionAccuracyPercent: 0,
          weightAccurateCount: 0, weightAccuracyPercent: 0,
        }
      });

    } catch (err) {
      fastify.log.error("❌ GET /summary failed", err);
      reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });
}

module.exports = calibrationBoxLogsRoutes;