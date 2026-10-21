import { fileURLToPath, pathToFileURL } from 'node:url';
import { updatePackage } from './update.js';
import { runWithUpdateLock } from './update-lock.js';

export async function performUpdateAndShow({ update = updatePackage,
  show = async () => (await import('./overlay.js')).launchOverlay(), lock = action => action() } = {}) {
  await lock(async () => {
    if (await update('easy-claude')) await show();
  });
}

export async function updateAndShow() {
  await runWithUpdateLock(process.execPath, [fileURLToPath(import.meta.url), '--locked']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv[2] === '--locked' ? performUpdateAndShow() : updateAndShow()).catch(error => { console.error(error.message); process.exitCode = 1; });
}
