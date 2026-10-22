process.env.EASY_LANGUAGE = 'zh';
import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialToken, normalizeUsage, readUsage, formatUsage } from '../src/usage.js';
import { overlayData } from '../src/overlay-data.js';
const fixture = { five_hour: { utilization: 25, resets_at: '2026-10-17T12:00:00Z' }, seven_day: { utilization: 60, resets_at: null }, seven_day_sonnet: { utilization: null }, extra_usage: { utilization: 99 } };
test('独立展示窗口，不将加购额度混入订阅比例', () => {
  const result = normalizeUsage(fixture); const display = overlayData(result);
  assert.deepEqual(display.windows.map(w => w.remaining), [75,40,null]);
  assert.match(formatUsage(result), /75%/); assert.equal(display.windows[1].resetsAt, null);
});
test('无效数据不当作满额', () => {
  for (const value of [null, {}, {five_hour: {utilization: '20'}}, {five_hour: {utilization: 101}}]) assert.throws(() => normalizeUsage(value));
});
test('忽略同前缀的周额度明细汇总', () => {
  const result = normalizeUsage({...fixture, seven_day_breakdown: {as_of: null, window_started_at: null, rows: []}});
  assert.equal(overlayData(result).windows.length, 3);
  assert.equal(result.rateLimitsByLimitId.seven_day_breakdown, undefined);
});
test('过期、缺失凭据明确报错，不泄漏秘密', () => {
  assert.equal(credentialToken(JSON.stringify({claudeAiOauth:{accessToken:'test-only',expiresAt:200}}),100),'test-only');
  assert.throws(() => credentialToken(JSON.stringify({claudeAiOauth:{accessToken:'secret',expiresAt:1}}),100), /过期/);
  assert.throws(() => credentialToken('secret'), e => !e.message.includes('secret'));
});
test('固定官方源，禁止重定向，不输出响应错误正文', async () => {
  const result = await readUsage({getToken: async () => 'test-only', fetchImpl: async (url, opts) => {
    assert.equal(url,'https://api.anthropic.com/api/oauth/usage'); assert.equal(opts.redirect,'error');
    return new Response(JSON.stringify(fixture));
  }}); assert.equal(result.rateLimitsByLimitId.five_hour.primary.usedPercent,25);
  for (const status of [401,403,429,500]) await assert.rejects(readUsage({getToken: async () => 'test-only',fetchImpl: async () => new Response('secret',{status})}),e=>!e.message.includes('secret'));
});
test('取消与超时释放请求', async () => {
  const fetchImpl = (_, {signal}) => new Promise((resolve,reject) => {signal.addEventListener('abort',()=>reject(new Error('secret')),{once:true});});
  await assert.rejects(readUsage({getToken: async ()=>'test-only',fetchImpl,timeoutMs:10}),/超时/);
  const controller=new AbortController();controller.abort();await assert.rejects(readUsage({signal:controller.signal}),/取消/);
});

test('区分登录失效和服务拒绝，403 不误导为重新登录', async () => {
  const request = status => readUsage({getToken: async () => 'test-only', fetchImpl: async () => new Response('secret', {status})});
  await assert.rejects(request(401), /HTTP 401.*claude auth login/);
  await assert.rejects(request(403), error => error.message.includes('HTTP 403') && error.message.includes('/usage') && !error.message.includes('claude auth login'));
});

test('认证状态明确分类，403和网络错误不能冒充未登录', async () => {
  assert.throws(() => credentialToken('{}'), e => e.code === 'auth_required');
  assert.throws(() => credentialToken(JSON.stringify({claudeAiOauth:{accessToken:'test-only',expiresAt:1}}),100), e => e.code === 'auth_expired');
  for (const [status, expected] of [[401,'auth_expired'],[403,undefined],[429,'rate_limited'],[500,undefined]]) {
    await assert.rejects(readUsage({getToken:async()=>'test-only',fetchImpl:async()=>new Response('',{status})}), e => e.code === expected);
  }
});

test('429保留结构化限流状态，不读取错误正文或立即重试', async () => {
  let calls = 0;
  await assert.rejects(readUsage({ getToken: async () => 'fake', fetchImpl: async () => {
    calls++; return { status:429, ok:false, json: () => { throw new Error('must not read body'); } };
  } }), error => error.code === 'rate_limited');
  assert.equal(calls, 1);
});
