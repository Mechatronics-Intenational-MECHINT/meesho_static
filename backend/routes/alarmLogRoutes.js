const AlarmLog = require("../models/AlarmLog");

async function alarmLogRoutes(fastify) {

  /* ---------------------------------------------------
     Indexes (safe to call multiple times)
  --------------------------------------------------- */
  AlarmLog.collection.createIndex({ arrivedAt: -1 });
  AlarmLog.collection.createIndex({ resolvedAt: -1 });
  AlarmLog.collection.createIndex({ code: 1 });
  AlarmLog.collection.createIndex({ status: 1 });

  /* ---------------------------------------------------
     GET /alarms/all
     Paginated alarm history with filters
  --------------------------------------------------- */
  fastify.get("/all", async (request, reply) => {
    try {
      const page = Math.max(parseInt(request.query.page) || 1, 1);
      const limit = Math.min(parseInt(request.query.limit) || 50, 1000);
      const skip = (page - 1) * limit;

      const { search, start, end } = request.query;

      const filter = {};

      // 🔎 Filter by alarm code
      if (search) {
        filter.code = new RegExp(
          search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
      }

      // 🕒 Date range filter (UTC Date objects)
      if (start && end) {
        filter.arrivedAt = {
          $gte: new Date(start),
          $lte: new Date(end),
        };
      }

      const [data, total] = await Promise.all([
        AlarmLog.find(filter)
          .sort({ arrivedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AlarmLog.countDocuments(filter),
      ]);

      reply.send({
        success: true,
        data,
        total,
        page,
        limit,
      });
    } catch (err) {
      fastify.log.error("❌ GET /alarms/all failed", err);
      reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  });

  /* ---------------------------------------------------
     GET /alarms/active
     Currently active alarms (for alert UI)
  --------------------------------------------------- */
  fastify.get("/active", async (_, reply) => {
    try {
      const data = await AlarmLog.find({ status: "ACTIVE" })
        .sort({ arrivedAt: -1 })
        .lean();

      reply.send({ success: true, data });
    } catch (err) {
      fastify.log.error("❌ GET /alarms/active failed", err);
      reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  });

  /* ---------------------------------------------------
     GET /alarms/export
     Export all matching alarms (no pagination)
  --------------------------------------------------- */
  fastify.get("/export", async (request, reply) => {
    try {
      const { search, start, end } = request.query;
      const filter = {};

      if (search) {
        filter.code = new RegExp(
          search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
      }

      if (start && end) {
        filter.arrivedAt = {
          $gte: new Date(start),
          $lte: new Date(end),
        };
      }

      const data = await AlarmLog.find(filter)
        .sort({ arrivedAt: -1 })
        .lean();

      reply.send({ success: true, data });
    } catch (err) {
      fastify.log.error("❌ GET /alarms/export failed", err);
      reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  });

  /* ---------------------------------------------------
     DELETE /alarms/:id
     Delete a single alarm (admin use)
  --------------------------------------------------- */
  fastify.delete("/delete/:id", async (request, reply) => {
    try {
      const deleted = await AlarmLog.findByIdAndDelete(request.params.id);
      if (!deleted) {
        return reply.code(404).send({
          success: false,
          message: "Alarm not found",
        });
      }
      reply.send({ success: true });
    } catch (err) {
      fastify.log.error("❌ DELETE /alarms/:id failed", err);
      reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  });

  /* ---------------------------------------------------
     DELETE /alarms/delete-all
     Delete all alarms (admin use)
  --------------------------------------------------- */
  fastify.delete("/delete-all", async (_, reply) => {
    try {
      await AlarmLog.deleteMany({});
      reply.send({ success: true });
    } catch (err) {
      fastify.log.error("❌ DELETE /alarms/delete-all failed", err);
      reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // Add these routes to your existing alarmLogRoutes.js file

  // GET /api/alarms/alert-logs — aggregated alarm frequency
  fastify.get("/alert-logs", async (req, reply) => {
    try {
      const { start, end, search, page = 1, limit = 25 } = req.query;
      const pg = parseInt(page);
      const lim = parseInt(limit);

      const match = {};

      // Date filter — expects IST strings like "2026-04-15 00:00:00"
      // Convert IST string to UTC Date for MongoDB query
      if (start && end) {
        const IST_MS = 5.5 * 3600 * 1000;

        const parseIST = (str) => {
  return new Date(str.replace(" ", "T") + "+05:30");
};

        match.arrivedAt = {
          $gte: parseIST(start),
          $lte: parseIST(end),
        };

        if (isNaN(match.arrivedAt.$gte) || isNaN(match.arrivedAt.$lte)) {
  return reply.code(400).send({
    success: false,
    message: "Invalid date format",
  });
}
      }

      if (search) {
        match.$or = [
          { code: { $regex: search, $options: "i" } },
          { message: { $regex: search, $options: "i" } },
        ];
      }

      // Aggregation pipeline — group by code+message
      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: { code: "$code", message: "$message" },
            cause: { $first: "$cause" },
            count: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] },
            },
            resolvedCount: {
              $sum: { $cond: [{ $eq: ["$status", "RESOLVED"] }, 1, 0] },
            },
            totalDurationMs: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$arrivedAt", false] },
                      { $ifNull: ["$resolvedAt", false] },
                    ],
                  },
                  { $subtract: ["$resolvedAt", "$arrivedAt"] },
                  0,
                ],
              },
            },
            avgDurationMs: {
              $avg: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$arrivedAt", false] },
                      { $ifNull: ["$resolvedAt", false] },
                    ],
                  },
                  { $subtract: ["$resolvedAt", "$arrivedAt"] },
                  null,
                ],
              },
            },
            lastSeen: { $max: "$arrivedAt" },
            firstSeen: { $min: "$arrivedAt" },
          },
        },
        {
          $project: {
            _id: 0,
            code: "$_id.code",
            message: "$_id.message",
            cause: 1,
            count: 1,
            activeCount: 1,
            resolvedCount: 1,
            totalDurationMs: 1,
            avgDurationMs: 1,
            lastSeen: 1,
            firstSeen: 1,
          },
        },
        { $sort: { count: -1 } },
      ];

      // Get total count (without pagination)
      const countPipeline = [...pipeline, { $count: "total" }];
      const countResult = await AlarmLog.aggregate(countPipeline);
      const total = countResult[0]?.total || 0;

      // Add pagination
      pipeline.push({ $skip: (pg - 1) * lim });
      pipeline.push({ $limit: lim });

      const data = await AlarmLog.aggregate(pipeline);

      reply.send({ success: true, data, total });
    } catch (err) {
      console.error("Alert-logs frequency error:", err);
      reply.code(500).send({ success: false, error: err.message });
    }
  });

  // GET /api/alarms/alert-logs/export — export all aggregated frequency (no pagination)
  fastify.get("/alert-logs/export", async (req, reply) => {
    try {
      const { start, end, search } = req.query;

      const match = {};

      if (start && end) {
        const IST_MS = 5.5 * 3600 * 1000;
        const parseIST = (str) => {
          const [datePart, timePart] = str.split(" ");
          const [y, mo, d] = datePart.split("-").map(Number);
          const [h, m, s] = (timePart || "00:00:00").split(":").map(Number);
          return new Date(Date.UTC(y, mo - 1, d, h, m, s || 0) - IST_MS);
        };
        match.arrivedAt = { $gte: parseIST(start), $lte: parseIST(end) };
      }

      if (search) {
        match.$or = [
          { code: { $regex: search, $options: "i" } },
          { message: { $regex: search, $options: "i" } },
        ];
      }

      const data = await AlarmLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: { code: "$code", message: "$message" },
            cause: { $first: "$cause" },
            count: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] },
            },
            resolvedCount: {
              $sum: { $cond: [{ $eq: ["$status", "RESOLVED"] }, 1, 0] },
            },
            totalDurationMs: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$arrivedAt", false] },
                      { $ifNull: ["$resolvedAt", false] },
                    ],
                  },
                  { $subtract: ["$resolvedAt", "$arrivedAt"] },
                  0,
                ],
              },
            },
            avgDurationMs: {
              $avg: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$arrivedAt", false] },
                      { $ifNull: ["$resolvedAt", false] },
                    ],
                  },
                  { $subtract: ["$resolvedAt", "$arrivedAt"] },
                  null,
                ],
              },
            },
            lastSeen: { $max: "$arrivedAt" },
            firstSeen: { $min: "$arrivedAt" },
          },
        },
        {
          $project: {
            _id: 0,
            code: "$_id.code",
            message: "$_id.message",
            cause: 1,
            count: 1,
            activeCount: 1,
            resolvedCount: 1,
            totalDurationMs: 1,
            avgDurationMs: 1,
            lastSeen: 1,
            firstSeen: 1,
          },
        },
        { $sort: { count: -1 } },
      ]);

      reply.send({ success: true, data });
    } catch (err) {
      console.error("Alert-logs export error:", err);
      reply.code(500).send({ success: false, error: err.message });
    }
  });
}

module.exports = alarmLogRoutes;
