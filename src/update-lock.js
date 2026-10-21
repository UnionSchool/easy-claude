import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installedPrefix } from './update.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = installedPrefix(root) ?? root;
const key = createHash('sha256').update(prefix).digest('hex').slice(0, 24);
const defaultLock = join(tmpdir(), `easy-tools-update-${key}.lock`);

export async function withUpdateLock(action, { lock = defaultLock } = {}) {
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    // shortcut: 异常强退可能留下锁；为避免误删在用锁，不自动按时间清除。
    if (error.code === 'EEXIST') throw new Error(`另一个 Easy 工具正在更新。若确认无更新进程，可删除遗留锁目录后重试：${lock}`);
    throw new Error('无法建立更新锁，请检查临时目录权限。');
  }
  try { return await action(); }
  finally { await rmdir(lock); }
}
