import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Guard, normalizeIP, parseIPResponse, probeHTTPS } from './guard.mjs';
import { createGateway } from './gateway.mjs';

const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowed = ['203.0.113.1'];
function guardFor(t, options = {}) {
  const guard = new Guard({ allowed, probe: async () => allowed[0], ...options });
  t.after(() => guard.revoke('测试结束')); return guard;
}
async function listen(server, host = '127.0.0.1') {
  server.listen(0, host); await once(server, 'listening'); return server.address().port;
}
async function connect(port, host = '127.0.0.1') {
  const socket = net.connect({ port, host });
  socket.on('error', () => {}); await once(socket, 'connect'); return socket;
}
async function tunnel(port, target) {
  const socket = await connect(port);
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const [data] = await once(socket, 'data');
  return { socket, response: data.toString() };
}
async function streamFixture(t) {
  const sockets = new Set(); let sent = 0;
  const origin = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {});
    const timer = setInterval(() => { sent++; socket.write('tick\n'); }, 10);
    socket.on('close', () => { clearInterval(timer); sockets.delete(socket); });
  });
  const port = await listen(origin);
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(r => origin.close(r)); });
  return { port, sent: () => sent };
}
async function gatewayFor(t, guard, port) {
  const gateway = createGateway(guard, new Map([[`127.0.0.1:${port}`, { host: '127.0.0.1', port }]]));
  const proxyPort = await listen(gateway.server);
  t.after(() => gateway.close()); return proxyPort;
}

