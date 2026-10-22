import { L } from './language.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installedPrefix } from './update.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const key = createHash('sha256').update(installedPrefix(root) ?? root).digest('hex').slice(0, 24);
// 使用新文件名，旧版无持有者信息的目录不再阻挡更新，也不冒险删除它。
const lockFile = join(tmpdir(), `easy-tools-update-${key}.flock`);
const helper = fileURLToPath(new URL('../native/build/EasyClaudeOverlay.app/Contents/MacOS/EasyClaudeOverlay', import.meta.url));

function runHelper(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', () => reject(new Error(L('无法启动系统更新锁组件，请重新安装此工具。', 'Cannot start the update lock helper. Reinstall this tool.'))));
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(L('更新进程已中断；系统会在安装进程退出后自动释放锁。', 'Update interrupted. The lock is released when installation exits.')));
      else resolve(code);
    });
  });
}

export async function runWithUpdateLock(command, args, {
  lock = lockFile, binary = helper, run = runHelper, platform = process.platform
} = {}) {
  if (platform !== 'darwin') throw new Error(L('浮窗更新仅支持 macOS。', 'Overlay updates require macOS.'));
  const code = await run(binary, ['--with-update-lock', lock, command, ...args]);
  if (code === 0) return;
  if (code === 75) throw new Error(L('另一个 Easy 工具正在更新，请稍后重试；无需清理更新锁。', 'Another Easy update is running. Try again later; do not remove the lock.'));
  if (code === 73) throw new Error(L('无法建立系统更新锁，请检查临时目录权限。', 'Cannot acquire the update lock. Check temporary directory permissions.'));
  if (code === 74) throw new Error(L('无法启动更新程序，请检查 Node.js 安装。', 'Cannot start the updater. Check the Node.js installation.'));
  throw new Error(L('更新未完成，请查看上方提示后重试。', 'Update incomplete. Check the messages above and retry.'));
}
