require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// --- DATABASE MODELS ---
const connectDB = require('./config/db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

// --- RESTOCK AUDIT LOG ---
const StockLogSchema = new mongoose.Schema({
    item_name: String,
    qty_added: Number,
    recorded_by: String,
    createdAt: { type: Date, default: Date.now }
});
const StockLog = mongoose.model('StockLog', StockLogSchema);

// --- OPENING / CLOSING STOCK TAKE ---
const StockTakeSchema = new mongoose.Schema({
    type: { type: String, enum: ['opening', 'closing'], required: true },
    taken_by: String,
    items: [{ product_id: String, name: String, qty: Number, unit_cost: Number, value: Number }],
    total_value: { type: Number, default: 0 },
    date: { type: Date, default: Date.now }
});
const StockTake = mongoose.model('StockTake', StockTakeSchema);

// --- SPOILAGE ---
const SpoilageSchema = new mongoose.Schema({
    product_id: String,
    item_name: String,
    qty: Number,
    unit_cost: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    reason: String,
    recorded_by: String,
    date: { type: Date, default: Date.now }
});
const Spoilage = mongoose.model('Spoilage', SpoilageSchema);

// --- EXPENDITURE ---
const ExpenditureSchema = new mongoose.Schema({
    description: String,
    amount: Number,
    added_by: String,
    date: { type: Date, default: Date.now }
});
const Expenditure = mongoose.model('Expenditure', ExpenditureSchema);

// 1. Connect to Database
connectDB();

// Self-heal legacy documents: barcode:null breaks the unique index (null is indexed as a value).
// Unset it so the field is truly absent — the sparse index then ignores those docs.
mongoose.connection.once('open', async () => {
    try {
        const res = await Product.updateMany({ barcode: null }, { $unset: { barcode: '' } });
        if (res.modifiedCount > 0) console.log(`Migration: cleared barcode on ${res.modifiedCount} legacy product(s)`);
    } catch (e) {
        console.error('Barcode migration error:', e.message);
    }
});

// ==========================================
// 2. CENTRAL API & WAITER SERVER (PORT 4027)
// ==========================================
const API_PORT = 4027;
const ADMIN_PORT = 4028;
const STORE_ID = 'Delish Dish Restaurant';

const apiApp = express();
apiApp.use(cors());
apiApp.use(express.json());
apiApp.use(express.urlencoded({ extended: true }));

// ==========================================
// --- AUTHENTICATION ---
// ==========================================
apiApp.post('/api/login', async (req, res) => {
    const { username, pin, attemptedRole } = req.body;
    try {
        const user = await User.findOne({ username, pin_hash: pin });
        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        if (user.isActive === false && user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Account suspended. Contact Admin.' });
        }
        if (user.role === attemptedRole || user.role === 'admin') {
            res.json({ success: true, token: 'temp-auth-token', role: user.role, userId: user._id, username: user.username });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials or wrong portal' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// --- STAFF MANAGEMENT ---
// ==========================================
apiApp.get('/api/staff', async (req, res) => {
    try {
        const staff = await User.find({ role: { $in: ['admin', 'waiter'] } }, '-pin_hash').sort({ createdAt: -1 });
        res.json({ success: true, staff });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

apiApp.post('/api/staff', async (req, res) => {
    try {
        const { username, role, pin } = req.body;
        if (!['admin', 'waiter'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: 'Username already exists' });
        const newUser = await User.create({ username, role, pin_hash: pin });
        res.json({ success: true, message: 'User added successfully!', user: newUser });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add user' });
    }
});

apiApp.patch('/api/staff/:id/edit', async (req, res) => {
    try {
        const { username, isActive } = req.body;
        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (isActive !== undefined) updateData.isActive = isActive;
        const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to update: ${error.message}` });
    }
});

apiApp.patch('/api/staff/:id/password', async (req, res) => {
    try {
        const { newPin } = req.body;
        await User.findByIdAndUpdate(req.params.id, { pin_hash: newPin });
        res.json({ success: true, message: 'Password updated successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update password' });
    }
});

apiApp.delete('/api/staff/:id', async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        if (userToDelete && userToDelete.username === 'admin') {
            return res.status(400).json({ success: false, message: 'Cannot delete the main admin account!' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'User deleted successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// ==========================================
// --- MENU ITEMS (PRODUCTS) ---
// ==========================================
apiApp.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find({});
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch menu items' });
    }
});

apiApp.get('/api/products/barcode/:code', async (req, res) => {
    try {
        const product = await Product.findOne({ barcode: req.params.code });
        if (!product) return res.status(404).json({ success: false, message: 'Item not found' });
        res.json({ success: true, product });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/products', async (req, res) => {
    try {
        const { name, type, price, buying_price, stock, barcode, image } = req.body;
        const newProduct = await Product.create({
            name,
            barcode: barcode || undefined,
            type: (type || 'meals').toLowerCase(),
            price: Number(price) || 0,
            buying_price: Number(buying_price) || 0,
            stock: Number(stock) || 0,
            image: image || null
        });
        res.json({ success: true, message: 'Menu item created!', product: newProduct });
    } catch (error) {
        console.error('Error creating item:', error);
        res.status(500).json({ success: false, message: `DB Error: ${error.message}` });
    }
});

apiApp.patch('/api/products/:id', async (req, res) => {
    try {
        const { price, buying_price, addedStock, recordedBy, barcode, image, name, stock } = req.body;
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ success: false, message: 'Item not found' });
        if (price !== undefined && price !== '') product.price = Number(price);
        if (buying_price !== undefined && buying_price !== '') product.buying_price = Number(buying_price);
        if (barcode !== undefined) product.barcode = barcode;
        if (image !== undefined) product.image = image;
        if (name !== undefined && name !== '') product.name = name;
        if (stock !== undefined && stock !== '') product.stock = Number(stock);
        if (addedStock && Number(addedStock) > 0) {
            product.stock = (product.stock || 0) + Number(addedStock);
            await StockLog.create({ item_name: product.name, qty_added: Number(addedStock), recorded_by: recordedBy || 'Admin' });
        }
        await product.save();
        res.json({ success: true, message: 'Item updated', product });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to update: ${error.message}` });
    }
});

apiApp.delete('/api/products/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Item deleted!' });
    } catch (error) {
        res.status(500).json({ success: false, message: `DB Error: ${error.message}` });
    }
});

// Seed default Delish Dish menu
apiApp.post('/api/seed-menu', async (req, res) => {
    const menu = [
        { name: 'Chicken (Quarter)', type: 'meals', price: 180, buying_price: 120, stock: 20 },
        { name: 'Beef Stew (Meat)', type: 'meals', price: 120, buying_price: 80, stock: 20 },
        { name: 'Kitheri / Githeri', type: 'meals', price: 70, buying_price: 40, stock: 30 },
        { name: 'Ugali', type: 'meals', price: 30, buying_price: 15, stock: 40 },
        { name: 'Rice', type: 'meals', price: 50, buying_price: 30, stock: 30 },
        { name: 'Chips', type: 'meals', price: 100, buying_price: 60, stock: 25 },
        { name: 'Sausage', type: 'snacks', price: 25, buying_price: 15, stock: 50 },
        { name: 'Smokie', type: 'snacks', price: 30, buying_price: 20, stock: 50 },
        { name: 'Tea', type: 'drinks', price: 20, buying_price: 10, stock: 100 },
        { name: 'Soda', type: 'drinks', price: 50, buying_price: 35, stock: 60 },
        { name: 'Tropical Juice', type: 'drinks', price: 60, buying_price: 40, stock: 40 }
    ];
    try {
        const count = await Product.countDocuments();
        if (count > 0) return res.json({ success: false, message: 'Menu already has items.' });
        for (const m of menu) await Product.create(m);
        res.json({ success: true, message: `Seeded ${menu.length} Delish Dish menu items.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- RESTOCK LOGS ---
// ==========================================
apiApp.get('/api/stock-logs', async (req, res) => {
    try {
        const logs = await StockLog.find().sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- STOCK TAKES (OPENING / CLOSING) ---
// ==========================================
apiApp.get('/api/stock-takes', async (req, res) => {
    try {
        const takes = await StockTake.find().sort({ date: -1 }).limit(60);
        res.json({ success: true, takes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/stock-takes', async (req, res) => {
    const { type, taken_by, items } = req.body;
    if (!['opening', 'closing'].includes(type)) return res.status(400).json({ success: false, message: 'Type must be opening or closing' });
    if (!items || !items.length) return res.status(400).json({ success: false, message: 'No items provided' });
    try {
        const enriched = [];
        let total = 0;
        for (const it of items) {
            const p = await Product.findById(it.product_id);
            if (!p) continue;
            const qty = Number(it.qty);
            const unitCost = p.buying_price || 0;
            const value = qty * unitCost;
            total += value;
            enriched.push({ product_id: p._id, name: p.name, qty, unit_cost: unitCost, value });
        }
        const take = await StockTake.create({ type, taken_by: taken_by || 'Admin', items: enriched, total_value: total });
        res.json({ success: true, take });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- SPOILAGE ---
// ==========================================
apiApp.get('/api/spoilage', async (req, res) => {
    try {
        if (req.query.date) {
            const { start, end } = dayRange(req.query.date);
            const list = await Spoilage.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
            const dayCost = list.reduce((sum, x) => sum + (x.value || 0), 0);
            return res.json({ success: true, list, dayCost });
        }
        const start = new Date(); start.setHours(0,0,0,0);
        const end = new Date(); end.setHours(23,59,59,999);
        const today = await Spoilage.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
        const all = await Spoilage.find({}).sort({ date: -1 }).limit(100);
        const todayCost = today.reduce((s, x) => s + (x.value || 0), 0);
        res.json({ success: true, today, all, todayCost });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/spoilage', async (req, res) => {
    const { product_id, qty, reason, recorded_by } = req.body;
    if (!product_id || !qty) return res.status(400).json({ success: false, message: 'Item and quantity required' });
    try {
        const p = await Product.findById(product_id);
        if (!p) return res.status(404).json({ success: false, message: 'Item not found' });
        const q = Number(qty);
        if (q > p.stock) return res.status(400).json({ success: false, message: `Only ${p.stock} in stock` });
        const unitCost = p.buying_price || 0;
        p.stock -= q;
        await p.save();
        const rec = await Spoilage.create({
            product_id: p._id, item_name: p.name, qty: q,
            unit_cost: unitCost, value: q * unitCost,
            reason: reason || 'Spoilt / expired', recorded_by: recorded_by || 'Admin'
        });
        res.json({ success: true, record: rec });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.delete('/api/spock-logs/:id', async (req, res) => {
    try {
        await Spoilage.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Spoilage record deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- EXPENDITURES ---
// ==========================================
apiApp.get('/api/expenditures', async (req, res) => {
    try {
        if (req.query.date) {
            const { start, end } = dayRange(req.query.date);
            const list = await Expenditure.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
            return res.json({ success: true, expenses: list });
        }
        const expenses = await Expenditure.find({}).sort({ date: -1 });
        res.json({ success: true, expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/expenditures', async (req, res) => {
    try {
        const { description, amount, added_by } = req.body;
        const newExpense = await Expenditure.create({ description, amount: Number(amount), added_by: added_by || 'Admin' });
        res.json({ success: true, expense: newExpense });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.delete('/api/expenditures/:id', async (req, res) => {
    try {
        await Expenditure.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Expense deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- ORDERS ---
// ==========================================
apiApp.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 }).limit(300);
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

apiApp.post('/api/orders', async (req, res) => {
    try {
        const { items, total_amount, served_by, waiter_id, table_number, customer_name, payment_method, mpesa_receipt, mpesa_amount, cash_tendered, cash_change } = req.body;
        let totalCost = 0;
        const enrichedItems = [];
        for (let item of (items || [])) {
            const p = await Product.findById(item.product_id);
            const unitCost = p ? (p.buying_price || 0) : 0;
            totalCost += unitCost * item.quantity;
            enrichedItems.push({ ...item, unit_cost: unitCost });
        }
        const newOrder = await Order.create({
            waiter_id: waiter_id || null,
            table_number: table_number || 'Counter',
            items: enrichedItems,
            total_amount: total_amount,
            total_cost: totalCost,
            status: 'completed',
            served_by: served_by || 'Waiter',
            customer_name: customer_name || 'WALK-IN',
            payment_method: payment_method || 'cash',
            mpesa_receipt: mpesa_receipt || null,
            mpesa_amount: mpesa_amount || 0,
            cash_tendered: cash_tendered || null,
            cash_change: cash_change || null
        });
        if (items && items.length > 0) {
            for (let item of items) {
                if (item.product_id) {
                    await Product.findByIdAndUpdate(item.product_id, { $inc: { stock: -item.quantity } });
                }
            }
        }
        res.json({ success: true, order: newOrder });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to save order: ${error.message}` });
    }
});

// ==========================================
// --- DAILY SALES (totals + per-waiter + cash/mpesa split) ---
// ==========================================
function dayRange(dateStr) {
    if (dateStr) {
        const d = new Date(dateStr);
        const start = new Date(d); start.setHours(0,0,0,0);
        const end = new Date(d); end.setHours(23,59,59,999);
        return { start, end };
    }
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    return { start, end };
}

apiApp.get('/api/sales/today', async (req, res) => {
    const { start, end } = dayRange(req.query.date);
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' });
        const totalSales = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        const totalCost = orders.reduce((sum, o) => sum + (o.total_cost || 0), 0);
        const cashSales = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total_amount || 0), 0);
        const mpesaOrders = orders.filter(o => o.payment_method === 'mpesa' || o.payment_method === 'split');
        const mpesaSales = mpesaOrders.reduce((sum, o) => sum + (o.mpesa_amount || o.total_amount), 0);
        const splitCash = orders.filter(o => o.payment_method === 'split').reduce((sum, o) => sum + ((o.total_amount || 0) - (o.mpesa_amount || 0)), 0);

        const waiterMap = {};
        orders.forEach(o => {
            const w = o.served_by || 'Unknown';
            if (!waiterMap[w]) waiterMap[w] = { waiter: w, orders: 0, revenue: 0, cost: 0, cash: 0, mpesa: 0, items: 0 };
            waiterMap[w].orders += 1;
            waiterMap[w].revenue += o.total_amount || 0;
            waiterMap[w].cost += o.total_cost || 0;
            waiterMap[w].items += (o.items || []).reduce((s, i) => s + i.quantity, 0);
            if (o.payment_method === 'cash') waiterMap[w].cash += o.total_amount || 0;
            else if (o.payment_method === 'mpesa') waiterMap[w].mpesa += o.mpesa_amount || o.total_amount || 0;
            else { waiterMap[w].mpesa += o.mpesa_amount || 0; waiterMap[w].cash += (o.total_amount || 0) - (o.mpesa_amount || 0); }
        });
        const waiters = Object.values(waiterMap).sort((a, b) => b.revenue - a.revenue);

        res.json({ success: true, totalSales, totalCost, grossProfit: totalSales - totalCost, cashSales, mpesaSales, splitCash, orderCount: orders.length, orders, waiters });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// M-Pesa payments list (manual till payments recorded via orders — no STK)
apiApp.get('/api/transactions/today', async (req, res) => {
    const { start, end } = dayRange(req.query.date);
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed', payment_method: { $in: ['mpesa', 'split'] } }).sort({ createdAt: -1 });
        const transactions = [];
        orders.forEach(o => {
            const amt = o.payment_method === 'split' ? (o.mpesa_amount || 0) : (o.total_amount || 0);
            if (amt > 0) transactions.push({
                receipt: o.mpesa_receipt || 'M-PESA',
                phone: 'Manual Till Payment',
                amount: amt,
                waiter: o.served_by,
                createdAt: o.createdAt
            });
        });
        const total = transactions.reduce((s, t) => s + t.amount, 0);
        res.json({ success: true, total, count: transactions.length, transactions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// --- FULL P&L FOR A DAY ---
// ==========================================
apiApp.get('/api/pl/:date', async (req, res) => {
    const { start, end } = dayRange(req.params.date);
    const dateStr = req.params.date || localDateStr(new Date());
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' });
        const revenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        const cogs = orders.reduce((sum, o) => sum + (o.total_cost || 0), 0);
        const expenses = await Expenditure.find({ date: { $gte: start, $lte: end } });
        const expenseTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const spoilage = await Spoilage.find({ date: { $gte: start, $lte: end } });
        const spoilageCost = spoilage.reduce((sum, x) => sum + (x.value || 0), 0);
        const grossProfit = revenue - cogs;

        // Closing-balance cashflow: today's closing (M-Pesa + cash) - yesterday's closing - today's expenses
        const balToday = await DailyBalance.findOne({ date: dateStr });
        const dPrev = new Date(dateStr + 'T00:00:00'); dPrev.setDate(dPrev.getDate() - 1);
        const balPrev = await DailyBalance.findOne({ date: localDateStr(dPrev) });
        const closingMpesa = balToday ? balToday.mpesa : null;
        const closingCash = balToday ? balToday.cash : null;
        const closingTotal = balToday ? (balToday.mpesa + balToday.cash) : null;
        const prevClosing = balPrev ? (balPrev.mpesa + balPrev.cash) : null;
        const totalMade = (closingTotal === null || prevClosing === null) ? null : closingTotal + expenseTotal - prevClosing;

        res.json({
            success: true, revenue, cogs, grossProfit, expenses: expenseTotal, spoilageCost, netProfit: grossProfit - expenseTotal - spoilageCost,
            closingMpesa, closingCash, closingTotal, prevClosing, totalMade, balanceRecorded: !!balToday,
            expenseList: expenses, spoilageList: spoilage, orderCount: orders.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- STATEMENTS & PRODUCT REPORTS ---
// ==========================================
apiApp.get('/api/reports/sales', async (req, res) => {
    const { from, to, group = 'day' } = req.query;
    let start, end;
    if (from) { start = new Date(from); start.setHours(0,0,0,0); } else { start = new Date(); start.setHours(0,0,0,0); }
    if (to) { end = new Date(to); end.setHours(23,59,59,999); } else { end = new Date(); end.setHours(23,59,59,999); }
    if (isNaN(start) || isNaN(end)) return res.status(400).json({ success: false, message: 'Invalid date range' });
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' }).sort({ createdAt: 1 });

        function groupKey(d) {
            if (group === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (group === 'week') {
                const monday = new Date(d);
                const day = monday.getDay();
                const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
                monday.setDate(diff);
                return 'Week of ' + monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            }
            return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        }

        const buckets = {};
        let totals = { revenue: 0, cost: 0, profit: 0, orders: 0, cash: 0, mpesa: 0, items: 0 };
        orders.forEach(o => {
            const key = groupKey(new Date(o.createdAt));
            if (!buckets[key]) buckets[key] = { period: key, orders: 0, items: 0, revenue: 0, cost: 0, cash: 0, mpesa: 0, waiters: new Set() };
            const b = buckets[key];
            const items = (o.items || []).reduce((s, i) => s + i.quantity, 0);
            b.orders += 1; b.items += items;
            b.revenue += o.total_amount || 0; b.cost += o.total_cost || 0;
            b.waiters.add(o.served_by);
            let cash = 0, mpesa = 0;
            if (o.payment_method === 'cash') cash = o.total_amount || 0;
            else if (o.payment_method === 'mpesa') mpesa = o.mpesa_amount || o.total_amount || 0;
            else { mpesa = o.mpesa_amount || 0; cash = (o.total_amount || 0) - (o.mpesa_amount || 0); }
            b.cash += cash; b.mpesa += mpesa;
            totals.revenue += o.total_amount || 0;
            totals.cost += o.total_cost || 0;
            totals.orders += 1; totals.items += items;
            totals.cash += cash; totals.mpesa += mpesa;
        });
        totals.profit = totals.revenue - totals.cost;

        const rows = Object.values(buckets).map(b => ({
            period: b.period, orders: b.orders, items: b.items,
            revenue: b.revenue, cost: b.cost, profit: b.revenue - b.cost,
            cash: b.cash, mpesa: b.mpesa, waiters: b.waiters.size
        }));
        res.json({ success: true, rows, totals, group });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.get('/api/reports/products', async (req, res) => {
    const { from, to } = req.query;
    let start, end;
    if (from) { start = new Date(from); start.setHours(0,0,0,0); } else { start = new Date(); start.setHours(0,0,0,0); }
    if (to) { end = new Date(to); end.setHours(23,59,59,999); } else { end = new Date(); end.setHours(23,59,59,999); }
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' });
        const map = {};
        orders.forEach(o => {
            (o.items || []).forEach(it => {
                const key = it.name || it.product_id;
                if (!map[key]) map[key] = { name: it.name || 'Unknown', qty: 0, revenue: 0, cost: 0, profit: 0 };
                map[key].qty += it.quantity;
                map[key].revenue += (it.unit_price || 0) * it.quantity;
                map[key].cost += (it.unit_cost || 0) * it.quantity;
                map[key].profit += ((it.unit_price || 0) - (it.unit_cost || 0)) * it.quantity;
            });
        });
        const products = Object.values(map).sort((a, b) => b.qty - a.qty);
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- REMAINDER (food left over at day end) ---
// ==========================================
const RemainderSchema = new mongoose.Schema({
    item_name: String,
    qty: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    recorded_by: String,
    date: { type: Date, default: Date.now }
});
const Remainder = mongoose.model('Remainder', RemainderSchema);

apiApp.get('/api/remainder', async (req, res) => {
    try {
        if (req.query.date) {
            const { start, end } = dayRange(req.query.date);
            const list = await Remainder.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
            return res.json({ success: true, list });
        }
        const start = new Date(); start.setHours(0,0,0,0);
        const end = new Date(); end.setHours(23,59,59,999);
        const today = await Remainder.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
        const all = await Remainder.find({}).sort({ date: -1 }).limit(200);
        const todayValue = today.reduce((sum, r) => sum + (r.value || 0), 0);
        res.json({ success: true, today, all, todayValue });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/remainder', async (req, res) => {
    const { item_name, qty, price, recorded_by } = req.body;
    if (!item_name || !qty) return res.status(400).json({ success: false, message: 'Item and quantity required' });
    try {
        const q = Number(qty);
        const p = Number(price) || 0;
        const rec = await Remainder.create({
            item_name, qty: q, price: p, value: q * p,
            recorded_by: recorded_by || 'Staff'
        });
        res.json({ success: true, record: rec });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.delete('/api/remainder/:id', async (req, res) => {
    try {
        await Remainder.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Remainder record deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- DAILY BALANCE (closing M-Pesa + cash, recorded by cashier at day end) ---
// ==========================================
const DailyBalanceSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD (local)
    mpesa: { type: Number, default: 0 },
    cash: { type: Number, default: 0 },
    recorded_by: String
}, { timestamps: true });
const DailyBalance = mongoose.model('DailyBalance', DailyBalanceSchema);

function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

apiApp.get('/api/daily-balance', async (req, res) => {
    const dateStr = req.query.date || localDateStr(new Date());
    try {
        const balance = await DailyBalance.findOne({ date: dateStr });
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const prev = await DailyBalance.findOne({ date: localDateStr(d) });
        res.json({ success: true, date: dateStr, balance, prev });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/daily-balance', async (req, res) => {
    const { date, mpesa, cash, recorded_by } = req.body;
    const dateStr = date || localDateStr(new Date());
    if (mpesa === undefined && cash === undefined) return res.status(400).json({ success: false, message: 'Provide M-Pesa and/or cash totals' });
    try {
        const bal = await DailyBalance.findOneAndUpdate(
            { date: dateStr },
            { mpesa: Number(mpesa) || 0, cash: Number(cash) || 0, recorded_by: recorded_by || 'Staff' },
            { upsert: true, returnDocument: 'after' }
        );
        res.json({ success: true, balance: bal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- DAY DETAIL (products sold + spoilage + remainder + profit for one day) ---
// ==========================================
apiApp.get('/api/reports/day', async (req, res) => {
    const { start, end } = dayRange(req.query.date);
    const dateStr = req.query.date || localDateStr(new Date());
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' });
        const revenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        const cogs = orders.reduce((sum, o) => sum + (o.total_cost || 0), 0);
        const pmap = {};
        orders.forEach(o => (o.items || []).forEach(it => {
            const k = it.name || it.product_id;
            if (!pmap[k]) pmap[k] = { name: it.name || 'Unknown', qty: 0, revenue: 0, cost: 0, profit: 0 };
            pmap[k].qty += it.quantity;
            pmap[k].revenue += (it.unit_price || 0) * it.quantity;
            pmap[k].cost += (it.unit_cost || 0) * it.quantity;
            pmap[k].profit += ((it.unit_price || 0) - (it.unit_cost || 0)) * it.quantity;
        }));
        const products = Object.values(pmap).sort((a, b) => b.qty - a.qty);

        const spoilage = await Spoilage.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
        const spoilageCost = spoilage.reduce((sum, x) => sum + (x.value || 0), 0);
        const remainder = await Remainder.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 });
        const remainderValue = remainder.reduce((sum, x) => sum + (x.value || 0), 0);
        const expenses = await Expenditure.find({ date: { $gte: start, $lte: end } });
        const expenseTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

        // closing-balance cashflow for the day
        const balToday = await DailyBalance.findOne({ date: dateStr });
        const dPrev = new Date(dateStr + 'T00:00:00'); dPrev.setDate(dPrev.getDate() - 1);
        const balPrev = await DailyBalance.findOne({ date: localDateStr(dPrev) });
        const closingTotal = balToday ? (balToday.mpesa + balToday.cash) : null;
        const prevTotal = balPrev ? (balPrev.mpesa + balPrev.cash) : 0;
        const totalMade = closingTotal === null ? null : closingTotal + expenseTotal - prevTotal;

        res.json({
            success: true, date: dateStr,
            revenue, cogs, salesProfit: revenue - cogs,
            expenseTotal, spoilageCost, remainderValue,
            products, spoilage, remainder,
            orderCount: orders.length,
            closingMpesa: balToday ? balToday.mpesa : null,
            closingCash: balToday ? balToday.cash : null,
            prevClosing: balPrev ? prevTotal : null,
            totalMade
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- DAILY PRODUCT PERFORMANCE (product x day matrix) ---
// ==========================================
apiApp.get('/api/reports/daily-products', async (req, res) => {
    const { from, to } = req.query;
    let start, end;
    if (from) { start = new Date(from); start.setHours(0,0,0,0); } else { start = new Date(); start.setHours(0,0,0,0); }
    if (to) { end = new Date(to); end.setHours(23,59,59,999); } else { end = new Date(); end.setHours(23,59,59,999); }
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' }).sort({ createdAt: 1 });
        const dateKeys = [];
        const byDate = {};
        orders.forEach(o => {
            const dk = localDateStr(new Date(o.createdAt));
            if (!byDate[dk]) { byDate[dk] = true; dateKeys.push(dk); }
        });
        const pmap = {};
        orders.forEach(o => {
            const dk = localDateStr(new Date(o.createdAt));
            (o.items || []).forEach(it => {
                const k = it.name || it.product_id;
                if (!pmap[k]) pmap[k] = { name: it.name || 'Unknown', per: {}, qty: 0, revenue: 0, profit: 0 };
                const row = pmap[k];
                row.per[dk] = (row.per[dk] || 0) + it.quantity;
                row.qty += it.quantity;
                row.revenue += (it.unit_price || 0) * it.quantity;
                row.profit += ((it.unit_price || 0) - (it.unit_cost || 0)) * it.quantity;
            });
        });
        const products = Object.values(pmap).sort((a, b) => b.qty - a.qty);
        res.json({ success: true, dates: dateKeys, products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// --- SERVE WAITER FRONTEND (PORT 4027) ---
// ==========================================
apiApp.use(express.static(path.join(__dirname, 'public/waiter')));

apiApp.listen(API_PORT, '0.0.0.0', () => {
    console.log(`Delish Dish API & Waiter Portal running on http://169.58.58.133:${API_PORT}`);
});

// ==========================================
// --- ADMIN FRONTEND SERVER (PORT 4028) ---
// ==========================================
const adminApp = express();
adminApp.use(cors());
adminApp.use(express.static(path.join(__dirname, 'public/admin')));
adminApp.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
adminApp.listen(ADMIN_PORT, '0.0.0.0', () => {
    console.log(`Delish Dish Admin Portal running on http://169.58.58.133:${ADMIN_PORT}`);
});