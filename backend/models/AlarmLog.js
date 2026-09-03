const mongoose = require("mongoose");

const AlarmLogSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      index: true
    },

    message: {
      type: String,
      required: true
    },

    cause: {
      type: String
    },

    machine_status: {
      type: String
    },

    remarks: {
      type: String
    },

    arrivedAt: {
      type: Date,
      required: true,
      index: true
    },

    resolvedAt: {
      type: Date,
      default: null
    },

    status: {
      type: String,
      enum: ["ACTIVE", "RESOLVED"],
      default: "RESOLVED",
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("AlarmLog", AlarmLogSchema);
