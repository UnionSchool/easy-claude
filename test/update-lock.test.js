import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithUpdateLock } from '../src/update-lock.js';

test('系统锁通过参数数组传递，不启动shell或删除旧锁目录', async () => {
  const calls = [];
  await runWithUpdateLock('/node path', ['/script path', '--locked'], {
    platform: 'darwin', lock: '/tmp/update.flock', binary: '/app helper',
    run: async (...args) => { calls.push(args); return 0; }
  });
  assert.deepEqual(calls, [['/app helper', ['--with-update-lock', '/tmp/update.flock', '/node path', '/script path', '--locked']]]);
});

test('占用、权限、启动失败和进程失败均明确报错', async () => {
  for (const [code, message] of [[75, /另一个 Easy/], [73, /权限/], [74, /Node.js/], [1, /未完成/]]) {
    await assert.rejects(runWithUpdateLock('/node', [], { platform: 'darwin', run: async () => code }), message);
  }
  await assert.rejects(runWithUpdateLock('/node', [], { platform: 'linux',
    run: async () => assert.fail('不得启动不支持的平台组件') }), /macOS/);
});
