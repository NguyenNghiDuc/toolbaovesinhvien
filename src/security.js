import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('hex');
export const passwordHash = value => argon2.hash(value, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
export const passwordValid = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString('hex')).join(':');
}
export function decrypt(value) {
  const [iv, tag, data] = value.split(':').map(v => Buffer.from(v, 'hex'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
export const totp = (secret, email) => new OTPAuth.TOTP({ issuer: 'StudentShield', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret });
export function score(user, accounts) {
  const base = (user.verified ? 20 : 0) + (user.totpSecret ? 30 : 0);
  const hygiene = accounts.length ? accounts.reduce((sum, a) => sum + (Number(a.has2fa) + Number(a.uniquePassword) + Number(a.recoveryReady)) / 3, 0) / accounts.length : 0;
  return Math.round(base + hygiene * 50);
}
