import { readUsage } from './usage.js';
import { overlayData } from './overlay-data.js';
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
try {
  const text = JSON.stringify(overlayData(await readUsage({ signal: controller.signal })));
  // 原生端在进程结束后读取管道；限制体积以免写端等待管道空间。
  if (Buffer.byteLength(text) > 12000) throw new Error('额度响应过大，请使用 easy-claude 查看完整数据。');
  console.log(text);
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
