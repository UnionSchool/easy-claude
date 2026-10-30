// 检测代次和短期租约共同决定代理是否可以转发。
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import https from 'node:https';

export function normalizeIP(value) {
  if (typeof value !== 'string' || !isIP(value)) throw new Error('非法 IP');
  if (isIP(value) === 4) return value;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // 防止映射地址被当作已验证的独立 IPv6 出口。
  if (ip.startsWith('::ffff:')) throw new Error('暂不支持 IPv4 映射 IPv6');
  return ip;
}

export function parseIPResponse(raw) {
  if (Buffer.byteLength(raw) > 8192) throw new Error('响应过大');
  return normalizeIP(JSON.parse(raw)?.ip);
}

export function probeHTTPS(url, { signal, family = 4, ca, timeout = 1000 } = {}) {
  if (new URL(url).protocol !== 'https:') throw new Error('只允许 HTTPS');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { signal, family, ca, agent: false, rejectUnauthorized: true }, res => {
      if (res.statusCode !== 200) {
        const error = Object.assign(new Error(`HTTP ${res.statusCode}`), { rateLimited: res.statusCode === 429 });
        res.destroy(); reject(error); return;
      }
      const chunks = []; let size = 0;
      res.on('data', data => {
        size += data.length;
        if (size > 8192) req.destroy(new Error('响应过大'));
        else chunks.push(data);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const ip = parseIPResponse(Buffer.concat(chunks).toString('utf8'));
          if (isIP(ip) !== family) throw new Error('检测地址族不一致');
          resolve(ip);
        }
        catch (error) { reject(error); }
      });
    });
    // 总时限包含连接与响应，不能只依赖空闲 socket 超时。
    const timer = setTimeout(() => req.destroy(new Error('检测超时')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

export const EXIT_IP_URLS = ['https://ipinfo.io/json', 'https://api.ipify.org?format=json'];

export function createExitIPProbe({ request = probeHTTPS, now = () => performance.now() } = {}) {
  const retryAt = new Map();
  return async signal => {
    for (const url of EXIT_IP_URLS) {
      if (signal.aborted) throw new Error('检测已取消');
      if (now() < (retryAt.get(url) ?? 0)) continue;
      try {
        const ip = await request(url, { signal, family: 4, timeout: 5000 });
        if (signal.aborted) throw new Error('检测已取消');
        return normalizeIP(ip);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.rateLimited) retryAt.set(url, now() + 600000);
      }
    }
    const rateLimited = EXIT_IP_URLS.every(url => now() < (retryAt.get(url) ?? 0));
    throw Object.assign(new Error(rateLimited ? '出口 IP 查询服务均不可用（限流，10分钟后重试）' : '出口 IP 查询服务均不可用'), { rateLimited });
  };
}

export class Guard extends EventEmitter {
  constructor({ allowed, probe, ttl = 1000, timeout = 500, cooldown = 1000, now = () => performance.now() }) {
    super();
    for (const value of [ttl, timeout, cooldown]) if (!Number.isFinite(value) || value <= 0) throw new Error('无效时间配置');
    this.allowed = new Set(allowed.map(normalizeIP));
    this.probe = probe; this.ttl = ttl; this.timeout = timeout;
    this.cooldown = cooldown; this.now = now;
    this.enabled = false; this.state = 'off'; this.generation = 0;
    this.expires = 0; this.retryAt = 0; this.family = null;
  }
  revoke(reason = '等待验证') {
    this.generation++;
    this.controller?.abort(); this.controller = null;
    clearTimeout(this.leaseTimer);
    this.expires = 0; this.family = null;
    this.state = this.enabled ? 'blocked' : 'off'; this.reason = reason;
    this.emit('blocked');
  }
  enable() { this.enabled = true; this.revoke(); }
  disable() { this.enabled = false; this.revoke('保护已关闭'); }
  changeAllowed(allowed) {
    this.revoke('白名单修改');
    this.allowed = new Set(allowed.map(normalizeIP));
  }
  usable() {
    if (this.state === 'allowed' && this.now() >= this.expires) this.revoke('检测过期');
    return this.enabled && this.state === 'allowed';
  }
  async verify({ keepLease = false } = {}) {
    if (!this.enabled || this.controller || this.now() < this.retryAt) return false;
    const retaining = keepLease && this.usable();
    if (!retaining) this.revoke();
    const generation = this.generation, controller = new AbortController();
    this.controller = controller;
    if (!retaining) this.state = 'checking';
    let timer;
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => this.probe(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('检测超时'));
        }, this.timeout); })
      ]);
      if (generation !== this.generation || controller.signal.aborted || !this.enabled) return false;
      const ip = normalizeIP(raw);
      this.lastIP = ip;
      if (!this.allowed.has(ip)) throw new Error('出口不在白名单');
      this.expires = this.now() + this.ttl; this.family = isIP(ip);
      this.state = 'allowed'; this.reason = ''; this.retryAt = 0;
      clearTimeout(this.leaseTimer);
      this.leaseTimer = setTimeout(() => this.revoke('检测过期'), this.ttl);
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.revoke(error.message);
        if (error.rateLimited) this.retryAt = this.now() + this.cooldown;
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }
}
