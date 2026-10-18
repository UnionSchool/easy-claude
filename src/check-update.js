import { checkUpdate } from './update.js';
try { console.log(JSON.stringify(await checkUpdate('easy-claude'))); }
catch { process.exitCode = 1; }
