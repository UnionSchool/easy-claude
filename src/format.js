import { L } from './language.js';
function duration(minutes, fallback) {
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return L(`${minutes / 1440} 天`, `${minutes / 1440} days`);
  if (minutes % 60 === 0) return L(`${minutes / 60} 小时`, `${minutes / 60} hours`);
  return L(`${minutes} 分钟`, `${minutes} minutes`);
}

function windowText(window, label) {
  if (!window || typeof window !== 'object') return L(`  ${label}：未知（未提供数据）`, `  ${label}: unknown (no data)`);
  const remaining = Number.isFinite(window.usedPercent)
    ? `${Number(Math.max(0, Math.min(100, 100 - window.usedPercent)).toFixed(1))}%`
    : L('未知', 'Unknown');
  const date = Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000) : null;
  const reset = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : L('未知', 'Unknown');
  return L(`  ${duration(window.windowDurationMins, label)}：剩余 ${remaining}；重置 ${reset}`, `  ${duration(window.windowDurationMins, label)}: ${remaining} left; resets ${reset}`);
}

export function formatUsage(result) {
  if (!result || typeof result !== 'object') throw new Error(L('额度响应格式无效。', 'Invalid usage response.'));
  const buckets = result.rateLimitsByLimitId;
  const entries = buckets && typeof buckets === 'object' && !Array.isArray(buckets)
    ? Object.entries(buckets).filter(([, value]) => value && typeof value === 'object') : [];
  if (!entries.length && result.rateLimits && typeof result.rateLimits === 'object') {
    entries.push([result.rateLimits.limitId ?? 'claude', result.rateLimits]);
  }
  if (!entries.length) throw new Error(L('服务端未提供额度数据，无法判断剩余额度。', 'The server returned no usage limits. Remaining usage is unknown.'));
  const output = [L('Claude Code 剩余额度（账号共享，非当前会话）', 'Claude Code remaining usage (shared account, not this session)')];
  for (const [id, bucket] of entries) {
    // 限制服务端标签中的控制字符，避免终端转义序列影响显示。
    const label = String(bucket.limitName || bucket.limitId || id).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    output.push(label, windowText(bucket.primary, L('主窗口', 'Primary')));
    if (bucket.secondary) output.push(windowText(bucket.secondary, L('次窗口', 'Secondary')));
  }
  if (result.ordinaryUsageAllowed === false) output.push(L('服务端提示：当前普通额度使用受限。', 'Server reports restricted usage.'));
  output.push(L(`重置时间使用本机时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`, `Reset times use the local time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`));
  return output.join('\n');
}
