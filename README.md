# easy-claude

**English** | [简体中文](README.zh-CN.md)

A lightweight companion for Claude: read CLI account usage, show transparent usage rings and a world clock, and manage them from a native macOS menu bar panel. No model calls or changes to the official application.

## Exit IP protection (application proxy)

Automatic usage refresh is off by default. Enable it for five-minute refreshes and one-minute confirmation after resets or due alerts; disable it for manual refresh only. Both modes obey rate-limit cooldowns. IP checks and the clock run independently.

Claude Desktop and Claude Code can use the same fixed local proxy: **http://127.0.0.1:18197**. Desktop uses the official `egressProxyUrl` policy; terminal Code uses proxy variables in `~/.claude/settings.json`. Normal Dock, Spotlight and terminal startup stays unchanged. No outer sandbox or application patching is used: the earlier sandboxed desktop launcher conflicted with Chromium's own sandbox and was withdrawn.

Enable Exit IP protection and enter the IPv4 allowlist. Only a successful current IP check permits forwarding. Service absent, protection off, unknown/expired/failed check or mismatched IP blocks proxy traffic and closes existing tunnels. Opening easy-claude starts the proxy even while the switch is off; the switch must be on and verification successful to forward. The Launch Claude button before Quit opens the official app normally, only when clicked.

Configuration changes require manually reopening Claude; the tool does not restart it. This is application proxy control, not an OS firewall: native updates, external browsers and programs that ignore proxy settings are not fully covered. IPv4 HTTPS CONNECT on port 443 is supported; IPv6 and other target ports are refused by this proxy. Protection covers configured proxy connections and does not guarantee control of every Claude-related network request.

[Setup, proxy configuration and removal](docs/exit-ip-protection.md) · [Development verification](docs/版本/出口IP保护开发管理.md)

## v1.1.0 release notes

- Add a fixed local proxy and IPv4 exit allowlist; invalid, expired or disabled checks block proxy connections.
- Group Network & protection and synchronize the displayed exit with protection checks.
- Add an automatic usage refresh switch, off by default, retaining manual refresh and HTTP 429 cooldowns.
- Keep normal Launch Claude behavior and identify ipinfo.io as the time-zone lookup source.

[Release history](CHANGELOG.md) · [1.1.0 development and release](docs/版本/1.1.0开发管理.md)

## Install and run

Requires Node.js 22 or later. The transparent overlay requires macOS 14 or later; the npm package includes a universal Apple Silicon/Intel application, so no local compilation is needed.

```sh
npm i -g easy-claude
easy-claude
easy-claude show
easy-claude -V
```

The default command prints usage. `show` closes the previous instance of this tool and opens a new one. `overlay` remains an alias. The floating clock and rings follow the official Claude desktop foreground window and hide when it is in the background; the menu bar panel remains available.

Sign in to the official CLI with the same account you use in the desktop app:

```sh
claude auth login
```

CLI and desktop login are separate. This tool cannot verify that their accounts match. Missing or stale data is never treated as full or zero usage. API key balances and current conversation context are outside its scope.

Automatic usage refresh is an explicit persistent switch, off by default (300 seconds normally, 60 seconds after resets or due alerts). HTTP 429 still pauses manual requests for 10 minutes, then up to 15 minutes. Successful queries clear the cooldown; failures never imply availability. The published v1.0.3 behavior is described in its release notes above.

## Usage rings and recovery

The outer thick ring shows weekly usage; the inner thin ring shows the five-hour window. Only windows returned by the service are shown. The center defaults to the five-hour percentage, falling back to weekly; select a quota row to change it. The center has no percent sign. Green means more than 50% remains, orange 20–50%, and red less than 20%.

Multiple exhausted windows wait for the latest reset among them. Reaching that time waits for automatic confirmation if enabled, or a manual refresh if disabled; it does not assume the account is available. Weekly countdowns use the largest remaining unit, while five-hour countdowns show hours and minutes. Absolute reset times use the system time zone and its 12/24-hour format.

## Clock and time zones

Drag the clock and rings independently. **Reset position** restores their defaults. Claude uses a horizontal layout at the lower left, with the ring before the clock.

The default city is Silicon Valley (`America/Los_Angeles`). Presets, in order: Silicon Valley, Los Angeles, Seattle, Washington, D.C., Columbus, Ohio, Singapore and Shanghai. Custom IANA time zones are supported. Daylight saving follows the selected zone; the computer time zone is never changed.

