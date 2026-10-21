import { readPublicIP } from './public-ip.js';
try { console.log(JSON.stringify(await readPublicIP())); }
catch { console.log(JSON.stringify({ error: 'IP异常' })); process.exitCode = 1; }
