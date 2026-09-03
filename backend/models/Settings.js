const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  machineUsername: { type: String, required: false },
  sorter_id: { type: String, required: false },
  centerName: { type: String, required: false },
  state: { type: String, required: false },
  version: { type: String, required: false },
  bucketName: { type: String, required: false },
  accessKeyId: { type: String, required: false },
  secretAccessKey: { type: String, required: false },
  giAuthToken: { type: String, required: false },
  calibrationWaybillNumber: { type: String, required: false },
  weightApiToken: { type: String, required: false },
  authorization_token: { type: String, required: false },
  giRetryCount: { type: Number, required: false },
  large: { type: Boolean, required: false },
  countThreshold: { type: Number, required: false },
  fixedTime: { type: String, required: false },

  calibrateLength: { type: Number, required: false },
  calibrateWidth: { type: Number, required: false },
  calibrateHeight: { type: Number, required: false },
  calibrateWeight: { type: Number, required: false },
  calibrateToleranceLength: { type: Number, required: false },
  calibrateToleranceWidth: { type: Number, required: false },
  calibrateToleranceHeight: { type: Number, required: false },
  calibrateToleranceWeight: { type: Number, required: false },

  boxlengthMin: { type: Number, required: false },
  boxlengthMax: { type: Number, required: false },
  boxbreadthMin: { type: Number, required: false },
  boxbreadthMax: { type: Number, required: false },
  boxheightMin: { type: Number, required: false },
  boxheightMax: { type: Number, required: false },
  boxweightMin: { type: Number, required: false },
  boxweightMax: { type: Number, required: false },

  regexPattern: { type: String, required: false },
  apiTrigger: { type: Boolean, required: false },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Settings", settingsSchema);