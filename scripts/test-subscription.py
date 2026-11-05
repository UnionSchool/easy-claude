"""隔离偏好与离屏面板检查：不显示窗口、不读取真实账号或运行代理。"""
import json, plistlib, shutil, subprocess, tempfile, uuid
from pathlib import Path
root = Path(__file__).resolve().parents[1]
output = root / 'native/build/subscription-previews'
output.mkdir(parents=True, exist_ok=True)
domain = 'com.unionschool.subscription-tests-' + uuid.uuid4().hex
entry = r'''
@main struct SubscriptionChecks {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  NSApp.setActivationPolicy(.prohibited)
  let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
  let owner = Overlay()
  owner.node = CommandLine.arguments[1]; owner.script = CommandLine.arguments[2]
  owner.searchPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
  precondition(owner.subscriptionDay == 0 && !owner.automaticUsageRefresh)
  for day in [1, 3, 28, 29, 30, 31, 0] {
   owner.setSubscriptionDay(day)
   precondition(owner.subscriptionDay == day && Overlay().subscriptionDay == day)
  }
  owner.setSubscriptionDay(3)
  for invalid in [-1, 32, Int.max] { owner.setSubscriptionDay(invalid); precondition(owner.subscriptionDay == 3) }
  for invalid in [-1, 32] {
   UserDefaults.standard.set(invalid, forKey:"subscriptionDay")
   precondition(Overlay().subscriptionDay == 0)
  }
  owner.setSubscriptionDay(3)
  owner.toggleAutomaticUsageRefresh()
  precondition(owner.automaticUsageRefresh && Overlay().automaticUsageRefresh && owner.query != nil)
  let pending = owner.query
  owner.toggleAutomaticUsageRefresh()
  precondition(!owner.automaticUsageRefresh && !Overlay().automaticUsageRefresh && owner.query === pending)
  let deadline = Date().addingTimeInterval(5)
  while owner.query != nil && Date() < deadline { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
  precondition(owner.query == nil && owner.subscriptionDay == 3)
  let now = Date().timeIntervalSince1970
  let windows: [[String:Any]] = [
   ["id":controlProduct == "Codex" ? "codex:primary" : "seven_day:primary", "label":"Weekly", "name":"Weekly", "remaining":77, "resetsAt":now+7200, "windowDurationMins":10080],
   ["id":"five_hour:primary", "label":"5-hour", "name":"5-hour", "remaining":94, "resetsAt":now+3600, "windowDurationMins":300]]
  owner.snapshot = try JSONDecoder().decode(Snapshot.self,from:JSONSerialization.data(withJSONObject:["windows":windows,"fetchedAt":now]))
  owner.ipText = "Test City·203.0.113.1"
  for language in ["zh", "en"] {
   owner.setLanguage(language)
   for day in [0, 3, 31] {
    owner.setSubscriptionDay(day)
    for expanded in [false, true] {
     owner.controlsExpanded = expanded
     let size = NSSize(width:360,height:owner.controlHeight)
     let host = NSHostingView(rootView:ControlPanelView(owner:owner))
     host.setFrameSize(size)
     let panel = NSPanel(contentRect:NSRect(origin:.zero,size:size),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
     panel.contentView = host
     host.layoutSubtreeIfNeeded()
     RunLoop.main.run(until:Date().addingTimeInterval(0.05))
     let bitmap = host.bitmapImageRepForCachingDisplay(in:host.bounds)!
     host.cacheDisplay(in:host.bounds,to:bitmap)
     try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[3]+"/"+language+"-\(day)"+(expanded ? "-expanded.png" : "-collapsed.png")))
     precondition(!panel.isVisible)
    }
   }
  }
  precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier == front)
  print("PASS subscription 0/1/3/28–31 persistence, invalid input, automatic on/off/in-flight, 12 zh/en offscreen panels; no foreground change")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='easy-subscription-') as temporary:
    work = Path(temporary)
    app = work / 'Checks.app'
    binary = app / 'Contents/MacOS/subscription-checks'
    binary.parent.mkdir(parents=True)
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': domain, 'CFBundleExecutable':'subscription-checks',
        'CFBundlePackageType':'APPL', 'LSUIElement':True}))
    query = work / 'query.cjs'
    query.write_text('setTimeout(()=>console.log(JSON.stringify({windows:[],fetchedAt:Date.now()/1000})),100)')
    source = work / 'Checks.swift'
    source.write_text((root / 'native/Overlay.swift').read_text().split('@main\nstruct Main')[0] + entry)
    try:
        subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path',str(work/'cache'),str(source),'-o',str(binary),'-framework','AppKit'],check=True)
        subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
        subprocess.run([str(binary),shutil.which('node'),str(query),str(output)],check=True,timeout=30)
    finally:
        subprocess.run(['defaults','delete',domain],capture_output=True)
