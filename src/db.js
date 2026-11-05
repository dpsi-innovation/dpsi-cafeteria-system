// src/db.js
// SQLite database engine using Node 22+ native node:sqlite
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const localDbPath = path.join(__dirname, '..', 'cafeteria.db');
let dbPath = localDbPath;

if (isServerless) {
  const tmpDbPath = path.join(os.tmpdir(), 'cafeteria.db');
  if (!fs.existsSync(tmpDbPath)) {
    if (fs.existsSync(localDbPath)) {
      try {
        fs.copyFileSync(localDbPath, tmpDbPath);
      } catch (err) {
        console.warn('[DB] Could not copy initial db file to /tmp:', err);
      }
    }
  }
  dbPath = tmpDbPath;
}

const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high reliability & ACID performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    admission_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    section TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    student_id TEXT UNIQUE NOT NULL,
    balance REAL NOT NULL DEFAULT 0.00,
    daily_limit REAL DEFAULT 200.00,
    is_active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    entry_type TEXT NOT NULL CHECK(entry_type IN ('CREDIT', 'DEBIT')),
    amount REAL NOT NULL,
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    image_emoji TEXT NOT NULL DEFAULT '🥪'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    admission_number TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS meal_bookings (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    admission_number TEXT NOT NULL,
    booking_date TEXT NOT NULL, -- e.g. '2026-10-24'
    meal_type TEXT NOT NULL DEFAULT 'Lunch', -- 'Breakfast', 'Lunch', 'Snacks'
    items_json TEXT NOT NULL, -- JSON array of booked items
    total_amount REAL NOT NULL,
    special_notes TEXT,
    token_code TEXT NOT NULL, -- e.g. 'TK-8421'
    status TEXT NOT NULL DEFAULT 'CONFIRMED', -- 'CONFIRMED', 'COLLECTED', 'CANCELLED'
    payment_method TEXT NOT NULL DEFAULT 'WALLET', -- 'WALLET' or 'RAZORPAY_DEMO'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    collected_at DATETIME,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    menu_item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    correlation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT,
    ip_address TEXT,
    status TEXT NOT NULL
  );
`);

function seedInitialData() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM students');
  const count = countStmt.get().count;

  if (count === 0) {
    console.log('[DB] Seeding demo students, wallets, and menu items...');

    const insertStudent = db.prepare(`
      INSERT INTO students (id, admission_number, name, class_name, section, parent_id, parent_name, parent_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertWallet = db.prepare(`
      INSERT INTO wallets (id, student_id, balance, daily_limit, is_active, version)
      VALUES (?, ?, ?, ?, 1, 1)
    `);

    const insertLedger = db.prepare(`
      INSERT INTO ledger_entries (id, idempotency_key, account_id, entry_type, amount, reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const demoStudents = [
      { id: 'stu_1', adm: 'ADM-2026-101', name: 'Aarav Sharma', class: 'Grade 8', sec: 'A', pid: 'par_1', pname: 'Rajesh Sharma', phone: '+91 98765 43210', bal: 350.00 },
      { id: 'stu_2', adm: 'ADM-2026-102', name: 'Diya Patel', class: 'Grade 7', sec: 'B', pid: 'par_2', pname: 'Pooja Patel', phone: '+91 98765 43211', bal: 150.00 },
      { id: 'stu_3', adm: 'ADM-2026-103', name: 'Rohan Verma', class: 'Grade 9', sec: 'C', pid: 'par_3', pname: 'Anil Verma', phone: '+91 98765 43212', bal: 25.00 },
      { id: 'stu_4', adm: 'ADM-2026-104', name: 'Ananya Iyer', class: 'Grade 10', sec: 'A', pid: 'par_4', pname: 'Meera Iyer', phone: '+91 98765 43213', bal: 500.00 }
    ];

    for (const s of demoStudents) {
      insertStudent.run(s.id, s.adm, s.name, s.class, s.sec, s.pid, s.pname, s.phone);
      const walletId = `wal_${s.id}`;
      insertWallet.run(walletId, s.id, s.bal, 200.00);

      // Ledger entry matching starting balance
      insertLedger.run(
        crypto.randomUUID(),
        `init_${s.id}`,
        `WALLET:${s.id}`,
        'CREDIT',
        s.bal,
        'INITIAL_CREDIT',
        'INIT',
        'Initial wallet top-up by Parent',
        s.pid
      );
    }

    const insertMenu = db.prepare(`
      INSERT INTO menu_items (id, name, category, price, is_available, image_emoji)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const items = [
      { id: 'item_1', name: 'Veg Grilled Sandwich', category: 'Snacks', price: 40.00, emoji: '🥪' },
      { id: 'item_2', name: 'Idli Vada Combo', category: 'Breakfast', price: 35.00, emoji: '🍲' },
      { id: 'item_3', name: 'Paneer Wrap', category: 'Snacks', price: 50.00, emoji: '🌯' },
      { id: 'item_4', name: 'Mini Thali Lunch', category: 'Meals', price: 70.00, emoji: '🍛' },
      { id: 'item_5', name: 'Fresh Fruit Juice', category: 'Beverages', price: 25.00, emoji: '🧃' },
      { id: 'item_6', name: 'Chocolate Milkshake', category: 'Beverages', price: 30.00, emoji: '🥤' },
      { id: 'item_7', name: 'Vegetable Samosa (2 pcs)', category: 'Snacks', price: 20.00, emoji: '🥟' },
      { id: 'item_8', name: 'Fresh Fruit Salad', category: 'Healthy', price: 30.00, emoji: '🥗' }
    ];

    for (const it of items) {
      insertMenu.run(it.id, it.name, it.category, it.price, it.emoji);
    }

    console.log('[DB] Seeding completed.');
  }
}