test('地址严格解析：IPv4/IPv6 规范化、映射地址和非法响应拒绝', () => {
  assert.equal(normalizeIP('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(parseIPResponse('{"ip":"203.0.113.1"}'), allowed[0]);
  for (const ip of [' 203.0.113.1', '203.0.113.1\n', '1.2.3.999', '127.1', '::ffff:192.0.2.1', 'fe80::1%en0']) {
    assert.throws(() => normalizeIP(ip));
  }
  for (const raw of ['null', '[]', '{}', '<html>', '{"ip":3}', 'x'.repeat(8193)]) assert.throws(() => parseIPResponse(raw));
});

test('默认关闭、启用先阻断、正确 IP 才放行；关闭不留下放行租约', async t => {
  const guard = guardFor(t);
  assert.equal(guard.state, 'off'); assert.equal(guard.usable(), false);
  guard.enable(); assert.equal(guard.state, 'blocked');
  assert.equal(await guard.verify(), true); assert.equal(guard.usable(), true);
  guard.disable(); assert.equal(guard.state, 'off'); assert.equal(guard.expires, 0);
});

test('错误 IP、非法值和查询失败均阻断；不沿用成功结果', async t => {
  const guard = guardFor(t); guard.enable(); await guard.verify();
  for (const value of ['203.0.113.2', 'invalid', null, new Error('查询失败')]) {
    guard.probe = async () => { if (value instanceof Error) throw value; return value; };
    assert.equal(await guard.verify(), false); assert.equal(guard.usable(), false);
  }
});

test('超时即使探测忽略取消也不能放行', async t => {
  let resolve;
  const guard = guardFor(t, { timeout: 30, probe: () => new Promise(r => { resolve = r; }) });
  guard.enable(); assert.equal(await guard.verify(), false);
  resolve(allowed[0]); await sleep(10); assert.equal(guard.usable(), false);
});

test('连续网络变化取消旧检测，旧成功和旧失败都不能覆盖最新状态', async t => {
  const pending = [], signals = [];
  const guard = guardFor(t, { probe: signal => new Promise((resolve, reject) => { pending.push({ resolve, reject }); signals.push(signal); }) });
  guard.enable(); const first = guard.verify(); await sleep(1);
  guard.revoke('网络变化'); const second = guard.verify(); await sleep(1);
  guard.revoke('再次变化'); const third = guard.verify(); await sleep(1);
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, true);
  pending[0].resolve(allowed[0]); await first; assert.equal(guard.usable(), false);
  pending[2].resolve(allowed[0]); assert.equal(await third, true);
  pending[1].reject(new Error('旧请求失败')); await second; assert.equal(guard.usable(), true);
});

test('单调时钟租约、唤醒/重启事件和白名单修改均撤销放行', async t => {
  let now = 100;
  const guard = guardFor(t, { now: () => now }); guard.enable(); await guard.verify();
  now += 1001; assert.equal(guard.usable(), false);
  for (const reason of ['唤醒', '监控服务重启', '控制通信中断']) {
    await guard.verify(); guard.revoke(reason); assert.equal(guard.usable(), false);
  }
  await guard.verify(); guard.changeAllowed(['203.0.113.2']); assert.equal(guard.usable(), false);
  assert.equal(await guard.verify(), false);
});

test('检测不重叠，429 冷却不能被手动复查绕过', async t => {
  let calls = 0, now = 0;
  const guard = guardFor(t, { now: () => now, probe: async () => {
    calls++; await sleep(10); throw Object.assign(new Error('HTTP 429'), { rateLimited: true });
  } });
  guard.enable(); const pending = guard.verify(); assert.equal(await guard.verify(), false); await pending;
  assert.equal(await guard.verify(), false); assert.equal(calls, 1);
  now = 1001; guard.probe = async () => { calls++; return allowed[0]; };
  assert.equal(await guard.verify(), true); assert.equal(calls, 2);
});

test('真实 HTTPS：证书校验、大小限制、非法响应、重定向、429、超时和恢复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'easy-ip-guard-proof-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, 'fixture.key'), certPath = join(directory, 'fixture.crt');
  await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
  const key = await readFile(keyPath), ca = await readFile(certPath);
  let mode = 'ok';
  const server = https.createServer({ key, cert: ca }, (_req, res) => {
    if (mode === 'timeout') return;
    if (mode === '429') { res.writeHead(429); res.end(); }
    else if (mode === 'redirect') { res.writeHead(302, { Location: 'https://127.0.0.1/' }); res.end(); }
    else res.end(mode === 'big' ? 'x'.repeat(8193) : mode === 'bad' ? 'null' : JSON.stringify({ ip: mode === 'family' ? '2001:db8::1' : allowed[0] }));
  });
  const port = await listen(server), url = `https://127.0.0.1:${port}/`;
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  assert.equal(await probeHTTPS(url, { ca }), allowed[0]);
  await assert.rejects(probeHTTPS(url));
  for (mode of ['bad', 'big', 'redirect', '429', 'timeout', 'family']) await assert.rejects(probeHTTPS(url, { ca, timeout: 50 }));
  mode = 'ok'; assert.equal(await probeHTTPS(url, { ca }), allowed[0]);
  // CONNECT 中的 TLS 由客户端与目标端验证，网关没有证书或解密逻辑。
  const guard = guardFor(t, { probe: signal => probeHTTPS(url, { ca, signal }) });
  guard.enable(); assert.equal(await guard.verify(), true);
  guard.revoke('模拟出口变化'); assert.equal(guard.usable(), false);
  assert.equal(await guard.verify(), true);
  const proxyPort = await gatewayFor(t, guard, port);
  const { socket, response } = await tunnel(proxyPort, `127.0.0.1:${port}`);
  assert.match(response, /200/);
  const secure = tls.connect({ socket, ca, servername: 'localhost' });
  secure.on('error', () => {}); await once(secure, 'secureConnect');
  secure.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  let body = ''; for await (const data of secure) body += data;
  assert.match(body, /203\.0\.113\.1/);
});

