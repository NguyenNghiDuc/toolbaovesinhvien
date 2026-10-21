import { dataDir, mailMode } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
if (mailMode !== 'file') throw new Error('Email is delivered by SMTP; no local inbox is enabled');
const dir = path.join(dataDir, 'mail');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(-20) : [];
if (!files.length) console.log('Chưa có email. Hãy đăng ký tài khoản trên ứng dụng trước.');
for (const file of files) {
  const message = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log(`\n--- ${message.createdAt} | ${message.to} ---\n${message.subject}\n${message.text}`);
}