function resetDatabaseToDemo() {
  console.log('[DB] Performing complete ACID reset to factory demo state...');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec('DELETE FROM order_items;');
    db.exec('DELETE FROM orders;');
    db.exec('DELETE FROM meal_bookings;');
    db.exec('DELETE FROM ledger_entries;');
    db.exec('DELETE FROM wallets;');
    db.exec('DELETE FROM students;');
    db.exec('DELETE FROM menu_items;');
    db.exec('DELETE FROM audit_logs;');

    const insertStudent = db.prepare(`
      INSERT INTO students (id, admission_number, name, class_name, section, parent_id, parent_name, parent_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertWallet = db.prepare(`
      INSERT INTO wallets (id, student_id, balance, daily_limit, is_active, version)
      VALUES (?, ?, ?, ?, 1, 1)
    `);

    const insertLedger = db.prepare(`
      INSERT INTO ledger_entries (id, idempotency_key, account_id, entry_type, amount, reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const demoStudents = [
      { id: 'stu_1', adm: 'ADM-2026-101', name: 'Aarav Sharma', class: 'Grade 8', sec: 'A', pid: 'par_1', pname: 'Rajesh Sharma', phone: '+91 98765 43210', bal: 350.00 },
      { id: 'stu_2', adm: 'ADM-2026-102', name: 'Diya Patel', class: 'Grade 7', sec: 'B', pid: 'par_2', pname: 'Pooja Patel', phone: '+91 98765 43211', bal: 150.00 },
      { id: 'stu_3', adm: 'ADM-2026-103', name: 'Rohan Verma', class: 'Grade 9', sec: 'C', pid: 'par_3', pname: 'Anil Verma', phone: '+91 98765 43212', bal: 25.00 },
      { id: 'stu_4', adm: 'ADM-2026-104', name: 'Ananya Iyer', class: 'Grade 10', sec: 'A', pid: 'par_4', pname: 'Meera Iyer', phone: '+91 98765 43213', bal: 500.00 }
    ];

    for (const s of demoStudents) {
      insertStudent.run(s.id, s.adm, s.name, s.class, s.sec, s.pid, s.pname, s.phone);
      const walletId = `wal_${s.id}`;
      insertWallet.run(walletId, s.id, s.bal, 200.00);

      insertLedger.run(
        crypto.randomUUID(),
        `init_${s.id}`,
        `WALLET:${s.id}`,
        'CREDIT',
        s.bal,
        'INITIAL_CREDIT',
        'INIT',
        'Initial wallet top-up by Parent',
        s.pid
      );
    }

    const insertMenu = db.prepare(`
      INSERT INTO menu_items (id, name, category, price, is_available, image_emoji)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const items = [
      { id: 'item_1', name: 'Veg Grilled Sandwich', category: 'Snacks', price: 40.00, emoji: '🥪' },
      { id: 'item_2', name: 'Idli Vada Combo', category: 'Breakfast', price: 35.00, emoji: '🍲' },
      { id: 'item_3', name: 'Paneer Wrap', category: 'Snacks', price: 50.00, emoji: '🌯' },
      { id: 'item_4', name: 'Mini Thali Lunch', category: 'Meals', price: 70.00, emoji: '🍛' },
      { id: 'item_5', name: 'Fresh Fruit Juice', category: 'Beverages', price: 25.00, emoji: '🧃' },
      { id: 'item_6', name: 'Chocolate Milkshake', category: 'Beverages', price: 30.00, emoji: '🥤' },
      { id: 'item_7', name: 'Vegetable Samosa (2 pcs)', category: 'Snacks', price: 20.00, emoji: '🥟' },
      { id: 'item_8', name: 'Fresh Fruit Salad', category: 'Healthy', price: 30.00, emoji: '🥗' }
    ];

    for (const it of items) {
      insertMenu.run(it.id, it.name, it.category, it.price, it.emoji);
    }

    // Add 1 sample advance booking for tomorrow for realistic demonstration
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrowStr = d.toISOString().split('T')[0];
    const sampleBooking = db.prepare(`
      INSERT INTO meal_bookings (
        id, student_id, admission_number, booking_date, meal_type, items_json,
        total_amount, special_notes, token_code, status, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'WALLET')
    `);
    sampleBooking.run(
      'MB-DEMO-TOMORROW',
      'stu_1',
      'ADM-2026-101',
      tomorrowStr,
      'Lunch',
      JSON.stringify([{ id: 'item_4', name: 'Mini Thali Lunch', quantity: 1, price: 70.00, emoji: '🍛' }]),
      70.00,
      'Pack hot and fresh',
      'TK-7821'
    );

    // Initial audit log entry
    db.prepare(`
      INSERT INTO audit_logs (correlation_id, actor_id, actor_role, action, resource_type, resource_id, details, ip_address, status)
      VALUES (?, 'SYSTEM', 'ADMIN', 'SYSTEM_RESET_FACTORY_STATE', 'DATABASE', 'ALL', 'Database reset to clean factory demo state', '127.0.0.1', 'SUCCESS')
    `).run(crypto.randomUUID());

    db.exec('COMMIT;');
    console.log('[DB] Factory demo state restored successfully.');
    return { success: true, message: 'Factory demo state restored successfully.' };
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('[DB_RESET_FAILED]', err);
    throw err;
  }
}

seedInitialData();

module.exports = {
  db,
  resetDatabaseToDemo
};
