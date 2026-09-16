# Delish Dish Restaurant POS

Waiter-driven restaurant POS with M-Pesa STK integration, per-waiter sales tracking,
opening/closing stock takes, spoilage logging and full Profit & Loss reporting.

## Ports
| Service         | Port | URL                              |
|-----------------|------|----------------------------------|
| API + Waiter UI | 4027 | http://<VPS-IP>:4027             |
| Admin Dashboard | 4028 | http://<VPS-IP>:4028             |

## Folder Structure

```
delish/
├── server.js                  # Express API + serves waiter UI (4027) + admin UI (4028)
├── package.json
├── .env                       # NEVER commit this (credentials live here)
├── .gitignore
├── config/
│   └── db.js                  # MongoDB connection
├── models/
│   ├── User.js                # admin / waiter accounts
│   ├── Product.js             # menu items (name, price, food cost, stock)
│   ├── Order.js               # orders with waiter, table, payment split, COGS
│   ├── MpesaTransaction.js    # confirmed M-Pesa payments
│   └── WebhookLog.js          # raw MegaPay webhook audit trail
└── public/
    ├── waiter/
    │   └── index.html         # waiter terminal (orders, tables, payments, receipts)
    └── admin/
        └── index.html         # dashboard (P&L, waiter sales, stock, spoilage, statements)
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
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Process manager (keeps the app running 24/7)
sudo npm install -g pm2

# Firewall
sudo ufw allow 4027
sudo ufw allow 4028
sudo ufw allow ssh
sudo ufw enable
```

### 3. Clone & configure (on the VPS)

```bash
git clone https://github.com/YOUR_USERNAME/delish-dish.git
cd delish-dish
npm install --omit=dev

# Create the .env file directly on the VPS (do NOT push it to GitHub)
nano .env
# paste:
#   PORT=4027
#   MONGO_URI=mongodb+srv://...
#   MEGAPAY_API_KEY=...
#   MEGAPAY_EMAIL=...
# save: Ctrl+O, Enter, Ctrl+X
```

### 4. Start with PM2

```bash
pm2 start server.js --name delish
pm2 save
pm2 startup        # auto-restart on VPS reboot (run the command it prints)
pm2 logs delish    # watch logs
```

### 5. Updating the app after changes

```bash
# On your machine: edit, commit, push
git add . && git commit -m "update" && git push

# On the VPS:
cd delish-dish
git pull
pm2 restart delish
```

### 6. M-Pesa webhook note

MegaPay calls back to the URL hardcoded in `server.js` (initiate-payment payload):
`http://169.58.58.133:4027/api/megapay/webhook` — keep that IP/port reachable.

## Daily Workflow

1. **Admin** logs in (port 4028) → Stock Control → **Record Opening Stock** (morning count)
2. **Waiters** serve tables on port 4027 — cash, M-Pesa, or split
3. Record any **Spoilage** during the day
4. End of day → **Record Closing Stock**
5. Check **P&L Dashboard** (daily), **Waiter Sales**, **M-Pesa & Cash**, and generate **Statements** for any period
