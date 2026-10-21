import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../src/config.js';
import ExcelJS from 'exceljs';
import { app } from '../src/app.js';
import { db, sessions } from '../src/db.js';
import { hash, random, passwordHash, totp, decrypt } from '../src/security.js';
const suffix = random().slice(0, 10);
const address = `student-${suffix}@example.com`;
const password = 'StudentShield-test-password-2026!';
const agent = request.agent(app);
let uid, csrf, schoolA, schoolB;
async function token(a = agent) { return (await a.get('/api/csrf')).body.token; }
const post = (path, data, a = agent, t = csrf) => a.post('/api' + path).set('x-csrf-token', t).send(data);
const login = async (a, email, code) => { const t = await token(a); return post('/auth/login', { email, password, code }, a, t); };
before(async () => {
  await db.user.count();
  csrf = await token();
  schoolA = await db.school.create({ data: { name: 'Test A', code: `A-${suffix.toUpperCase()}` } });
  schoolB = await db.school.create({ data: { name: 'Test B', code: `B-${suffix.toUpperCase()}` } });
});
after(async () => {
  const users = await db.user.findMany({ where: { email: { contains: suffix } }, select: { id: true } });
  for (const u of users) await sessions.revokeUser(u.id);
  await db.securityEvent.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  await db.school.deleteMany({ where: { id: { in: [schoolA?.id, schoolB?.id].filter(Boolean) } } });
  await db.$disconnect();
});
test('CSRF rejects mutation without session token', async () => { const r = await request(app).post('/api/auth/register').send({}); assert.equal(r.status, 403); });
test('register hashes password and requires verified email', async () => {
  const r = await post('/auth/register', { email: address, name: 'Sinh viên thử nghiệm', password, schoolCode: schoolA.code });
  assert.equal(r.status, 202);
  const u = await db.user.findUnique({ where: { email: address } }); uid = u.id;
  assert.match(u.passwordHash, /^\$argon2id\$/); assert.equal(u.verified, false); assert.equal(u.role, 'USER');
  assert.equal((await login(agent, address)).status, 403);
  const tokens = await db.token.findMany({ where: { userId: uid, kind: 'verify' } }); assert.equal(tokens.length, 1);
});
test('local inbox delivers verification link, token single-use', async () => {
  const messages = fs.readdirSync(path.join(dataDir, 'mail')).map(f => JSON.parse(fs.readFileSync(path.join(dataDir, 'mail', f), 'utf8')));
  const full = messages.find(m => m.to === address && m.text.includes('#verify=')); assert.ok(full, 'verification email delivered to local inbox');
  const raw = full.text.match(/#verify=([a-f0-9]{64})/)[1];
  assert.equal((await post('/auth/verify', { token: raw })).status, 200);
  assert.equal((await post('/auth/verify', { token: raw })).status, 400);
});
test('login rotates session and enables authenticated dashboard', async () => {
  assert.equal((await login(agent, address)).status, 200); csrf = await token();
  const me = await agent.get('/api/me'); assert.equal(me.body.user.id, uid); assert.equal(me.body.user.passwordHash, undefined);
  const dash = await agent.get('/api/dashboard'); assert.equal(dash.status, 200); assert.equal(dash.body.score, 20);
});
test('protected accounts persist and cannot be deleted by another user', async () => {
  const r = await post('/accounts', { label: '=HYPERLINK("bad")', email: address, has2fa: true, uniquePassword: true, recoveryReady: true });
  assert.equal(r.status, 201);
  const other = await db.user.create({ data: { email: `other-${suffix}@example.com`, name: 'Other', verified: true, passwordHash: await passwordHash(password) } });
  const a = request.agent(app); assert.equal((await login(a, other.email)).status, 200); const t = await token(a);
  await a.delete('/api/accounts/' + r.body.id).set('x-csrf-token', t);
  assert.ok(await db.protectedAccount.findUnique({ where: { id: r.body.id } }));
  assert.equal((await agent.get('/api/dashboard')).body.score, 70);
});
test('ordinary user cannot access administration or self-promote', async () => {
  assert.equal((await agent.get('/api/admin/users')).status, 403);
  assert.equal((await agent.patch('/api/admin/users/' + uid).set('x-csrf-token', csrf).send({ role: 'SUPER_ADMIN' })).status, 403);
});
test('school admin cannot see or modify users of another school', async () => {
  const u = await db.user.create({ data: { email: `admin-${suffix}@example.com`, name: 'Admin', verified: true, role: 'ADMIN', schoolId: schoolB.id, passwordHash: await passwordHash(password) } });
  const a = request.agent(app); assert.equal((await login(a, u.email)).status, 200); const t = await token(a);
  const users = await a.get('/api/admin/users'); assert.equal(users.status, 200); assert.ok(users.body.every(u => u.schoolId === schoolB.id));
  assert.equal((await a.patch('/api/admin/users/' + uid).set('x-csrf-token', t).send({ disabled: true })).status, 403);
  assert.equal((await post('/admin/schools', { name: 'Bad', code: 'BAD' }, a, t)).status, 403);
  assert.equal((await a.get('/api/admin/policy')).status, 403);
  assert.equal((await a.patch('/api/admin/schools/' + schoolA.id).set('x-csrf-token', t).send({ name: 'Changed' })).status, 403);
  const lesson = await post('/admin/lessons', { title: 'Private lesson', content: 'School B only' }, a, t); assert.equal(lesson.status, 201);
  assert.ok(!(await agent.get('/api/lessons')).body.some(l => l.id === lesson.body.id));
  assert.equal((await post('/lessons/' + lesson.body.id + '/complete', {})).status, 404);
  await db.lesson.delete({ where: { id: lesson.body.id } });
});
test('link checker flags phishing indicators without fetching target', async () => {
  const r = await post('/tools/link', { url: 'http://user:pass@bit.ly/login' }); assert.equal(r.status, 200); assert.equal(r.body.risk, 'Cao');
  assert.equal((await post('/tools/link', { url: 'javascript:alert(1)' })).status, 400);
});
test('PDF and Excel are generated from authenticated data', async () => {
  const pdf = await agent.get('/api/reports/pdf'); assert.equal(pdf.status, 200); assert.match(pdf.headers['content-type'], /pdf/); assert.ok(pdf.body.length > 500);
  const xlsx = await agent.get('/api/reports/xlsx').buffer(true).parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }); assert.equal(xlsx.status, 200); assert.ok(xlsx.body.length > 1000);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.body); assert.equal(workbook.worksheets[0].getRow(2).getCell(1).value, '=HYPERLINK("bad")'); assert.equal(workbook.worksheets[0].getRow(2).getCell(1).type, ExcelJS.ValueType.String);
});
test('TOTP enable encrypts secret and returns one-time recovery codes', async () => {
  const setup = await post('/2fa/setup', { password }); assert.equal(setup.status, 200);
  const secret = setup.body.secret;
  const r = await post('/2fa/enable', { code: totp(secret, address).generate() }); assert.equal(r.status, 200); assert.equal(r.body.recoveryCodes.length, 8);
  const u = await db.user.findUnique({ where: { id: uid } }); assert.notEqual(u.totpSecret, secret); assert.equal(decrypt(u.totpSecret), secret); assert.notEqual(u.recoveryHashes[0], r.body.recoveryCodes[0]);
  const a = request.agent(app); assert.equal((await login(a, address)).status, 401);
  assert.equal((await login(a, address, r.body.recoveryCodes[0])).status, 200);
  const b = request.agent(app); assert.equal((await login(b, address, r.body.recoveryCodes[0])).status, 401);
});
test('remote session revocation prevents further authenticated requests', async () => {
  const u = await db.user.findUnique({ where: { id: uid } });
  const code = random().slice(0, 20); await db.user.update({ where: { id: uid }, data: { recoveryHashes: { push: hash(code) } } });
  const a = request.agent(app); assert.equal((await login(a, address, code)).status, 200);
  const sessions = await a.get('/api/sessions'); const other = sessions.body.find(s => s.current); assert.ok(other);
  assert.equal((await agent.delete('/api/sessions/' + other.id).set('x-csrf-token', csrf)).status, 200);
  const remaining = await agent.get('/api/sessions'); assert.ok(!remaining.body.some(s => s.id === other.id));
  assert.equal((await a.get('/api/me')).status, 401);
});
test('password reset single-use, invalidates sessions, retains 2FA', async () => {
  const raw = random(); await db.token.create({ data: { userId: uid, kind: 'reset', hash: hash(raw), expiresAt: new Date(Date.now() + 60000) } });
  const a = request.agent(app); const t = await token(a);
  assert.equal((await post('/auth/reset', { token: raw, password: password + 'new' }, a, t)).status, 200);
  assert.equal((await agent.get('/api/me')).status, 401);
  assert.equal((await post('/auth/reset', { token: raw, password }, a, t)).status, 400);
  assert.ok((await db.user.findUnique({ where: { id: uid } })).totpSecret);
});

test('expired reset tokens are rejected; account lockout survives different sessions', async () => {
  const a = request.agent(app); const t = await token(a), raw = random();
  await db.token.create({ data: { userId: uid, kind: 'reset', hash: hash(raw), expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await post('/auth/reset', { token: raw, password }, a, t)).status, 400);
  await db.securityEvent.createMany({ data: Array.from({length:10}, () => ({ userId:uid, type:'LOGIN_FAILED', ip:'test', agent:'test' })) });
  const recovery = random(); await db.user.update({ where: { id:uid }, data:{ recoveryHashes:{push:hash(recovery)} } });
  const r = await post('/auth/login', { email:address, password:password + 'new', code:recovery }, a, t);
  assert.equal(r.status,401);
  assert.ok((await db.user.findUnique({where:{id:uid}})).recoveryHashes.includes(hash(recovery)), 'lockout does not consume recovery code');
});
