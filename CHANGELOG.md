# 更新记录

## 1.1.0

- Use a fixed local proxy for normal Claude startup; withdraw the outer desktop sandbox after nested-sandbox helper crashes. Fail closed when the switch is off or IP verification is invalid. Official proxy coverage exceptions remain documented.

- Add the exit IP protection switch, local gateway and protected Claude Code launch entry (development; real Claude acceptance pending).
- Add Launch Claude immediately before Quit; never close an existing desktop automatically.
- Add a persistent automatic usage refresh switch, off by default; retain manual refresh and HTTP 429 cooldowns.
- Group Network & protection; synchronize the displayed exit with protection checks and hide stale IPs on failure. Collapse configuration into More settings.

## 1.0.3

- Refresh usage every five minutes; keep one-minute online confirmation when a reset or availability alert is due.
- Keep usage valid between polls with a ten-minute stale-data threshold; errors and expired windows remain explicit.
- HTTP 429 pauses queries for 10 minutes, then up to 15 minutes; success restores normal polling. Manual and reminder queries obey the same cooldown.
- Keep the half-size AM/PM or Chinese day period beside the floating time, with the city below.
- Verify background quota refresh with isolated continuous-typing and marked-text checks; do not activate the official application.

## 1.0.2

- Refresh usage every minute. HTTP 429 pauses all refresh entry points for 2/4/8/15 minutes (capped); successful queries restore the normal interval.

- Add Chinese/English interface and CLI text, following the system by default with a saved manual language choice.
- Use English README.md with a linked README.zh-CN.md; include both in the package.
- Show floating time before AM/PM (Chinese day period in Chinese); suffix font is half the numeric font size. Keep the city below and preserve the system hour format.
- Align settings row heights and vertical spacing across both languages.
- Halve the blank space below the network exit in the collapsed Claude panel.

## v1.0.1（2026-10-22，America/Los_Angeles）

- 状态栏改为模板图标＋剩余百分比；任一已知总额度耗尽时改显示恢复倒计时，多个耗尽窗口取较晚恢复时间。重置时刻到达后先在线确认，不直接宣称恢复。
- 左键打开原生控制面板。收起时仅显示额度与时间、网络出口、更多设置和退出；更多设置原位展开，屏幕高度不足时可滚动，右键保留兼容菜单。
- 展开区集中提供显示时间、IP时区跟随、手动时区、恢复位置、一次性提醒、开机启动、自动更新及检查并更新。关闭IP时区跟随后才显示手动时区。
- 未登录和登录过期提供对应登录命令的复制及重新检测；网络、403等查询异常独立提示，不当作耗尽。时间、IP及设置仍可使用，不自动运行登录命令。
- 额度在后台按原频率刷新，Codex约60秒、Claude约5分钟；保留时区、位置、中心额度和所有开关设置，不替用户启用提醒、登录启动或自动更新。


## v0.3.4（2026-10-22，America/Los_Angeles）

- 12小时制按所选时区显示五个时段：00:00–06:00 凌晨、06:00–12:00 上午、12:00–18:00 下午、18:00–21:00 晚上、21:00–24:00 深夜。
- 零点显示 `00:12`，不再显示 `12:12`；正午仍显示 `12:12`。24小时制及额度重置时间的系统格式保持不变。
- 菜单新增“开机启动”，默认关闭；手动开启后，登录当前macOS用户会自动打开浮窗。关闭取消后续登录启动，不结束当前浮窗。
- 使用独立的用户级LaunchAgent，无需管理员权限，不修改官方应用。原时区、位置、提醒及更新设置继续保留。

## v0.3.3（2026-10-20，America/Los_Angeles）

- 改为只请求一次 `https://ipinfo.io/json`，同时获取当前网络出口的公网IP、城市和时区；继续支持环境及系统HTTPS代理。
- 跟随IP时区时，浮窗时间下方显示接口返回的城市名称，例如 `Los Angeles`，不再显示“IP时区”；时间仍按接口返回的时区计算。
- 城市名称居中，最大宽度不超过时间文字的实际宽度，过长自动缩小字号。
- 获取不到IP或有效时区时继续显示自定义时区时间；城市缺失显示“城市未知”。不改变已保存的时区、位置和开关。

