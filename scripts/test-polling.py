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
  owner.automaticUsageRefresh=false
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
  func check(_ elapsed:Double, due:Bool, shouldQuery:Bool, reminder:Bool=false, foreground:Bool=false) {
   var changed=raw;changed["resetsAt"]=due ? now-1 : now+3600
   var sample=payload;sample["windows"]=[changed]
   owner.snapshot=try! JSONDecoder().decode(Snapshot.self,from:JSONSerialization.data(withJSONObject:sample))
   owner.reminder=reminder ? AvailabilityReminder(ids:[row.id],due:now-1) : nil
   owner.lastAttempt=Date().addingTimeInterval(-elapsed)
   let before=owner.lastAttempt
   if foreground { owner.maybeAutoRefreshUsage(foreground: true) } else { owner.tick() }
   precondition((owner.query != nil) == shouldQuery)
   if !shouldQuery {precondition(owner.lastAttempt == before)}
   let deadline=Date().addingTimeInterval(5)
   while owner.query != nil && Date()<deadline { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
   precondition(owner.query == nil)
   precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier == front)
  }
  check(599,due:false,shouldQuery:false,foreground:true)
  check(601,due:false,shouldQuery:false,foreground:true)
  check(179,due:true,shouldQuery:false,foreground:true)
  check(181,due:true,shouldQuery:false,foreground:true)
  check(179,due:false,shouldQuery:false,reminder:true)
  check(181,due:false,shouldQuery:false,reminder:true)
  check(86400,due:true,shouldQuery:false,reminder:true)
  owner.automaticUsageRefresh=true
  // 后台无前台窗口且已有快照时不空转，仅提醒到点允许后台确认。
  check(601,due:false,shouldQuery:false)
  check(181,due:true,shouldQuery:false)
  check(179,due:false,shouldQuery:false,reminder:true)
  check(181,due:false,shouldQuery:true,reminder:true)
  // 前台活跃时按 600s 正常 / 180s 到期确认轮询。
  check(599,due:false,shouldQuery:false,foreground:true)
  check(601,due:false,shouldQuery:true,foreground:true)
  check(179,due:true,shouldQuery:false,foreground:true)
  check(181,due:true,shouldQuery:true,foreground:true)
  // 登录失效后停止自动轮询。
  owner.controlErrorCode="auth_expired"
  check(86400,due:true,shouldQuery:false,foreground:true)
  owner.controlErrorCode=nil
  // 开启出口 IP 保护且未放通时拦截自动与手动额度查询。
  owner.protectionEnabled=true
  owner.protectionReport=nil
  check(86400,due:true,shouldQuery:false,foreground:true)
  owner.refresh()
  precondition(owner.query == nil && owner.error != nil)
  owner.protectionEnabled=false
  owner.error=nil
  owner.usageSchedule.nextAllowedAt=now+900
  check(86400,due:true,shouldQuery:false,foreground:true)
  owner.usageSchedule.nextAllowedAt=0
  owner.automaticUsageRefresh=false
  owner.reminder=nil
  owner.refresh()
  precondition(owner.query != nil,"手动刷新必须保留")
  let manualDeadline=Date().addingTimeInterval(5)
  while owner.query != nil && Date()<manualDeadline { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
  precondition(owner.query == nil)
  owner.reminder=nil;owner.snapshot!.windows=[row]
  owner.snapshot!.fetchedAt=Date().timeIntervalSince1970-1199
  owner.error=nil
  precondition(owner.currentControlState().mode == "ready")
  owner.snapshot!.fetchedAt=Date().timeIntervalSince1970-1201
  precondition(owner.currentControlState().mode == "unknown")
  print("PASS actual tick: off never polls, background idle skips, foreground 600/180s, auth/protection gates, cooldown, manual refresh, stale 1199/1201s; no foreground change")
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
