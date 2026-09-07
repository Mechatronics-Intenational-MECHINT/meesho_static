const mongoose = require("mongoose");

const BoxdataSchema = new mongoose.Schema(
  {
    barcode: { type: String },

    length: { type: String },
    breadth: { type: String },
    height: { type: String },
    angle: { type: String },

    weight: { type: String },
  volumetricWeight : { type: String },
    RealVolume: { type: String },
    Volume: { type: String },

    InScan_Status: { type: Boolean }, // physical inscan machine state (unrelated to API sync below)
    DWS_Status: { type: Boolean },

    date: { type: Date },

    imagePath: { type: String },

    scantime: { type: String },
    dwstime: { type: String },

    count: { type: String },

    status: { type: String },
    time: { type: String },

    // 🔥 INSCAN API PROCESSING STATE
    inscanSent: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true
    },
    inscanProcessing: {
      type: Boolean,
      default: false,
      index: true
    },
    inscanRetryCount: { type: Number, default: 0 },
    inscanLastError: { type: String, default: "" },
    inscanLastAttempt: { type: Date },

    // 🔥 LOGS API PROCESSING STATE
    logSent: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true
    },
    logProcessing: {
      type: Boolean,
      default: false,
      index: true
    },
    logRetryCount: { type: Number, default: 0 },
    logLastError: { type: String, default: "" },
    logLastAttempt: { type: Date },

    // 🔥 IMAGE PROCESSING STATE
    imageSent: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true
    },
    imageProcessing: {
      type: Boolean,
      default: false,
      index: true
    },
    imageRetryCount: { type: Number, default: 0 },
    imageLastError: { type: String, default: "" },
    imageLastAttempt: { type: Date }
  },
  { timestamps: true }
);

// 🔥 INDEXES FOR FAST WORKERS — each syncer polls its own pending+not-processing queue
BoxdataSchema.index({ inscanSent: 1, inscanProcessing: 1 });
BoxdataSchema.index({ logSent: 1, logProcessing: 1 });
BoxdataSchema.index({ imageSent: 1, imageProcessing: 1 });

module.exports = mongoose.model("Boxdata", BoxdataSchema);