## v0.3.1（2026-10-20，America/Los_Angeles）

- 新增“跟随IP时区”开关，默认关闭；开启后自动显示网络出口时区时间并隐藏手动时区选择，关闭恢复原城市和时区。
- 获取不到IP或有效时区时显示自定义时区的时间；开关保持开启，后续获取成功自动继续跟随。继续支持系统12/24小时制与夏令时。
- IP菜单改为“城市名称·IP地址”，无空格；IP获取失败仍显示“IP异常”。城市和时区通过已验证IP查询地理信息，不按城市猜测时区。

## v0.2.12（2026-10-21）

- 菜单新增公网IP和城市，固定从ip.sb获取IP，再查询该IP的出口城市；启动及每5分钟刷新，点击地址可立即刷新。
- 获取不到IP时显示“IP异常”；仅城市查询失败时保留IP并显示“城市未知”。支持IPv4/IPv6和现有环境/系统HTTPS代理，不保存IP历史。

## v0.2.11（2026-10-21）

- 新增一次性“额度可用提醒”：同时受5小时和周额度限制时，等待较晚的恢复时间，在线确认全部可用后发送系统通知和提示音，随后自动关闭。
- 提醒状态跨重启保存；关闭即取消，断网或查询失败继续等待，目标窗口缺失或额度未知时不误报。
- 更新锁改为系统内核锁，异常强退后自动释放；安装仍在运行时保持排他，旧锁目录无需手动清理。

## v0.2.8（2026-10-21）

- 当前时间浮窗和城市菜单跟随系统12/24小时制及地区格式，保留所选城市时区；字体自动适应宽度，避免上午/下午标记截断。

## v0.2.7（2026-10-21）

- 修复旧浮窗退出后日志清理失效；检查失败保留上次成功的新版提示并显示检查失败状态。

- 新增菜单“自动更新”开关，默认关闭并保存选择；开启后每日检查到新版自动安装并重开，失败只在菜单提示。更新锁防止同一安装前缀的多个Easy更新进程并发安装。

- 额度菜单重置时间跟随系统12/24小时制及AM/PM显示，保持原时区、日期和倒计时规则。

- 更新前在线判断版本，已最新时提示“已经是最新版本”，不安装也不重开；有新版并安装成功才自动重开。

## v0.2.6（2026-10-19）

- 菜单显示“更新版本·当前版本号”，每天检查一次官方 npm，有新版时右侧显示绿色圆点；检查记录跨重启保存，只提示、不自动安装。
- 命令行 update 成功后自动重开浮窗，与菜单更新一致。
- 新增大写 -V 显示版本号，保留 -v 与 --version。

## v0.2.5（2026-10-19）

- 菜单新增“更新版本”：后台复用 update，防重复点击；成功后自动重开浮窗，失败保留当前浮窗并提示，设置保持不变。

## 0.2.4 — 2026-10-19

### 修复

- update先在线刷新latest并比较版本，按明确版本号安装，防止旧缓存降级；相同或更高的本地版本不安装，检查失败明确报错。
- 保留上一版新增的update、show自动重开和绿色时段延长至18:00。


## 0.2.3 — 2026-10-19

### 新增

- 新增 `easy-claude update`，复用npm升级当前安装目录中的正式包。
- `show` 自动退出自身旧浮窗并打开新版，保留现有设置；无法退出旧实例时明确失败，避免重复窗口。

### 调整

- 两个工具统一所选城市的时间颜色：00:00–09:00红、09:00–18:00绿、18:00–24:00橙。
- 将绿色结束/橙色开始从15:00调整至18:00；午夜与09:00切换点不变，仍自动处理夏令时。
- 保留升级前的时区、城市、位置和显示选择，额度圆环颜色规则保持原样。
- README与版本说明随包交付，保留show快捷启动和overlay兼容。
