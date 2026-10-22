import { L } from './language.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const endpoint = 'https://api.anthropic.com/api/oauth/usage';

export function systemProxy(text) {
  const value = key => text.match(new RegExp(`^\\s*${key} : (.+)$`, 'm'))?.[1].trim();
  if (value('HTTPSEnable') !== '1') return null;
  const host = value('HTTPSProxy');
  const port = Number(value('HTTPSPort'));
  if (!host || !/^[a-zA-Z0-9.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(L('系统 HTTPS 代理配置无效。', 'Invalid system HTTPS proxy configuration.'));
  }
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function curlConfig(url, headers, proxy) {
  if (url !== endpoint) throw new Error(L('仅允许官方额度地址。', 'Only the official usage endpoint is allowed.'));
  const quote = value => {
    if (/[\r\n\0]/.test(value)) throw new Error(L('请求配置包含无效字符。', 'Request configuration contains invalid characters.'));
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  };
  return [`url = ${quote(url)}`, `proxy = ${quote(proxy)}`,
    ...Object.entries(headers).map(([key, value]) => `header = ${quote(`${key}: ${value}`)}`)].join('\n');
}

// macOS 上 Node fetch 不读取系统代理。复用系统 curl 的 CONNECT/TLS 校验，令牌只从 stdin 传入。
export async function quotaFetch(url, options) {
  if (process.platform !== 'darwin') return fetch(url, options);
  const { stdout } = await run('/usr/sbin/scutil', ['--proxy'], { timeout: 2000, signal: options.signal });
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY || systemProxy(stdout);
  if (!proxy) return fetch(url, options);
  const config = curlConfig(url, options.headers, proxy);
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['-q', '--config', '-', '--silent', '--show-error', '--proto', '=https',
      '--max-time', '15', '--max-redirs', '0', '--write-out', '\n%{http_code}'],
    { signal: options.signal, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 1024 * 1024) { child.kill(); reject(new Error(L('额度响应过大。', 'Usage response too large.'))); }
      else chunks.push(data);
    });
    child.on('error', () => reject(new Error(L('额度代理请求失败。', 'Usage proxy request failed.'))));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) { reject(new Error(L('额度代理请求失败。', 'Usage proxy request failed.'))); return; }
      const output = Buffer.concat(chunks).toString('utf8');
      const split = output.lastIndexOf('\n');
      const status = Number(output.slice(split + 1));
      if (status < 200 || status >= 300) {
        if (status >= 400 && status <= 599) resolve(new Response(null, { status }));
        else reject(new Error(L('额度请求收到无效响应或重定向。', 'Invalid usage response or redirect.')));
        return;
      }
      resolve(new Response(output.slice(0, split), { status }));
    });
    child.stdin.end(config);
  });
}
