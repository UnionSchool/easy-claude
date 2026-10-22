import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function resolveLanguage(choice, preferred = 'en') {
  return ['zh', 'en'].includes(choice) ? choice : /^zh(?:[-_]|$)/i.test(preferred) ? 'zh' : 'en';
}
let preference;
function storedLanguage() {
  if (preference !== undefined) return preference;
  let selected = 'system', preferred = Intl.DateTimeFormat().resolvedOptions().locale;
  if (process.platform === 'darwin') {
    const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    try { selected = execFileSync('/usr/bin/defaults', ['read', `com.unionschool.${name}.overlay`, 'interfaceLanguage'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim(); } catch { /* 未设置时跟随系统。 */ }
    try { preferred = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).match(/[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*/i)?.[0] ?? preferred; } catch { /* 其他系统保留Intl地区。 */ }
  }
  preference = resolveLanguage(selected, preferred);
  return preference;
}
export function language() {
  return ['zh', 'en'].includes(process.env.EASY_LANGUAGE) ? process.env.EASY_LANGUAGE : storedLanguage();
}
export function L(chinese, english) { return language() === 'zh' ? chinese : english; }
