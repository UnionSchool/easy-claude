import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { proxyStatus, changeProxy, desktopScript } from '../src/proxy-config.js';
import { DEFAULT_PROXY_URL, proxyEnvironment, DEFAULT_PROXY_PORT } from '../src/ip-guard/launcher.js';
const run = promisify(execFile), mac = { skip: process.platform !== 'darwin' };
async function fixture(t, initial = { theme: 'dark', env: { HTTPS_PROXY: 'http://old.invalid:8080', KEEP: 'untouched' } }) {
  const folder = await fs.mkdtemp(join(tmpdir(), "easy proxy 'config-"));
  const paths = { cli: join(folder, 'cli/settings.json'), desktop: join(folder, 'managed/user/com.anthropic.claudefordesktop.plist'), machine: join(folder, 'machine.plist'), state: join(folder, 'private/proxy-state.json') };
  await fs.mkdir(join(folder, 'cli'), { mode: 0o700 }); await fs.mkdir(join(folder, 'managed/user'), { recursive: true, mode: 0o700 });
  if (initial !== null) await fs.writeFile(paths.cli, JSON.stringify(initial), { mode: 0o600 });
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  // 同一系统脚本仅把root所有者断言换成临时目录的测试UID，不执行管理员授权。
  const admin = async ({ script }) => {
    try { await run('/bin/sh', ['-c', script.replaceAll('" = 0 ]', `" = ${process.getuid()} ]`)]); }
    catch (error) { throw new Error('Desktop script: ' + error.stdout + ' / ' + error.stderr.slice(-700)); }
  };
  return { paths, admin, initial };
}
async function writePlist(path, value) { await fs.writeFile(path, JSON.stringify(value)); await run('/usr/bin/plutil', ['-convert', 'xml1', path]); }
async function plistJSON(path) { return JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path])).stdout); }

test('启动备份并设置两端，停止按字段恢复，保留后来新增的其他字段', mac, async t => {
  const f = await fixture(t);
  await writePlist(f.paths.desktop, { egressProxyUrl: 'http://original.invalid:9000', other: 'keep' });
  const started = await changeProxy('start', f);
  assert.equal(started.configured, true); assert.equal(started.hasBackup, true);
  const current = JSON.parse(await fs.readFile(f.paths.cli)); current.newField = 'added later';
  await fs.writeFile(f.paths.cli, JSON.stringify(current));
  await run('/usr/bin/plutil', ['-insert', 'newDesktopField', '-string', 'added later', f.paths.desktop]);
  const stopped = await changeProxy('stop', f);
  assert.equal(stopped.active, false);
  const restored = JSON.parse(await fs.readFile(f.paths.cli));
  assert.deepEqual(restored, { ...f.initial, newField: 'added later' });
  assert.deepEqual(await plistJSON(f.paths.desktop), { egressProxyUrl: 'http://original.invalid:9000', other: 'keep', newDesktopField: 'added later' });
  await assert.rejects(fs.access(f.paths.state), { code: 'ENOENT' });
});

test('原来没有设置时停止删除本工具字段，不留下CLI空文件', mac, async t => {
  const f = await fixture(t, null);
  assert.equal((await changeProxy('start', f)).configured, true);
  assert.equal((await changeProxy('stop', f)).active, false);
  await assert.rejects(fs.access(f.paths.cli), { code: 'ENOENT' });
  assert.deepEqual(await plistJSON(f.paths.desktop), {});
});

test('取消管理员授权不改CLI，机器策略冲突不覆盖，坏JSON不丢失', mac, async t => {
  const f = await fixture(t), before = await fs.readFile(f.paths.cli);
  await assert.rejects(changeProxy('start', { ...f, admin: async () => { throw new Error('取消授权'); } }), /取消/);
  assert.deepEqual(await fs.readFile(f.paths.cli), before);
  await writePlist(f.paths.machine, { egressProxyUrl: 'http://managed.invalid' });
  await assert.rejects(changeProxy('start', f), /机器级/);
  assert.deepEqual(await fs.readFile(f.paths.cli), before);
  await fs.unlink(f.paths.machine); await fs.writeFile(f.paths.cli, '{bad json');
  await assert.rejects(changeProxy('start', f), /JSON无效/);
  assert.equal(await fs.readFile(f.paths.cli, 'utf8'), '{bad json');
});

test('已有手动代理不能假称恢复原状态，确认后只移除本工具字段', mac, async t => {
  const f = await fixture(t, { other: 1, env: { ...proxyEnvironment(DEFAULT_PROXY_PORT, {}), KEEP: 'preserved' } });
  await writePlist(f.paths.desktop, { egressProxyUrl: DEFAULT_PROXY_URL, other: 'preserved' });
  const prompt = await changeProxy('stop', f);
  assert.equal(prompt.needsDefaultRestore, true); assert.equal(prompt.active, true);
  const stopped = await changeProxy('stop-default', f);
  assert.equal(stopped.active, false); assert.equal(stopped.restoredDefault, true);
  assert.deepEqual(JSON.parse(await fs.readFile(f.paths.cli)), { other: 1, env: { KEEP: 'preserved' } });
  assert.deepEqual(await plistJSON(f.paths.desktop), { other: 'preserved' });
});

test('停止不覆盖用户后来改过的代理；CLI并发修改不被覆盖', mac, async t => {
  const f = await fixture(t); await changeProxy('start', f);
  const current = JSON.parse(await fs.readFile(f.paths.cli)); current.env.HTTPS_PROXY = 'http://new.invalid';
  await fs.writeFile(f.paths.cli, JSON.stringify(current));
  await changeProxy('stop', f);
  assert.equal(JSON.parse(await fs.readFile(f.paths.cli)).env.HTTPS_PROXY, 'http://new.invalid');
  const other = await fixture(t, null);
  await assert.rejects(changeProxy('start', { ...other, admin: async args => {
    await other.admin(args); await fs.writeFile(other.paths.cli, '{"userNew":true}');
  } }), /已变化/);
  assert.equal(await fs.readFile(other.paths.cli, 'utf8'), '{"userNew":true}');
  assert.equal((await proxyStatus(other)).active, true);
});

test('管理员脚本只用系统工具，shell路径安全引用，备份私有且路径不能篡改', mac, async t => {
  const f = await fixture(t); await changeProxy('start', f);
  const saved = JSON.parse(await fs.readFile(f.paths.state));
  assert.equal((await fs.stat(f.paths.state)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(saved.cliBackup)).mode & 0o777, 0o600);
  const script = desktopScript('start', f.paths, saved);
  assert.match(script, /\/usr\/bin\/plutil/); assert.doesNotMatch(script, /node |python|curl/);
  await run('/bin/sh', ['-n', '-c', script]);
  saved.desktopHash = 'a'.repeat(64); saved.desktopBackup = '/etc/hosts'; await fs.writeFile(f.paths.state, JSON.stringify(saved));
  await assert.rejects(changeProxy('stop', f), /备份路径无效/);
});
