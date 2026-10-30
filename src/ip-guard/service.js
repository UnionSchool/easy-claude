import net from 'node:net';
import { mkdir, lstat, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Guard, normalizeIP, createExitIPProbe } from './guard.js';
import { createGateway } from './gateway.js';
import { controlPath, DEFAULT_PROXY_PORT } from './launcher.js';

export async function startService({ input = process.stdin, output = process.stdout, path = controlPath(), proxyPort = DEFAULT_PROXY_PORT,
  probe = createExitIPProbe(), now = () => performance.now(),
  heartbeatTimeout = 15000 } = {}) {
  const guard = new Guard({ allowed: [], probe, ttl: 75000, timeout: 13000, cooldown: 600000, now });
  // 服务一开始先阻断，收到界面配置前绝不接受转发。
  guard.enable();
  const gateway = createGateway(guard);
  await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(proxyPort, '127.0.0.1', resolve); });
  const port = gateway.server.address().port;
  let fault = '', checkedAt = null, interval = 60000;
  let lastCheck = -Infinity, heartbeat = now(), stopped = false, holding = false, verification = 0, requested = false;
  const status = () => {
    const ready = guard.usable() && !fault;
    return { service: 'easy-claude-ip-guard', port, enabled: guard.enabled, ready,
      state: fault ? 'fault' : guard.state, reason: fault || guard.reason || '', ip: guard.lastIP || null, checkedAt };
  };
  const report = () => { if (!stopped && !output.destroyed) output.write(JSON.stringify(status()) + '\n'); };
  const verify = async (keepLease = false) => {
    if (!guard.enabled || stopped || holding) return;
    if (!keepLease) requested = true;
    if (guard.controller || now() < guard.retryAt) return;
    if (now() - lastCheck < 60000) {
      if (!keepLease) { guard.reason = '等待60秒最小查询间隔'; report(); }
      return;
    }
    requested = false;
    const attempt = ++verification;
    lastCheck = now();
    const pending = guard.verify({ keepLease }); report();
    await pending;
    if (attempt === verification) checkedAt = new Date().toISOString();
    report();
  };
  guard.on('blocked', report);
  const control = net.createServer(socket => { socket.on('error', () => {}); socket.end(JSON.stringify(status()) + '\n'); });
  const stop = async () => {
    if (stopped) return;
    stopped = true; verification++; clearInterval(timer); guard.revoke('控制程序已退出');
    reader.close(); await gateway.close();
    await new Promise(resolve => control.close(resolve));
  };
  let timer, reader;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const directory = await lstat(dirname(path));
    if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) throw new Error('保护通信目录权限不安全');
    try {
      const file = await lstat(path);
      if (!file.isSocket() || file.uid !== process.getuid()) throw new Error('保护通信路径不安全');
      const active = await new Promise((resolve, reject) => {
        const socket = net.connect(path);
        socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('已有保护服务没有响应')); });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', error => ['ECONNREFUSED', 'ENOENT'].includes(error.code) ? resolve(false) : reject(error));
      });
      if (active) throw new Error('已有保护服务正在运行');
      await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(path, resolve); });
    await chmod(path, 0o600);
  } catch (error) {
    guard.revoke(); await gateway.close(); control.close(); throw error;
  }
  reader = createInterface({ input, crlfDelay: Infinity });
  reader.on('line', line => {
    if (line.length > 4096) { verification++; guard.revoke(); fault = '控制消息过大'; report(); return; }
    try {
      const command = JSON.parse(line);
      if (command.action === 'heartbeat') { heartbeat = now(); return; }
      if (command.action === 'configure') {
        holding = true;
        verification++; guard.revoke('配置修改');
        if (typeof command.enabled !== 'boolean') throw new Error('保护配置无效');
        if (!command.enabled) { holding = false; guard.disable(); fault = ''; report(); return; }
        const ips = command.ips.map(normalizeIP);
        if (!ips.length || ips.length > 20 || ips.some(ip => net.isIP(ip) !== 4)) throw new Error('请输入 IPv4 白名单；当前版本关闭 IPv6 转发');
        if (!Number.isInteger(command.interval) || command.interval < 60 || command.interval > 300) throw new Error('复查间隔应为60至300秒');
        guard.changeAllowed(ips); guard.ttl = command.interval * 1000 + 15000;
        interval = command.interval * 1000; holding = false; guard.enable(); fault = ''; void verify();
      } else if (command.action === 'invalidate' || command.action === 'verify') {
        if (guard.enabled) { verification++; guard.revoke('网络变化或重新检测'); report(); void verify(); }
      } else if (command.action === 'hold') {
        holding = true; verification++; guard.revoke('白名单正在编辑'); report();
      } else if (command.action === 'launchDesktop') {
        // Electron辅助进程需要自行初始化沙箱，外层sandbox-exec会使它们启动即崩溃。
        throw new Error('桌面受保护启动暂不可用：嵌套沙箱冲突。请关闭保护后正常启动Claude；不会自动回退直连。');
      } else throw new Error('未知保护命令');
    } catch (error) { verification++; guard.revoke('配置或控制错误'); fault = error.message; report(); }
  });
  reader.on('close', () => { void stop(); });
  output.on('error', () => { void stop(); });
  timer = setInterval(() => {
    if (now() - heartbeat >= heartbeatTimeout) { void stop(); return; }
    const wasAllowed = guard.state === 'allowed'; guard.usable();
    if (wasAllowed && guard.state !== 'allowed') report();
    if (guard.enabled && !fault && now() >= guard.retryAt && now() - lastCheck >= (requested ? 60000 : interval)) void verify(!requested);
  }, 500);
  report();
  return { guard, port, status, stop, verify };
}
