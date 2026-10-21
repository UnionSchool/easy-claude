import { access, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, basename, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function installedPrefix(root, platform = process.platform) {
  const modules = dirname(root.replace(/[\\/]$/, ''));
  if (basename(modules) !== 'node_modules') return null;
  const parent = dirname(modules);
  return basename(parent) === 'lib' ? dirname(parent) : platform === 'win32' ? parent : null;
}

export function isNewer(latest, current) {
  if (!/^\d+\.\d+\.\d+$/.test(latest) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(current)) {
    throw new Error('无法识别正式版本号，未执行更新。');
  }
  const a = latest.split('.').map(Number), b = current.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return current.includes('-');
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

export async function readLatest(npmCli, name) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [npmCli, 'view', name, 'dist-tags.latest',
      '--json', '--prefer-online', '--registry=https://registry.npmjs.org'], { timeout: 30000, maxBuffer: 4096 });
    return JSON.parse(stdout);
  } catch { throw new Error('无法在线检查 npm 最新版本，请检查网络后重试。'); }
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
  getNpmCli = findNpmCli, getLatest = readLatest,
  currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  run = runNpm, platform = process.platform } = {}) {
  if (!['easy-codex', 'easy-claude'].includes(name)) throw new Error('不支持的更新包名。');
  const npmCli = await getNpmCli();
  const latest = await getLatest(npmCli, name);
  if (!isNewer(latest, currentVersion)) {
    console.log(currentVersion === latest
      ? `${name} 已经是最新版本（${currentVersion}）。`
      : `${name} 当前版本 ${currentVersion} 高于 npm 最新版本 ${latest}，无需更新。`);
    return false;
  }
  const prefix = installedPrefix(root, platform);
  // 先在线检查再锁定版本，避免安装阶段复用旧 latest 缓存而降级。
  const args = [npmCli, 'install', '--global', ...(prefix ? ['--prefix', prefix] : []),
    '--prefer-online', '--registry=https://registry.npmjs.org', `${name}@${latest}`];
  await run(process.execPath, args);
  console.log(`${name} 已更新到 ${latest}。`);
  return true;
}

export async function checkUpdate(name, { getNpmCli = findNpmCli, getLatest = readLatest,
  currentVersion = version } = {}) {
  if (!['easy-codex', 'easy-claude'].includes(name)) throw new Error('不支持的更新包名。');
  const latest = await getLatest(await getNpmCli(), name);
  return { latest, available: isNewer(latest, currentVersion) };
}
