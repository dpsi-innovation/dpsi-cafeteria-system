# 🏫 School LMS - Cafeteria Wallet & Canteen POS Microservice

A zero-risk, double-entry financial microservice that links student cafeteria wallets directly to their **School LMS Admission Number**.

---

## 🌟 Live Localhost URL

Open in your browser:
👉 **[http://localhost:4000](http://localhost:4000)**

---

## 🚀 Key Modules Built & Active

### 1. 👨‍👧 Parent Top-Up Dashboard
- Select child mapped by **LMS Admission Number** (e.g. `ADM-2026-101`).
- Quick-pick amounts (`+₹100`, `+₹200`, `+₹500`, `+₹1000`) or custom amounts.
- Supported payment methods: UPI, Cards, Net Banking.
- **Idempotency Protection**: Every top-up generates a cryptographic UUID to prevent duplicate charges or double credit.
- Immediate wallet credit with live transaction ledger.

### 2. 🛒 Cafeteria POS Terminal (Canteen Counter)
- Search / barcode scanner by **Student Admission Number**.
- Real-time display of **student name, class, section, photo/avatar, wallet balance, and remaining daily limit**.
- Interactive food tray catalog with live pricing:
  - 🥪 Veg Grilled Sandwich (₹40.00)
  - 🍲 Idli Vada Combo (₹35.00)
  - 🌯 Paneer Wrap (₹50.00)
  - 🍛 Mini Thali Lunch (₹70.00)
  - 🧃 Fresh Fruit Juice (₹25.00)
  - 🥤 Chocolate Milkshake (₹30.00)
  - 🥟 Samosa (₹20.00)
  - 🥗 Fruit Salad (₹30.00)
- **Automatic Budget & Balance Checks**:
  - Rejects with HTTP 402 if balance is insufficient.
  - Rejects with HTTP 403 if daily spend limit is exceeded.
- Instantly updates balance and creates an order receipt.

### 3. 🎓 Student Digital Kiosk Pass
- Virtual canteen student pass showing balance, daily limits, and full history.

### 4. 🛡️ Financial Security & Audit Engine
- **Double-Entry Bookkeeping**: Every transaction writes a balanced debit and credit ledger entry.
- **Zero-Drift Live Reconciliation**: Verifies that `Wallet Balance == Sum(Ledger Entries)` across all students.
- **Immutable Audit Logs**: Every login, purchase, top-up, limit breach, or decline is permanently logged with IP and correlation ID.
- **ACID Transactions**: Atomic lock ensures zero race conditions during peak lunch queues.

---

## 🛠️ How to Run Manually

```bash
# Start server
node --experimental-sqlite src/server.js
```

Or with Docker (when Docker Desktop is installed):
```bash
docker compose up -d
```
