# easy-claude 工作约定

- 本文件与 MEMORY.md 由 Codex 与 Claude Code 共用；开始或恢复读取记忆，处理子目录前检查局部规则；阶段结束合并更新记忆并注明时区和工具。
- 无依赖 Node.js >=22 CLI，额度数据转换复用 easy-codex 的展示协议；Swift 6 AppKit 浮窗跟随 com.anthropic.claudefordesktop，32×32、透明、默认左侧。
- 仅查询 Claude Code 订阅额度，不查询 API 账单或创建模型会话。OAuth 凭据只在内存中用于 api.anthropic.com 的额度请求，不记录、输出、修改或刷新凭据。禁止向自定义服务转发令牌。
- 非公开稳定额度接口可能变化；缺失数据不得伪装满额。过期登录明确提示用户执行 claude auth login，桌面账号须用户核对一致。
- 根目录 npm test；macOS npm run build:overlay 构建双架构应用并自检。仅数据读取可跨平台，浮窗 macOS 14+。
- 公开仓库 UnionSchool/easy-claude，origin；npm 无作用域包 easy-claude。发布须用户授权：升级版本并提交、推送 main 与对应 v 标签，release.yml 自动构建和发布；npm Environment 显示 Deployment，发布后核实注册表和公开安装。
- NPM_TOKEN 使用 Easy 系列共用 Token，2026-10-17 起 90 天，预计 2027-01-15 到期，以 npm 实际有效期和包权限为准。不得从其他仓库导出 Secret；缺少时由用户在 GitHub 安全配置。
