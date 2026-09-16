// Create a user (admin or waiter) from the command line.
// Usage: node scripts/create-user.js <username> <pin> [role]
//   node scripts/create-user.js admin 1234 admin
//   node scripts/create-user.js mary 4321 waiter
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

const [username, pin, role = 'waiter'] = process.argv.slice(2);

if (!username || !pin) {
    console.log('Usage: node scripts/create-user.js <username> <pin> [admin|waiter]');
    process.exit(1);
}
if (!['admin', 'waiter'].includes(role)) {
    console.log('Role must be "admin" or "waiter"');
    process.exit(1);
}

connectDB().then(async () => {
    const existing = await User.findOne({ username });
    if (existing) {
        console.log(`User "${username}" already exists. To change the PIN, delete it first or use the admin portal.`);
        process.exit(0);
    }
    await User.create({ username, pin_hash: pin, role });
    console.log(`Created ${role} account: ${username}`);
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
