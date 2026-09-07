// models/CalibrationBoxStatus.js
const mongoose = require("mongoose");

const CalibrationBoxLogsSchema = new mongoose.Schema({
  barcode: String,
  index: String,
  id: String,
  length: String,
  width: String,
  height: String,
  weight: String,
  volumetricWeight : String,
  calibrateLength: String,
  calibrateWidth: String,
  calibrateHeight: String,
  calibrateWeight: String,
  weightTolerance: String,
  lengthStatus: String,
  widthStatus: String,
  heightStatus: String,
  weightStatus: String,
  finalResult: String,
  lengthVariance: Number,
  widthVariance: Number,
  heightVariance: Number,
  weightVariance: Number,
  scantime: String,
  dwstime: String,
  dimensionTolerance: String,
  timestamp: String,
  apiStatus: String,
}, { timestamps: true });

module.exports = mongoose.model("CalibrationBoxLogs", CalibrationBoxLogsSchema);
