const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
    store_id: { type: String, default: 'DELISH' },
    ref_id: { type: String },
    raw_payload: { type: String },
    matched_ref: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
