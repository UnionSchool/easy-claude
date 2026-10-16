import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { formatUsage } from './format.js';
const run = promisify(execFile);
const loginMessage = '请执行 claude auth login 登录与 Claude 桌面相同的订阅账号。';

export function credentialToken(raw, now = Date.now()) {
  let auth;
  try { auth = JSON.parse(raw)?.claudeAiOauth; } catch { throw new Error(`Claude Code 登录数据格式不受支持。${loginMessage}`); }
  if (!auth || typeof auth.accessToken !== 'string' || !auth.accessToken.trim()) throw new Error(loginMessage);
  if (Number.isFinite(auth.expiresAt) && auth.expiresAt <= now) throw new Error(`Claude Code 登录已过期。${loginMessage}`);
  return auth.accessToken;
}

export async function loadToken({ signal } = {}) {
  let raw;
  // 自定义配置目录不猜测钥匙串名称，以免读到另一个账号。
  if (process.platform === 'darwin' && !process.env.CLAUDE_CONFIG_DIR) {
    try { raw = (await run('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1024 * 1024, signal })).stdout; }
    catch { if (signal?.aborted) throw new Error('查询已取消。'); }
  }
  if (!raw) {
    try { raw = await readFile(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json'), { encoding: 'utf8', signal }); }
    catch { throw new Error(signal?.aborted ? '查询已取消。' : `未找到可读取的 Claude Code 订阅登录。${loginMessage}`); }
  }
  return credentialToken(raw);
}

export function normalizeUsage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('额度响应格式无效。');
  const rateLimitsByLimitId = {};
  for (const [key, value] of Object.entries(data)) {
    if (!/^(five_hour|seven_day)(_[a-z0-9_]+)?$/.test(key) || value == null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('额度窗口格式无效。');
    // 明细汇总也使用 seven_day 前缀，只有比例字段才代表额度窗口。
    if (!Object.hasOwn(value, 'utilization')) continue;
    const used = value.utilization;
    if (used != null && (!Number.isFinite(used) || used < 0 || used > 100)) throw new Error('额度比例格式无效。');
    const reset = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) / 1000 : null;
    const primary = { usedPercent: used ?? null, resetsAt: Number.isFinite(reset) ? reset : null, windowDurationMins: key.startsWith('five_hour') ? 300 : 10080 };
    const label = key === 'five_hour' ? 'Claude · 5 小时' : key === 'seven_day' ? 'Claude · 7 天' : key.replaceAll('_', ' ');
    rateLimitsByLimitId[key] = { limitId: key, limitName: label, primary };
  }
  if (!Object.keys(rateLimitsByLimitId).length) throw new Error('服务端未提供订阅额度，不能判断剩余额度；API Key 余额不在范围内。');
  return { rateLimitsByLimitId };
}

export async function readUsage({ signal, timeoutMs = 15000, getToken = loadToken, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error('查询已取消。');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const token = await getToken({ signal: controller.signal });
    // 固定官方源且禁止重定向，避免登录凭据发送到其他站点。
    const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      redirect: 'error', signal: controller.signal,
    }).catch(() => { throw new Error('无法连接 Claude 额度服务，请检查网络。'); });
    if (response.status === 401 || response.status === 403) throw new Error(`订阅登录无效或无额度权限。${loginMessage}`);
    if (response.status === 429) throw new Error('额度查询过于频繁，请稍后再试。');
    if (!response.ok) throw new Error(`Claude 额度服务暂不可用（HTTP ${response.status}）。`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Claude 返回了无效的额度数据。'); }
    return normalizeUsage(data);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? '查询已取消。' : '额度查询超时，请检查网络。');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
