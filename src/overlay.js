import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function launchOverlay({ platform = process.platform, check = access, run = promisify(execFile) } = {}) {
  if (platform !== 'darwin') throw new Error('浮窗首版仅支持 macOS。');
  const app = fileURLToPath(new URL('../native/build/EasyClaudeOverlay.app', import.meta.url));
  try { await check(`${app}/Contents/MacOS/EasyClaudeOverlay`, constants.X_OK); }
  catch { throw new Error('尚未构建浮窗，请在项目目录执行 npm run build:overlay。'); }
  try { await run(`${app}/Contents/MacOS/EasyClaudeOverlay`, ['--quit-running'], { timeout: 7000, maxBuffer: 4096 }); }
  catch { throw new Error('无法退出旧浮窗，请从菜单退出后重试。'); }
  await run('/usr/bin/open', ['-g', '-a', app, '--args',
    process.execPath, fileURLToPath(new URL('./overlay-query.js', import.meta.url)), process.env.PATH ?? '', process.env.CLAUDE_CONFIG_DIR ?? '']);
  console.log('额度与电子时钟浮窗已启动；Claude 在前台时显示。拖动调整位置，右键或菜单栏 EA 可设置时区、查看双环额度和退出。');
}
