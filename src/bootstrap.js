import { db } from './db.js';
import { passwordHash, passwordValid } from './security.js';
const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
try {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !passwordValid(password)) throw new Error('Set valid BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD (12–128 characters) securely');
  const digest = await passwordHash(password);
  await db.$transaction(async tx => {
    if (await tx.user.count({ where: { role: 'SUPER_ADMIN' } })) throw new Error('Super Admin already exists; bootstrap is disabled');
    await tx.user.create({ data: { email, name: 'System Administrator', verified: true, role: 'SUPER_ADMIN', passwordHash: digest } });
  }, { isolationLevel: 'Serializable' });
  console.log('Super Admin created. Remove bootstrap credentials from your environment and enable 2FA.');
} finally { await db.$disconnect(); }
