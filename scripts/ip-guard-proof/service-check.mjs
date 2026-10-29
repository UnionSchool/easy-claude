import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startService } from '../../src/ip-guard/service.js';
import { readGuardStatus } from '../../src/ip-guard/launcher.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(10); }
  assert.fail('未在时限内收到预期状态');
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'easy-guard-service-'));
  const input = new PassThrough(), output = new PassThrough(); let data = '';
  output.on('data', chunk => { data += chunk; });
  const path = join(directory, 'control.sock');
  const service = await startService({ input, output, path, proxyPort: 0, probe: async () => '203.0.113.1', ...options });
  t.after(async () => { await service.stop(); input.destroy(); output.destroy(); await rm(directory, { recursive: true, force: true }); });
  return { ...service, input, path, messages: () => data.trim().split('\n').map(line => JSON.parse(line)),
    send: command => input.write(JSON.stringify(command) + '\n') };
}
const config = { action: 'configure', enabled: true, ips: ['203.0.113.1'], interval: 30 };

test('真实控制服务：开启验证、只读发现、IPv4白名单和关闭状态', async t => {
  const service = await fixture(t);
  assert.equal(service.status().ready, false);
  await assert.rejects(readGuardStatus({ path: service.path }));
  service.send(config); await until(() => service.status().ready);
  assert.equal((await readGuardStatus({ path: service.path })).port, service.port);
  assert.equal((await stat(service.path)).mode & 0o777, 0o600);
  service.send({ ...config, ips: ['2001:db8::1'] }); await until(() => service.status().state === 'fault');
  assert.equal(service.status().ready, false);
  service.send({ action: 'configure', enabled: false }); await until(() => service.status().state === 'off');
  await assert.rejects(readGuardStatus({ path: service.path }));
});

test('编辑白名单期间保持阻断，旧探测返回不能重新放通', async t => {
  let resolve;
  const service = await fixture(t, { probe: () => new Promise(r => { resolve = r; }) });
  service.send(config); await until(() => service.guard.controller);
  service.send({ action: 'hold' }); await until(() => service.status().state === 'blocked');
  resolve('203.0.113.1'); await sleep(550);
  assert.equal(service.status().ready, false);
});

test('失去心跳或控制输入关闭，服务关停并撤销放行', async t => {
  const service = await fixture(t, { heartbeatTimeout: 100 });
  service.send(config); await until(() => service.status().ready);
  await sleep(650); assert.equal(service.guard.usable(), false);
  await assert.rejects(readGuardStatus({ path: service.path }));
  const second = await fixture(t); second.send(config); await until(() => second.status().ready);
  second.input.end(); await until(() => !second.guard.usable());
});

test('桌面启动因嵌套沙箱不兼容明确拒绝，验证通过也不执行或无保护回退', async t => {
  const launches = [];
  const service = await fixture(t, { startDesktop: (port, path) => {
    launches.push({ port, path }); return new PassThrough();
  } });
  service.send(config); await until(() => service.status().ready);
  assert.equal(launches.length, 0);
  service.send({ action: 'launchDesktop', appPath: '/fixture/Claude.app' });
  await until(() => service.status().state === 'fault');
  assert.match(service.status().reason, /嵌套沙箱冲突/);
  assert.equal(service.guard.usable(), false); assert.equal(launches.length, 0);
  service.send({ action: 'configure', enabled: false }); await until(() => service.status().state === 'off');
  service.send({ action: 'launchDesktop', appPath: '/fixture/Claude.app' });
  await until(() => service.status().state === 'fault'); assert.equal(launches.length, 0);
});
