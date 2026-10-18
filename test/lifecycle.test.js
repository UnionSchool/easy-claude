import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePackage, installedPrefix } from '../src/update.js';
import { launchOverlay } from '../src/overlay.js';

test('更新限定当前包及现有全局目录，路径含空格仍独立传参', async () => {
  assert.equal(installedPrefix('/some node/lib/node_modules/easy-codex'), '/some node');
  assert.equal(installedPrefix('/workspace/easy-codex'), null);
  const calls = [];
  await updatePackage('easy-codex', { root: '/some node/lib/node_modules/easy-codex',
    getNpmCli: async () => '/npm cli.js', run: async (...args) => calls.push(args) });
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], ['/npm cli.js', 'install', '--global', '--prefix', '/some node',
    '--registry=https://registry.npmjs.org', 'easy-codex@latest']);
  await assert.rejects(updatePackage('other', {run: async () => assert.fail('不得执行')}), /包名/);
});
test('更新失败明确报错，不宣称成功', async () => {
  await assert.rejects(updatePackage('easy-claude', {getNpmCli: async () => '/npm',
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
