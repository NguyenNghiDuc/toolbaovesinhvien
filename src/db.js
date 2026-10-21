// Local, single-process JSON persistence. No database server, ORM or SQL required.
import { dataDir } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const file = path.join(dataDir, 'store.json'), lock = path.join(dataDir, 'store.lock');
const context = new AsyncLocalStorage();
let queue = Promise.resolve(), closed = false;
function acquire() {
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid store.lock; inspect it before removing it');
    try { process.kill(pid, 0); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      fs.unlinkSync(lock); return acquire();
    }
    throw new Error('StudentShield data is already open by another process. Stop that process or use a different DATA_DIR.');
  }
}
acquire();
const revive = (key, value) => value && typeof value === 'object' && '$bigint' in value ? BigInt(value.$bigint) : ['createdAt', 'expiresAt', 'expire'].includes(key) && typeof value === 'string' ? new Date(value) : value;
const encode = value => JSON.stringify(value, (key, v) => typeof v === 'bigint' ? { $bigint: String(v) } : v);
const empty = () => ({ user: [], school: [], token: [], protectedAccount: [], securityEvent: [], lesson: [
  { id: 'passwords', schoolId: null, title: 'Mật khẩu riêng cho từng tài khoản', content: 'Dùng mật khẩu dài ít nhất 12 ký tự, riêng cho mỗi dịch vụ. Sử dụng trình quản lý mật khẩu.' },
  { id: 'phishing', schoolId: null, title: 'Nhận diện liên kết lừa đảo', content: 'Kiểm tra tên miền trước khi đăng nhập. HTTPS không chứng minh trang đáng tin. Tự mở trang chính thức.' },
  { id: 'twofactor', schoolId: null, title: 'Bật 2FA và chuẩn bị khôi phục', content: 'Dùng ứng dụng xác thực. Lưu mã khôi phục ngoại tuyến. Không cung cấp OTP cho người khác.' }
], completion: [], systemPolicy: [], sessions: [] });
let state;
try { state = JSON.parse(fs.readFileSync(file, 'utf8'), revive); }
catch (e) { if (e.code !== 'ENOENT') { fs.unlinkSync(lock); throw new Error('Cannot read store.json; restore a backup rather than overwriting your data', { cause: e }); } state = empty(); }
for (const table of Object.keys(empty())) {
  if (!Array.isArray(state[table])) { fs.unlinkSync(lock); throw new Error(`Invalid local store table: ${table}. Restore a backup; data was not overwritten.`); }
}
function persist() {
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, encode(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function release() { if (!closed) { closed = true; fs.unlinkSync(lock); } }
process.once('exit', () => { if (!closed && fs.existsSync(lock)) release(); });
async function atomic(fn) {
  if (closed) throw new Error('Local store is closed');
  if (context.getStore()) return fn();
  const pending = queue.then(() => context.run(true, async () => {
    const before = structuredClone(state);
    try { const result = await fn(); persist(); return structuredClone(result); }
    catch (e) { state = before; throw e; }
  }));
  queue = pending.catch(() => {}); return pending;
}
const error = (code, message) => Object.assign(new Error(message), { code });
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some(w => matches(row, w));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(w => matches(row, w));
    if (key === 'NOT') return !matches(row, value);
    if (key === 'user') return matches(state.user.find(u => u.id === row.userId) || {}, value);
    if (key === 'userId_lessonId') return matches(row, value);
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) return Object.entries(value).every(([op, v]) => {
      if (op === 'in') return v.includes(actual);
      if (op === 'contains') return typeof actual === 'string' && actual.includes(v);
      if (op === 'has') return Array.isArray(actual) && actual.includes(v);
      if (op === 'not') return actual !== v;
      if (op === 'lt') return actual !== null && actual < v;
      if (op === 'gt') return actual !== null && actual > v;
      if (op === 'equals') return actual === v;
      throw new Error(`Unsupported local filter: ${op}`);
    });
    return actual === value;
  });
}
function projected(row, args = {}) {
  if (!row) return null;
  let value = structuredClone(row);
  if (args.include?.completions) value.completions = state.completion.filter(c => c.lessonId === row.id && matches(c, args.include.completions.where)).map(c => projected(c, args.include.completions));
  if (args.select) value = Object.fromEntries(Object.keys(args.select).filter(k => args.select[k]).map(k => [k, value[k]]));
  return value;
}
function defaults(model, data) {
  const standard = { id: randomUUID(), createdAt: new Date() };
  const byModel = { user: { avatar: 'shield', role: 'USER', schoolId: null, verified: false, disabled: false, totpSecret: null, totpLastStep: null, recoveryHashes: [], sessionVersion: 0 }, school: { contactEmail: null, settings: {} }, lesson: { schoolId: null }, protectedAccount: { has2fa: false, uniquePassword: false, recoveryReady: false } };
  return { ...standard, ...byModel[model], ...structuredClone(data) };
}
function validate(model, row, old) {
  for (const key of { user: ['email'], school: ['code'], token: ['hash'] }[model] || []) if (state[model].some(r => r !== old && r[key] === row[key])) throw error('P2002', 'Duplicate value');
  if (model === 'user' && !['USER', 'ADMIN', 'SUPER_ADMIN'].includes(row.role)) throw error('P2003', 'Invalid role');
  if (model === 'completion' && state.completion.some(r => r !== old && r.userId === row.userId && r.lessonId === row.lessonId)) throw error('P2002', 'Duplicate lesson completion');
  if (row.userId && !state.user.some(u => u.id === row.userId)) throw error('P2003', 'Unknown user');
  if (row.schoolId && !state.school.some(s => s.id === row.schoolId)) throw error('P2003', 'Unknown school');
  if (model === 'completion' && !state.lesson.some(l => l.id === row.lessonId)) throw error('P2003', 'Unknown lesson');
}
function patch(row, data) {
  const result = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if ('increment' in value) { result[key] += value.increment; continue; }
      if ('push' in value) { result[key] = [...result[key], value.push]; continue; }
      if ('set' in value) { result[key] = value.set; continue; }
    }
    result[key] = structuredClone(value);
  }
  return result;
}
function model(name) {
  const findMany = async (args = {}) => {
    let rows = state[name].filter(r => matches(r, args.where));
    if (args.orderBy) { const [key, direction] = Object.entries(args.orderBy)[0]; rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === 'desc' ? -1 : 1)); }
    return rows.slice(0, args.take).map(r => projected(r, args));
  };
  const create = args => atomic(() => { const row = defaults(name, args.data); validate(name, row); state[name].push(row); return projected(row, args); });
  const updateMany = args => atomic(() => { let count = 0; for (const [index, row] of state[name].entries()) if (matches(row, args.where)) { const changed = patch(row, args.data); validate(name, changed, row); state[name][index] = changed; count++; } return { count }; });
  const deleteMany = (args = {}) => atomic(() => {
    const removed = state[name].filter(r => matches(r, args.where));
    state[name] = state[name].filter(r => !removed.includes(r));
    const ids = removed.map(r => r.id);
    if (name === 'user') {
      for (const child of ['token', 'protectedAccount', 'completion']) state[child] = state[child].filter(r => !ids.includes(r.userId));
      state.sessions = state.sessions.filter(r => !ids.includes(r.sess.userId));
      state.securityEvent.forEach(e => { if (ids.includes(e.userId)) e.userId = null; });
    }
    if (name === 'lesson') state.completion = state.completion.filter(c => !ids.includes(c.lessonId));
    if (name === 'school') state.user.forEach(u => { if (ids.includes(u.schoolId)) u.schoolId = null; });
    return { count: removed.length };
  });
  return {
    findMany, findUnique: async args => projected(state[name].find(r => matches(r, args.where)), args), findFirst: async args => (await findMany(args))[0] || null,
    count: async (args = {}) => state[name].filter(r => matches(r, args.where)).length,
    create, createMany: args => atomic(async () => { for (const data of args.data) await create({ data }); return { count: args.data.length }; }),
    updateMany, update: args => atomic(async () => { if (!(await updateMany(args)).count) throw error('P2025', 'Record not found'); return projected(state[name].find(r => matches(r, args.where)), args); }),
    deleteMany, delete: args => atomic(async () => { const row = state[name].find(r => matches(r, args.where)); if (!row) throw error('P2025', 'Record not found'); await deleteMany(args); return row; }),
    upsert: args => atomic(async () => { const row = state[name].find(r => matches(r, args.where)); if (!row) return create({ data: args.create }); await updateMany({ where: args.where, data: args.update }); return projected(state[name].find(r => matches(r, args.where))); })
  };
}
export const db = Object.fromEntries(['user', 'school', 'token', 'protectedAccount', 'securityEvent', 'lesson', 'completion', 'systemPolicy'].map(n => [n, model(n)]));
db.$transaction = fn => atomic(() => fn(db));
db.$disconnect = async () => { await queue; release(); };
db.consumeRecovery = (userId, codeHash) => atomic(() => { const user = state.user.find(u => u.id === userId); if (!user?.recoveryHashes.includes(codeHash)) return false; user.recoveryHashes = user.recoveryHashes.filter(h => h !== codeHash); return true; });
export const sessions = {
  get: id => structuredClone(state.sessions.find(s => s.sid === id && s.expire > new Date())?.sess || null),
  set: (id, sess) => atomic(() => { const expire = new Date(sess.cookie.expires || Date.now() + 8 * 3600000); state.sessions = state.sessions.filter(s => s.sid !== id); state.sessions.push({ sid: id, sess: structuredClone(sess), expire }); }),
  destroy: id => atomic(() => { state.sessions = state.sessions.filter(s => s.sid !== id); }),
  list: userId => structuredClone(state.sessions.filter(s => s.sess.userId === userId && s.expire > new Date())),
  revokeUser: userId => atomic(() => { state.sessions = state.sessions.filter(s => s.sess.userId !== userId); }),
  cleanup: () => atomic(() => { state.sessions = state.sessions.filter(s => s.expire > new Date()); })
};
persist();
