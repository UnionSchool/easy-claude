import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Guard, createExitIPProbe, parseIPResponse, EXIT_IP_URLS } from '../src/ip-guard/guard.js';
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


test('解析 JSON、Cloudflare trace 及纯文本 IPv4 响应', () => {
  assert.equal(parseIPResponse('{"ip":"203.0.113.1"}'), '203.0.113.1');
  assert.equal(parseIPResponse('fl=123\nh=www.cloudflare.com\nip=203.0.113.2\nts=1\n'), '203.0.113.2');
  assert.equal(parseIPResponse('203.0.113.3\n'), '203.0.113.3');
  assert.throws(() => parseIPResponse(''));
  assert.throws(() => parseIPResponse('not-an-ip'));
});

test('多源轮转探测：单源429冷却10分钟后恢复，期间自动跳过', async () => {
  let clock = 0;
  const calls = [];
  const urls = ['https://a.example/ip', 'https://b.example/ip', 'https://c.example/ip'];
  const probe = createExitIPProbe({ urls, now: () => clock, request: async (url, options) => {
    calls.push(url);
    assert.equal(options.family, 4); assert.equal(options.timeout, 4000);
    if (url === urls[0] && clock < 600000) throw Object.assign(new Error('429'), { rateLimited: true });
    return '203.0.113.1';
  } });
  const signal = new AbortController().signal;
  assert.equal(await probe(signal), '203.0.113.1');
  clock = 10000; assert.equal(await probe(signal), '203.0.113.1');
  clock = 20000; assert.equal(await probe(signal), '203.0.113.1');
  clock = 30000; assert.equal(await probe(signal), '203.0.113.1');
  assert.deepEqual(calls, [urls[0], urls[1], urls[1], urls[2], urls[1]]);
  clock = 600000;
  // 下一轮起点为 urls[1]，再两轮回到 urls[0] 时冷却已结束。
  await probe(signal); await probe(signal); await probe(signal);
  assert.equal(calls.at(-1), urls[0]);
});

test('任一源返回合法但不在白名单的IP时立即阻断，不能切其他源挑选放通结果', async t => {
  const calls = [];
  const probe = createExitIPProbe({ request: async url => {
    calls.push(url); return url === EXIT_IP_URLS[0] ? '198.51.100.9' : '203.0.113.1';
  } });
  const guard = new Guard({ allowed: ['203.0.113.1'], probe });
  t.after(() => guard.revoke()); guard.enable();
  assert.equal(await guard.verify(), false);
  assert.equal(guard.usable(), false); assert.equal(guard.lastIP, '198.51.100.9');
  assert.deepEqual(calls, [EXIT_IP_URLS[0]]);
});

test('全部源失败保持失败；取消后不得继续备用；非法IP切下一源', async () => {
  let count = 0;
  const failed = createExitIPProbe({ request: async () => { count++; throw new Error('timeout'); } });
  await assert.rejects(failed(new AbortController().signal), /均不可用/); assert.equal(count, EXIT_IP_URLS.length);
  const controller = new AbortController(); count = 0;
  const canceled = createExitIPProbe({ request: async () => { count++; controller.abort(); throw new Error('aborted'); } });
  await assert.rejects(canceled(controller.signal)); assert.equal(count, 1);
  count = 0;
  const invalid = createExitIPProbe({ request: async () => (++count === 1 ? 'invalid' : '203.0.113.1') });
  assert.equal(await invalid(new AbortController().signal), '203.0.113.1'); assert.equal(count, 2);
});

test('全部源429时冷却不追加请求，冷却结束才允许再试', async () => {
  let count = 0, clock = 0;
  const limited = createExitIPProbe({ now: () => clock, request: async () => {
    count++; throw Object.assign(new Error('429'), { rateLimited: true });
  } });
  await assert.rejects(limited(new AbortController().signal), error => error.rateLimited === true);
  clock = 60000;
  await assert.rejects(limited(new AbortController().signal), error => error.rateLimited === true);
  assert.equal(count, EXIT_IP_URLS.length);
  clock = 600000; await assert.rejects(limited(new AbortController().signal)); assert.equal(count, EXIT_IP_URLS.length * 2);
});


test('保护检测首源超时或网络失败时切备用，备用成功仍须校验白名单', async t => {
  for (const failure of ['检测超时', 'ECONNRESET']) {
    const calls = [];
    const probe = createExitIPProbe({ request: async url => {
      calls.push(url);
      if (url === EXIT_IP_URLS[0]) throw new Error(failure);
      return '198.51.100.9';
    } });
    const guard = new Guard({ allowed: ['203.0.113.1'], probe });
    t.after(() => guard.revoke()); guard.enable();
    assert.equal(await guard.verify(), false);
    assert.deepEqual(calls, [EXIT_IP_URLS[0], EXIT_IP_URLS[1]]);
    assert.equal(guard.lastIP, '198.51.100.9');
    assert.equal(guard.reason, '出口不在白名单');
    assert.equal(guard.usable(), false);
  }
});
