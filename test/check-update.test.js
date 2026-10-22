process.env.EASY_LANGUAGE = 'zh';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkUpdate } from '../src/update.js';

test('仅在线检查正式版本，不安装；相同或更旧版本无提示', async () => {
  for (const [latest, available] of [['1.2.4', true], ['1.2.3', false], ['1.1.9', false]]) {
    assert.deepEqual(await checkUpdate('easy-claude', { currentVersion: '1.2.3',
      getNpmCli: async () => 'npm', getLatest: async () => latest }), { latest, available });
  }
  await assert.rejects(checkUpdate('easy-claude', { currentVersion: '1.2.3',
    getNpmCli: async () => 'npm', getLatest: async () => { throw new Error('offline'); } }), /offline/);
});

test('三种版本参数输出一致', () => {
  const cli = new URL('../bin/easy-claude.js', import.meta.url);
  const results = ['-V', '-v', '--version'].map(flag => execFileSync(process.execPath, [cli.pathname, flag], { encoding: 'utf8' }));
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
  assert.match(results[0], /^\d+\.\d+\.\d+\n$/);
});
