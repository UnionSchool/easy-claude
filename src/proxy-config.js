import { promises as fs, constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_PROXY_PORT, DEFAULT_PROXY_URL, proxyEnvironment } from './ip-guard/launcher.js';

const run = promisify(execFile);
const wanted = proxyEnvironment(DEFAULT_PROXY_PORT, {});
const keys = Object.keys(wanted);
const hash = data => createHash('sha256').update(data).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function proxyPaths() {
  return {
    cli: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
    desktop: join('/Library/Managed Preferences', userInfo().username, 'com.anthropic.claudefordesktop.plist'),
    machine: '/Library/Managed Preferences/com.anthropic.claudefordesktop.plist',
    state: join(homedir(), 'Library/Application Support/easy-claude/proxy-state.json')
  };
}
async function file(path) {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('配置文件类型或大小不安全');
    return { stat, data: await fs.readFile(path) };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function json(data) {
  let value;
  try { value = JSON.parse(data); } catch { throw new Error('配置JSON无效，请先修复原文件'); }
  if (!object(value) || (value.env !== undefined && !object(value.env))) throw new Error('配置结构无效，未修改原文件');
  return value;
}
async function desktopValue(path) {
  if (!await file(path)) return null;
  try { return (await run('/usr/bin/plutil', ['-extract', 'egressProxyUrl', 'raw', '-o', '-', path], { timeout: 5000, maxBuffer: 8192 })).stdout.replace(/\n$/, ''); }
  catch (error) {
    if (((error.stdout || '') + (error.stderr || '')).includes('No value at that key path')) return null;
    throw new Error('无法读取桌面代理策略，请检查文件权限或管理员策略');
  }
}
async function snapshot(paths) {
  const saved = await file(paths.state);
  if (!saved) return null;
  if (saved.stat.uid !== process.getuid() || saved.stat.mode & 0o077) throw new Error('代理备份记录权限不安全');
  const value = json(saved.data);
  if (value.version !== 1 || value.cli !== paths.cli || value.desktop !== paths.desktop) throw new Error('代理配置目录已变化，请先恢复原目录配置');
  if ((value.desktopBackup !== null && !/^[a-f0-9]{64}$/.test(value.desktopHash || '')) || (value.cliBackup !== null && !/^[a-f0-9]{64}$/.test(value.cliHash || ''))) throw new Error('代理备份校验信息无效');
  for (const [key, target, pattern] of [['cliBackup', paths.cli, /^settings\.bak-\d{8}-\d{6}\.json$/],
    ['desktopBackup', paths.desktop, /^com\.anthropic\.claudefordesktop\.bak-\d{8}-\d{6}\.plist$/]]) {
    if (value[key] !== null && (typeof value[key] !== 'string' || dirname(value[key]) !== dirname(target) || !pattern.test(basename(value[key])))) throw new Error('代理备份路径无效');
  }
  return value;
}
export async function proxyStatus({ paths = proxyPaths() } = {}) {
  const cliFile = await file(paths.cli), env = cliFile ? json(cliFile.data).env || {} : {};
  const desktop = await desktopValue(paths.desktop);
  const machine = await desktopValue(paths.machine);
  const saved = await snapshot(paths);
  return {
    active: desktop === DEFAULT_PROXY_URL || keys.some(key => env[key] === wanted[key] && !key.toLowerCase().includes('no_proxy')),
    configured: machine === null && desktop === DEFAULT_PROXY_URL && keys.every(key => env[key] === wanted[key]),
    hasBackup: saved !== null,
    machinePolicy: machine !== null
  };
}
async function privateDirectory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error('代理备份目录权限不安全');
}
async function atomic(path, data, mode = 0o600) {
  const temp = path + '.easy-' + randomBytes(8).toString('hex');
  try { await fs.writeFile(temp, data, { flag: 'wx', mode }); await fs.rename(temp, path); }
  finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function stamp() {
  const d = new Date(), two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

// 管理员只运行系统自带工具；恢复时在plist内部复制字段，旧代理凭据不进入命令参数。
export function desktopScript(action, paths, saved, rollback = null) {
  const dir = dirname(paths.desktop), token = '__easy_proxy_' + randomBytes(6).toString('hex');
  const safe = path => `\n[ ! -L ${quote(path)} ]\n[ "$(/usr/bin/stat -f %u ${quote(path)})" = 0 ]\nmode=$(/usr/bin/stat -f %Lp ${quote(path)})\n[ $((0$mode & 022)) -eq 0 ]`;
  let script = `set -eu\n[ ! -L ${quote(dirname(dir))} ]\n/bin/mkdir -p ${quote(dirname(dir))}${safe(dirname(dir))}\n[ ! -L ${quote(dir)} ]\n/bin/mkdir -p ${quote(dir)}${safe(dir)}\ncd ${quote(dir)}\n`;
  script += `target=${quote(paths.desktop)}\nif [ -e "$target" ]; then ${safe(paths.desktop)}\n/usr/bin/plutil -lint "$target" >/dev/null\nfi\n`;
  script += `if [ -e ${quote(paths.machine)} ]; then /usr/bin/plutil -lint ${quote(paths.machine)} >/dev/null; if /usr/bin/plutil -type egressProxyUrl ${quote(paths.machine)} >/dev/null 2>&1; then exit 1; fi; fi\n`;
  if (action === 'start') {
    if (saved.desktopBackup) {
      script += `[ -f "$target" ]\n[ "$(/usr/bin/shasum -a 256 "$target" | /usr/bin/awk '{print $1}')" = ${quote(saved.desktopHash)} ]\n[ ! -e ${quote(saved.desktopBackup)} ]\n/bin/cp -p "$target" ${quote(saved.desktopBackup)}\n`;
    } else { script += '[ ! -e "$target" ]\n'; }
  } else { script += `current=$(/usr/bin/plutil -extract egressProxyUrl raw -o - "$target" 2>/dev/null || true)\n[ "$current" = ${quote(DEFAULT_PROXY_URL)} ] || exit 0\n`; }
  if (action === 'stop-default' && rollback?.desktopBackup) {
    script += `[ "$(/usr/bin/shasum -a 256 "$target" | /usr/bin/awk '{print $1}')" = ${quote(rollback.desktopHash)} ]\n[ ! -e ${quote(rollback.desktopBackup)} ]\n/bin/cp -p "$target" ${quote(rollback.desktopBackup)}\n`;
  }
  script += 'sourceHash=\nif [ -e "$target" ]; then sourceHash=$(/usr/bin/shasum -a 256 "$target" | /usr/bin/awk \'{print $1}\'); fi\n';
  script += `temp=$(/usr/bin/mktemp ${quote(join(dir, '.easy-proxy.XXXXXX'))})\ntrap '/bin/rm -f "$temp"' EXIT\nif [ -e "$target" ]; then /bin/cp -p "$target" "$temp"; else /usr/bin/plutil -create xml1 "$temp"; /bin/chmod 644 "$temp"; fi\n`;
  if (action === 'start') script += `/usr/bin/plutil -replace egressProxyUrl -string ${quote(DEFAULT_PROXY_URL)} "$temp"\n`;
  else {
    script += '/usr/bin/plutil -remove egressProxyUrl "$temp"\n';
    if (saved?.desktopBackup) {
      script += `${safe(saved.desktopBackup)}\n[ "$(/usr/bin/shasum -a 256 ${quote(saved.desktopBackup)} | /usr/bin/awk '{print $1}')" = ${quote(saved.desktopHash)} ]\n`;
      script += `if /usr/bin/plutil -type egressProxyUrl ${quote(saved.desktopBackup)} >/dev/null 2>&1; then\n/usr/libexec/PlistBuddy -c ${quote(`Add :${token} dict`)} "$temp"\n/usr/libexec/PlistBuddy -c ${quote(`Merge ${basename(saved.desktopBackup)} :${token}`)} "$temp"\n/usr/libexec/PlistBuddy -c ${quote(`Copy :${token}:egressProxyUrl :egressProxyUrl`)} "$temp"\n/usr/libexec/PlistBuddy -c ${quote(`Delete :${token}`)} "$temp"\nfi\n`;
    }
  }
  return script + '/usr/bin/plutil -lint "$temp" >/dev/null\nif [ -e "$target" ]; then [ "$(/usr/bin/shasum -a 256 "$target" | /usr/bin/awk \'{print $1}\')" = "$sourceHash" ]; else [ -z "$sourceHash" ]; fi\n/bin/mv -f "$temp" "$target"\n';
}
async function administrator({ script }) {
  try { await run('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'do shell script (item 1 of argv) with administrator privileges', '-e', 'end run', script], { timeout: 120000, maxBuffer: 8192 }); }
  catch (error) { throw new Error((error.stderr || '').includes('-128') ? '已取消管理员授权' : '桌面代理操作失败，请检查管理员策略和权限'); }
}
export async function changeProxy(action, { paths = proxyPaths(), admin = administrator } = {}) {
  if (!['start', 'stop', 'stop-default'].includes(action)) throw new Error('未知代理操作');
  const before = await proxyStatus({ paths });
  if (action === 'start' && before.configured) return before;
  if (before.machinePolicy) throw new Error('存在机器级代理策略，请由管理员管理；未覆盖该策略');
  let saved = await snapshot(paths);
  let rollback = null;
  if (action === 'stop-default' && saved) throw new Error('已有原配置备份，请使用停止操作恢复');
  if (action === 'stop' && !saved && before.active) return { ...before, needsDefaultRestore: true };
  if (action !== 'start' && !before.active) return before;
  if (action === 'start' && before.active && !saved) throw new Error('旧配置没有原始备份，请先停止并确认恢复默认');
  const cliFile = await file(paths.cli), current = cliFile ? json(cliFile.data) : {};
  if (cliFile && (cliFile.stat.uid !== process.getuid() || cliFile.stat.mode & 0o022)) throw new Error('CLI配置文件归属或权限不安全，未修改');
  const next = { ...current, env: { ...(current.env || {}) } };
  await fs.mkdir(dirname(paths.cli), { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(dirname(paths.cli));
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || directory.mode & 0o022) throw new Error('CLI配置目录不安全');
  if (action === 'stop-default') {
    const time = stamp(), desktopFile = await file(paths.desktop);
    rollback = { desktopBackup: desktopFile ? join(dirname(paths.desktop), `com.anthropic.claudefordesktop.bak-${time}.plist`) : null,
      desktopHash: desktopFile ? hash(desktopFile.data) : null };
    if (cliFile) {
      const backup = join(dirname(paths.cli), `settings.bak-${time}.json`);
      await fs.copyFile(paths.cli, backup, constants.COPYFILE_EXCL); await fs.chmod(backup, 0o600);
      if (hash(await fs.readFile(backup)) !== hash(cliFile.data)) throw new Error('CLI配置在备份期间已变化，未修改');
    }
  }
  if (action === 'start') {
    await privateDirectory(dirname(paths.state));
    const time = stamp(), desktopFile = await file(paths.desktop);
    saved = { version: 1, cli: paths.cli, desktop: paths.desktop,
      cliBackup: cliFile ? join(dirname(paths.cli), `settings.bak-${time}.json`) : null,
      desktopBackup: desktopFile ? join(dirname(paths.desktop), `com.anthropic.claudefordesktop.bak-${time}.plist`) : null,
      desktopHash: desktopFile ? hash(desktopFile.data) : null, cliHash: cliFile ? hash(cliFile.data) : null };
    if (cliFile) {
      await fs.copyFile(paths.cli, saved.cliBackup, constants.COPYFILE_EXCL); await fs.chmod(saved.cliBackup, 0o600);
      if (hash(await fs.readFile(saved.cliBackup)) !== saved.cliHash) throw new Error('CLI配置在备份期间已变化，未修改');
    }
    await atomic(paths.state, JSON.stringify(saved));
    Object.assign(next.env, wanted);
  } else {
    let original = {};
    if (saved?.cliBackup) {
      const backup = await file(saved.cliBackup);
      if (!backup || hash(backup.data) !== saved.cliHash) throw new Error('原始CLI备份缺失或已变化，未猜测原配置');
      original = json(backup.data);
    }
    for (const key of keys) {
      if (next.env[key] !== wanted[key]) continue;
      if (Object.hasOwn(original.env || {}, key)) next.env[key] = original.env[key];
      else delete next.env[key];
    }
    if (!Object.keys(next.env).length && !Object.hasOwn(original, 'env')) delete next.env;
  }
  try {
    const desktop = await desktopValue(paths.desktop);
    if (action === 'start' || desktop === DEFAULT_PROXY_URL) await admin({ action, paths, saved: action === 'stop-default' ? null : saved, script: desktopScript(action, paths, action === 'stop-default' ? null : saved, rollback) });
    const latest = await file(paths.cli);
    if ((latest ? hash(latest.data) : null) !== (cliFile ? hash(cliFile.data) : null)) throw new Error('CLI配置在操作期间已变化，请重试；未覆盖新内容');
    if (action !== 'start' && saved?.cliBackup === null && !Object.keys(next).length) await fs.unlink(paths.cli).catch(error => { if (error.code !== 'ENOENT') throw error; });
    else await atomic(paths.cli, JSON.stringify(next, null, 2) + '\n', cliFile ? cliFile.stat.mode & 0o777 : 0o600);
    if (action !== 'start') await fs.unlink(paths.state).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const result = await proxyStatus({ paths });
    if (action === 'start' && !result.configured) throw new Error('代理配置未完全验证成功，请检查两端配置');
    return { ...result, needsRestart: true, restoredDefault: action === 'stop-default' };
  } catch (error) {
    if (action === 'start' && !(await proxyStatus({ paths }).catch(() => ({ active: true }))).active) await fs.unlink(paths.state).catch(() => {});
    throw error;
  }
}
