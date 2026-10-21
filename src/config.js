import 'dotenv/config';
export const production = process.env.NODE_ENV === 'production';
for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'APP_URL']) {
  if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must have at least 32 characters');
if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY)) throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes in hex');
if (production && !process.env.APP_URL.startsWith('https://')) throw new Error('Production requires HTTPS APP_URL');
export const origin = new URL(process.env.APP_URL).origin;
