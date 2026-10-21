import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { systemProxy } from './transport.js';

export async function readPublicIP({ run = promisify(execFile), env = process.env, platform = process.platform } = {}) {
  let proxy = env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY;
  if (!proxy && platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/scutil', ['--proxy'], { timeout: 2000, maxBuffer: 65536 });
    proxy = systemProxy(stdout);
  }
  const request = async url => {
    const { stdout } = await run('/usr/bin/curl', ['-q', '--silent', '--show-error', '--fail', '--proto', '=https',
      '--connect-timeout', '5', '--max-time', '12', '--max-redirs', '0', url], {
      timeout: 15000, maxBuffer: 8192, env: proxy ? { ...env, https_proxy: proxy } : env
    });
    return stdout;
  };
  let data;
  try { data = JSON.parse(await request('https://ipinfo.io/json')); }
  catch { throw new Error('IP异常'); }
  if (!data || typeof data.ip !== 'string' || !isIP(data.ip)) throw new Error('IP异常');
  const ip = data.ip;
  let city = null, timezone = null;
  if (typeof data.city === 'string') {
    city = data.city.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 60) || null;
  }
  if (typeof data.timezone === 'string' && data.timezone.length <= 100) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: data.timezone });
      timezone = data.timezone;
    } catch { /* 无效时区保持未知，不改用电脑时区。 */ }
  }
  return { ip, city, timezone };
}
