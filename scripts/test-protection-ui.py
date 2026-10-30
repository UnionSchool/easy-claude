"""离屏验证真实面板与保护开关：不显示窗口、不启动 Claude、不读取账号。"""
import json, plistlib, shutil, subprocess, tempfile, uuid
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / 'native/build/protection-previews'
output.mkdir(parents=True, exist_ok=True)
domain = 'com.unionschool.protection-tests-' + uuid.uuid4().hex
entry = r'''
@main struct ProtectionUITest {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  NSApp.setActivationPolicy(.prohibited)
  UserDefaults.standard.set(30, forKey:"ipProtectionInterval")
  let owner = Overlay()
  precondition(owner.protectionInterval == 60)
  owner.protectionConfigurationChanged()
  precondition(UserDefaults.standard.integer(forKey:"ipProtectionInterval") == 60)
  owner.node = CommandLine.arguments[1]; owner.script = CommandLine.arguments[2]
  owner.searchPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
  let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
  func drain() { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  func wait(_ check: () -> Bool) {
   let deadline = Date().addingTimeInterval(5)
   while !check() && Date() < deadline { drain() }
   precondition(check())
  }
  owner.refreshIP()
  let firstIPQuery = owner.ipQuery
  precondition(firstIPQuery != nil)
  owner.refreshIP();precondition(owner.ipQuery === firstIPQuery)
  wait { owner.ipQuery == nil }
  let ipAttempt = owner.ipLastProbeUptime
  owner.ipLastAttempt = .distantPast
  owner.refreshIP()
  precondition(owner.ipQuery == nil && owner.ipLastProbeUptime == ipAttempt)
  UserDefaults.standard.set("zh", forKey:"interfaceLanguage")
  owner.checkProxyConfiguration()
  wait { owner.proxyProcess == nil && owner.proxyReport != nil }
  precondition(owner.proxyReport?.active == false && owner.proxyActionText == "启动Claude代理")
  owner.changeClaudeProxy()
  wait { owner.proxyProcess == nil && owner.proxyReport?.configured == true }
  precondition(owner.proxyReport?.active == true && owner.proxyActionText == "停止Claude代理")
  owner.changeClaudeProxy()
  wait { owner.proxyProcess == nil && owner.proxyReport?.active == false }
  owner.changeClaudeProxy()
  wait { owner.proxyProcess == nil && owner.proxyReport?.configured == true }
  precondition(!owner.automaticUsageRefresh)
  owner.toggleAutomaticUsageRefresh()
  precondition(owner.automaticUsageRefresh && Overlay().automaticUsageRefresh)
  owner.toggleAutomaticUsageRefresh()
  precondition(!owner.automaticUsageRefresh && !Overlay().automaticUsageRefresh)
  wait { owner.query == nil }
  precondition(!owner.protectionEnabled)
  owner.setProtectionEnabled(true)
  precondition(!owner.protectionEnabled && owner.protectionError != nil)
  owner.protectionIPs = "203.0.113.1"
  owner.protectionConfigurationChanged()
  owner.setProtectionEnabled(true)
  wait { owner.protectionReport?.ready == true }
  precondition(owner.protectionEnabled && UserDefaults.standard.bool(forKey:"ipProtectionEnabled"))
  precondition(Overlay().protectionEnabled && Overlay().protectionIPs == "203.0.113.1")
  owner.ipText="Old City·198.51.100.99"
  precondition(owner.networkIPText == "203.0.113.1")
  owner.sendProtection(["action":"fixtureChanged"])
  wait { owner.protectionReport?.ip == "198.51.100.20" }
  precondition(owner.networkIPText == "198.51.100.20" && !owner.protectionIsAllowed)
  owner.sendProtection(["action":"fixtureTimeout"])
  wait { owner.protectionReport?.reason == "检测超时" }
  precondition(!owner.networkIPText.contains("198.51.100.20"))
  owner.configureProtection();wait { owner.protectionReport?.ready == true }
  for language in ["zh", "en"] {
   UserDefaults.standard.set(language, forKey:"interfaceLanguage")
   for enabled in [true, false] {
    for proxyActive in [false, true] {
    owner.runProxyAction(proxyActive ? "start" : "stop")
    wait { owner.proxyProcess == nil && owner.proxyReport?.active == proxyActive }
    for expanded in [false, true] {
    owner.controlsExpanded = expanded
    owner.setProtectionEnabled(enabled)
    wait { owner.protectionReport?.state == (enabled ? "allowed" : "off") }
    precondition(!owner.protectionStateText.isEmpty)
    let host = NSHostingView(rootView: ControlPanelView(owner:owner))
    let size = NSSize(width:360, height:owner.controlHeight)
    host.setFrameSize(size)
    let panel = NSPanel(contentRect:NSRect(origin:.zero,size:size),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
    panel.contentView = host
    host.layoutSubtreeIfNeeded();drain()
    let bitmap = host.bitmapImageRepForCachingDisplay(in:host.bounds)!
    host.cacheDisplay(in:host.bounds,to:bitmap)
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[3]+"/"+language+(enabled ? "-on" : "-off")+(expanded ? "-expanded" : "-collapsed")+(proxyActive ? "-proxy-on.png" : "-proxy-off.png")))
    precondition(!panel.isVisible)
    }
    }
   }
  }
  owner.setProtectionEnabled(true);wait { owner.protectionReport?.ready == true }
  owner.sendProtection(["action":"fixtureFault"])
  wait { owner.protectionError != nil }
  precondition(owner.protectionStateText.contains("Unprotected") || owner.protectionStateText.contains("未受保护"))
  try owner.protectionInput?.close()
  wait { owner.protectionProcess == nil }
  precondition(owner.protectionError != nil)
  precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier == front)
  print("PASS protection toggle on/off persistence, missing config, service failure, zh/en offscreen panel; no foreground change")
 }
}
'''
fixture = r'''
const readline = require('node:readline');
const lines = readline.createInterface({input:process.stdin});
lines.on('line', line => {
 const command = JSON.parse(line);
 if(command.action === 'heartbeat') return;
 if(command.action === 'fixtureChanged') console.log(JSON.stringify({state:'blocked',reason:'出口不在白名单',ready:false,ip:'198.51.100.20',checkedAt:new Date().toISOString()}));
 else if(command.action === 'fixtureTimeout') console.log(JSON.stringify({state:'blocked',reason:'检测超时',ready:false,ip:'198.51.100.20'}));
 else if(command.action === 'fixtureFault') console.log(JSON.stringify({state:'fault',reason:'测试故障',ready:false}));
 else console.log(JSON.stringify({state:command.enabled ? 'allowed':'off',ready:!!command.enabled,ip:'203.0.113.1',checkedAt:new Date().toISOString()}));
});
'''
with tempfile.TemporaryDirectory(prefix='easy-protection-ui-') as temporary:
    work = Path(temporary)
    app = work / 'ProtectionTests.app'
    binary = app / 'Contents/MacOS/protection-checks'
    binary.parent.mkdir(parents=True)
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': domain, 'CFBundleExecutable':'protection-checks',
        'CFBundlePackageType':'APPL', 'LSUIElement':True, 'CFBundleShortVersionString':'test'}))
    (work / 'overlay-guard.js').write_text(fixture)
    (work / 'overlay-proxy.js').write_text(r'''
const fs = require('node:fs');
const path = require('node:path').join(__dirname, 'proxy-test-state.json');
const action = process.argv[2];
let active = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : false;
if(action !== 'status') { active = action === 'start'; fs.writeFileSync(path, JSON.stringify(active)); }
console.log(JSON.stringify({active,configured:active,hasBackup:active,needsRestart:action !== 'status'}));
''')
    (work / 'overlay-ip.js').write_text('console.log(JSON.stringify({ip:"203.0.113.1",city:"Test",timezone:"Asia/Shanghai"}))')
    (work / 'overlay-query.js').write_text("console.log(JSON.stringify({windows:[],fetchedAt:Date.now()/1000}))")
    source = work / 'Protection.swift'
    source.write_text((root/'native/Overlay.swift').read_text().split('@main\nstruct Main')[0] + entry)
    try:
        subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path',str(work/'cache'),str(source),'-o',str(binary),'-framework','AppKit'],check=True)
        subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
        subprocess.run([str(binary),shutil.which('node'),str(work/'overlay-query.js'),str(output)],check=True,timeout=30)
    finally:
        subprocess.run(['defaults','delete',domain],capture_output=True)
