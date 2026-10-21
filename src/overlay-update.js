import { pathToFileURL } from 'node:url';
import { updatePackage } from './update.js';
import { withUpdateLock } from './update-lock.js';

export async function updateAndShow({ update = updatePackage,
  show = async () => (await import('./overlay.js')).launchOverlay(), lock = withUpdateLock } = {}) {
  await lock(async () => {
    if (await update('easy-claude')) await show();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateAndShow().catch(error => { console.error(error.message); process.exitCode = 1; });
}
