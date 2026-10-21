import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicIP } from '../src/public-ip.js';

const response = { ip: '203.0.113.1', city: ' Los Angeles\n', timezone: 'America/Los_Angeles' };

test('只请求ipinfo一次，同时读取IP、城市和时区，保留代理与安全限制', async () => {
  let count = 0;
  const result = await readPublicIP({ platform: 'darwin', env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
    run: async (cmd, args, options) => {
      count++;
      assert.equal(cmd, '/usr/bin/curl');
      assert.equal(args.at(-1), 'https://ipinfo.io/json');
      assert.equal(options.env.https_proxy, 'http://127.0.0.1:7890');
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 8192);
      assert.ok(args.includes('-q') && args.includes('--fail') && !args.includes('--location'));
      return { stdout: JSON.stringify(response) };
    } });
  assert.equal(count, 1);
  assert.deepEqual(result, { ...response, city: 'Los Angeles' });
});

test('无环境代理时读取系统HTTPS代理；无代理仍只请求一次', async () => {
  for (const enabled of [true, false]) {
    let requests = 0;
    const result = await readPublicIP({ platform: 'darwin', env: {}, run: async (cmd, _args, options) => {
      if (cmd === '/usr/sbin/scutil') return { stdout: enabled ? '  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n' : ' HTTPSEnable : 0\n' };
      requests++;
      assert.equal(options.env.https_proxy, enabled ? 'http://127.0.0.1:7890' : undefined);
      return { stdout: JSON.stringify(response) };
    } });
    assert.equal(requests, 1);
    assert.equal(result.ip, response.ip);
  }
});

test('无效JSON、无效IP、错误响应与限流均显示IP异常，不追加查询', async () => {
  for (const value of ['', '<html>blocked</html>', 'null', '{}', '[]', '{"ip":123}', '{"ip":"unknown"}', '{"ip":"203.0.113.1\\nmalicious"}', '{"error":{"message":"rate limited"}}']) {
    let count = 0;
    await assert.rejects(readPublicIP({ platform: 'linux', env: {}, run: async () => { count++; return { stdout: value }; } }), /IP异常/);
    assert.equal(count, 1);
  }
  for (const message of ['network', 'HTTP 429']) {
    let count = 0;
    await assert.rejects(readPublicIP({ platform: 'linux', env: {}, run: async () => { count++; throw new Error(message); } }), /IP异常/);
    assert.equal(count, 1);
  }
});

test('IPv4和IPv6均从同一次响应读取，缺少城市时区仍保留IP', async () => {
  for (const ip of ['198.51.100.7', '2001:db8::7']) {
    const result = await readPublicIP({ platform: 'linux', env: {}, run: async (_cmd, args) => {
      assert.equal(args.at(-1), 'https://ipinfo.io/json');
      return { stdout: JSON.stringify({ ip }) };
    } });
    assert.deepEqual(result, { ip, city: null, timezone: null });
  }
});

test('时区独立于城市，无效时区保持未知，城市文本受限', async () => {
  for (const [city, timezone, expectedCity, expectedZone] of [
    [null, 'America/Los_Angeles', null, 'America/Los_Angeles'],
    ['City', 'Invalid/Zone', 'City', null],
    ['City', null, 'City', null],
    [123, 'Asia/Shanghai', null, 'Asia/Shanghai'],
    ['x'.repeat(100), 'x'.repeat(101), 'x'.repeat(60), null]
  ]) {
    const result = await readPublicIP({ platform: 'linux', env: {}, run: async () => ({
      stdout: JSON.stringify({ip: response.ip, city, timezone})
    }) });
    assert.equal(result.timezone, expectedZone);
    assert.equal(result.city, expectedCity);
  }
});
