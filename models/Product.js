const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    barcode: { type: String, unique: true, sparse: true },
    type: { type: String, default: 'meals' }, // meals | drinks | snacks
    price: { type: Number, default: 0 },      // selling price
    buying_price: { type: Number, default: 0 }, // food cost per unit
    stock: { type: Number, default: 0 },      // units remaining
    image: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
