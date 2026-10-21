import nodemailer from 'nodemailer';
import { db } from './db.js';
import { random, hash } from './security.js';
import { origin } from './config.js';
const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}) });
export async function notify(email, subject, text) {
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST is required to send security email');
  await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject, text });
}
export async function sendToken(user, kind) {
  const raw = random();
  const token = await db.token.create({ data: { userId: user.id, kind, hash: hash(raw), expiresAt: new Date(Date.now() + (kind === 'verify' ? 86400000 : 1800000)) } });
  try { await notify(user.email, kind === 'verify' ? 'Xác minh email StudentShield' : 'Đặt lại mật khẩu StudentShield', `${origin}/#${kind}=${raw}\nLiên kết chỉ dùng một lần.`); }
  catch (error) { await db.token.delete({ where: { id: token.id } }); throw error; }
}
