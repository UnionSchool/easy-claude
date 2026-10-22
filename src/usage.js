import { L } from './language.js';
import { quotaFetch } from './transport.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { formatUsage } from './format.js';
const run = promisify(execFile);
const loginMessage = L('请执行 claude auth login 登录与 Claude 桌面相同的订阅账号。', 'Run claude auth login with the same subscription account as Claude Desktop.');

export function credentialToken(raw, now = Date.now()) {
  let auth;
  try { auth = JSON.parse(raw)?.claudeAiOauth; } catch { throw new Error(L(`Claude Code 登录数据格式不受支持。${loginMessage}`, `Unsupported Claude Code login data. ${loginMessage}`)); }
  if (!auth || typeof auth.accessToken !== 'string' || !auth.accessToken.trim()) throw Object.assign(new Error(loginMessage), { code: 'auth_required' });
  if (Number.isFinite(auth.expiresAt) && auth.expiresAt <= now) throw Object.assign(new Error(L(`Claude Code 登录已过期。${loginMessage}`, `Claude Code login expired. ${loginMessage}`)), { code: 'auth_expired' });
  return auth.accessToken;
}

export async function loadToken({ signal } = {}) {
  let raw;
  // 自定义配置目录不猜测钥匙串名称，以免读到另一个账号。
  if (process.platform === 'darwin' && !process.env.CLAUDE_CONFIG_DIR) {
    try { raw = (await run('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1024 * 1024, signal })).stdout; }
    catch { if (signal?.aborted) throw new Error(L('查询已取消。', 'Query cancelled.')); }
  }
  if (!raw) {
    try { raw = await readFile(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json'), { encoding: 'utf8', signal }); }
    catch { throw Object.assign(new Error(signal?.aborted ? L('查询已取消。', 'Query cancelled.') : L(`未找到可读取的 Claude Code 订阅登录。${loginMessage}`, `No readable Claude Code subscription login found. ${loginMessage}`)), { code: signal?.aborted ? undefined : 'auth_required' }); }
  }
  return credentialToken(raw);
}

export function normalizeUsage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(L('额度响应格式无效。', 'Invalid usage response.'));
  const rateLimitsByLimitId = {};
  for (const [key, value] of Object.entries(data)) {
    if (!/^(five_hour|seven_day)(_[a-z0-9_]+)?$/.test(key) || value == null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(L('额度窗口格式无效。', 'Invalid usage window.'));
    // 明细汇总也使用 seven_day 前缀，只有比例字段才代表额度窗口。
    if (!Object.hasOwn(value, 'utilization')) continue;
    const used = value.utilization;
    if (used != null && (!Number.isFinite(used) || used < 0 || used > 100)) throw new Error(L('额度比例格式无效。', 'Invalid usage percentage.'));
    const reset = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) / 1000 : null;
    const primary = { usedPercent: used ?? null, resetsAt: Number.isFinite(reset) ? reset : null, windowDurationMins: key.startsWith('five_hour') ? 300 : 10080 };
    const label = key === 'five_hour' ? L('Claude · 5 小时', 'Claude · 5 hours') : key === 'seven_day' ? L('Claude · 7 天', 'Claude · 7 days') : key.replaceAll('_', ' ');
    rateLimitsByLimitId[key] = { limitId: key, limitName: label, primary };
  }
  if (!Object.keys(rateLimitsByLimitId).length) throw new Error(L('服务端未提供订阅额度，不能判断剩余额度；API Key 余额不在范围内。', 'No subscription usage returned. Remaining usage is unknown; API key balances are not supported.'));
  return { rateLimitsByLimitId };
}

export async function readUsage({ signal, timeoutMs = 15000, getToken = loadToken, fetchImpl = quotaFetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error(L('查询已取消。', 'Query cancelled.'));
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const token = await getToken({ signal: controller.signal });
    // 固定官方源且禁止重定向，避免登录凭据发送到其他站点。
    const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      redirect: 'error', signal: controller.signal,
    }).catch(() => { throw new Error(L('无法连接 Claude 额度服务，请检查网络。', 'Cannot connect to Claude usage service. Check the network.')); });
    if (response.status === 401) throw Object.assign(new Error(L(`订阅登录已失效（HTTP 401）。${loginMessage}`, `Subscription login expired (HTTP 401). ${loginMessage}`)), { code: 'auth_expired' });
    if (response.status === 403) throw new Error(L('Claude 官方额度服务拒绝访问（HTTP 403）。可能是账号权限、网络访问限制或接口兼容变化；请先检查 Claude Code 的 /usage，不能仅据此判断登录已过期。', 'Claude usage service denied access (HTTP 403). Check account permissions, network access and Claude Code /usage; this does not necessarily mean an expired login.'));
    if (response.status === 429) throw Object.assign(new Error(L('额度查询过于频繁，请稍后再试。', 'Too many usage requests. Try again later.')), { code: 'rate_limited' });
    if (!response.ok) throw new Error(L(`Claude 额度服务暂不可用（HTTP ${response.status}）。`, `Claude usage service unavailable (HTTP ${response.status}).`));
    let data;
    try { data = await response.json(); } catch { throw new Error(L('Claude 返回了无效的额度数据。', 'Claude returned invalid usage data.')); }
    return normalizeUsage(data);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? L('查询已取消。', 'Query cancelled.') : L('额度查询超时，请检查网络。', 'Usage query timed out. Check the network.'));
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
