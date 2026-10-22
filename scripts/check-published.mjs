import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function alreadyPublished(status, metadata, version, head) {
  if (status === 404) return false;
  if (status !== 200) throw new Error(`Registry check failed: HTTP ${status}`);
  if (metadata?.version !== version || metadata?.gitHead !== head) {
    throw new Error('Published version does not match this Git commit. Refusing to reuse it.');
  }
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}?verify=${Date.now()}`, { signal: AbortSignal.timeout(12000) });
  const exists = alreadyPublished(response.status, response.status === 200 ? await response.json() : null, version, head);
  appendFileSync(process.env.GITHUB_OUTPUT, `exists=${exists}\n`);
  console.log(exists ? 'This version and commit are already on npm; skipping duplicate publish.' : 'Version is not published; proceeding.');
}
