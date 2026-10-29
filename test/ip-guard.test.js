import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Guard } from '../src/ip-guard/guard.js';
import { proxyEnvironment, runProtectedCode } from '../src/ip-guard/launcher.js';

test('固定本机代理环境，只绕过本机地址且不修改原环境', () => {
  const env = { PATH: '/test', NO_PROXY: '*', https_proxy: 'http://old' };
  const result = proxyEnvironment(12345, env);
  assert.equal(result.HTTPS_PROXY, 'http://127.0.0.1:12345');
  assert.equal(result.no_proxy, 'localhost,127.0.0.1,::1,.local');
  assert.equal(result.NO_PROXY, result.no_proxy);
  assert.equal(env.NO_PROXY, '*');
  for (const port of [0, 65536, '12345', 1.5]) assert.throws(() => proxyEnvironment(port));
});

test('保护服务不可用时不启动 Claude，不回退直连', async () => {
  let launched = false;
  await assert.rejects(runProtectedCode([], {
    platform: 'darwin',
    readStatus: async () => { throw new Error('offline'); }, start: () => { launched = true; }
  }));
  assert.equal(launched, false);
});

test('代理启动器保留终端和参数，不再添加外层沙箱', async () => {
  let invocation;
  const code = await runProtectedCode(['--help'], {
    platform: 'darwin',
    readStatus: async () => ({ port: 12345 }),
    start: (...args) => {
      invocation = args;
      const child = new EventEmitter(); process.nextTick(() => child.emit('exit', 7)); return child;
    }
  });
  assert.equal(code, 7); assert.equal(invocation[2].stdio, 'inherit');
  assert.equal(invocation[0], 'claude');
  assert.deepEqual(invocation[1], ['--help']);
  assert.equal(invocation[2].env.HTTPS_PROXY, 'http://127.0.0.1:12345');
});

test('周期复查成功续租不断连接，失败立即撤销旧放行', async t => {
  const guard = new Guard({ allowed: ['203.0.113.1'], probe: async () => '203.0.113.1' });
  t.after(() => guard.revoke()); guard.enable(); await guard.verify();
  let blocked = 0; guard.on('blocked', () => blocked++);
  assert.equal(await guard.verify({ keepLease: true }), true);
  assert.equal(blocked, 0); assert.equal(guard.usable(), true);
  guard.probe = async () => '203.0.113.2';
  assert.equal(await guard.verify({ keepLease: true }), false);
  assert.equal(blocked, 1); assert.equal(guard.usable(), false);
});
