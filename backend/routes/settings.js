
const Settings = require("../models/Settings");

const VALID_FIELDS = new Set(
  Object.keys(Settings.schema.paths).filter((k) => !["_id", "__v"].includes(k))
);

const SENSITIVE_FIELDS = new Set([
  "secretAccessKey",
  "authorizationBearer",
  "giAuthToken",
  "weightApiToken",
  "accessKeyId",
]);

function maskSecrets(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  for (const key of SENSITIVE_FIELDS) {
    if (obj[key]) {
      const s = String(obj[key]);
      obj[key] = s.length > 4 ? `${"•".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}` : "••••••••";
    }
  }
  return obj;
}

async function settingsRoutes(fastify, options) {
  // GET current settings (secrets masked before leaving the server)
  fastify.get("/settings-data", async (request, reply) => {
    try {
      const settings = await Settings.findOne();
      if (!settings) return reply.code(404).send({ message: "No settings found" });
      reply.send(maskSecrets(settings));
    } catch (err) {
      fastify.log.error("Error fetching settings:", err);
      reply.code(500).send({ error: "Internal Server Error" });
    }
  });

  // POST - Save or update settings (whitelisted fields, atomic upsert on the one doc)
  fastify.post("/save", async (request, reply) => {
    try {
      const updates = {};
      for (const [key, value] of Object.entries(request.body || {})) {
        if (VALID_FIELDS.has(key)) updates[key] = value;
      }
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ message: "No valid fields provided" });
      }

      const settings = await Settings.findOneAndUpdate(
        {}, // matches the single existing doc, or none if collection is empty
        { $set: { ...updates, updatedAt: new Date() } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      reply.code(200).send({ message: "Settings saved successfully", settings: maskSecrets(settings) });
    } catch (err) {
      fastify.log.error("Error saving settings:", err);
      reply.code(500).send({ error: "Internal Server Error" });
    }
  });

  // PUT - Update single field (validated, atomic upsert on the one doc)
  fastify.put("/settings-update", async (request, reply) => {
    try {
      const { field, value } = request.body;
      if (!field) return reply.code(400).send({ message: "Field is required" });
      if (!VALID_FIELDS.has(field)) {
        return reply.code(400).send({ message: `Unknown field: "${field}"` });
      }

      const settings = await Settings.findOneAndUpdate(
        {},
        { $set: { [field]: value, updatedAt: new Date() } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      reply.send({ message: "Updated successfully", field, settings: maskSecrets(settings) });
    } catch (err) {
      fastify.log.error("Update error:", err);
      reply.code(500).send({ error: "Failed to update field" });
    }
  });
}

module.exports = settingsRoutes;