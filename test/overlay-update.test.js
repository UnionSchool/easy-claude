import test from 'node:test';
import assert from 'node:assert/strict';
import { updateAndShow } from '../src/overlay-update.js';

test('菜单更新成功后才重开浮窗', async () => {
  const calls = [];
  await updateAndShow({ update: async name => calls.push(name), show: async () => calls.push('show') });
  assert.deepEqual(calls, ['easy-claude', 'show']);
});

test('更新失败保留当前浮窗', async () => {
  let reopened = false;
  await assert.rejects(updateAndShow({ update: async () => { throw new Error('network'); },
    show: async () => { reopened = true; } }), /network/);
  assert.equal(reopened, false);
});
