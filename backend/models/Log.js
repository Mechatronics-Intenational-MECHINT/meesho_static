const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
    username: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    message: { type: String, required: true }
});

module.exports = mongoose.model('Log', LogSchema);
