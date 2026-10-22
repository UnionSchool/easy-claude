import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolveLanguage, L } from '../src/language.js';
test('language follows the first system language, supports overrides and falls back to English', () => {
  assert.equal(resolveLanguage(undefined, 'zh-Hant-TW'), 'zh');
  assert.equal(resolveLanguage('system', 'en-US'), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('zh', 'en-US'), 'zh');
  assert.equal(resolveLanguage('invalid', 'fr-FR'), 'en');
  const saved = process.env.EASY_LANGUAGE;
  try {
    process.env.EASY_LANGUAGE = 'en'; assert.equal(L('中文', 'English'), 'English');
    process.env.EASY_LANGUAGE = 'zh'; assert.equal(L('中文', 'English'), '中文');
  } finally { if (saved === undefined) delete process.env.EASY_LANGUAGE; else process.env.EASY_LANGUAGE = saved; }
});
test('CLI help supports both languages without starting queries', () => {
  for (const [language, expected] of [['en', 'Usage:'], ['zh', '用法：']]) {
    const output = execFileSync(process.execPath, [new URL('../bin/easy-claude.js', import.meta.url).pathname, '--help'], { encoding: 'utf8', env: { ...process.env, EASY_LANGUAGE: language } });
    assert.ok(output.includes(expected));
  }
});
