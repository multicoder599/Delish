const mongoose = require('mongoose');

const mpesaTransactionSchema = new mongoose.Schema({
    store_id: { type: String, default: 'DELISH' },
    ref_id: { type: String, required: true, unique: true },
    receipt: { type: String, default: 'N/A' },
    phone: { type: String },
    amount: { type: Number, required: true },
    waiter: { type: String, default: 'Waiter' },
    status: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Expired'], default: 'Pending' },
    failureReason: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('MpesaTransaction', mpesaTransactionSchema);
