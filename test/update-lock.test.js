import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withUpdateLock } from '../src/update-lock.js';

test('并发更新只能进入一个，成功或失败均释放锁', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'easy-update-lock-test-'));
  const lock = join(dir, 'update.lock');
  try {
    await withUpdateLock(async () => {
      await assert.rejects(withUpdateLock(async () => assert.fail('不得并发更新'), { lock }), /另一个 Easy/);
    }, { lock });
    await assert.rejects(access(lock));
    await assert.rejects(withUpdateLock(async () => { throw new Error('offline'); }, { lock }), /offline/);
    await assert.rejects(access(lock));
    assert.equal(await withUpdateLock(async () => 42, { lock }), 42);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
