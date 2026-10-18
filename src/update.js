import { access, realpath } from 'node:fs/promises';
import { dirname, basename, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function installedPrefix(root, platform = process.platform) {
  const modules = dirname(root.replace(/[\\/]$/, ''));
  if (basename(modules) !== 'node_modules') return null;
  const parent = dirname(modules);
  return basename(parent) === 'lib' ? dirname(parent) : platform === 'win32' ? parent : null;
}

async function findNpmCli() {
  const directories = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)];
  for (const directory of directories.filter(Boolean)) {
    for (const path of [join(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
      join(directory, 'node_modules/npm/bin/npm-cli.js'), join(directory, 'npm')]) {
      try { const resolved = await realpath(path); await access(resolved); return resolved; }
      catch { /* npm 可能位于 PATH 中另一套 Node 的旁边。 */ }
    }
  }
  throw new Error('未找到 npm，请先安装 Node.js/npm，再使用 npm i -g 更新。');
}

function runNpm(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', () => reject(new Error('无法启动 npm 更新。')));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm 更新失败（${signal ?? code ?? '未知状态'}），请检查网络或安装目录权限。`));
    });
  });
}

export async function updatePackage(name, { root = fileURLToPath(new URL('../', import.meta.url)),
  getNpmCli = findNpmCli, run = runNpm, platform = process.platform } = {}) {
  if (!['easy-codex', 'easy-claude'].includes(name)) throw new Error('不支持的更新包名。');
  const npmCli = await getNpmCli();
  const prefix = installedPrefix(root, platform);
  const args = [npmCli, 'install', '--global', ...(prefix ? ['--prefix', prefix] : []),
    '--registry=https://registry.npmjs.org', `${name}@latest`];
  await run(process.execPath, args);
  console.log(`${name} 已更新；运行 ${name} show 自动重启浮窗。`);
}
