import { proxyStatus, changeProxy } from './proxy-config.js';
try {
  if (process.platform !== 'darwin') throw new Error('Claude代理配置仅支持macOS');
  const action = process.argv[2] || 'status';
  console.log(JSON.stringify(action === 'status' ? await proxyStatus() : await changeProxy(action)));
} catch (error) {
  const status = await proxyStatus().catch(() => ({ active: false, configured: false }));
  console.log(JSON.stringify({ ...status, error: error.message }));
  process.exitCode = 1;
}
