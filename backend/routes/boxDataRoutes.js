// routes/boxDataRoutes.js
const Boxdata = require("../models/Boxdata");
const moment = require("moment-timezone");

async function boxDataRoutes(fastify, options) {

  // ✅ PAGINATED BOX DATA (FIXED - uses createdAt)
  fastify.get("/boxdata", async (request, reply) => {
    try {
      const page = Math.max(parseInt(request.query.page) || 1, 1);
      const limit = Math.min(parseInt(request.query.limit) || 50, 1000);
      const skip = (page - 1) * limit;

      const search = (request.query.search || "").trim();
      const start = request.query.startDateTime || null;
      const end = request.query.endDateTime || null;

      const filter = {};

      // 🔥 FIX: use createdAt instead of date
      if (start && end) {
        const startUTC = moment.tz(start, "Asia/Kolkata").tz("UTC").toDate();
        const endUTC = moment.tz(end, "Asia/Kolkata").tz("UTC").toDate();

        filter.createdAt = { $gte: startUTC, $lte: endUTC };
      }

      // 🔍 Barcode search
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.barcode = new RegExp(escaped, "i");
      }

      const totalRecords = await Boxdata.countDocuments(filter);

      const data = await Boxdata.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // ✅ Send IST date based on createdAt
      const formatted = data.map((item) => ({
        ...item,
        dateIST: moment(item.createdAt)
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss"),
      }));

      reply.send({ success: true, data: formatted, totalRecords });

    } catch (err) {
      fastify.log.error("❌ GET /boxdata failed", err);
      reply.code(500).send({ success: false, error: "Failed to fetch box data." });
    }
  });

  // ✅ EXPORT (FIXED)
  fastify.get("/boxdata/export", async (request, reply) => {
    try {
      const search = (request.query.search || "").trim();
      const start = request.query.startDateTime || null;
      const end = request.query.endDateTime || null;

      const filter = {};

      // 🔥 FIX: use createdAt
      if (start && end) {
        const startUTC = moment.tz(start, "Asia/Kolkata").tz("UTC").toDate();
        const endUTC = moment.tz(end, "Asia/Kolkata").tz("UTC").toDate();

        filter.createdAt = { $gte: startUTC, $lte: endUTC };
      }

      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.barcode = new RegExp(escaped, "i");
      }

      const data = await Boxdata.find(filter)
        .sort({ createdAt: -1 })
        .lean();

      const formatted = data.map((item) => ({
        ...item,
        dateIST: moment(item.createdAt)
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss"),
      }));

      reply.send({ success: true, data: formatted });

    } catch (err) {
      fastify.log.error("❌ GET /boxdata/export failed", err);
      reply.code(500).send({ success: false, error: "Failed to export box data." });
    }
  });

  // ✅ CLEAR ALL
  fastify.delete("/boxdata/clear", async (request, reply) => {
    try {
      await Boxdata.deleteMany({});
      reply.send({ success: true, message: "All box data deleted." });
    } catch (err) {
      fastify.log.error("❌ DELETE failed", err);
      reply.code(500).send({ success: false });
    }
  });

}

module.exports = boxDataRoutes;