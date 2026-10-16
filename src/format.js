function duration(minutes, fallback) {
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function windowText(window, label) {
  if (!window || typeof window !== 'object') return `  ${label}：未知（未提供数据）`;
  const remaining = Number.isFinite(window.usedPercent)
    ? `${Number(Math.max(0, Math.min(100, 100 - window.usedPercent)).toFixed(1))}%`
    : '未知';
  const date = Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000) : null;
  const reset = date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未知';
  return `  ${duration(window.windowDurationMins, label)}：剩余 ${remaining}；重置 ${reset}`;
}

export function formatUsage(result) {
  if (!result || typeof result !== 'object') throw new Error('额度响应格式无效。');
  const buckets = result.rateLimitsByLimitId;
  const entries = buckets && typeof buckets === 'object' && !Array.isArray(buckets)
    ? Object.entries(buckets).filter(([, value]) => value && typeof value === 'object') : [];
  if (!entries.length && result.rateLimits && typeof result.rateLimits === 'object') {
    entries.push([result.rateLimits.limitId ?? 'claude', result.rateLimits]);
  }
  if (!entries.length) throw new Error('服务端未提供额度数据，无法判断剩余额度。');
  const output = ['Claude Code 剩余额度（账号共享，非当前会话）'];
  for (const [id, bucket] of entries) {
    // 限制服务端标签中的控制字符，避免终端转义序列影响显示。
    const label = String(bucket.limitName || bucket.limitId || id).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    output.push(label, windowText(bucket.primary, '主窗口'));
    if (bucket.secondary) output.push(windowText(bucket.secondary, '次窗口')); 
  }
  if (result.ordinaryUsageAllowed === false) output.push('服务端提示：当前普通额度使用受限。');
  output.push(`重置时间使用本机时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  return output.join('\n');
}
