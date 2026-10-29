import net from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { L } from '../language.js';

export const DEFAULT_PROXY_PORT = 18197;
export const DEFAULT_PROXY_URL = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

export function controlPath(env = process.env) {
  return join(env.EASY_CLAUDE_GUARD_DIR || join(tmpdir(), `easy-claude-guard-${process.getuid()}`), 'control.sock');
}

export function proxyEnvironment(port, env = process.env) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port');
  const proxy = `http://127.0.0.1:${port}`;
  return { ...env, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
    ALL_PROXY: proxy, all_proxy: proxy, NO_PROXY: 'localhost,127.0.0.1,::1,.local', no_proxy: 'localhost,127.0.0.1,::1,.local' };
}

export function readGuardStatus({ path = controlPath(), timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(path); let data = '';
    const timer = setTimeout(() => socket.destroy(new Error('Protection service timeout')), timeout);
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 8192) { socket.destroy(new Error('Invalid protection status')); return; }
      if (!data.includes('\n')) return;
      try {
        const status = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (status.service !== 'easy-claude-ip-guard' || !status.enabled || !status.ready) throw new Error('Protection service unavailable');
        proxyEnvironment(status.port);
        socket.destroy(); resolve(status);
      } catch (error) { socket.destroy(); reject(error); }
    });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); if (!data.includes('\n')) reject(new Error('Protection service disconnected')); });
  });
}

export async function runProtectedCode(args, { readStatus = readGuardStatus, start = spawn, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error(L('受保护启动仅支持 macOS。', 'Protected launch requires macOS.'));
  let status;
  try { status = await readStatus(); }
  catch { throw new Error(L('请先在 easy-claude 面板开启保护并等待 IP 验证通过。', 'Enable protection in easy-claude and wait for IP verification.')); }
  return new Promise((resolve, reject) => {
    const child = start('claude', args, { env: proxyEnvironment(status.port, env), stdio: 'inherit' });
    child.on('error', () => reject(new Error(L('受保护启动失败，没有回退直连。', 'Protected launch failed; direct access was not used.'))));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
