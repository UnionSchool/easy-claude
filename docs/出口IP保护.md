# 出口 IP 保护

本功能控制明确配置到 easy-claude 的应用代理连接，不是系统防火墙。默认关闭，安装 npm 包不会自动修改 Claude 的配置或重启 Claude。代理只接受 IPv4 HTTPS CONNECT 443；不支持 IPv6、HTTP 和其他目标端口。

## 安装与设置

1. `npm i -g easy-claude`，然后运行 `easy-claude show`（macOS 14+、Node.js 22+）。
2. 展开“更多设置”，输入允许的公网 IPv4，多个地址用逗号分隔；设置30/60/120/300秒复查周期。
3. 将需要保护的 Claude 应用配置到 `http://127.0.0.1:18197`，配置后由用户自行重新打开对应应用。easy-claude 不自动接管正在运行的进程。
4. 打开“出口 IP 保护”，等实际显示“代理已放通”。工具未运行、开关关闭、尚未验证、验证失败或过期、IP不匹配时，代理不转发，并关闭原有隧道。关闭保护不会自动恢复直连。

### Claude 桌面

使用官方受管配置 `egressProxyUrl`，文件为 `/Library/Managed Preferences/<当前用户名>/com.anthropic.claudefordesktop.plist`。需要管理员权限；已有企业管理策略时由管理员处理，不覆盖其策略。

先备份现有文件，保留原有字段，再仅设置该键。例如在用户自己运行的终端中：

```sh
sudo mkdir -p "/Library/Managed Preferences/$USER"
sudo defaults write "/Library/Managed Preferences/$USER/com.anthropic.claudefordesktop" egressProxyUrl -string "http://127.0.0.1:18197"
```

有原文件时，写入前将其复制为同目录 `com.anthropic.claudefordesktop.bak-YYYYMMDD-HHMMSS.plist`。普通 Dock／Spotlight 启动方式保持；用户手动重新打开 Claude 才会加载代理配置。“启动 Claude”按钮也仅正常启动应用，不附加沙箱或启动参数。

### Claude Code CLI

编辑 `~/.claude/settings.json`（使用自定义 Claude 配置目录时编辑对应文件），先做同目录带时间戳备份。合并以下 `env` 字段，保留其他设置和环境变量，不用这段示例覆盖整个文件：

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:18197",
    "HTTPS_PROXY": "http://127.0.0.1:18197",
    "ALL_PROXY": "http://127.0.0.1:18197",
    "http_proxy": "http://127.0.0.1:18197",
    "https_proxy": "http://127.0.0.1:18197",
    "all_proxy": "http://127.0.0.1:18197",
    "NO_PROXY": "localhost,127.0.0.1,::1,.local",
    "no_proxy": "localhost,127.0.0.1,::1,.local"
  }
}
```

检查并去除针对 Claude 目标的代理绕过项，保留确有需要且不影响保护范围的其他本机例外。用户自行新建 Claude Code 会话加载配置；已有会话不自动重启。`easy-claude protected [参数]`也是可选代理环境启动入口，服务未就绪时拒绝启动，不自动回退直连。

## 面板与检测

- “网络与保护”显示实际过滤代理状态、当前出口、允许出口、最近检测时间与原因；保护开启时地址读取最新保护检测，地理查询不会覆盖它。失败显示未知，不把上一次成功当作当前有效结果。
- “重新检测”、网络变化、唤醒和白名单修改会先撤销放行再验证。定期复查有效租约内续租不断流，失败立即撤销；超时、非法响应和限流均不能放行。
- 查询源为 `https://ipinfo.io/json`，HTTPS证书验证、超时、响应大小与地址格式检查保持启用。不读取或转发 Claude 令牌，不解密会话内容。
- `跟随IP时区:ipinfo.io`使用独立的城市／时区查询，失败回退用户手动时区，不修改系统时区。
- 额度自动刷新默认关闭；开启正常每5分钟、到期确认每分钟，关闭仅手动。额度查询与保护复查独立，429冷却不能绕过。

## 关闭与卸载

关闭保护或退出 easy-claude 会停止代理转发。若要恢复原网络方式，先恢复两端之前的代理设置：桌面仅恢复／删除本功能设置的 `egressProxyUrl`；CLI仅恢复本功能改动的代理环境变量，保留其他配置和原有例外。可从备份逐项核对，避免覆盖之后新增的有效设置。用户再自行重新打开 Claude。

确认已不再使用本机代理后，关闭 easy-claude 的“开机启动”，从工具菜单退出，再运行 `npm uninstall -g easy-claude`。不要在 Claude 仍指向本机代理时直接卸载并期待其自动直连。没有系统扩展、独立系统服务或系统全局代理规则需要卸载。

## 保证范围与验收

单次检测只能证明检测连接的出口；不能保证所有 Claude 目标使用相同公网出口，也不承诺网络事件没有通知窗口。官方更新器、外部浏览器、忽略代理的程序及系统代发连接可能不经过本代理，不能当作系统级防绕过方案。

隔离自动测试覆盖代理阻断、旧检测作废、长连接撤销、重启与失联、限流和UI；真实 Claude Code业务、网络切换／唤醒及跨系统兼容尚未全面验证。不要把自动测试通过解释为所有进程、所有流量已实机验收。[发布与验证记录](版本/1.1.0开发管理.md)。
