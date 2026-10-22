# -*- coding: utf-8 -*-
"""隔离输入焦点验证：两个进程，真实AppKit键盘/组字事件，模拟额度响应。"""
import json, os, plistlib, shutil, subprocess, sys, tempfile, time, uuid, signal
from pathlib import Path
root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
name = json.loads((root/'package.json').read_text())['name']
product = name.removeprefix('easy-')
host_source = r'''
import AppKit
@MainActor final class TypingHost: NSObject, NSApplicationDelegate {
 let root = URL(fileURLWithPath:CommandLine.arguments[1])
 let window = NSWindow(contentRect:NSRect(x:220,y:220,width:700,height:380),styleMask:[.titled,.closable],backing:.buffered,defer:false)
 let text = NSTextView(frame:NSRect(x:30,y:55,width:640,height:285))
 var expected = "", keys = 0, checks = 0
 var started: Date?, setup = Date(), ready = false, finished = false, marked = false, committed = false
 var markStart = 0
 func write(_ value:[String:Any], _ file:String) { try! JSONSerialization.data(withJSONObject:value).write(to:root.appendingPathComponent(file),options:.atomic) }
 func applicationDidFinishLaunching(_ note:Notification) {
  window.title = "Easy 输入焦点测试 — 自动输入，仅含测试文字"
  text.isRichText = false; text.font = .monospacedSystemFont(ofSize:18,weight:.regular)
  window.contentView!.addSubview(text)
  window.makeKeyAndOrderFront(nil);window.makeFirstResponder(text)
  NSApp.activate(ignoringOtherApps:true)
  Timer.scheduledTimer(timeInterval:0.05,target:self,selector:#selector(step),userInfo:nil,repeats:true)
 }
 func focusOK() -> Bool {
  NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier && window.isKeyWindow && NSApp.keyWindow === window && window.firstResponder === text
 }
 func fail(_ reason:String) {
  write(["ok":false,"reason":reason,"keys":keys,"checks":checks],"result.json")
  finished = true
 }
 @objc func step() {
  if FileManager.default.fileExists(atPath:root.appendingPathComponent("stop").path) { NSApp.terminate(nil);return }
  if finished { return }
  if !ready {
   if focusOK() { ready = true;write(["pid":getpid()],"ready.json") }
   else if Date().timeIntervalSince(setup) > 15 { fail("Cannot establish initial input focus");return }
   else { return }
  }
  guard focusOK() else { fail("Foreground app, key window or first responder changed");return }
  guard FileManager.default.fileExists(atPath:root.appendingPathComponent("start").path) else { return }
  if started == nil { started = Date() }
  let elapsed = Date().timeIntervalSince(started!)
  checks += 1
  guard text.string == expected else { fail("Input text was lost or changed");return }
  guard text.selectedRange() == NSRange(location:(expected as NSString).length,length:0) else { fail("Caret moved unexpectedly");return }
  if marked {
   guard text.hasMarkedText() && text.markedRange() == NSRange(location:markStart,length:8) else { fail("Chinese composition was interrupted");return }
  }
  if elapsed >= 12 {
   write(["ok":true,"keys":keys,"checks":checks,"compositionCommitted":committed,"pid":getpid()],"result.json");finished = true;return
  }
  if elapsed >= 3 && !committed {
   if !marked {
    markStart = (expected as NSString).length
    text.setMarkedText("zhongwen",selectedRange:NSRange(location:8,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
    expected += "zhongwen";marked = true
   } else if elapsed >= 6 {
    text.insertText("中文",replacementRange:NSRange(location:markStart,length:8));text.unmarkText()
    expected = (expected as NSString).substring(to:markStart) + "中文";marked = false;committed = true
   }
  } else {
   let char = keys % 13 == 12 ? " " : String(keys % 10)
   let event = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:char,charactersIgnoringModifiers:char,isARepeat:false,keyCode:0)!
   NSApp.sendEvent(event);expected += char;keys += 1
  }
  guard focusOK() && text.string == expected && text.selectedRange() == NSRange(location:(expected as NSString).length,length:0) else { fail("Keystroke or caret not preserved");return }
 }
}
@main struct Main {
 @MainActor static func main() {
  let app = NSApplication.shared;app.setActivationPolicy(.regular)
  let owner = TypingHost();app.delegate = owner;app.run()
 }
}
'''
probe_entry = r'''
@MainActor final class ProbeDriver: NSObject {
 let owner: Overlay
 let root = URL(fileURLWithPath:ProcessInfo.processInfo.environment["EASY_FOCUS_ROOT"]!)
 var last = Date.distantPast
 init(_ owner:Overlay) { self.owner = owner }
 @objc func step() {
  if FileManager.default.fileExists(atPath:root.appendingPathComponent("stop").path) { NSApp.terminate(nil);return }
  owner.ipLastAttempt = Date()
  let count = (try? String(contentsOf:root.appendingPathComponent("count"),encoding:.utf8)).flatMap { Int($0) } ?? 0
  if count < 10 && owner.query == nil && Date().timeIntervalSince(last) >= 0.7 {
   // 虚拟推进查询到期时刻；不直接调用refresh，仍由生产tick定时分支触发。
   owner.lastAttempt = Date().addingTimeInterval(-301)
   // CLAUDE_COOLDOWN
   last = Date()
  }
 }
}
@main struct Main {
 @MainActor static func main() {
  let app = NSApplication.shared;app.setActivationPolicy(.accessory)
  let owner = Overlay();app.delegate = owner
  owner.ipLastAttempt = Date()
  UserDefaults.standard.set(owner.appVersion,forKey:"updateCheckedVersion")
  UserDefaults.standard.set(Date().timeIntervalSince1970,forKey:"updateLastAttempt")
  let driver = ProbeDriver(owner)
  Timer.scheduledTimer(timeInterval:0.05,target:driver,selector:#selector(ProbeDriver.step),userInfo:nil,repeats:true)
  app.run()
 }
}
'''
with tempfile.TemporaryDirectory(prefix=name+'-typing-') as temporary:
    work = Path(temporary); prefix='com.unionschool.focus-'+uuid.uuid4().hex
    host_id=prefix+'.typing';probe_id=prefix+'.overlay'
    def make_app(label,bundle,source):
        app=work/(label+'.app'); contents=app/'Contents';binary=contents/'MacOS'/label;binary.parent.mkdir(parents=True)
        (contents/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':bundle,'CFBundleExecutable':label,'CFBundlePackageType':'APPL','CFBundleName':label,'CFBundleShortVersionString':'0.0.1','LSUIElement':label!='Typing'}))
        swift=work/(label+'.swift');swift.write_text(source)
        compilation=subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path','/tmp/easy-period-swift-cache',str(swift),'-o',str(binary),'-framework','AppKit'],capture_output=True,text=True)
        if compilation.returncode:raise RuntimeError(compilation.stderr)
        subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
        return app,binary
    source=(root/'native/Overlay.swift').read_text().split('@main\nstruct Main')[0]
    start=source.index('@MainActor\nfunc targetWindow()');end=source.index('@MainActor\nclass RingView',start)
    # 仅把官方窗口依赖替换为隔离Typing窗口；tick、非激活浮窗与刷新回调均为实际源码。
    target='@MainActor\nfunc targetWindow() -> CGRect? {\n guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == '+json.dumps(host_id)+' else { return nil };return CGRect(x:220,y:220,width:700,height:380)\n}\n\n'
    source=source[:start]+target+source[end:]
    entry=probe_entry.replace('// CLAUDE_COOLDOWN','owner.usageSchedule.nextAllowedAt = 0' if product=='claude' else '')
    host,host_bin=make_app('Typing',host_id,host_source)
    probe,probe_bin=make_app('OverlayProbe',probe_id,source+entry)
    script=work/'query.cjs'
    script.write_text('''const fs=require('node:fs');const path='''+json.dumps(str(work/'count'))+''';let n=0;try{n=+fs.readFileSync(path,'utf8')}catch{};fs.writeFileSync(path,String(n+1));const now=Date.now()/1000;let out={windows:[{id:'''+json.dumps('codex:primary' if product=='codex' else 'seven_day:primary')+''',name:'Weekly',label:'Weekly',remaining:n%3===2?0:77-n,resetsAt:now+3600,windowDurationMins:10080}],fetchedAt:now};if(n===2)out={error:'simulated network failure',errorCode:'query_failed'};if(n===4)out={error:'simulated expired login',errorCode:'auth_expired'};if(n===6)out={error:'simulated rate limit',errorCode:'rate_limited'};setTimeout(()=>console.log(n===8?'invalid JSON':JSON.stringify(out)),150);''')
    (work/'overlay-ip.js').write_text("console.log(JSON.stringify({ip:'203.0.113.18',city:'Test city',timezone:'America/Los_Angeles'}));")
    (work/'check-update.js').write_text('console.log(JSON.stringify({available:false}));')
    child=None;result=None
    # shortcut: 使用AppKit键盘及组字事件；需要具体物理键盘/输入法候选面板验收时另补人工测试。
    try:
        subprocess.run(['open','-n',str(host),'--args',str(work)],check=True)
        deadline=time.monotonic()+20
        while not (work/'ready.json').exists():
            if (work/'result.json').exists():raise RuntimeError((work/'result.json').read_text())
            if time.monotonic()>deadline:raise TimeoutError('Typing app could not establish focus')
            time.sleep(.05)
        env=dict(os.environ,EASY_FOCUS_ROOT=str(work))
        child=subprocess.Popen([str(probe_bin),shutil.which('node'),str(script),os.environ.get('PATH','')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        (work/'start').touch()
        deadline=time.monotonic()+20
        while not (work/'result.json').exists():
            if child.poll() is not None:raise RuntimeError('Overlay probe exited: '+child.stderr.read().decode()[-1000:])
            if time.monotonic()>deadline:raise TimeoutError('Typing test timeout')
            time.sleep(.05)
        result=json.loads((work/'result.json').read_text());result['queries']=int((work/'count').read_text());result['product']=product
        Path('/tmp/easy-typing-'+product+'-result.json').write_text(json.dumps(result,indent=2))
        assert result['ok'] and result['compositionCommitted'] and result['queries']>=8,result
        print(json.dumps(result),flush=True)
    finally:
        (work/'stop').touch()
        if child is not None:
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.terminate();child.wait(timeout=5)
        ready_file=work/'ready.json'
        if ready_file.exists():
            host_pid=json.loads(ready_file.read_text())['pid']
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                try:os.kill(host_pid,0)
                except ProcessLookupError:break
                time.sleep(.05)
            else:
                try:os.kill(host_pid,signal.SIGTERM)
                except ProcessLookupError:pass
        # 只清理本次随机Bundle偏好域，不操作正式配置。
        for domain in [host_id,probe_id]:subprocess.run(['defaults','delete',domain],capture_output=True)
