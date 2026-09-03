// models/InscanAuditLog.js
const mongoose = require("mongoose");

const InscanAuditLogSchema = new mongoose.Schema(
  {
    barcode:    { type: String, index: true },
    success:    { type: Boolean },
    statusCode: { type: Number },
    attempts:   { type: Number },
    payload:    { type: mongoose.Schema.Types.Mixed },
    response:   { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InscanAuditLog", InscanAuditLogSchema, "inscan_audit_log");