test('真实 TCP 长连接：阻断后停止传输，新客户端也被拒绝，检测可恢复', async t => {
  const origin = await streamFixture(t), guard = guardFor(t);
  const proxyPort = await gatewayFor(t, guard, origin.port), target = `127.0.0.1:${origin.port}`;
  let result = await tunnel(proxyPort, target); assert.match(result.response, /403/); result.socket.destroy();
  guard.enable(); result = await tunnel(proxyPort, target); assert.match(result.response, /403/); result.socket.destroy();
  guard.enable(); await guard.verify(); result = await tunnel(proxyPort, target);
  assert.match(result.response, /200/); result.socket.resume();
  await sleep(40); assert.ok(origin.sent() > 0);
  const closed = once(result.socket, 'close'); guard.revoke('网络变化'); await closed;
  await sleep(20); const before = origin.sent(); await sleep(30); assert.equal(origin.sent(), before);
  result = await tunnel(proxyPort, target); assert.match(result.response, /403/); result.socket.destroy();
  assert.equal(await guard.verify(), true);
  result = await tunnel(proxyPort, target); assert.match(result.response, /200/); result.socket.destroy();
  guard.disable();
  result = await tunnel(proxyPort, target); assert.match(result.response, /403/); result.socket.destroy();
  const ordinary = await connect(origin.port); ordinary.resume(); ordinary.destroy();
});

test('真实计时器到期自动切断已有连接；IPv6 目标不能沿用 IPv4 验证', async t => {
  const origin = await streamFixture(t), guard = guardFor(t, { ttl: 100 });
  const gateway = createGateway(guard, new Map([
    [`127.0.0.1:${origin.port}`, { host: '127.0.0.1', port: origin.port }],
    ['[::1]:9', { host: '::1', port: 9 }]
  ]));
  const port = await listen(gateway.server); t.after(() => gateway.close());
  guard.enable(); await guard.verify();
  const denied = await tunnel(port, '[::1]:9'); assert.match(denied.response, /403/); denied.socket.destroy();
  const result = await tunnel(port, `127.0.0.1:${origin.port}`); result.socket.resume();
  await once(result.socket, 'close'); assert.equal(guard.usable(), false);
});

test('独立网关进程被强退后已有连接关闭，新连接不能回退直连', async t => {
  const origin = await streamFixture(t);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { Guard } from ${JSON.stringify(new URL('./guard.mjs', import.meta.url).href)};
    import { createGateway } from ${JSON.stringify(new URL('./gateway.mjs', import.meta.url).href)};
    const guard = new Guard({ allowed: ['203.0.113.1'], probe: async () => '203.0.113.1', ttl: 10000 });
    guard.enable(); await guard.verify();
    const gateway = createGateway(guard, new Map([['fixture', { host: '127.0.0.1', port: ${origin.port} }]]));
    gateway.server.listen(0, '127.0.0.1', () => console.log(gateway.server.address().port));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const [data] = await once(child.stdout, 'data'), port = Number(data.toString().trim());
  const result = await tunnel(port, 'fixture'); assert.match(result.response, /200/); result.socket.resume();
  const closed = once(result.socket, 'close'), exited = once(child, 'exit');
  child.kill('SIGKILL'); await exited; await closed;
  await assert.rejects(connect(port), error => error.code === 'ECONNREFUSED');
  const ordinary = await connect(origin.port); ordinary.resume(); ordinary.destroy();
});

