process.env.EASY_LANGUAGE = 'zh';
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemProxy, curlConfig } from '../src/transport.js';
test('读取系统 HTTPS 代理，拒绝无效配置', () => {
  assert.equal(systemProxy(' HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7897\n'), 'http://127.0.0.1:7897');
  assert.equal(systemProxy(' HTTPSEnable : 0\n'), null);
  assert.throws(() => systemProxy(' HTTPSEnable : 1\n HTTPSProxy : bad/path\n HTTPSPort : 7897\n'));
});
test('代理请求固定官方源，拒绝配置注入', () => {
  const url = 'https://api.anthropic.com/api/oauth/usage';
  assert.match(curlConfig(url, {authorization: 'Bearer test-only'}, 'http://127.0.0.1:7897'), /header = "authorization: Bearer test-only"/);
  assert.throws(() => curlConfig('https://example.com', {}, 'http://localhost:1'));
  assert.throws(() => curlConfig(url, {authorization: 'bad\nheader'}, 'http://localhost:1'));
});