The clock has no seconds and follows the system 12/24-hour format. Colors use the selected zone: red 00:00–09:00, green 09:00–18:00, orange 18:00–24:00. Midnight remains `00:mm` in 12-hour mode. Chinese uses five day-period labels; English uses AM/PM. In the floating clock, time comes first (`10:09 AM`), with the period at half the numeric font size; the city remains below. The city below the clock fits within the time's width.

## Interface language

The interface defaults to the first system language: Chinese becomes Simplified Chinese; other languages use English. Open **More settings → Language** and select **System default**, **简体中文**, or **English**. The right-click menu also provides this choice. Manual selection applies immediately and survives restarts without changing other settings.

The CLI uses the same saved preference. `EASY_LANGUAGE=en` or `EASY_LANGUAGE=zh` temporarily overrides CLI language. Language does not change the computer's region, time zone or hour format.

## Network exit and IP time zone

A single request to `https://ipinfo.io/json` reads the public IP, city and IANA time zone. The panel displays `City·IP`, refreshing at startup, every five minutes or on demand. A failed lookup shows an explicit error rather than an old IP. IP history is not saved.

**Follow IP time zone** is off by default. Enable it to hide manual zone choices and use the validated IP time zone and returned city. Failed lookups temporarily restore the saved manual time; successful lookups resume following. Disable it to restore manual choices. Proxy routing can make this exit differ from AI traffic; geolocation may be inaccurate or rate-limited.

## Availability alert

Enable **Usage available alert** while a known quota is exhausted and has a valid reset time. It waits for all exhausted windows, checks online, sends one system notification with sound after availability is confirmed, then turns itself off. Unknown data, restrictions and request failures do not trigger a success notification.

The alert survives restarts and can be cancelled. The tool must be running; sleep delays checks until wake. Notification permissions, Focus and system sound settings control delivery. Enabling the alert requests permission; it is never enabled automatically.

## Updates and launch at login

```sh
easy-claude update
```

The CLI and **Check for updates** share the same update path. A newer official npm release is installed at the existing prefix and automatically reopened. An already-current version is not reinstalled or restarted. If an older version has no `update` command, use `npm i -g easy-claude@latest`.

Version checks run once a day while the tool is running; a green dot indicates an available update. **Automatic updates** is off by default. Enable it to install confirmed new versions and reopen automatically. Update failures are shown; no `sudo` is used. A kernel lock prevents concurrent installs and is released after a crash when the remaining install processes exit.

**Launch at login** is off by default. Enabling it creates only this tool's user LaunchAgent and runs `show` when that macOS user signs in. Disabling removes that entry without closing the current overlay. It does not start the official app. After moving or removing Node/npm, reopen from the new installation and toggle this option off/on to refresh the saved path. System background-item permission may be required.

## Data and security boundaries

Usage comes from Claude Code subscription credentials and the official fixed-origin OAuth usage endpoint. This is not a public stable API and can change. macOS uses the existing Claude Code credentials keychain item, otherwise the credential file; CLAUDE_CONFIG_DIR selects its own credential file. Credentials stay in memory and are not refreshed, rewritten, logged or forwarded to another origin. HTTP 401 and HTTP 403 are handled separately.

Network requests respect existing HTTPS/ALL proxy configuration or the macOS system HTTPS proxy; without a proxy they connect directly. TLS validation stays enabled and credential-bearing requests do not follow redirects. No desktop chats or screenshots are read; overlay positioning uses window bounds rather than avatar recognition.

## Development and publishing

```sh
npm test
npm run build:overlay
npm run test:controls
```

Building requires Swift 6 and Xcode Command Line Tools. The packaged app is ad-hoc signed, not developer-notarized. UI tests use isolated preferences and simulated responses, without model calls.

A matching `v<version>` tag triggers GitHub Actions validation, universal build and npm publication. Stable releases use `latest`; prereleases use `next`. The `npm` environment exposes deployment status on GitHub. Publishing credentials are stored only in GitHub Actions secrets. A successful workflow is followed by registry and public-install verification.

## Known limits

CLI login can expire while the desktop remains signed in. Official service responses and network access determine availability. Notification sound, real logout/reboot and cross-machine multi-monitor behavior need separate acceptance; simulated UI tests do not prove those paths.

[Version management](https://github.com/UnionSchool/easy-claude/blob/main/docs/版本/README.md)

The Network & protection section groups the current exit, allowlist and protection status. With protection on, the displayed exit follows the protection check immediately; failures show unknown instead of an old IP. Expand More settings to edit the allowlist and interval.
