// src/server.js
// High-security Cafeteria Microservice running directly with native Node.js & node:sqlite
const http = require('node:http');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { db, resetDatabaseToDemo } = require('./db');
const { recordAudit, getAuditLogs } = require('./audit');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, '..', 'public'))
  ? path.join(__dirname, '..', 'public')
  : path.join(__dirname, 'public');

// --- Helper Functions ---
function jsonResponse(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key, X-Correlation-Id',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (e) {
      return Promise.resolve({});
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // 100KB body limit to prevent memory exhaustion DOS
      if (body.length > 100 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        if (!body.trim()) return resolve({});
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN'
      });
      res.end(content);
    }
  });
}

// In-memory rate limiting map
const requestCounts = new Map();
function rateLimit(ip, limit = 120, windowMs = 60000) {
  const now = Date.now();
  const record = requestCounts.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count += 1;
  }
  requestCounts.set(ip, record);
  return record.count <= limit;
}

// --- Request Router ---
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
  const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key, X-Correlation-Id',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  // Rate Limiting
  if (!rateLimit(ip)) {
    recordAudit({
      correlationId,
      actorId: 'IP:' + ip,
      actorRole: 'ANONYMOUS',
      action: 'RATE_LIMIT_EXCEEDED',
      resourceType: 'NETWORK',
      details: { pathname },
      ipAddress: ip,
      status: 'BLOCKED'
    });
    return jsonResponse(res, 429, { error: 'Rate limit exceeded. Please wait a moment.' });
  }

  try {
    // -------------------------------------------------------------
    // API: System Status & Health Check
    // -------------------------------------------------------------
    if (pathname === '/api/health' && method === 'GET') {
      return jsonResponse(res, 200, {
        status: 'UP',
        service: 'cafeteria-wallet-microservice',
        timestamp: new Date().toISOString(),
        correlationId
      });
    }

    // -------------------------------------------------------------
    // API: Reset Test Mode (Restore Demo Data State)
    // -------------------------------------------------------------
    if (pathname === '/api/reset-demo' && method === 'POST') {
      try {
        const result = resetDatabaseToDemo();
        return jsonResponse(res, 200, {
          success: true,
          message: 'System test mode has been cleanly reset to factory demo state!',
          details: result
        });
      } catch (rstErr) {
        return jsonResponse(res, 500, { error: 'Failed to reset demo: ' + rstErr.message });
      }
    }

    // -------------------------------------------------------------
    // API: Students list & Lookup
    // -------------------------------------------------------------
    if (pathname === '/api/students' && method === 'GET') {
      const stmt = db.prepare(`
        SELECT s.*, w.balance, w.daily_limit, w.is_active as wallet_active
        FROM students s
        JOIN wallets w ON s.id = w.student_id
        ORDER BY s.admission_number ASC
      `);
      const students = stmt.all();
      return jsonResponse(res, 200, { students });
    }

    if (pathname.startsWith('/api/students/lookup/') && method === 'GET') {
      const admissionNumber = decodeURIComponent(pathname.replace('/api/students/lookup/', '')).trim();
      const stmt = db.prepare(`
        SELECT s.*, w.balance, w.daily_limit, w.is_active as wallet_active, w.version as wallet_version
        FROM students s
        JOIN wallets w ON s.id = w.student_id
        WHERE UPPER(s.admission_number) = UPPER(?)
      `);
      const student = stmt.get(admissionNumber);

      if (!student) {
        return jsonResponse(res, 404, { error: `Student with Admission No '${admissionNumber}' not found` });
      }

      // Calculate today's spend
      const todaySpendStmt = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as today_spent
        FROM ledger_entries
        WHERE account_id = ? AND entry_type = 'DEBIT' AND reference_type = 'PURCHASE'
        AND date(created_at) = date('now')
      `);
      const { today_spent } = todaySpendStmt.get(`WALLET:${student.id}`);
      student.today_spent = today_spent;

      return jsonResponse(res, 200, { student });
    }

    // -------------------------------------------------------------
    // API: Wallet Balance & Details
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/wallet/') && method === 'GET') {
      const studentId = pathname.replace('/api/wallet/', '').trim();
      const stmt = db.prepare(`
        SELECT s.admission_number, s.name, s.class_name, s.section, s.parent_name,
               w.id as wallet_id, w.balance, w.daily_limit, w.is_active, w.version, w.updated_at
        FROM wallets w
        JOIN students s ON s.id = w.student_id
        WHERE w.student_id = ?
      `);
      const wallet = stmt.get(studentId);
      if (!wallet) return jsonResponse(res, 404, { error: 'Wallet not found' });

      return jsonResponse(res, 200, { wallet });
    }

    // -------------------------------------------------------------
    // API: Parent Wallet Top-up (Double-entry Ledger + Idempotency)
    // -------------------------------------------------------------
    if (pathname === '/api/wallet/topup' && method === 'POST') {
      const body = await parseBody(req);
      const { studentId, amount, paymentMethod, idempotencyKey, parentId, parentName } = body;

      if (!studentId || !amount || Number(amount) <= 0) {
        return jsonResponse(res, 400, { error: 'Valid studentId and positive amount are required' });
      }

      const parsedAmount = Math.round(Number(amount) * 100) / 100;
      const finalIdempotencyKey = idempotencyKey || req.headers['x-idempotency-key'] || crypto.randomUUID();

      // Check Idempotency to prevent double-crediting
      const checkKey = db.prepare('SELECT * FROM ledger_entries WHERE idempotency_key = ?');
      const existing = checkKey.get(finalIdempotencyKey);
      if (existing) {
        return jsonResponse(res, 200, {
          message: 'Idempotent request: top-up already processed',
          duplicate: true,
          entry: existing
        });
      }

      // Check student & wallet existence
      const walletStmt = db.prepare('SELECT * FROM wallets WHERE student_id = ?');
      const wallet = walletStmt.get(studentId);
      if (!wallet || !wallet.is_active) {
        return jsonResponse(res, 404, { error: 'Active wallet for student not found' });
      }

      const studentStmt = db.prepare('SELECT * FROM students WHERE id = ?');
      const student = studentStmt.get(studentId);

      // Perform ACID transaction
      db.exec('BEGIN IMMEDIATE;');
      try {
        const newBalance = Math.round((wallet.balance + parsedAmount) * 100) / 100;

        // 1. Update wallet balance with optimistic version bump
        const updateWallet = db.prepare(`
          UPDATE wallets
          SET balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE student_id = ? AND version = ?
        `);
        const updateResult = updateWallet.run(newBalance, studentId, wallet.version);

        if (updateResult.changes === 0) {
          throw new Error('Concurrent modification detected. Please retry.');
        }

        // 2. Double-entry Ledger entry: Credit student wallet
        const creditLedger = db.prepare(`
          INSERT INTO ledger_entries (id, idempotency_key, account_id, entry_type, amount, reference_type, reference_id, description, created_by)
          VALUES (?, ?, ?, 'CREDIT', ?, 'TOP_UP', ?, ?, ?)
        `);
        const refId = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        creditLedger.run(
          crypto.randomUUID(),
          finalIdempotencyKey,
          `WALLET:${studentId}`,
          parsedAmount,
          refId,
          `Wallet top-up via ${paymentMethod || 'Online UPI/Card'} by ${parentName || student.parent_name}`,
          parentId || student.parent_id
        );

        // 3. Counter-ledger entry: Debit Payment Gateway settlement account
        creditLedger.run(
          crypto.randomUUID(),
          `${finalIdempotencyKey}-counter`,
          `SETTLEMENT:${paymentMethod || 'GATEWAY'}`,
          parsedAmount,
          refId,
          `Settlement inflow from Parent ${parentName || student.parent_name}`,
          parentId || student.parent_id
        );

        db.exec('COMMIT;');

        // Record Audit log
        recordAudit({
          correlationId,
          actorId: parentId || student.parent_id,
          actorRole: 'PARENT',
          action: 'WALLET_TOPUP',
          resourceType: 'WALLET',
          resourceId: wallet.id,
          details: {
            studentAdmission: student.admission_number,
            amount: parsedAmount,
            previousBalance: wallet.balance,
            newBalance,
            paymentMethod: paymentMethod || 'UPI/Card',
            refId
          },
          ipAddress: ip,
          status: 'SUCCESS'
        });

        return jsonResponse(res, 200, {
          success: true,
          message: `Successfully topped up ₹${parsedAmount.toFixed(2)} to ${student.name}'s wallet`,
          student: student.name,
          admissionNumber: student.admission_number,
          amount: parsedAmount,
          previousBalance: wallet.balance,
          newBalance,
          referenceId: refId
        });

      } catch (txError) {
        db.exec('ROLLBACK;');
        recordAudit({
          correlationId,
          actorId: parentId || student.parent_id,
          actorRole: 'PARENT',
          action: 'WALLET_TOPUP_FAILED',
          resourceType: 'WALLET',
          resourceId: wallet.id,
          details: { error: txError.message, amount: parsedAmount },
          ipAddress: ip,
          status: 'ERROR'
        });
        return jsonResponse(res, 500, { error: 'Top-up failed: ' + txError.message });
      }
    }

    // -------------------------------------------------------------
    // API: Cafeteria Menu Items
    // -------------------------------------------------------------
    if (pathname === '/api/menu' && method === 'GET') {
      const stmt = db.prepare('SELECT * FROM menu_items ORDER BY category ASC, name ASC');
      return jsonResponse(res, 200, { items: stmt.all() });
    }

    // -------------------------------------------------------------
    // API: Cafeteria POS Order Creation & Balance Deduction
    // -------------------------------------------------------------
    if (pathname === '/api/order' && method === 'POST') {
      const body = await parseBody(req);
      const { admissionNumber, items, staffId, staffName } = body;

      if (!admissionNumber || !Array.isArray(items) || items.length === 0) {
        return jsonResponse(res, 400, { error: 'Admission number and at least one order item are required' });
      }

      // Lookup student & wallet
      const studentStmt = db.prepare(`
        SELECT s.*, w.id as wallet_id, w.balance, w.daily_limit, w.is_active as wallet_active, w.version as wallet_version
        FROM students s
        JOIN wallets w ON s.id = w.student_id
        WHERE UPPER(s.admission_number) = UPPER(?)
      `);
      const student = studentStmt.get(admissionNumber.trim());

      if (!student) {
        return jsonResponse(res, 404, { error: `Student with Admission No '${admissionNumber}' not found` });
      }

      if (!student.wallet_active) {
        return jsonResponse(res, 403, { error: 'Student wallet is inactive. Contact school admin.' });
      }

      // Calculate total from DB prices to prevent tampering
      let totalAmount = 0;
      const verifiedItems = [];

      const itemLookupStmt = db.prepare('SELECT * FROM menu_items WHERE id = ?');
      for (const reqItem of items) {
        const dbItem = itemLookupStmt.get(reqItem.id);
        if (!dbItem || !dbItem.is_available) {
          return jsonResponse(res, 400, { error: `Item '${reqItem.name || reqItem.id}' is unavailable` });
        }
        const qty = parseInt(reqItem.quantity, 10) || 1;
        if (qty <= 0) continue;

        const subtotal = Math.round(dbItem.price * qty * 100) / 100;
        totalAmount += subtotal;
        verifiedItems.push({
          menuItemId: dbItem.id,
          name: dbItem.name,
          quantity: qty,
          unitPrice: dbItem.price,
          subtotal
        });
      }

      totalAmount = Math.round(totalAmount * 100) / 100;

      // 1. Balance check
      if (student.balance < totalAmount) {
        recordAudit({
          correlationId,
          actorId: staffId || 'POS-STAFF',
          actorRole: 'STAFF',
          action: 'PURCHASE_DECLINED_INSUFFICIENT_FUNDS',
          resourceType: 'ORDER',
          details: {
            admissionNumber: student.admission_number,
            requestedAmount: totalAmount,
            currentBalance: student.balance,
            deficit: totalAmount - student.balance
          },
          ipAddress: ip,
          status: 'DECLINED'
        });

        return jsonResponse(res, 402, {
          error: `Insufficient balance! Wallet balance is ₹${student.balance.toFixed(2)}, required ₹${totalAmount.toFixed(2)}`,
          balance: student.balance,
          deficit: Math.round((totalAmount - student.balance) * 100) / 100
        });
      }

      // 2. Daily limit check
      const todaySpendStmt = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as today_spent
        FROM ledger_entries
        WHERE account_id = ? AND entry_type = 'DEBIT' AND reference_type = 'PURCHASE'
        AND date(created_at) = date('now')
      `);
      const { today_spent } = todaySpendStmt.get(`WALLET:${student.id}`);

      if (student.daily_limit && (today_spent + totalAmount) > student.daily_limit) {
        const remainingLimit = Math.max(0, student.daily_limit - today_spent);
        recordAudit({
          correlationId,
          actorId: staffId || 'POS-STAFF',
          actorRole: 'STAFF',
          action: 'PURCHASE_DECLINED_DAILY_LIMIT',
          resourceType: 'ORDER',
          details: {
            admissionNumber: student.admission_number,
            requestedAmount: totalAmount,
            todaySpent: today_spent,
            dailyLimit: student.daily_limit
          },
          ipAddress: ip,
          status: 'DECLINED'
        });

        return jsonResponse(res, 403, {
          error: `Daily spend limit of ₹${student.daily_limit.toFixed(2)} exceeded! Spent today: ₹${today_spent.toFixed(2)}, Remaining allowed: ₹${remainingLimit.toFixed(2)}`,
          dailyLimit: student.daily_limit,
          todaySpent: today_spent,
          remainingLimit
        });
      }

      // Perform ACID transaction
      db.exec('BEGIN IMMEDIATE;');
      try {
        const newBalance = Math.round((student.balance - totalAmount) * 100) / 100;
        const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const idempotencyKey = crypto.randomUUID();

        // A. Update wallet
        const updateWallet = db.prepare(`
          UPDATE wallets
          SET balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE student_id = ? AND version = ?
        `);
        const updateResult = updateWallet.run(newBalance, student.id, student.wallet_version);
        if (updateResult.changes === 0) {
          throw new Error('Concurrent wallet modification. Please try again.');
        }

        // B. Insert order
        const insertOrder = db.prepare(`
          INSERT INTO orders (id, student_id, admission_number, total_amount, status)
          VALUES (?, ?, ?, ?, 'COMPLETED')
        `);
        insertOrder.run(orderId, student.id, student.admission_number, totalAmount);

        // C. Insert order items
        const insertOrderItem = db.prepare(`
          INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity, unit_price, subtotal)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of verifiedItems) {
          insertOrderItem.run(
            crypto.randomUUID(),
            orderId,
            item.menuItemId,
            item.name,
            item.quantity,
            item.unitPrice,
            item.subtotal
          );
        }

        // D. Ledger entry: Debit student wallet
        const insertLedger = db.prepare(`
          INSERT INTO ledger_entries (id, idempotency_key, account_id, entry_type, amount, reference_type, reference_id, description, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertLedger.run(
          crypto.randomUUID(),
          idempotencyKey,
          `WALLET:${student.id}`,
          'DEBIT',
          totalAmount,
          'PURCHASE',
          orderId,
          `Canteen food purchase: ${verifiedItems.map(i => `${i.quantity}x ${i.name}`).join(', ')}`,
          staffId || 'CAFETERIA_POS'
        );

        // E. Ledger entry: Credit Canteen Revenue
        insertLedger.run(
          crypto.randomUUID(),
          `${idempotencyKey}-rev`,
          'REVENUE:CANTEEN',
          'CREDIT',
          totalAmount,
          'PURCHASE',
          orderId,
          `Revenue from ${student.name} (${student.admission_number})`,
          staffId || 'CAFETERIA_POS'
        );

        db.exec('COMMIT;');

        // Record Audit log
        recordAudit({
          correlationId,
          actorId: staffId || 'CAFETERIA_POS',
          actorRole: 'STAFF',
          action: 'ORDER_PURCHASE_COMPLETED',
          resourceType: 'ORDER',
          resourceId: orderId,
          details: {
            orderId,
            studentAdmission: student.admission_number,
            studentName: student.name,
            totalAmount,
            previousBalance: student.balance,
            newBalance,
            items: verifiedItems
          },
          ipAddress: ip,
          status: 'SUCCESS'
        });

        return jsonResponse(res, 200, {
          success: true,
          message: `Order processed successfully! ₹${totalAmount.toFixed(2)} deducted from ${student.name}'s wallet`,
          orderId,
          studentName: student.name,
          admissionNumber: student.admission_number,
          totalAmount,
          previousBalance: student.balance,
          newBalance,
          items: verifiedItems
        });

      } catch (txErr) {
        db.exec('ROLLBACK;');
        recordAudit({
          correlationId,
          actorId: staffId || 'CAFETERIA_POS',
          actorRole: 'STAFF',
          action: 'ORDER_PURCHASE_FAILED',
          resourceType: 'ORDER',
          details: { error: txErr.message },
          ipAddress: ip,
          status: 'ERROR'
        });
        return jsonResponse(res, 500, { error: 'Order processing error: ' + txErr.message });
      }
    }

    // -------------------------------------------------------------
    // API: Meal Pre-Booking for Tomorrow / Future Dates
    // -------------------------------------------------------------
    if (pathname === '/api/meal-bookings' && method === 'POST') {
      const body = await parseBody(req);
      const { studentId, bookingDate, mealType, items, specialNotes, paymentMode } = body;

      if (!studentId || !bookingDate || !Array.isArray(items) || items.length === 0) {
        return jsonResponse(res, 400, { error: 'Student, booking date, and meal items are required' });
      }

      // Check student & wallet existence
      const studentStmt = db.prepare(`
        SELECT s.*, w.id as wallet_id, w.balance, w.daily_limit, w.is_active as wallet_active, w.version as wallet_version
        FROM students s
        JOIN wallets w ON s.id = w.student_id
        WHERE s.id = ?
      `);
      const student = studentStmt.get(studentId);

      if (!student || !student.wallet_active) {
        return jsonResponse(res, 404, { error: 'Active student wallet not found' });
      }

      // Calculate total from DB price list (prevents client price tampering)
      let totalAmount = 0;
      const verifiedItems = [];
      const itemLookupStmt = db.prepare('SELECT * FROM menu_items WHERE id = ?');

      for (const reqItem of items) {
        const dbItem = itemLookupStmt.get(reqItem.id);
        if (!dbItem || !dbItem.is_available) {
          return jsonResponse(res, 400, { error: `Menu item '${reqItem.name || reqItem.id}' is unavailable` });
        }
        const qty = parseInt(reqItem.quantity, 10) || 1;
        if (qty <= 0) continue;
        const subtotal = Math.round(dbItem.price * qty * 100) / 100;
        totalAmount += subtotal;
        verifiedItems.push({
          id: dbItem.id,
          name: dbItem.name,
          category: dbItem.category,
          price: dbItem.price,
          quantity: qty,
          subtotal,
          emoji: dbItem.image_emoji
        });
      }
      totalAmount = Math.round(totalAmount * 100) / 100;

      // Balance check
      if (student.balance < totalAmount) {
        return jsonResponse(res, 402, {
          error: `Insufficient balance! Wallet balance is ₹${student.balance.toFixed(2)}, required ₹${totalAmount.toFixed(2)} for pre-booking. Please top up first.`,
          balance: student.balance,
          required: totalAmount,
          deficit: Math.round((totalAmount - student.balance) * 100) / 100
        });
      }

      // Generate Booking ID and Pickup Token (e.g., TK-4829)
      const bookingId = `MB-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const tokenCode = `TK-${Math.floor(1000 + Math.random() * 9000)}`;
      const idempotencyKey = crypto.randomUUID();

      // Execute ACID Transaction: Deduct wallet, write ledger entries, insert meal_booking
      db.exec('BEGIN IMMEDIATE;');
      try {
        const newBalance = Math.round((student.balance - totalAmount) * 100) / 100;

        // 1. Update wallet balance with optimistic lock
        const updateWallet = db.prepare(`
          UPDATE wallets
          SET balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE student_id = ? AND version = ?
        `);
        const updateResult = updateWallet.run(newBalance, student.id, student.wallet_version);
        if (updateResult.changes === 0) {
          throw new Error('Concurrent wallet modification. Please retry.');
        }

        // 2. Insert into meal_bookings
        const insertBooking = db.prepare(`
          INSERT INTO meal_bookings (
            id, student_id, admission_number, booking_date, meal_type, items_json,
            total_amount, special_notes, token_code, status, payment_method
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertBooking.run(
          bookingId,
          student.id,
          student.admission_number,
          bookingDate,
          mealType || 'Lunch',
          JSON.stringify(verifiedItems),
          totalAmount,
          specialNotes || '',
          tokenCode,
          'CONFIRMED',
          paymentMode || 'WALLET'
        );

        // 3. Ledger: Debit student wallet
        const insertLedger = db.prepare(`
          INSERT INTO ledger_entries (id, idempotency_key, account_id, entry_type, amount, reference_type, reference_id, description, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const itemsSummary = verifiedItems.map(i => `${i.quantity}x ${i.name}`).join(', ');
        insertLedger.run(
          crypto.randomUUID(),
          idempotencyKey,
          `WALLET:${student.id}`,
          'DEBIT',
          totalAmount,
          'MEAL_PREBOOK',
          bookingId,
          `Advance Meal Booking for ${bookingDate} (${mealType || 'Lunch'}): ${itemsSummary}`,
          student.parent_id || 'PARENT'
        );

        // 4. Ledger: Credit Canteen Revenue
        insertLedger.run(
          crypto.randomUUID(),
          `${idempotencyKey}-rev`,
          'REVENUE:CANTEEN',
          'CREDIT',
          totalAmount,
          'MEAL_PREBOOK',
          bookingId,
          `Advance Booking revenue from ${student.name} (${student.admission_number}) for ${bookingDate}`,
          student.parent_id || 'PARENT'
        );

        db.exec('COMMIT;');

        // Record Audit Log
        recordAudit({
          correlationId,
          actorId: student.parent_id || 'PARENT',
          actorRole: 'PARENT',
          action: 'MEAL_ADVANCE_BOOKED',
          resourceType: 'MEAL_BOOKING',
          resourceId: bookingId,
          details: {
            bookingId,
            tokenCode,
            bookingDate,
            mealType: mealType || 'Lunch',
            admissionNumber: student.admission_number,
            studentName: student.name,
            totalAmount,
            newBalance,
            items: verifiedItems
          },
          ipAddress: ip,
          status: 'SUCCESS'
        });

        return jsonResponse(res, 200, {
          success: true,
          message: `Meal successfully booked for ${bookingDate}! Token: ${tokenCode}`,
          bookingId,
          tokenCode,
          bookingDate,
          mealType: mealType || 'Lunch',
          totalAmount,
          previousBalance: student.balance,
          newBalance,
          items: verifiedItems,
          studentName: student.name,
          admissionNumber: student.admission_number
        });

      } catch (bookErr) {
        db.exec('ROLLBACK;');
        console.error('[MEAL_BOOKING_ERROR_TRACE]', bookErr);
        recordAudit({
          correlationId,
          actorId: student.parent_id || 'PARENT',
          actorRole: 'PARENT',
          action: 'MEAL_PREBOOK_FAILED',
          resourceType: 'MEAL_BOOKING',
          resourceId: bookingId,
          details: { error: bookErr.message },
          ipAddress: ip,
          status: 'ERROR'
        });
        return jsonResponse(res, 500, { error: 'Meal booking error: ' + bookErr.message });
      }
    }

    // Get bookings for a specific student or date
    if (pathname.startsWith('/api/meal-bookings/student/') && method === 'GET') {
      const studentId = pathname.replace('/api/meal-bookings/student/', '').trim();
      const stmt = db.prepare(`
        SELECT mb.*, s.name as student_name, s.class_name, s.section
        FROM meal_bookings mb
        JOIN students s ON s.id = mb.student_id
        WHERE mb.student_id = ?
        ORDER BY mb.booking_date DESC, mb.created_at DESC
        LIMIT 50
      `);
      const bookings = stmt.all(studentId);
      bookings.forEach(b => {
        try { b.items = JSON.parse(b.items_json); } catch (e) { b.items = []; }
      });
      return jsonResponse(res, 200, { bookings });
    }

    // Mark advance booking collected at canteen counter
    if (pathname.startsWith('/api/meal-bookings/collect/') && method === 'POST') {
      const bookingId = pathname.replace('/api/meal-bookings/collect/', '').trim();
      const stmt = db.prepare('SELECT * FROM meal_bookings WHERE id = ?');
      const booking = stmt.get(bookingId);

      if (!booking) {
        return jsonResponse(res, 404, { error: 'Booking not found' });
      }
      if (booking.status === 'COLLECTED') {
        return jsonResponse(res, 400, { error: 'Meal has already been collected on ' + booking.collected_at });
      }

      const updateStmt = db.prepare(`
        UPDATE meal_bookings
        SET status = 'COLLECTED', collected_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(bookingId);

      recordAudit({
        correlationId,
        actorId: 'POS-STAFF',
        actorRole: 'STAFF',
        action: 'MEAL_BOOKING_COLLECTED',
        resourceType: 'MEAL_BOOKING',
        resourceId: bookingId,
        details: { tokenCode: booking.token_code, admissionNumber: booking.admission_number },
        ipAddress: ip,
        status: 'SUCCESS'
      });

      return jsonResponse(res, 200, { success: true, message: `Token ${booking.token_code} marked as Collected!` });
    }

    // -------------------------------------------------------------
    // API: Ledger Transactions (Audit trail for Parent & Student)
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/transactions/') && method === 'GET') {
      const studentId = pathname.replace('/api/transactions/', '').trim();
      const stmt = db.prepare(`
        SELECT * FROM ledger_entries
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `);
      const transactions = stmt.all(`WALLET:${studentId}`);
      return jsonResponse(res, 200, { transactions });
    }

    // -------------------------------------------------------------
    // API: Orders history
    // -------------------------------------------------------------
    if (pathname === '/api/orders' && method === 'GET') {
      const stmt = db.prepare(`
        SELECT o.*, s.name as student_name, s.class_name
        FROM orders o
        JOIN students s ON s.id = o.student_id
        ORDER BY o.created_at DESC
        LIMIT 50
      `);
      const orders = stmt.all();

      const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
      for (const ord of orders) {
        ord.items = itemStmt.all(ord.id);
      }

      return jsonResponse(res, 200, { orders });
    }

    // -------------------------------------------------------------
    // API: System Audit Logs (Security Dashboard)
    // -------------------------------------------------------------
    if (pathname === '/api/audit-logs' && method === 'GET') {
      const logs = getAuditLogs(60);
      return jsonResponse(res, 200, { logs });
    }

    // -------------------------------------------------------------
    // API: Reconciliation Check (Ledger vs Wallets)
    // -------------------------------------------------------------
    if (pathname === '/api/reconcile' && method === 'GET') {
      const wallets = db.prepare('SELECT * FROM wallets').all();
      const report = [];
      let totalDiscrepancies = 0;

      for (const w of wallets) {
        const credits = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE account_id = ? AND entry_type = 'CREDIT'`).get(`WALLET:${w.student_id}`).total;
        const debits = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE account_id = ? AND entry_type = 'DEBIT'`).get(`WALLET:${w.student_id}`).total;
        const computed = Math.round((credits - debits) * 100) / 100;
        const diff = Math.round((computed - w.balance) * 100) / 100;

        if (diff !== 0) totalDiscrepancies++;

        report.push({
          studentId: w.student_id,
          walletBalance: w.balance,
          ledgerComputed: computed,
          discrepancy: diff,
          status: diff === 0 ? 'BALANCED' : 'MISMATCH'
        });
      }

      return jsonResponse(res, 200, {
        timestamp: new Date().toISOString(),
        totalWallets: wallets.length,
        totalDiscrepancies,
        status: totalDiscrepancies === 0 ? 'ALL_BALANCED_PERFECT' : 'WARNING_DISCREPANCIES_FOUND',
        report
      });
    }

    // -------------------------------------------------------------
    // Serve Static UI Files (React / Single Page LMS Portal)
    // -------------------------------------------------------------
    if (pathname === '/' || pathname === '/index.html') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    }
    if (pathname === '/styles.css') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'styles.css'), 'text/css');
    }
    if (pathname === '/app.js') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'app.js'), 'application/javascript');
    }
    if (pathname === '/dps-logo.png') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'dps-logo.png'), 'image/png');
    }

    // Fallback 404
    return jsonResponse(res, 404, { error: 'Route not found' });

  } catch (error) {
    console.error('[UNHANDLED_EXCEPTION]', error);
    recordAudit({
      correlationId,
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      action: 'SERVER_EXCEPTION',
      resourceType: 'API',
      details: { error: error.message, stack: error.stack },
      ipAddress: ip,
      status: 'CRITICAL_ERROR'
    });
    return jsonResponse(res, 500, { error: 'Internal Server Error: ' + error.message });
  }
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  🏫 SCHOOL CAFETERIA WALLET MICROSERVICE RUNNING    `);
    console.log(`  🌐 URL: http://localhost:${PORT}                     `);
    console.log(`  🔒 Security: Audit Logging + Ledger + Idempotency   `);
    console.log(`=======================================================`);
  });
}

module.exports = { server, requestHandler };
