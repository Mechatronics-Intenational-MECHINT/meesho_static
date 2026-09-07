const mongoose = require("mongoose");

const ImageRequestSchema = new mongoose.Schema({
  type: { type: String, enum: ["AWB", "DBO/IBO"], required: true },

  // type: AWB
  awb: { type: String, index: true },

  // type: DBO/IBO
  dbo_ibo_from: { type: String },
  dbo_ibo_to: { type: String },

  status: {
    type: String,
    enum: ["pending", "matched", "uploaded", "failed", "no_match"],
    default: "pending",
    index: true,
  },

  matchedImagePaths: [{ type: String }],
  lastError: { type: String, default: "" },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Prevent the same AWB request being queued twice by consecutive fetch ticks.
ImageRequestSchema.index(
  { type: 1, awb: 1 },
  { unique: true, partialFilterExpression: { type: "AWB" } }
);

ImageRequestSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("ImageRequest", ImageRequestSchema);
