#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
import { readUsage, formatUsage } from '../src/usage.js';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('用法：easy-claude [usage|show|overlay|update]\n显示已登录 Claude 账号的剩余百分比和重置时间。需要 Claude Code 订阅登录。');
} else if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
  console.log(version);
} else if (args.length === 1 && ['show', 'overlay'].includes(args[0])) {
  try { const { launchOverlay } = await import('../src/overlay.js'); await launchOverlay(); }
  catch (error) { console.error(`easy-claude: ${error.message}`); process.exitCode = 1; }
} else if (args.length === 1 && args[0] === 'update') {
  try { const { updatePackage } = await import('../src/update.js'); await updatePackage('easy-claude'); }
  catch (error) { console.error(`easy-claude: ${error.message}`); process.exitCode = 1; }
} else if (args.length === 0 || (args.length === 1 && args[0] === 'usage')) {
  try { console.log(formatUsage(await readUsage())); }
  catch (error) { console.error(`easy-claude: ${error.message}`); process.exitCode = 1; }
} else {
  console.error('未知参数。用法：easy-claude [usage|show|overlay|update]，或 easy-claude --help');
  process.exitCode = 1;
}
