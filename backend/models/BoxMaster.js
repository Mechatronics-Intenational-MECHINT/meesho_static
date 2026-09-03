const mongoose = require("mongoose");

const BoxMasterSchema = new mongoose.Schema({
  barcode: { type: String, required: false, unique: false },
  length: { type: String, required: false },       // stored as string
  breadth: { type: String, required: false },      // stored as string
  height: { type: String, required: false },       // stored as string
  weight: { type: String, required: false },       // stored as string
  volume: { type: String, required: false },       // stored as string
  realVolume: { type: String, required: false },   // stored as string
  giStatus: { type: String, enum: ["sent", "not sent"], default: "not sent" },
  giResponse: { type: Number }, // only status: 0 or 1
  weightStatus: { type: String, enum: ["sent", "not sent"], default: "not sent" },
  weightResponse: { type: String }, // only msg
  s3Status: { type: String, enum: ["sent", "not sent"], default: "not sent" },
  s3Path: { type: String },
  processedAt: { type: Date },
}, {
  timestamps: true
});

module.exports = mongoose.model("BoxMaster", BoxMasterSchema);
