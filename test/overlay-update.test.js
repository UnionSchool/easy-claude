import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePackage } from '../src/update.js';
import { performUpdateAndShow as updateAndShow } from '../src/overlay-update.js';

test('菜单更新成功后才重开浮窗', async () => {
  const calls = [];
  await updateAndShow({ update: async name => { calls.push(name); return true; }, show: async () => calls.push('show') });
  assert.deepEqual(calls, ['easy-claude', 'show']);
});

test('更新失败保留当前浮窗', async () => {
  let reopened = false;
  await assert.rejects(updateAndShow({ update: async () => { throw new Error('network'); },
    show: async () => { reopened = true; } }), /network/);
  assert.equal(reopened, false);
});

test('已是最新或本地版本更高时不安装、不重开', async () => {
  for (const latest of ['1.2.3', '1.2.2']) {
    let reopened = false;
    await updateAndShow({ update: name => updatePackage(name, {
      currentVersion: '1.2.3', getNpmCli: async () => 'npm', getLatest: async () => latest,
      run: async () => assert.fail('不得重复安装或降级') }),
      show: async () => { reopened = true; } });
    assert.equal(reopened, false);
  }
});

test('更新锁拒绝时不执行安装或重开', async () => {
  await assert.rejects(updateAndShow({
    lock: async () => { throw new Error('busy'); },
    update: async () => assert.fail('不得安装'), show: async () => assert.fail('不得重开')
  }), /busy/);
});
