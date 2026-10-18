# easy-claude 工作约定

- 本文件与 MEMORY.md 由 Codex 与 Claude Code 共用；开始或恢复读取记忆，处理子目录前检查局部规则；阶段结束合并更新记忆并注明时区和工具。
- 无依赖 Node.js >=22 CLI，额度数据转换复用 easy-codex 的展示协议；Swift 6 AppKit 浮窗跟随 com.anthropic.claudefordesktop，32×32、透明、默认左侧。
- usage/overlay 仅查询 Claude Code 订阅额度，不查询 API 账单或创建模型会话。OAuth 凭据只在内存中用于 api.anthropic.com 的额度请求，不记录、输出、修改或刷新凭据。禁止向自定义服务转发令牌。
- 非公开稳定额度接口可能变化；缺失数据不得伪装满额。过期登录明确提示用户执行 claude auth login，桌面账号须用户核对一致。
- 根目录 npm test；macOS npm run build:overlay 构建双架构应用并自检。仅数据读取可跨平台，浮窗 macOS 14+。
- 公开仓库 UnionSchool/easy-claude，origin；npm 无作用域包 easy-claude。发布须用户授权：升级版本并提交、推送 main 与对应 v 标签，release.yml 自动构建和发布；npm Environment 显示 Deployment，发布后核实注册表和公开安装。
- NPM_TOKEN 使用 Easy 系列共用 Token，2026-10-17 起 90 天，预计 2027-01-15 到期，以 npm 实际有效期和包权限为准。不得从其他仓库导出 Secret；缺少时由用户在 GitHub 安全配置。

## 电子时钟

- 复用原生 Overlay 进程新增独立透明时钟面板，跟随 Claude 前台窗口。默认硅谷 America/Los_Angeles；DateFormatter 按 IANA 时区转换，自动处理夏令时，不修改系统时区。
- 右键或 EA 菜单设置时区、显示开关；UserDefaults 保留时区与独立位置。构建自检覆盖洛杉矶冬夏时间、新加坡时间及无效时区。
- 时钟仅显示 HH:mm；按所选时区当地时间：00:00–09:00 红、09:00–15:00 绿、15:00–24:00 橙。
- 城市菜单顺序固定：硅谷、洛杉矶、西雅图、华盛顿（特区）、哥伦布（俄亥俄州）、新加坡、上海。城市名称和 IANA 时区独立保存，不能按时区去重城市。
- macOS 额度请求遵循现有环境 HTTPS/ALL 代理或系统 HTTPS 代理；通过系统 curl 标准输入传递请求配置，禁止令牌进入 argv/文件、关闭 TLS 校验或跟随重定向。401 与 403 分别提示，不能将 403 认定为登录过期。
- 额度浮窗保持 32×32，周总额度 seven_day:primary 为外环，five_hour:primary 为内环，中心数字默认5小时剩余，可从菜单切换周额度并保留选择；独立判断过期，不用模型子额度替代总额度。
- 双环剩余弧线均为实线，外周额度3px、内5小时2px，同色通过粗细及内外位置区分；外环底轨淡色虚线；中心默认5小时，菜单可切换为周额度。默认窗口内左下角，圆环偏移(138,4)，时钟(164,0)，时钟96×46；已有位置保留，菜单恢复默认位置应用新布局。
- 菜单按5小时、周排序，显示“名称 · 剩余百分比 · 重置 MM-dd HH:mm”；重置用电脑本地时区，与独立时钟时区区分；点击只切换中心数字，双环不变。
- 环内只显示剩余数字，不带百分号；菜单和悬停仍使用百分比。
