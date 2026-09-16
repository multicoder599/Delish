const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const orderItemSchema = new mongoose.Schema({
    product_id: { type: String, ref: 'Product', required: true },
    name: { type: String },
    quantity: { type: Number, default: 1 },
    unit_price: { type: Number, required: true },
    unit_cost: { type: Number, default: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    _id: { type: String, default: uuidv4 },
    waiter_id: { type: String, ref: 'User' },
    table_number: { type: String, default: 'Counter' },
    items: [orderItemSchema],
    total_amount: { type: Number, default: 0 },
    total_cost: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'completed', 'voided'], default: 'completed' },
    served_by: { type: String, default: 'Waiter' },
    customer_name: { type: String, default: 'WALK-IN' },
    payment_method: { type: String, default: 'cash' }, // cash | mpesa | split
    mpesa_receipt: { type: String, default: null },
    mpesa_amount: { type: Number, default: 0 },
    cash_tendered: { type: Number, default: null },
    cash_change: { type: Number, default: null }
}, { timestamps: true });

orderSchema.index({ createdAt: -1 });
module.exports = mongoose.model('Order', orderSchema);
