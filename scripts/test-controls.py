"""隔离控制面板验证：真实SwiftUI绘制，默认不触及真实设置/登录项/网络。"""
import json, os, plistlib, shutil, subprocess, tempfile, uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1]
name=json.loads((root/'package.json').read_text())['name']
output=root/'native/build/control-previews';output.mkdir(parents=True,exist_ok=True)
domain='com.unionschool.controls-tests-'+uuid.uuid4().hex
entry=r'''
@main struct ControlUITest {
 @MainActor static func main() throws {
  setbuf(stdout,nil)
  _ = NSApplication.shared
  NSApp.setActivationPolicy(.accessory)
  NSApp.finishLaunching()
  NSApp.activate(ignoringOtherApps:true)
  runControlChecks()
  let owner = Overlay()
  let now = Date().timeIntervalSince1970
  func snapshot(_ mode: String) -> Snapshot {
   let zeros = mode == "waiting" || mode == "verifying"
   let reset = mode == "verifying" ? now - 1 : now + 7200
   let weekly: [String:Any] = ["id":controlProduct == "Codex" ? "codex:primary" : "seven_day:primary", "label":"周", "name":"周额度", "remaining":zeros ? 0 : 77, "resetsAt":reset, "windowDurationMins":10080]
   let five: [String:Any] = ["id":"five_hour:primary", "label":"5小时", "name":"5小时", "remaining":zeros ? 0 : 94, "resetsAt":now + 3600, "windowDurationMins":300]
   let rows = controlProduct == "Codex" ? [weekly] : [five,weekly]
   let data: [String:Any] = ["windows":rows,"fetchedAt":mode == "unknown" ? now - 10000 : now]
   return try! JSONDecoder().decode(Snapshot.self,from:JSONSerialization.data(withJSONObject:data))
  }
  owner.manualClockCity = "洛杉矶"; owner.manualClockZone = TimeZone(identifier:"America/Los_Angeles")!
  owner.followIPTimeZone = false; owner.applyClockTimeZone()
  owner.ipText = "Los Angeles·203.0.113.18"
  let host = NSHostingView(rootView:ControlPanelView(owner:owner))
  let window = NSWindow(contentRect:NSRect(x:100,y:100,width:360,height:500),styleMask:[.titled],backing:.buffered,defer:false)
  window.appearance = NSAppearance(named:.darkAqua)
  window.contentView = host
  func drain() { RunLoop.main.run(until:Date().addingTimeInterval(0.25)) }
  for (mode,expanded) in [("ready",false),("ready",true),("waiting",false),("auth_required",false),("auth_expired",false),("failed",false),("unknown",false),("verifying",false)] {
   owner.snapshot = snapshot(mode)
   owner.error = ["auth_required","auth_expired","failed"].contains(mode) ? "测试状态：请重新检测" : nil
   owner.controlErrorCode = mode
   owner.controlsExpanded = expanded; owner.resizeControls()
   let size = NSSize(width:360,height:owner.controlHeight)
   window.setContentSize(size);host.setFrameSize(size);window.makeKeyAndOrderFront(nil);drain();host.layoutSubtreeIfNeeded();drain()
   precondition(host.bounds.width == 360 && host.bounds.height == owner.controlHeight)
   let bitmap = host.bitmapImageRepForCachingDisplay(in:host.bounds)!
   host.cacheDisplay(in:host.bounds,to:bitmap)
   let file = CommandLine.arguments[1]+"/"+mode+(expanded ? "-expanded" : "")+".png"
   try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:file))
   print("PASS control render",mode,expanded ? "expanded" : "collapsed")
  }
  // 在测试Bundle的独立偏好域验证现有动作，不开启提醒、自动更新或真实登录项。
  owner.lastAttempt = Date(); owner.ipLastAttempt = Date()
  UserDefaults.standard.set(owner.appVersion,forKey:"updateCheckedVersion")
  UserDefaults.standard.set(Date().timeIntervalSince1970,forKey:"updateLastAttempt")
  let oldClock = owner.clockEnabled
  owner.toggleClock()
  precondition(owner.clockEnabled != oldClock && UserDefaults.standard.bool(forKey:"clockEnabled") == owner.clockEnabled)
  owner.toggleClock()
  precondition(owner.setTimeZone("Asia/Shanghai",cityName:"上海"))
  precondition(owner.clock.zone.identifier == "Asia/Shanghai" && !owner.followIPTimeZone)
  owner.receiveIPTimeZone("America/Los_Angeles",city:"Los Angeles")
  owner.followIPTimeZone = true;owner.applyClockTimeZone()
  precondition(owner.clock.cityName == "Los Angeles")
  owner.receiveIPTimeZone(nil)
  precondition(owner.clock.cityName == "上海")
  owner.snapshot = snapshot("ready");owner.error = nil
  let selected = NSMenuItem();selected.representedObject = controlProduct == "Codex" ? "weekly" : "seven_day:primary";owner.selectPercentage(selected)
  precondition(owner.ring.showWeeklyPercentage)
  print("PASS control settings clock/timezone/IP fallback/percentage")
  func pressMore() {
   let point = NSPoint(x:80,y:host.isFlipped ? host.bounds.height-21 : 21)
   let location = host.convert(point,to:nil)
   for type in [NSEvent.EventType.leftMouseDown,.leftMouseUp] {
    let event = NSEvent.mouseEvent(with:type,location:location,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,eventNumber:1,clickCount:1,pressure:1)!
    NSApp.sendEvent(event)
   }
   drain()
  }
  owner.controlsExpanded = false;owner.resizeControls()
  window.setContentSize(NSSize(width:360,height:owner.controlHeight));drain()
  pressMore()
  precondition(owner.controlsExpanded,"更多设置真实点击未展开")
  window.setContentSize(NSSize(width:360,height:owner.controlHeight));drain()
  pressMore()
  precondition(!owner.controlsExpanded,"收起设置真实点击未收起")
  print("PASS real mouse press: more settings expand/collapse")
  owner.status = NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
  let statusButton = owner.status!.button!
  statusButton.image = controlIcon(); statusButton.title = "77%"
  statusButton.target = owner; statusButton.action = #selector(Overlay.openControls)
  owner.controlPopover.contentViewController = NSHostingController(rootView:ControlPanelView(owner:owner))
  owner.controlPopover.behavior = .transient;owner.controlPopover.animates = false
  statusButton.performClick(nil);drain()
  precondition(owner.controlPopover.isShown,"状态栏点击未打开面板")
  precondition(!owner.controlsExpanded)
  statusButton.performClick(nil);drain()
  precondition(!owner.controlPopover.isShown,"状态栏点击未关闭面板")
  NSStatusBar.system.removeStatusItem(owner.status!)
  print("PASS real status item click opens/closes popover")
  window.orderOut(nil)
 }
}
'''
with tempfile.TemporaryDirectory(prefix=name+'-controls-') as temporary:
 work=Path(temporary);app=work/'Controls.app';contents=app/'Contents';binary=contents/'MacOS/controls';binary.parent.mkdir(parents=True)
 (contents/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':domain,'CFBundleExecutable':'controls','CFBundlePackageType':'APPL','LSUIElement':True,'CFBundleShortVersionString':'1.0.1'}))
 source=work/'Controls.swift';source.write_text((root/'native/Overlay.swift').read_text().split('@main\nstruct Main')[0]+entry)
 try:
  compile_result=subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path',str(output/'swift-cache'),str(source),'-o',str(binary),'-framework','AppKit'],capture_output=True,text=True)
  if compile_result.returncode:
   print(compile_result.stderr,flush=True)
   raise SystemExit(compile_result.returncode)
  subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
  subprocess.run([str(binary),str(output)],check=True,timeout=60)
 finally:
  subprocess.run(['defaults','delete',domain],capture_output=True)
print('PASS isolated control UI:',name,'previews:',output)
