const BoxMaster = require("../models/BoxMaster");

async function boxMasterRoutes(fastify, options) {

  BoxMaster.collection.createIndex({ barcode: 1 });
  BoxMaster.collection.createIndex({ createdAt: -1 });

  // 📥 GET with filters (IST → UTC conversion)
  fastify.get("/boxmaster", async (request, reply) => {
    try {
      const page  = Math.max(parseInt(request.query.page) || 1, 1);
      const limit = Math.min(parseInt(request.query.limit) || 50, 5000);
      const skip  = (page - 1) * limit;

      const search = (request.query.search || "").trim();
      const startQ = request.query.start;
      const endQ   = request.query.end;
      const statusFilter = request.query.status || "";

      const filter = {};

      // ✅ IST → UTC conversion
      if (startQ && endQ) {
        const startUTC = new Date(startQ + "+05:30");
        const endUTC   = new Date(endQ + "+05:30");

        filter.createdAt = {
          $gte: startUTC,
          $lte: endUTC,
        };
      }

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.barcode = rx;
      }

      // status filter
      switch (statusFilter) {
        case "success":
          filter.giStatus = "sent";
          filter.weightStatus = "sent";
          filter.s3Status = "sent";
          break;
        case "gi_not_sent":
          filter.giStatus = "not sent";
          break;
        case "gi_sent":
          filter.giStatus = "sent";
          break;
        case "dws_not_sent":
          filter.weightStatus = "not sent";
          break;
        case "dws_sent":
          filter.weightStatus = "sent";
          break;
        case "image_sent":
          filter.s3Status = "sent";
          break;
        case "image_not_sent":
          filter.s3Status = "not sent";
          break;
      }

      const [data, total] = await Promise.all([
        BoxMaster.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        BoxMaster.countDocuments(filter),
      ]);

      reply.send({ success: true, data, total });

    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ success: false });
    }
  });

  // 📤 EXPORT
  fastify.get("/boxmaster/export", async (request, reply) => {
    try {
      const search = (request.query.search || "").trim();
      const startQ = request.query.start;
      const endQ   = request.query.end;
      const statusFilter = request.query.status || "";

      const filter = {};

      if (startQ && endQ) {
        filter.createdAt = {
          $gte: new Date(startQ + "+05:30"),
          $lte: new Date(endQ + "+05:30"),
        };
      }

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.barcode = rx;
      }

      const data = await BoxMaster.find(filter)
        .sort({ createdAt: -1 })
        .lean();

      reply.send({ success: true, data });

    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ success: false });
    }
  });

}

module.exports = boxMasterRoutes;