import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { db } from '../src/db.js';
const run = (code, dir) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
test('atomic transactions roll back all changes when validation fails', async () => {
  await assert.rejects(db.$transaction(async tx => {
    await tx.school.create({ data: { name: 'Rollback school', code: 'ROLLBACK' } });
    await tx.user.create({ data: { email: 'bad@example.com', name: 'Bad', schoolId: 'missing', passwordHash: 'test' } });
  }));
  assert.equal(await db.school.count({ where: { code: 'ROLLBACK' } }), 0);
});
test('concurrent requests cannot consume one recovery code twice', async () => {
  const u = await db.user.create({ data: { email: 'recovery@example.com', name: 'Test', passwordHash: 'test', recoveryHashes: ['hashed-test'] } });
  const results = await Promise.all([db.consumeRecovery(u.id, 'hashed-test'), db.consumeRecovery(u.id, 'hashed-test')]);
  assert.equal(results.filter(Boolean).length, 1);
});
test('data, dates, encrypted factors and sessions survive a process restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-restart-'));
  try {
    const write = run(`import {db,sessions} from './src/db.js'; import {encrypt} from './src/security.js';
      const u=await db.user.create({data:{email:'persist@example.com',name:'Persist',passwordHash:'hash',totpSecret:encrypt('secret'),totpLastStep:123n}});
      await sessions.set('test-session',{userId:u.id,cookie:{expires:new Date(Date.now()+60000)}}); await db.$disconnect();`, dir);
    assert.equal(write.status, 0, write.stderr);
    const read = run(`import {db,sessions} from './src/db.js'; import {decrypt} from './src/security.js'; import assert from 'node:assert/strict';
      const u=await db.user.findUnique({where:{email:'persist@example.com'}}); assert.ok(u.createdAt instanceof Date); assert.equal(u.totpLastStep,123n); assert.equal(decrypt(u.totpSecret),'secret'); assert.equal(sessions.get('test-session').userId,u.id); await db.$disconnect();`, dir);
    assert.equal(read.status, 0, read.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a second writer is rejected rather than silently losing user data', () => {
  const r = run(`await import('./src/db.js');`, process.env.DATA_DIR);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /already open/);
});
test('corrupt JSON is preserved for recovery, not replaced with an empty store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-corrupt-'));
  try {
    fs.writeFileSync(path.join(dir, 'store.json'), 'corrupt');
    const result = run(`await import('./src/db.js');`, dir);
    assert.notEqual(result.status, 0); assert.equal(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'), 'corrupt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
