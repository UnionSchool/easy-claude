import { L } from './language.js';
import { formatUsage } from './usage.js';

export function overlayData(result, now = Date.now()) {
  const detail = formatUsage(result);
  const map = result.rateLimitsByLimitId;
  const entries = map && typeof map === 'object' && !Array.isArray(map)
    ? Object.entries(map).filter(([, b]) => b && typeof b === 'object') : [];
  if (!entries.length) entries.push([result.rateLimits.limitId ?? 'claude', result.rateLimits]);
  const windows = [];
  for (const [id, bucket] of entries) {
    for (const key of ['primary', 'secondary']) {
      const w = bucket[key];
      if (!w) continue;
      const mins = w.windowDurationMins;
      const label = Number.isFinite(mins) && mins > 0
        ? mins % 1440 === 0 ? L(`${mins / 1440}天`, `${mins / 1440}d`) : mins % 60 === 0 ? L(`${mins / 60}小时`, `${mins / 60}h`) : L(`${mins}分钟`, `${mins}m`)
        : key === 'primary' ? L('主窗口', 'Primary') : L('次窗口', 'Secondary');
      windows.push({ id: `${id}:${key}`, label,
        name: `${String(bucket.limitName || id).replace(/[\x00-\x1f\x7f-\x9f]/g, '')} · ${label}`,
        remaining: Number.isFinite(w.usedPercent) ? Math.max(0, Math.min(100, 100 - w.usedPercent)) : null,
        resetsAt: Number.isFinite(w.resetsAt) && Math.abs(w.resetsAt) < 8.64e12 ? w.resetsAt : null });
    }
  }
  return { windows, detail, fetchedAt: now / 1000, restricted: result.ordinaryUsageAllowed === false };
}

export function overlayError(error) {
  return { error: error?.message || L('额度查询失败', 'Usage query failed'),
    errorCode: ['auth_required','auth_expired','rate_limited'].includes(error?.code) ? error.code : 'query_failed' };
}
