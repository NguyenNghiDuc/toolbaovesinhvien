import { test } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { passwordHash, passwordValid, encrypt, decrypt, random, hash, score } from '../src/security.js';
test('Argon2id verifies correct password and rejects wrong password', async () => {
  const digest = await passwordHash('Long-unique-test-password');
  assert.match(digest, /^\$argon2id\$/);
  assert.equal(await argon2.verify(digest, 'Long-unique-test-password'), true);
  assert.equal(await argon2.verify(digest, 'incorrect'), false);
});
test('TOTP encryption is randomized and authenticated', () => {
  const a = encrypt('TOTPSECRET'); const b = encrypt('TOTPSECRET'); assert.notEqual(a, b); assert.equal(decrypt(a), 'TOTPSECRET');
  const parts = a.split(':'); parts[1] = '0'.repeat(32); assert.throws(() => decrypt(parts.join(':')));
});
test('password bounds and score represent configured protection', () => {
  assert.equal(passwordValid('short'), false); assert.equal(passwordValid('a'.repeat(129)), false); assert.equal(passwordValid('a'.repeat(12)), true);
  assert.equal(score({ verified: true, totpSecret: 'enabled' }, [{ has2fa: true, uniquePassword: true, recoveryReady: true }]), 100);
  assert.equal(score({ verified: false, totpSecret: null }, []), 0);
  assert.notEqual(hash(random()), hash(random()));
});
