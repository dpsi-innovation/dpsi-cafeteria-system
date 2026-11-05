// src/audit.js
const { db } = require('./db');
const crypto = require('node:crypto');

function recordAudit({ correlationId, actorId, actorRole, action, resourceType, resourceId, details, ipAddress, status }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (correlation_id, actor_id, actor_role, action, resource_type, resource_id, details, ip_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      correlationId || crypto.randomUUID(),
      actorId || 'SYSTEM',
      actorRole || 'SYSTEM',
      action,
      resourceType,
      resourceId || null,
      typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
      ipAddress || '127.0.0.1',
      status || 'SUCCESS'
    );
  } catch (err) {
    console.error('[AUDIT_ERROR] Failed to record audit log:', err.message);
  }
}

function getAuditLogs(limit = 50) {
  const stmt = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?');
  return stmt.all(limit);
}

module.exports = {
  recordAudit,
  getAuditLogs
};
