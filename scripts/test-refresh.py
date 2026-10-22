"""无前台窗口的额度刷新退避检查：模拟响应，不读取账号或发起网络请求。"""
import json, shutil, subprocess, tempfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
entry = r'''
@main struct RefreshChecks {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  var schedule = UsageRefreshSchedule()
  for delay: Double in [600, 900, 900] {
   schedule.receive(rateLimited:true,succeeded:false,now:1000)
   precondition(schedule.nextAllowedAt == 1000 + delay)
   precondition(!schedule.allows(1000 + delay - 0.001) && schedule.allows(1000 + delay))
  }
  schedule.receive(rateLimited:false,succeeded:false,now:2000)
  precondition(schedule.rateLimitCount == 2)
  schedule.receive(rateLimited:false,succeeded:true,now:3000)
  precondition(schedule.rateLimitCount == 0 && schedule.allows(3000))
  let owner = Overlay()
  owner.node = CommandLine.arguments[1]; owner.script = CommandLine.arguments[2]
  owner.searchPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
  let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
  for failed in [true,true,false] {
   owner.usageSchedule.nextAllowedAt = 0 // 模拟冷却结束，不等待真实分钟。
   let now = Date().timeIntervalSince1970
   let value: [String:Any] = failed ? ["error":"rate limited", "errorCode":"rate_limited"] : ["windows":[["id":"seven_day:primary","name":"Weekly","label":"Weekly","remaining":50,"resetsAt":now+7200,"windowDurationMins":10080]],"fetchedAt":now]
   let json = try JSONSerialization.data(withJSONObject:value)
   try ("console.log(JSON.stringify(" + String(decoding:json,as:UTF8.self) + "))").write(toFile:owner.script,atomically:true,encoding:.utf8)
   owner.refresh()
   let query = owner.query
   precondition(query != nil)
   owner.refresh()
   precondition(owner.query === query) // 在途请求不能重叠。
   let deadline = Date().addingTimeInterval(5)
   while owner.query != nil && Date() < deadline { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
   precondition(owner.query == nil)
   if failed {
    precondition(owner.currentControlState().mode == "rate_limited")
    let attempt = owner.lastAttempt
    owner.refresh()
    precondition(owner.query == nil && owner.lastAttempt == attempt) // 手动/提醒同走这个入口。
   } else {
    precondition(owner.usageSchedule.rateLimitCount == 0 && owner.usageSchedule.nextAllowedAt == 0)
    precondition(owner.error == nil)
   }
   precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier == front)
  }
  print("PASS 300-second schedule: 429 backoff 10/15m, cooldown gate, in-flight guard, success recovery; foreground app unchanged")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='easy-claude-refresh-') as temporary:
    work = Path(temporary)
    source = work/'Refresh.swift'
    source.write_text((root/'native/Overlay.swift').read_text().split('@main\nstruct Main')[0]+entry)
    cache = root/'native/build/refresh-test-cache'; cache.mkdir(parents=True, exist_ok=True)
    binary = work/'refresh-checks'
    subprocess.run(['xcrun','swiftc','-swift-version','6','-parse-as-library','-module-cache-path',str(cache),str(source),'-o',str(binary),'-framework','AppKit'],check=True)
    subprocess.run([str(binary),shutil.which('node'),str(work/'query.cjs')],check=True,timeout=30)
