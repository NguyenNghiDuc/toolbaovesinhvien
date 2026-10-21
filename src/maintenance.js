import { db, pool } from './db.js';
try {
  const days = Number(process.env.EVENT_RETENTION_DAYS || 90);
  if (!Number.isInteger(days) || days < 7) throw new Error('EVENT_RETENTION_DAYS must be an integer >= 7');
  await db.token.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400000) } } });
  await pool.query('DELETE FROM session WHERE expire < NOW()');
  console.log('Expired tokens, sessions, and old events removed.');
} finally { await db.$disconnect(); await pool.end(); }
