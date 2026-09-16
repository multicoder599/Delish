# Delish Dish Restaurant POS

Waiter-driven restaurant POS with per-waiter sales tracking, opening/closing stock takes,
spoilage logging, full Profit & Loss reporting and product performance statements.

## Ports
| Service         | Port | URL                  |
|-----------------|------|----------------------|
| API + Waiter UI | 4027 | http://<VPS-IP>:4027 |
| Admin Dashboard | 4028 | http://<VPS-IP>:4028 |

## Payments
- **Cash** — waiter enters amount received, change is calculated
- **M-Pesa** — customer pays to the restaurant till manually, waiter confirms
  (edit the till number in `public/waiter/index.html`, constant `TILL_NUMBER`)

## Folder Structure

```
delish/
├── server.js                  # Express API + waiter UI (4027) + admin UI (4028)
├── package.json
├── .env                       # NEVER commit this (credentials live here)
├── .gitignore
├── config/
│   └── db.js                  # MongoDB connection
├── models/
│   ├── User.js                # admin / waiter accounts
│   ├── Product.js             # menu items (price, food cost, stock)
│   └── Order.js               # orders with waiter, table, payment, COGS
├── scripts/
│   └── create-user.js         # CLI: node scripts/create-user.js <user> <pin> [admin|waiter]
└── public/
    ├── waiter/index.html      # waiter terminal (tables, menu, payments, receipts)
    └── admin/index.html       # dashboard (P&L, waiters, stock, spoilage, statements)
```

## Local Development

```bash
npm install
npm run dev        # nodemon
```

## Deployment: GitHub → VPS

### 1. Push to GitHub (from your machine)

```bash
cd delish
git init
git add .
git commit -m "Delish Dish Restaurant POS"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/delish-dish.git
git push -u origin main
```

> `.env` is already in `.gitignore` — your credentials will NOT be pushed.

### 2. First-time VPS setup (Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo ufw allow 4027
sudo ufw allow 4028
sudo ufw enable
```

### 3. Clone & configure (on the VPS)

```bash
git clone https://github.com/YOUR_USERNAME/delish-dish.git
cd delish-dish
npm install --omit=dev
nano .env        # PORT, MONGO_URI, (MegaPay keys no longer required)
pm2 start server.js --name delish
pm2 save
pm2 startup      # run the printed command for auto-start on reboot
pm2 logs delish
```

### 4. Create the first admin account

```bash
node scripts/create-user.js admin 1234 admin
node scripts/create-user.js mary 4321 waiter
```

Further waiters/admins are created from the admin portal → Staff tab.

### 5. Updating the app after changes

```bash
# machine: git add . && git commit -m "update" && git push
# VPS:
cd delish-dish
git pull
pm2 restart delish
```

## Daily Workflow

1. **Admin** (port 4028) → Stock Control → **Record Opening Stock** (morning count)
2. **Waiters** (port 4027) serve tables — cash or manual M-Pesa
3. Record any **Spoilage** during the day
4. End of day → **Record Closing Stock**
5. Review **P&L Dashboard**, **Waiter Sales**, **M-Pesa & Cash**, and generate
   **Statements** for any day, week, month or custom range — including most/least sold products.
