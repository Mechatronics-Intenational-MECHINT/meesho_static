// models/AuthToken.js
const mongoose = require("mongoose");

const authTokenSchema = new mongoose.Schema(
  {
    access_token: { type: String, default: null },
    expires_at:   { type: Date,   default: null },
    next_cursor:  { type: String, default: null }, // preserved from pg schema — used for parcel logs pagination
  },
  { timestamps: { createdAt: false, updatedAt: "updated_at" } }
);

// Single-document collection — same empty-filter upsert pattern as the DWS settings fix
module.exports = mongoose.model("AuthToken", authTokenSchema, "auth_table");