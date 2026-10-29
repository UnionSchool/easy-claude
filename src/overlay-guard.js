import { startService } from './ip-guard/service.js';
try { await startService(); }
catch {
  console.log(JSON.stringify({ state: 'fault', reason: '保护服务启动失败，请检查端口、沙箱或已有进程', ready: false }));
  process.exitCode = 1;
}
