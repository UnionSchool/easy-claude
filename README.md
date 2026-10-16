# easy-claude

查看 Claude Code 订阅剩余额度，并在 Claude 桌面应用旁显示透明彩色圆环。第三方辅助工具，与 Anthropic 无官方隶属关系。

需要 Node.js 22+ 与 Claude Code 订阅登录；不支持把 API Key 账单余额当作订阅额度。

## 安装与使用

```sh
npm i -g easy-claude
easy-claude
easy-claude overlay
```

读取 Claude Code 登录账号，桌面端请使用同一账号。登录不存在或过期时，执行 `claude auth login` 后重试。仅安装 Claude 桌面端、没有 Claude Code 登录时不能查询。

## 圆环

- macOS 14+；跟随 Claude 桌面应用窗口，前台显示，后台隐藏。默认左侧，32×32，透明背景，无底板和阴影。
- 显示剩余百分比：大于 50% 为绿色、20%–50% 橙色、低于 20% 红色；未知或过期为灰色，不伪装满额。
- 默认显示剩余最少的已知窗口；右键切换窗口、刷新、恢复位置或退出，双击刷新，拖动校准。
- 可见时每 5 分钟查询，10 分钟前的快照或已到重置时间的数据标为过期；接口错误会立即标记未知。
- 不显示“7天”等底部文字，详情在悬停提示和菜单。菜单栏标记为 EA。
- 基于窗口边界定位，不识别头像，不读取桌面聊天或截图；无法自动核对桌面账号与 CLI 账号一致。

## 数据与认证边界

使用本机 Claude Code 中存在的 `https://api.anthropic.com/api/oauth/usage` 接口，仅发送只读 GET，不创建模型请求或刷新/修改凭据。它不是公开稳定 API，可能因服务调整失效。

macOS 优先读取 `Claude Code-credentials` 钥匙串项；其他情况读取 Claude Code 的 `.credentials.json`。设置 `CLAUDE_CONFIG_DIR` 时只读取该目录的凭据文件，不猜测自定义钥匙串名称。可能需要系统允许访问已有钥匙串项。

登录令牌只在内存中用于固定官方源；禁止跟随重定向，不输出原始错误正文或令牌。查询总超时 15 秒，遇到 429 提示稍后重试。OAuth 权限可能不足；如重新登录仍无法查询，应停止请求并检查接口兼容性。

展示服务端 `utilization` 的剩余值 `100 - utilization`。各窗口独立，额外付费额度不混入百分比。未知字段不硬编码为零。此接口读取的是订阅窗口，不是当前聊天上下文剩余量。

## 开发

```sh
npm test
npm run build:overlay
```

构建需要 Swift 6 与 Xcode Command Line Tools，生成 Intel/Apple Silicon 通用应用；使用 ad-hoc 签名，未开发者签名或公证。测试使用模拟响应，不发送模型请求。

## 发布

升级 package.json 版本，提交后推送同版本 v 标签，由 GitHub Actions 自动测试、构建通用浮窗并发布 npm。稳定版使用 latest，预发布使用 next。发布任务使用 npm Environment，仓库 Deployments 可查看记录。

发布使用 Easy 系列共用的 NPM_TOKEN Secret；每次发布前检查有效期和包权限。首次配置后，普通代码推送只运行 CI，版本标签才发布 npm。
