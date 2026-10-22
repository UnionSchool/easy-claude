import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('浮窗只能在 macOS 构建。');
const app = `${root}native/build/EasyClaudeOverlay.app/Contents`;
await mkdir(`${app}/MacOS`, { recursive: true });
const temporary = await mkdtemp('/tmp/easy-claude-build-');
try {
  for (const architecture of ['arm64', 'x86_64']) {
    execFileSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
      '-target', `${architecture}-apple-macosx14.0`, '-module-cache-path', `${temporary}/cache`,
      `${root}native/Overlay.swift`, '-o', `${temporary}/${architecture}`, '-framework', 'AppKit'], { stdio: 'inherit' });
  }
  execFileSync('lipo', ['-create', `${temporary}/arm64`, `${temporary}/x86_64`, '-output', `${app}/MacOS/EasyClaudeOverlay`], { stdio: 'inherit' });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
await writeFile(`${app}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>EasyClaudeOverlay</string>
<key>CFBundleIdentifier</key><string>com.unionschool.easy-claude.overlay</string>
<key>CFBundleName</key><string>Easy Claude Overlay</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hans</string><string>zh-Hant</string></array>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', `${root}native/build/EasyClaudeOverlay.app`], { stdio: 'inherit' });
execFileSync(`${app}/MacOS/EasyClaudeOverlay`, ['--self-test'], { stdio: 'inherit' });
