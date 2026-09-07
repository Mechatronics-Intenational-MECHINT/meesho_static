// routes/boxDataRoutes.js
const Boxdata = require("../models/Boxdata");
const moment = require("moment-timezone");
const path = require("path");
const fs   = require("fs");

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

/* ═══════════════════════════════════════════════════════════════════════
   REPLACE the earlier :id-based download route with this barcode-based one.
   Same double "/boxdata" pattern as your other routes in this file
   (export, clear, etc.) — so effective URL is:
     /api/boxdata/boxdata/download-image/:barcode

   Needs at top of file (if not already there):
     const path = require("path");
     const fs   = require("fs");
   ═══════════════════════════════════════════════════════════════════════ */

fastify.get("/boxdata/download-image/:barcode", async (request, reply) => {
  try {
    const { barcode } = request.params;
    if (!barcode) {
      return reply.code(400).send({ success: false, error: "Barcode is required." });
    }

    const uploadsDir = path.join(__dirname, "..", "uploads"); // adjust if this file isn't directly inside /routes

    let files;
    try {
      files = fs.readdirSync(uploadsDir);
    } catch (e) {
      fastify.log.error("❌ Could not read uploads dir:", e.message);
      return reply.code(500).send({ success: false, error: "Could not read uploads folder." });
    }

    // Images are stored as "<barcode>-<timestamp>.jpg" — match by prefix only.
    // We never build a filesystem path directly from the client-supplied barcode;
    // we only use it to filter an actual directory listing, then join the
    // filename that we found on disk. That rules out path traversal.
    const matches = files.filter((f) => f.startsWith(`${barcode}-`));

    if (!matches.length) {
      return reply.code(404).send({ success: false, error: "No image found for this barcode." });
    }

    // If more than one image exists for this barcode (re-scans, duplicates),
    // pick the most recent one — same descending sort tryMatchImage() uses.
    matches.sort((a, b) => b.localeCompare(a));
    const filename = matches[0];
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: "File missing on disk." });
    }

    reply.header("Content-Disposition", `attachment; filename="${barcode}.jpg"`);
    reply.type("image/jpeg");
    return reply.send(fs.createReadStream(filePath));

  } catch (err) {
    fastify.log.error("❌ GET /boxdata/download-image failed", err);
    reply.code(500).send({ success: false, error: "Failed to download image." });
  }
});

}

module.exports = boxDataRoutes;