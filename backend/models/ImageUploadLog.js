const mongoose = require("mongoose");

const ImageUploadLogSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: "ImageRequest" },
  type: { type: String, enum: ["AWB", "DBO/IBO"], required: true },
  awb: { type: String },
  imagePath: { type: String },
  scan_time: { type: String },
  flow_type: { type: String },
  statusCode: { type: Number },
  success: { type: Boolean },
  response: { type: mongoose.Schema.Types.Mixed },
  attempt: { type: Number },
  uploadedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ImageUploadLog", ImageUploadLogSchema);