test('macOS 真实沙箱：只允许代理端口，直连/其他端口/IPv6/子进程绕过拒绝', async t => {
  assert.equal(process.platform, 'darwin', '这项验收必须在 Mac 执行');
  const origin = await streamFixture(t), guard = guardFor(t); guard.enable(); await guard.verify();
  const port = await gatewayFor(t, guard, origin.port);
  const v6 = net.createServer(socket => socket.end()); const v6port = await listen(v6, '::1');
  t.after(() => new Promise(r => v6.close(r)));
  const profile = `(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:${port}"))`;
  const probe = `
    const net = require('node:net');
    async function attempt(host, port) {
      return new Promise(resolve => {
        const socket = net.connect({host, port});
        socket.setTimeout(300, () => { socket.destroy(); resolve('TIMEOUT'); });
        socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); });
        socket.on('error', error => resolve(error.code));
      });
    }
    (async () => console.log(JSON.stringify(await Promise.all([
      attempt('127.0.0.1', ${port}), attempt('127.0.0.1', ${origin.port}),
      attempt('::1', ${v6port}), attempt('192.0.2.1', 443), attempt('2001:db8::1', 443)
    ]))))();
  `;
  const expected = ['CONNECTED', 'EPERM', 'EPERM', 'EPERM', 'EPERM'];
  const direct = await run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', probe], { timeout: 5000 });
  assert.deepEqual(JSON.parse(direct.stdout), expected);
  const descendant = await run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e',
    `require('node:child_process').execFile(process.execPath, ['-e', ${JSON.stringify(probe)}], (error, stdout) => { if(error) process.exit(1); process.stdout.write(stdout); });`
  ], { timeout: 5000 });
  assert.deepEqual(JSON.parse(descendant.stdout), expected);
  const udp = await run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', `
    const dgram = require('node:dgram');
    async function attempt(type, host) {
      return new Promise(resolve => {
        const socket = dgram.createSocket(type);
        socket.on('error', error => { socket.close(); resolve(error.code); });
        socket.send('test', ${origin.port}, host, error => { socket.close(); resolve(error?.code || 'SENT'); });
      });
    }
    (async () => console.log(JSON.stringify(await Promise.all([attempt('udp4', '127.0.0.1'), attempt('udp6', '::1')]))))();
  `], { timeout: 5000 });
  assert.deepEqual(JSON.parse(udp.stdout), ['EPERM', 'EPERM']);
  // 前面的子进程检查可能超过短测试租约；流式撤销用刚验证的租约单独断言。
  assert.equal(await guard.verify(), true);
  const client = spawn('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', `
    const socket = require('node:net').connect({host:'127.0.0.1', port:${port}});
    let started = false;
    socket.on('connect', () => socket.write('CONNECT 127.0.0.1:${origin.port} HTTP/1.1\\r\\nHost: fixture\\r\\n\\r\\n'));
    socket.on('data', data => { if(!started && data.includes('tick')) { started = true; console.log('STREAMING'); } });
    socket.on('error', error => { console.error(error.code); process.exitCode = 1; });
    socket.on('close', () => console.log('CLOSED'));
    setTimeout(() => { socket.destroy(); process.exit(2); }, 4000).unref();
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (client.exitCode === null) client.kill('SIGKILL'); });
  const [streaming] = await once(client.stdout, 'data'); assert.match(streaming.toString(), /STREAMING/);
  const closedOutput = once(client.stdout, 'data'), clientExit = once(client, 'exit');
  guard.revoke('沙箱客户端传输中阻断');
  assert.match((await closedOutput)[0].toString(), /CLOSED/);
  assert.equal((await clientExit)[0], 0);
  const ordinary = await connect(origin.port); ordinary.resume(); ordinary.destroy();
});

test('IPv6 验证仅允许 IPv6 目标，真实 IPv6 隧道可切断', async t => {
  const origin = net.createServer(socket => { socket.on('error', () => {}); socket.write('ipv6'); });
  const port = await listen(origin, '::1'); t.after(() => new Promise(r => origin.close(r)));
  const guard = guardFor(t, { allowed: ['2001:db8::1'], probe: async () => '2001:0db8::1' });
  const gateway = createGateway(guard, new Map([[`[::1]:${port}`, { host: '::1', port }]]));
  const proxyPort = await listen(gateway.server); t.after(() => gateway.close());
  guard.enable(); assert.equal(await guard.verify(), true);
  const result = await tunnel(proxyPort, `[::1]:${port}`); result.socket.resume();
  assert.match(result.response, /200/);
  const closed = once(result.socket, 'close'); guard.revoke(); await closed;
});
