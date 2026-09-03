const Status = require("../models/Status");

async function statusRoutes(fastify, options) {
  // GET /status-latest — Fetch latest machine status
  fastify.get("/status-latest", async (request, reply) => {
    try {
      const latestStatus = await Status.findOne().sort({ timestamp: -1 });
      reply.send(latestStatus);
    } catch (err) {
      fastify.log.error("Error fetching latest status:", err);
      reply.code(500).send({ error: "Failed to fetch machine status" });
    }
  });

  // POST /status — Update or insert machine status
  fastify.post("/status", async (request, reply) => {
    try {
      let status = await Status.findOne();

      if (status) {
        status = await Status.findOneAndUpdate({}, request.body, { new: true });
      } else {
        status = new Status(request.body);
        await status.save();
      }

      reply.send(status);
    } catch (err) {
      fastify.log.error("Error updating status:", err);
      reply.code(400).send({ message: err.message });
    }
  });
}

module.exports = statusRoutes;
