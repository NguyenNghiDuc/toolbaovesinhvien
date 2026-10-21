import './config.js';
import express from 'express';
import session from 'express-session';
import { LocalSessionStore } from './session-store.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import QRCode from 'qrcode';
import { Secret } from 'otpauth';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db, sessions } from './db.js';
import { production, origin, mailMode } from './config.js';
import { random, hash, encrypt, decrypt, passwordHash, passwordValid, totp, score } from './security.js';
import { sendToken, notify } from './mail.js';
export const app = express();
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:'] } } }));
app.get('/healthz', async (req, res) => { try { await db.user.count(); res.json({ status: 'ok' }); } catch { res.status(503).json({ status: 'unavailable' }); } });
app.use(express.json({ limit: '32kb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 150, message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' }, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(session({ store: new LocalSessionStore(), secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, name: 'ss.sid', cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 } }));
app.use('/api', async (req, res, next) => {
  req.policy = await db.systemPolicy.findUnique({ where: { id: 'global' } }) || { minPasswordLength: 12, maxFailedLogins: 10, sessionHours: 8 };
  next();
});
const fail = (status, message) => Object.assign(new Error(message), { status });
const safe = u => ({ id: u.id, email: u.email, name: u.name, avatar: u.avatar, role: u.role, schoolId: u.schoolId, verified: u.verified, twoFactor: Boolean(u.totpSecret) });
const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const email = v => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const normalize = v => v.trim().toLowerCase();
const save = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
async function event(req, type, userId = req.user?.id) { await db.securityEvent.create({ data: { type, userId, ip: req.ip || '', agent: (req.get('user-agent') || '').slice(0, 300) } }); }
async function alert(req, user, type) {
  await event(req, type, user.id);
  try { await notify(user.email, 'Cảnh báo bảo mật StudentShield', `${type}\nThời gian: ${new Date().toISOString()}\nNếu không phải bạn, hãy đổi mật khẩu và thu hồi các phiên đăng nhập.`); }
  catch { await event(req, 'EMAIL_DELIVERY_FAILED', user.id); }
}
app.get('/api/runtime', (req, res) => res.json({ localMail: mailMode === 'file' }));
app.get('/api/csrf', (req, res) => { req.session.csrf ||= random(); res.json({ token: req.session.csrf }); });
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token') || '';
  const expected = req.session.csrf || '';
  if (!expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return next(fail(403, 'Phiên biểu mẫu hết hạn. Hãy tải lại trang.'));
  if (req.get('origin') && req.get('origin') !== origin) return next(fail(403, 'Origin không hợp lệ'));
  next();
});
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, message: { error: 'Quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 15 phút.' }, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api/auth', authLimit);
app.post('/api/auth/register', async (req, res) => {
  const { name, password, schoolCode } = req.body;
  if (!text(name, 100) || !email(req.body.email) || !passwordValid(password) || password.length < req.policy.minPasswordLength) throw fail(400, `Tên, email hợp lệ và mật khẩu ${req.policy.minPasswordLength}–128 ký tự là bắt buộc`);
  const address = normalize(req.body.email);
  const school = schoolCode ? await db.school.findUnique({ where: { code: String(schoolCode).toUpperCase() } }) : null;
  if (schoolCode && !school) throw fail(400, 'Mã trường không hợp lệ');
  const existing = await db.user.findUnique({ where: { email: address } });
  if (!existing) {
    const user = await db.user.create({ data: { name: name.trim(), email: address, passwordHash: await passwordHash(password), schoolId: school?.id } });
    try { await sendToken(user, 'verify'); } catch { await event(req, 'EMAIL_DELIVERY_FAILED', user.id); }
  }
  res.status(202).json({ message: 'Nếu email có thể đăng ký, liên kết xác minh sẽ được gửi. Bạn có thể yêu cầu gửi lại.' });
});
app.post('/api/auth/resend', async (req, res) => {
  const user = email(req.body.email) ? await db.user.findUnique({ where: { email: normalize(req.body.email) } }) : null;
  if (user && !user.verified) { try { await sendToken(user, 'verify'); } catch { await event(req, 'EMAIL_DELIVERY_FAILED', user.id); } }
  res.json({ message: 'Nếu tài khoản phù hợp, email xác minh đã được gửi.' });
});
app.post('/api/auth/verify', async (req, res) => {
  const tokenHash = hash(String(req.body.token || ''));
  await db.$transaction(async tx => {
    const token = await tx.token.findUnique({ where: { hash: tokenHash } });
    if (!token || token.kind !== 'verify' || token.expiresAt < new Date()) throw fail(400, 'Liên kết không hợp lệ hoặc hết hạn');
    if (!(await tx.token.deleteMany({ where: { id: token.id } })).count) throw fail(400, 'Liên kết đã được dùng');
    await tx.user.update({ where: { id: token.userId }, data: { verified: true } });
  });
  res.json({ message: 'Email đã được xác minh. Bạn có thể đăng nhập.' });
});
const dummyHash = await passwordHash(random());
async function verifyFactor(user, code) {
  if (!user.totpSecret) return true;
  if (typeof code !== 'string') return false;
  const delta = totp(decrypt(user.totpSecret), user.email).validate({ token: code, window: 1 });
  if (delta !== null) {
    const step = BigInt(Math.floor(Date.now() / 30000) + delta);
    return (await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 1;
  }
  const codeHash = hash(code);
  if (!user.recoveryHashes.includes(codeHash)) return false;
  return db.consumeRecovery(user.id, codeHash);
}
app.post('/api/auth/login', async (req, res) => {
  const address = email(req.body.email) ? normalize(req.body.email) : '';
  const user = await db.user.findUnique({ where: { email: address } });
  const recent = user ? await db.securityEvent.count({ where: { userId: user.id, type: 'LOGIN_FAILED', createdAt: { gt: new Date(Date.now() - 900000) } } }) : 0;
  const valid = typeof req.body.password === 'string' && req.body.password.length <= 128 && await argon2.verify(user?.passwordHash || dummyHash, req.body.password);
  if (!user || !valid || user.disabled || recent >= req.policy.maxFailedLogins || !await verifyFactor(user, req.body.code)) {
    if (user) { await event(req, 'LOGIN_FAILED', user.id); if (recent === 4) await alert(req, user, 'REPEATED_LOGIN_FAILURES'); }
    throw fail(401, 'Thông tin đăng nhập không hợp lệ hoặc tài khoản tạm khóa');
  }
  if (!user.verified) throw fail(403, 'Vui lòng xác minh email trước');
  await regenerate(req);
  req.session.cookie.maxAge = req.policy.sessionHours * 3600000;
  req.session.userId = user.id;
  req.session.version = user.sessionVersion;
  req.session.device = { agent: (req.get('user-agent') || '').slice(0, 300), ip: req.ip, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
  await save(req);
  await alert(req, user, 'NEW_LOGIN');
  res.json({ user: safe(user) });
});
app.post('/api/auth/forgot', async (req, res) => {
  const user = email(req.body.email) ? await db.user.findUnique({ where: { email: normalize(req.body.email) } }) : null;
  if (user) { try { await sendToken(user, 'reset'); } catch { await event(req, 'EMAIL_DELIVERY_FAILED', user.id); } }
  res.json({ message: 'Nếu email tồn tại, liên kết đặt lại sẽ được gửi.' });
});
app.post('/api/auth/reset', async (req, res) => {
  if (!passwordValid(req.body.password) || req.body.password.length < req.policy.minPasswordLength) throw fail(400, `Mật khẩu phải có ${req.policy.minPasswordLength}–128 ký tự`);
  const password = await passwordHash(req.body.password);
  const user = await db.$transaction(async tx => {
    const token = await tx.token.findUnique({ where: { hash: hash(String(req.body.token || '')) } });
    if (!token || token.kind !== 'reset' || token.expiresAt < new Date()) throw fail(400, 'Liên kết không hợp lệ hoặc hết hạn');
    if (!(await tx.token.deleteMany({ where: { id: token.id } })).count) throw fail(400, 'Liên kết đã được dùng');
    const user = await tx.user.update({ where: { id: token.userId }, data: { passwordHash: password, sessionVersion: { increment: 1 } } });
    await tx.token.deleteMany({ where: { userId: user.id, kind: 'reset' } });
    await sessions.revokeUser(user.id);
    return user;
  });
  await alert(req, user, 'PASSWORD_RESET');
  res.json({ message: 'Mật khẩu đã được đổi; các phiên đã thu hồi. 2FA vẫn được giữ.' });
});
async function auth(req, res, next) {
  const user = req.session.userId ? await db.user.findUnique({ where: { id: req.session.userId } }) : null;
  if (!user || user.disabled || user.sessionVersion !== req.session.version) throw fail(401, 'Vui lòng đăng nhập');
  req.user = user;
  if (req.session.device) req.session.device.lastSeen = new Date().toISOString();
  next();
}
app.use('/api', auth);
app.get('/api/me', (req, res) => res.json({ user: safe(req.user) }));
app.post('/api/logout', (req, res, next) => req.session.destroy(error => { if (error) return next(error); res.clearCookie('ss.sid', { httpOnly: true, sameSite: 'lax', secure: production }); res.json({ ok: true }); }));
app.patch('/api/profile', async (req, res) => {
  if (!text(req.body.name, 100)) throw fail(400, 'Tên không hợp lệ');
  res.json({ user: safe(await db.user.update({ where: { id: req.user.id }, data: { name: req.body.name.trim(), ...( ['shield', 'star', 'leaf', 'moon', 'sun', 'diamond'].includes(req.body.avatar) ? { avatar: req.body.avatar } : {}) } })) });
});
app.post('/api/password', async (req, res) => {
  if (!passwordValid(req.body.password) || req.body.password.length < req.policy.minPasswordLength || !await argon2.verify(req.user.passwordHash, String(req.body.currentPassword || '').slice(0, 129)) || !await verifyFactor(req.user, req.body.code)) throw fail(400, 'Mật khẩu hoặc mã xác thực không hợp lệ');
  await db.user.update({ where: { id: req.user.id }, data: { passwordHash: await passwordHash(req.body.password), sessionVersion: { increment: 1 } } });
  await sessions.revokeUser(req.user.id);
  await alert(req, req.user, 'PASSWORD_CHANGED');
  res.json({ message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
});
app.get('/api/dashboard', async (req, res) => {
  const accounts = await db.protectedAccount.findMany({ where: { userId: req.user.id } });
  const events = await db.securityEvent.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 });
  res.json({ score: score(req.user, accounts), accounts, events, recommendations: [...(!req.user.totpSecret ? ['Bật xác thực hai bước cho StudentShield.'] : []), ...accounts.filter(a => !a.has2fa || !a.uniquePassword || !a.recoveryReady).map(a => `Kiểm tra 2FA, mật khẩu riêng và khôi phục: ${a.label}`), ...(!accounts.length ? ['Thêm tài khoản cần bảo vệ để đánh giá đầy đủ.'] : [])] });
});
app.get('/api/accounts', async (req, res) => res.json(await db.protectedAccount.findMany({ where: { userId: req.user.id } })));
app.post('/api/accounts', async (req, res) => {
  if (!text(req.body.label, 100) || !email(req.body.email)) throw fail(400, 'Tên và email không hợp lệ');
  res.status(201).json(await db.protectedAccount.create({ data: { userId: req.user.id, label: req.body.label.trim(), email: normalize(req.body.email), has2fa: req.body.has2fa === true, uniquePassword: req.body.uniquePassword === true, recoveryReady: req.body.recoveryReady === true } }));
});
app.patch('/api/accounts/:id', async (req, res) => {
  const data = {};
  for (const key of ['has2fa', 'uniquePassword', 'recoveryReady']) if (typeof req.body[key] === 'boolean') data[key] = req.body[key];
  if (req.body.label !== undefined) { if (!text(req.body.label, 100)) throw fail(400, 'Tên không hợp lệ'); data.label = req.body.label.trim(); }
  if (req.body.email !== undefined) { if (!email(req.body.email)) throw fail(400, 'Email không hợp lệ'); data.email = normalize(req.body.email); }
  const result = await db.protectedAccount.updateMany({ where: { id: req.params.id, userId: req.user.id }, data });
  if (!result.count) throw fail(404, 'Không tìm thấy tài khoản'); res.json({ ok: true });
});
app.delete('/api/accounts/:id', async (req, res) => { await db.protectedAccount.deleteMany({ where: { id: req.params.id, userId: req.user.id } }); res.json({ ok: true }); });
app.get('/api/sessions', async (req, res) => {
  const rows = sessions.list(req.user.id).map(s => ({ sid: s.sid, device: s.sess.device }));
  res.json(rows.map(r => ({ id: hash(r.sid), current: r.sid === req.sessionID, ...r.device })));
});
app.delete('/api/sessions/:id', async (req, res) => {
  const rows = sessions.list(req.user.id);
  for (const row of rows) if (hash(row.sid) === req.params.id) await sessions.destroy(row.sid);
  await event(req, 'SESSION_REVOKED'); res.json({ ok: true });
});
app.post('/api/2fa/setup', async (req, res) => {
  if (req.user.totpSecret || !await argon2.verify(req.user.passwordHash, String(req.body.password || '').slice(0, 129))) throw fail(400, 'Không thể khởi tạo 2FA');
  const secret = new Secret({ size: 20 }).base32;
  req.session.pendingTotp = { secret, expires: Date.now() + 600000 };
  const uri = totp(secret, req.user.email).toString();
  res.json({ secret, qr: await QRCode.toDataURL(uri) });
});
app.post('/api/2fa/enable', async (req, res) => {
  const pending = req.session.pendingTotp;
  if (req.user.totpSecret || !pending || pending.expires < Date.now() || totp(pending.secret, req.user.email).validate({ token: String(req.body.code || ''), window: 1 }) === null) throw fail(400, 'Mã không hợp lệ hoặc hết hạn');
  const codes = Array.from({ length: 8 }, () => random().slice(0, 20));
  const enabled = await db.user.updateMany({ where: { id: req.user.id, totpSecret: null }, data: { totpSecret: encrypt(pending.secret), recoveryHashes: codes.map(hash), sessionVersion: { increment: 1 } } });
  if (!enabled.count) throw fail(409, '2FA đã được bật bởi một yêu cầu khác');
  delete req.session.pendingTotp;
  req.session.version++;
  await alert(req, req.user, 'TWO_FACTOR_ENABLED');
  res.json({ recoveryCodes: codes });
});
app.post('/api/2fa/disable', async (req, res) => {
  if (!req.user.totpSecret || !await argon2.verify(req.user.passwordHash, String(req.body.password || '').slice(0, 129)) || !await verifyFactor(req.user, req.body.code)) throw fail(400, 'Xác thực không hợp lệ');
  await db.user.update({ where: { id: req.user.id }, data: { totpSecret: null, totpLastStep: null, recoveryHashes: [], sessionVersion: { increment: 1 } } });
  req.session.version++;
  await alert(req, req.user, 'TWO_FACTOR_DISABLED'); res.json({ ok: true });
});
app.post('/api/tools/link', (req, res) => {
  let url; try { url = new URL(String(req.body.url)); } catch { throw fail(400, 'URL không hợp lệ'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw fail(400, 'Chỉ hỗ trợ HTTP/HTTPS');
  const flags = [];
  if (url.protocol !== 'https:') flags.push('Không sử dụng HTTPS');
  if (url.username || url.password) flags.push('URL chứa thông tin đăng nhập gây nhầm lẫn');
  for (const [brand, domain] of [['google', 'google.com'], ['facebook', 'facebook.com'], ['microsoft', 'microsoft.com'], ['github', 'github.com']]) {
    if (url.hostname.toLowerCase().includes(brand) && url.hostname !== domain && !url.hostname.endsWith('.' + domain)) flags.push(`Tên miền nhắc đến ${brand} nhưng không thuộc ${domain}; cần kiểm tra giả mạo`);
  }
  if (url.hostname.includes('xn--')) flags.push('Tên miền quốc tế cần kiểm tra giả mạo');
  if (/^(\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(':')) flags.push('Địa chỉ IP thay cho tên miền');
  if (['bit.ly', 'tinyurl.com', 't.co', 'rb.gy', 'shorturl.at'].includes(url.hostname)) flags.push('Link rút gọn che đích đến');
  if (url.hostname.split('.').length > 4 || url.hostname.length > 60) flags.push('Tên miền dài hoặc nhiều tên miền phụ');
  if (/login|verify|password|account|signin/i.test(url.pathname + url.search)) flags.push('Đường dẫn liên quan đăng nhập: hãy xác minh tên miền');
  res.json({ host: url.hostname, risk: flags.length >= 3 ? 'Cao' : flags.length ? 'Cần kiểm tra' : 'Chưa thấy dấu hiệu trong quy tắc', flags, note: 'Phân tích tĩnh; không mở URL, không giải link rút gọn và không cam kết an toàn.' });
});
app.get('/api/lessons', async (req, res) => res.json(await db.lesson.findMany({ where: { OR: [{ schoolId: null }, { schoolId: req.user.schoolId || '__none__' }] }, include: { completions: { where: { userId: req.user.id }, select: { createdAt: true } } } })));
app.post('/api/lessons/:id/complete', async (req, res) => {
 const lesson = await db.lesson.findFirst({ where: { id: req.params.id, OR: [{ schoolId: null }, { schoolId: req.user.schoolId || '__none__' }] } });
 if (!lesson) throw fail(404, 'Không tìm thấy bài học');
 res.json(await db.completion.upsert({ where: { userId_lessonId: { userId: req.user.id, lessonId: req.params.id } }, create: { userId: req.user.id, lessonId: req.params.id }, update: {} })); });
const admin = (req, res, next) => { if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) throw fail(403, 'Không có quyền quản trị'); if (req.user.role === 'ADMIN' && !req.user.schoolId) throw fail(403, 'Admin chưa được cấp phạm vi trường'); next(); };
const superAdmin = (req, res, next) => { if (req.user.role !== 'SUPER_ADMIN') throw fail(403, 'Chỉ Super Admin'); next(); };
const scope = req => req.user.role === 'SUPER_ADMIN' ? {} : { schoolId: req.user.schoolId };
app.get('/api/admin/policy', superAdmin, (req, res) => res.json(req.policy));
app.patch('/api/admin/policy', superAdmin, async (req, res) => {
  const { minPasswordLength, maxFailedLogins, sessionHours } = req.body;
  if (!Number.isInteger(minPasswordLength) || minPasswordLength < 12 || minPasswordLength > 64 || !Number.isInteger(maxFailedLogins) || maxFailedLogins < 3 || maxFailedLogins > 20 || !Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 24) throw fail(400, 'Chính sách ngoài phạm vi cho phép');
  const data = { minPasswordLength, maxFailedLogins, sessionHours };
  const policy = await db.systemPolicy.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
  await event(req, 'SYSTEM_POLICY_UPDATED'); res.json(policy);
});
app.get('/api/admin/users', admin, async (req, res) => res.json((await db.user.findMany({ where: scope(req), take: 200, orderBy: { createdAt: 'desc' } })).map(safe)));
app.get('/api/admin/stats', admin, async (req, res) => res.json({ users: await db.user.count({ where: scope(req) }), verified: await db.user.count({ where: { ...scope(req), verified: true } }), twoFactor: await db.user.count({ where: { ...scope(req), totpSecret: { not: null } } }), completions: await db.completion.count({ where: { user: scope(req) } }) }));
app.patch('/api/admin/users/:id', admin, async (req, res) => {
  const target = await db.user.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!target || target.id === req.user.id || target.role === 'SUPER_ADMIN' || (req.user.role === 'ADMIN' && (target.role !== 'USER' || req.body.role || req.body.schoolId !== undefined))) throw fail(403, 'Không được thay đổi tài khoản này');
  const data = { sessionVersion: { increment: 1 } };
  if (typeof req.body.disabled === 'boolean') data.disabled = req.body.disabled;
  if (req.user.role === 'SUPER_ADMIN') {
    if (req.body.role !== undefined) { if (!['USER', 'ADMIN'].includes(req.body.role)) throw fail(400, 'Vai trò không hợp lệ'); data.role = req.body.role; }
    if (req.body.schoolId !== undefined) data.schoolId = req.body.schoolId || null;
    if ((data.role || target.role) === 'ADMIN' && !(data.schoolId === undefined ? target.schoolId : data.schoolId)) throw fail(400, 'Admin phải thuộc một trường');
  }
  res.json(safe(await db.user.update({ where: { id: target.id }, data })));
  await event(req, `ADMIN_USER_UPDATED:${target.id}`);
});
app.get('/api/admin/events', admin, async (req, res) => res.json(await db.securityEvent.findMany({ where: { user: scope(req) }, take: 100, orderBy: { createdAt: 'desc' } })));
app.get('/api/admin/schools', admin, async (req, res) => res.json(await db.school.findMany({ where: req.user.role === 'SUPER_ADMIN' ? {} : { id: req.user.schoolId } })));
app.post('/api/admin/schools', superAdmin, async (req, res) => {
  if (!text(req.body.name, 100) || !/^[A-Z0-9_-]{3,20}$/.test(req.body.code || '')) throw fail(400, 'Tên hoặc mã trường không hợp lệ');
  const school = await db.school.create({ data: { name: req.body.name.trim(), code: req.body.code } });
  await event(req, `SCHOOL_CREATED:${school.id}`); res.status(201).json(school);
});
app.get('/api/admin/lessons', admin, async (req, res) => res.json(await db.lesson.findMany({ where: req.user.role === 'SUPER_ADMIN' ? {} : { schoolId: req.user.schoolId } })));
app.patch('/api/admin/lessons/:id', admin, async (req, res) => {
  if (!text(req.body.title, 120) || !text(req.body.content, 10000)) throw fail(400, 'Nội dung không hợp lệ');
  const result = await db.lesson.updateMany({ where: { id: req.params.id, ...(req.user.role === 'SUPER_ADMIN' ? {} : { schoolId: req.user.schoolId }) }, data: { title: req.body.title, content: req.body.content } });
  if (!result.count) throw fail(404, 'Không tìm thấy bài học trong phạm vi');
  await event(req, `LESSON_UPDATED:${req.params.id}`); res.json({ ok: true });
});
app.delete('/api/admin/lessons/:id', admin, async (req, res) => {
  const result = await db.lesson.deleteMany({ where: { id: req.params.id, ...(req.user.role === 'SUPER_ADMIN' ? {} : { schoolId: req.user.schoolId }) } });
  if (!result.count) throw fail(404, 'Không tìm thấy bài học trong phạm vi');
  await event(req, `LESSON_DELETED:${req.params.id}`); res.json({ ok: true });
});
app.post('/api/admin/lessons', admin, async (req, res) => {
  if (!text(req.body.title, 120) || !text(req.body.content, 10000)) throw fail(400, 'Nội dung không hợp lệ');
  res.status(201).json(await db.lesson.create({ data: { title: req.body.title, content: req.body.content, schoolId: req.user.role === 'ADMIN' ? req.user.schoolId : null } }));
  await event(req, 'LESSON_CREATED');
});
app.patch('/api/admin/schools/:id', admin, async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN' && req.user.schoolId !== req.params.id) throw fail(403, 'Ngoài phạm vi trường');
  if (!text(req.body.name, 100) || (req.body.contactEmail && !email(req.body.contactEmail))) throw fail(400, 'Thông tin trường không hợp lệ');
  const school = await db.school.update({ where: { id: req.params.id }, data: { name: req.body.name.trim(), contactEmail: req.body.contactEmail || null } });
  await event(req, `SCHOOL_UPDATED:${school.id}`); res.json(school);
});
app.get('/api/admin/report.xlsx', admin, async (req, res) => {
  const users = await db.user.findMany({ where: scope(req), take: 10000 });
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('School security');
  sheet.addRow(['Name', 'Email', 'Role', 'Verified', '2FA']);
  for (const u of users) sheet.addRow([u.name, u.email, u.role, u.verified, Boolean(u.totpSecret)]);
  res.attachment('studentshield-school.xlsx'); await workbook.xlsx.write(res); res.end();
});
app.get('/api/reports/:format', async (req, res) => {
  const accounts = await db.protectedAccount.findMany({ where: { userId: req.user.id } });
  if (req.params.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Security');
    sheet.addRow(['Account', '2FA', 'Unique password', 'Recovery ready']);
    for (const a of accounts) sheet.addRow([a.label, a.has2fa, a.uniquePassword, a.recoveryReady]);
    res.attachment('studentshield.xlsx'); await workbook.xlsx.write(res); res.end();
  } else if (req.params.format === 'pdf') {
    res.attachment('studentshield.pdf'); const doc = new PDFDocument(); doc.pipe(res);
    doc.fontSize(22).text('StudentShield Security Report'); doc.fontSize(12).text(`Score: ${score(req.user, accounts)}/100`).text(`Accounts: ${accounts.length}`).text(`2FA enabled: ${accounts.filter(a => a.has2fa).length}`).text(`Generated: ${new Date().toISOString()}`).text('Self-reported indicators; not an independent security audit.'); doc.end();
  } else throw fail(400, 'Định dạng không hỗ trợ');
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'P2002' ? 409 : err.code === 'P2003' ? 400 : 500);
  if (status === 500) console.error('Request failed:', err.name, err.code || 'internal');
  res.status(status).json({ error: status === 500 ? 'Không thể xử lý yêu cầu. Hãy thử lại sau.' : err.code === 'P2002' ? 'Dữ liệu đã tồn tại' : err.code === 'P2003' ? 'Tham chiếu dữ liệu không hợp lệ' : err.message });
});
