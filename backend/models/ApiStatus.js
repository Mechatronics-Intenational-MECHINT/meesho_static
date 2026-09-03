// models/ApiStatus.js
const mongoose = require("mongoose");

const ApiStatusSchema = new mongoose.Schema(
  {
    apiName:    { type: String, required: true }, // e.g. "logSync"
    url:        { type: String },
    payload:    { type: mongoose.Schema.Types.Mixed },
    statusCode: { type: Number },
    success:    { type: Boolean },
    response:   { type: mongoose.Schema.Types.Mixed },
    attempt:    { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ApiStatus", ApiStatusSchema, "api_status");