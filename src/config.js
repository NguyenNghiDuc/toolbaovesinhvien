import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export const production = process.env.NODE_ENV === 'production';
export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// These keys survive restarts; never replace a key once TOTP has been configured.
const keyFile = path.join(dataDir, 'keys.json');
let keys;
try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  keys = { session: process.env.SESSION_SECRET || randomBytes(48).toString('hex'), encryption: process.env.DATA_ENCRYPTION_KEY || randomBytes(32).toString('hex') };
  try { fs.writeFileSync(keyFile, JSON.stringify(keys), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); }
}
if ((process.env.SESSION_SECRET && process.env.SESSION_SECRET !== keys.session) || (process.env.DATA_ENCRYPTION_KEY && process.env.DATA_ENCRYPTION_KEY !== keys.encryption)) throw new Error('Configured keys differ from data/keys.json. Keep the original keys to preserve sessions and TOTP.');
process.env.SESSION_SECRET ||= keys.session;
process.env.DATA_ENCRYPTION_KEY ||= keys.encryption;
process.env.PORT ||= '8080';
process.env.APP_URL ||= `http://localhost:${process.env.PORT}`;
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must have at least 32 characters');
if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY)) throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes in hex');
if (production && !process.env.APP_URL.startsWith('https://')) throw new Error('Production requires HTTPS APP_URL');
export const origin = new URL(process.env.APP_URL).origin;
export const mailMode = process.env.MAIL_MODE || 'file';
if (!['file', 'smtp'].includes(mailMode)) throw new Error('MAIL_MODE must be file or smtp');
if (production && mailMode !== 'smtp') throw new Error('Production requires MAIL_MODE=smtp');
