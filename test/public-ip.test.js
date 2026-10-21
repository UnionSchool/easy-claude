import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicIP } from '../src/public-ip.js';

test('IP和城市固定查询指定服务，城市查询必须针对已获取IP', async () => {
  const calls = [];
  const result = await readPublicIP({ platform: 'darwin', env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
    run: async (cmd, args, options) => {
      calls.push(args.at(-1));
      assert.equal(cmd, '/usr/bin/curl');
      assert.equal(options.env.https_proxy, 'http://127.0.0.1:7890');
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 8192);
      assert.ok(args.includes('-q') && !args.includes('--location'));
      return { stdout: calls.length === 1 ? '203.0.113.1\n' : JSON.stringify({ ip: '203.0.113.1', city: ' Los Angeles\n', timezone: 'America/Los_Angeles' }) };
    } });
  assert.deepEqual(result, { ip: '203.0.113.1', city: 'Los Angeles', timezone: 'America/Los_Angeles' });
  assert.deepEqual(calls, ['https://ip.sb/ip', 'https://api.ip.sb/geoip/203.0.113.1']);
});

test('无环境代理时读取系统HTTPS代理；无代理仍能请求', async () => {
  for (const enabled of [true, false]) {
    let calls = 0;
    await readPublicIP({ platform: 'darwin', env: {}, run: async (cmd, args, options) => {
      calls++;
      if (cmd === '/usr/sbin/scutil') return { stdout: enabled ? '  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n' : ' HTTPSEnable : 0\n' };
      assert.equal(options.env.https_proxy, enabled ? 'http://127.0.0.1:7890' : undefined);
      return { stdout: calls === 2 ? '203.0.113.1' : '{}' };
    } });
    assert.equal(calls, 3);
  }
});

test('IP非法或网络失败显示IP异常，不请求城市', async () => {
  for (const value of ['', '<html>blocked</html>', '203.0.113.1\nmalicious', 'unknown']) {
    let count = 0;
    await assert.rejects(readPublicIP({ platform: 'linux', env: {}, run: async () => { count++; return { stdout: value }; } }), /IP异常/);
    assert.equal(count, 1);
  }
  await assert.rejects(readPublicIP({ platform: 'linux', env: {}, run: async () => { throw new Error('network'); } }), /IP异常/);
});

test('IPv6可查询；城市未知、无效或错误IP不伪造城市', async () => {
  for (const response of ['{}', 'invalid', JSON.stringify({ip:'203.0.113.2',city:'Wrong City'}), JSON.stringify({ip:'2001:db8::1',city:null})]) {
    let count = 0;
    const result = await readPublicIP({ platform: 'linux', env: {}, run: async () => ({stdout: ++count === 1 ? '2001:db8::1\n' : response}) });
    assert.deepEqual(result, { ip: '2001:db8::1', city: null, timezone: null });
  }
  let count = 0;
  const result = await readPublicIP({ platform: 'linux', env: {}, run: async () => {
    if (++count === 1) return {stdout:'203.0.113.1'};
    throw new Error('geo offline');
  } });
  assert.deepEqual(result, {ip:'203.0.113.1',city:null,timezone:null});
});


test('时区独立于城市读取，无效或错误IP的时区保持未知', async () => {
  for (const [ip, city, timezone, expected] of [
    ['203.0.113.1', null, 'America/Los_Angeles', 'America/Los_Angeles'],
    ['203.0.113.1', 'City', 'Invalid/Zone', null],
    ['203.0.113.1', 'City', null, null],
    ['203.0.113.2', 'City', 'Asia/Shanghai', null]
  ]) {
    let count = 0;
    const result = await readPublicIP({ platform: 'linux', env: {}, run: async () => ({
      stdout: ++count === 1 ? '203.0.113.1' : JSON.stringify({ip,city,timezone})
    }) });
    assert.equal(result.timezone, expected);
    assert.equal(result.city, ip === '203.0.113.1' ? city : null);
  }
});
