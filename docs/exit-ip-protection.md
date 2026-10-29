# Exit IP protection

This is application proxy control, not an OS firewall. It is off by default. Installing the npm package does not change Claude settings or restart it. The gateway supports IPv4 HTTPS CONNECT on port 443 only; IPv6, HTTP and other destination ports are refused.

## Setup

1. Install `npm i -g easy-claude` and run `easy-claude show` (macOS 14+, Node.js 22+).
2. Expand More settings, enter a comma-separated public IPv4 allowlist and choose a 30/60/120/300-second check interval.
3. Configure the desired applications to use `http://127.0.0.1:18197`. Manually reopen them to load their settings.
4. Enable Exit IP protection and wait for Proxy allowed. A missing service, disabled switch, unknown/failed/expired check or mismatched IP rejects new proxy connections and closes established tunnels. Turning protection off does not restore direct networking.

### Claude Desktop

Use the official managed `egressProxyUrl` policy in `/Library/Managed Preferences/<username>/com.anthropic.claudefordesktop.plist`. Administrator access is required. If your organization already manages this policy, ask its administrator; do not override that policy.

Back up an existing file with a timestamp in the same directory, preserve other fields, and set only `egressProxyUrl` to `http://127.0.0.1:18197`. For example, run these commands yourself:

```sh
sudo mkdir -p "/Library/Managed Preferences/$USER"
sudo defaults write "/Library/Managed Preferences/$USER/com.anthropic.claudefordesktop" egressProxyUrl -string "http://127.0.0.1:18197"
```

Manually reopen Claude to load the policy. Dock, Spotlight and the Launch Claude button keep normal launch behavior; no outer sandbox or injected arguments are used.

### Claude Code

Back up `~/.claude/settings.json` (or the settings file in your custom Claude configuration directory). Merge these keys into `env`, preserving other configuration:

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

Review existing bypass entries for Claude destinations; retain other legitimate local exceptions. Manually start a new Code session. `easy-claude protected [arguments]` is an optional proxy-environment launcher; it refuses to launch when the service is unavailable and never falls back to direct access.

## Status and behavior

Network & protection groups the actual gateway state, current exit, allowlist, last check and blocking reason. With protection on, the exit follows protection checks; failed checks show unknown rather than a stale IP. Geographic lookups cannot overwrite it.

Manual rechecks, network changes, wake and configuration changes revoke permission before verifying again. Successful periodic checks renew the valid lease; failures revoke it. Checks use `https://ipinfo.io/json` with certificate, timeout, size and IP-format validation. Claude credentials are neither read nor forwarded by protection; HTTPS content is not decrypted.

IP-based clock settings use an independent geographic lookup and fall back to your saved manual zone on failure. Automatic usage refresh is a separate persistent switch, off by default: 300 seconds normally and 60 seconds after a reset or due alert. Manual and automatic refresh share rate-limit cooldowns.

## Disable and uninstall

Turning off protection or quitting blocks proxy forwarding. To restore your former network path, restore the previous Desktop proxy key and Code proxy environment values, preserving unrelated settings and later edits. Manually reopen Claude. Only remove the managed `egressProxyUrl` key if this feature created it; do not delete the whole policy file.

After applications no longer use this proxy, disable Launch at login, quit easy-claude and run `npm uninstall -g easy-claude`. No system extension, separate system service or global proxy rule is installed. Removing the package while applications still point at its proxy leaves them offline.

## Limits

An IP check proves the exit of that detection connection only. It cannot guarantee that all Claude destinations share that exit or that network-event delivery has no timing window. Updaters, external browsers, programs ignoring proxy settings and system-mediated traffic may bypass application proxies.

Isolated tests cover blocking, stale checks, connection revocation, control loss, cooldowns and UI. Real Code business traffic, physical network switching/wake and broad OS compatibility have not been fully validated. See the [release verification record](版本/1.1.0开发管理.md).
