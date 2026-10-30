# Exit IP protection

This is application proxy control, not an OS firewall. It is off by default. Installing the npm package does not change Claude settings or restart it. The gateway supports IPv4 HTTPS CONNECT on port 443 only; IPv6, HTTP and other destination ports are refused.

## Setup

1. Install `npm i -g easy-claude` and run `easy-claude show` (macOS 14+, Node.js 22+). Updates inspect settings but never silently change proxies.
2. Expand More settings, enter the public IPv4 allowlist and choose a 60/120/300-second interval. Saved 30-second settings migrate to 60 seconds.
3. Click green Start Claude proxy below Local proxy. The tool saves a baseline before configuring Desktop and Code. Desktop writes require macOS administrator approval. Machine-level policies, unsafe permissions/symlinks, invalid JSON and concurrent changes are not overwritten.
4. Enable protection, wait for Proxy allowed and manually reopen Claude/Code to load settings. The tool never starts or stops Claude automatically.

Yellow Stop Claude proxy restores saved proxy fields while preserving unrelated later edits. Legacy/manual settings without a baseline require confirmation before removing this tool's fields and restoring application defaults; the original custom proxy cannot be guessed.

CLI backups and the restore record are private (0600, state directory 0700). Backups remain for inspection after restoration. Account credential files are not read; other configuration is backed up and preserved. Reopen Claude manually after changes.

A missing service, disabled protection, failed/expired check or mismatched IP blocks forwarding and closes existing tunnels. Turning protection off does not restore direct access; restore proxy settings and manually reopen Claude. Manual instructions below remain available for advanced setup.

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

Manual rechecks, network changes, wake and configuration changes revoke permission first. Each round waits for a 60-second minimum interval; forwarding remains blocked while queued. Protection sources reporting HTTP 429 cool down for ten minutes. A valid but non-allowlisted primary IP blocks directly instead of selecting a more favorable fallback. Successful periodic checks renew the valid lease; failures revoke it. Checks use `https://ipinfo.io/json` with fallback to `https://api.ipify.org?format=json` on lookup failure or rate limiting (IP only; no city or time zone) with certificate, timeout, size and IP-format validation. Claude credentials are neither read nor forwarded by protection; HTTPS content is not decrypted.

IP-based clock settings use an independent geographic lookup and fall back to your saved manual zone on failure. Automatic usage refresh is a separate persistent switch, off by default: 300 seconds normally and 60 seconds after a reset or due alert. Manual and automatic refresh share rate-limit cooldowns.

## Disable and uninstall

Turning off protection or quitting blocks proxy forwarding. Prefer yellow Stop Claude proxy and then manually reopen Claude. For manual restoration, restore the previous Desktop proxy key and Code proxy environment values, preserving unrelated settings and later edits. Manually reopen Claude. Only remove the managed `egressProxyUrl` key if this feature created it; do not delete the whole policy file.

After applications no longer use this proxy, disable Launch at login, quit easy-claude and run `npm uninstall -g easy-claude`. No system extension, separate system service or global proxy rule is installed. Removing the package while applications still point at its proxy leaves them offline.

## Limits

An IP check proves the exit of that detection connection only. It cannot guarantee that all Claude destinations share that exit or that network-event delivery has no timing window. Updaters, external browsers, programs ignoring proxy settings and system-mediated traffic may bypass application proxies.

Isolated tests cover blocking, stale checks, connection revocation, control loss, cooldowns and UI. Real Code business traffic, physical network switching/wake and broad OS compatibility have not been fully validated. See the [release verification record](版本/1.2.0开发管理.md).
