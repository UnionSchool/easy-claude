import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePackage, installedPrefix, isNewer } from '../src/update.js';
import { launchOverlay } from '../src/overlay.js';

test('更新限定当前包及现有全局目录，路径含空格仍独立传参', async () => {
  assert.equal(installedPrefix('/some node/lib/node_modules/easy-codex'), '/some node');
  assert.equal(installedPrefix('/workspace/easy-codex'), null);
  const calls = [];
  await updatePackage('easy-codex', { root: '/some node/lib/node_modules/easy-codex',
    getNpmCli: async () => '/npm cli.js', getLatest: async () => '1.2.3', currentVersion: '1.0.0', run: async (...args) => calls.push(args) });
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], ['/npm cli.js', 'install', '--global', '--prefix', '/some node',
    '--prefer-online', '--registry=https://registry.npmjs.org', 'easy-codex@1.2.3']);
  await assert.rejects(updatePackage('other', {run: async () => assert.fail('不得执行')}), /包名/);
});
test('更新失败明确报错，不宣称成功', async () => {
  await assert.rejects(updatePackage('easy-claude', {getNpmCli: async () => '/npm', getLatest: async () => '1.2.3', currentVersion: '1.0.0',
    run: async () => { throw new Error('test update failed'); }}), /test update failed/);
});
test('show 先等待退出旧浮窗，再打开，退出失败不启动重复实例', async () => {
  const calls = [];
  await launchOverlay({platform: 'darwin', check: async () => {},
    run: async (...args) => { calls.push(args); }});
  assert.deepEqual(calls[0][1], ['--quit-running']);
  assert.equal(calls[0][2].timeout, 7000);
  assert.equal(calls[1][0], '/usr/bin/open');
  assert.equal(calls.length, 2);
  let failures = 0;
  await assert.rejects(launchOverlay({platform:'darwin',check:async()=>{},run:async()=>{
    failures++; throw new Error('stop failed');
  }}), /无法退出旧浮窗/);
  assert.equal(failures, 1);
});

test('在线版本检查拒绝降级和相同版本，检查失败不安装', async () => {
  assert.equal(isNewer('0.2.1','0.2.2'), false);
  assert.equal(isNewer('0.2.2','0.2.2'), false);
  assert.equal(isNewer('0.10.0','0.9.9'), true);
  assert.equal(isNewer('1.0.0','1.0.0-next.1'), true);
  assert.throws(() => isNewer('bad','0.2.2'));
  for (const latest of ['0.2.1','0.2.2']) await updatePackage('easy-codex', {
    currentVersion:'0.2.2', getNpmCli:async()=>'/npm',getLatest:async()=>latest,
    run:async()=>assert.fail('不应降级或重复安装')
  });
  await assert.rejects(updatePackage('easy-codex',{getNpmCli:async()=>'/npm',
    getLatest:async()=>{throw new Error('offline');},run:async()=>assert.fail('失败不安装')}),/offline/);
});
