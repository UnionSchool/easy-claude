import { L } from './language.js';
import { readPublicIP } from './public-ip.js';
try { console.log(JSON.stringify(await readPublicIP())); }
catch { console.log(JSON.stringify({ error: L('IP异常', 'IP unavailable') })); process.exitCode = 1; }
