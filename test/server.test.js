import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('occupied port produces a clear error and failure exit, never a listening message', async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-port-conflict-'));
  try {
    const port = String(occupied.address().port);
    const result = spawnSync(process.execPath, ['src/server.js'], { env: { ...process.env, DATA_DIR: dir, PORT: port, HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /EADDRINUSE/);
    assert.ok(result.stderr.includes(port));
    assert.doesNotMatch(result.stdout, /listening on port/);
    assert.equal(fs.existsSync(path.join(dir, 'store.lock')), false);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
