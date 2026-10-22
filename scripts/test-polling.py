# -*- coding: utf-8 -*-
"""实际tick边界检查，无前台窗口、不读取账号或查询网络。"""
import json, shutil, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
entry=r'''
@main struct PollingChecks {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  let owner = Overlay()
  owner.node=CommandLine.arguments[1];owner.script=CommandLine.arguments[2]
  owner.searchPath=ProcessInfo.processInfo.environment["PATH"] ?? ""
  owner.ipLastAttempt=Date();owner.versionCheck=Process();owner.reminderSending=true
  let now=Date().timeIntervalSince1970
  let raw:[String:Any]=["id":controlProduct == "Codex" ? "codex:primary" : "seven_day:primary","label":"Weekly","name":"Weekly","remaining":50,"resetsAt":now+3600,"windowDurationMins":10080]
  let payload:[String:Any]=["windows":[raw],"fetchedAt":now]
  let data=try JSONSerialization.data(withJSONObject:payload)
  try ("console.log(JSON.stringify("+String(decoding:data,as:UTF8.self)+"))").write(toFile:owner.script,atomically:true,encoding:.utf8)
  owner.snapshot=try JSONDecoder().decode(Snapshot.self,from:data)
  let row=owner.snapshot!.windows[0]
  let front=NSWorkspace.shared.frontmostApplication?.processIdentifier
  func check(_ elapsed:Double, due:Bool, shouldQuery:Bool, reminder:Bool=false) {
   var changed=raw;changed["resetsAt"]=due ? now-1 : now+3600
   var sample=payload;sample["windows"]=[changed]
   owner.snapshot=try! JSONDecoder().decode(Snapshot.self,from:JSONSerialization.data(withJSONObject:sample))
   owner.reminder=reminder ? AvailabilityReminder(ids:[row.id],due:now-1) : nil
   owner.lastAttempt=Date().addingTimeInterval(-elapsed)
   let before=owner.lastAttempt
   owner.tick()
   precondition((owner.query != nil) == shouldQuery)
   if !shouldQuery {precondition(owner.lastAttempt == before)}
   let deadline=Date().addingTimeInterval(5)
   while owner.query != nil && Date()<deadline { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
   precondition(owner.query == nil)
   precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier == front)
  }
  check(299,due:false,shouldQuery:false)
  check(301,due:false,shouldQuery:true)
  check(59,due:true,shouldQuery:false)
  check(61,due:true,shouldQuery:true)
  check(59,due:false,shouldQuery:false,reminder:true)
  check(61,due:false,shouldQuery:true,reminder:true)
  owner.reminder=nil;owner.snapshot!.windows=[row]
  owner.snapshot!.fetchedAt=Date().timeIntervalSince1970-599
  owner.error=nil
  precondition(owner.currentControlState().mode == "ready")
  owner.snapshot!.fetchedAt=Date().timeIntervalSince1970-601
  precondition(owner.currentControlState().mode == "unknown")
  print("PASS actual tick: normal 299/301s, reset/reminder 59/61s, stale 599/601s; no foreground change")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='easy-polling-') as temporary:
    work=Path(temporary)
    source=(root/'native/Overlay.swift').read_text().split('@main\nstruct Main')[0]
    start=source.index('@MainActor\nfunc targetWindow()');end=source.index('@MainActor\nclass RingView',start)
    source=source[:start]+'@MainActor\nfunc targetWindow() -> CGRect? { nil }\n\n'+source[end:]
    swift=work/'Polling.swift';swift.write_text(source+entry)
    binary=work/'polling-checks'
    subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path','/tmp/easy-period-swift-cache',str(swift),'-o',str(binary),'-framework','AppKit'],check=True)
    subprocess.run([str(binary),shutil.which('node'),str(work/'query.cjs')],check=True,timeout=30)
