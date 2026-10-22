import AppKit
import CoreGraphics
import Darwin
import UserNotifications

struct UsageWindow: Decodable {
    let id: String
    let label: String
    let name: String
    let remaining: Double?
    let resetsAt: Double?
}
struct Snapshot: Decodable {
    var windows: [UsageWindow] = []
    var detail: String = ""
    var fetchedAt: Double = 0
    var restricted: Bool = false
    var error: String?

    enum CodingKeys: CodingKey { case windows, detail, fetchedAt, restricted, error }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        windows = try c.decodeIfPresent([UsageWindow].self, forKey: .windows) ?? []
        detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        fetchedAt = try c.decodeIfPresent(Double.self, forKey: .fetchedAt) ?? 0
        restricted = try c.decodeIfPresent(Bool.self, forKey: .restricted) ?? false
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

enum RingState: Equatable {
    case green, orange, red, unknown
    static func resolve(_ remaining: Double?, stale: Bool) -> RingState {
        guard !stale, let remaining, remaining.isFinite else { return .unknown }
        return remaining > 50 ? .green : remaining >= 20 ? .orange : .red
    }
    var color: NSColor {
        switch self {
        case .green: .systemGreen
        case .orange: .systemOrange
        case .red: .systemRed
        case .unknown: .secondaryLabelColor
        }
    }
}

func appKitRect(_ rect: CGRect, primaryHeight: CGFloat) -> CGRect {
    CGRect(x: rect.minX, y: primaryHeight - rect.maxY, width: rect.width, height: rect.height)
}
func ringOrigin(in rect: CGRect, inset: CGPoint) -> CGPoint {
    CGPoint(x: max(rect.minX, min(rect.maxX - 32, rect.minX + inset.x)),
            y: max(rect.minY, min(rect.maxY - 32, rect.minY + inset.y)))
}

@MainActor
func targetWindow() -> CGRect? {
    guard let app = NSWorkspace.shared.frontmostApplication,
          app.bundleIdentifier == "com.anthropic.claudefordesktop" else { return nil }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for window in windows {
        guard (window[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier),
              (window[kCGWindowLayer as String] as? Int) == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              rect.width >= 300, rect.height >= 200 else { continue }
        // CG 坐标原点在主屏左上；AppKit 使用主屏左下，多屏位置也按同一基准转换。
        return appKitRect(rect, primaryHeight: NSScreen.screens.first?.frame.height ?? 0)
    }
    return nil
}

@MainActor
class RingView: NSView {
    var remaining: Double?
    var weeklyRemaining: Double?
    var weeklyStale = true
    var showWeeklyPercentage = false
    var showWeeklyRing = true
    var showFiveHourRing = true
    var displaysWeeklyPercentage: Bool { showWeeklyRing && (showWeeklyPercentage || !showFiveHourRing) }
    var stale = true
    var caption = "等待额度"
    var makeMenu: (() -> NSMenu)?
    var moved: ((CGPoint) -> Void)?
    var refresh: (() -> Void)?
    var dragging = false
    private var dragStart = CGPoint.zero
    private var originStart = CGPoint.zero

    override func draw(_ dirtyRect: NSRect) {
        if showWeeklyRing { drawRing(radius: 14, remaining: weeklyRemaining, stale: weeklyStale, dashed: true) }
        if showFiveHourRing { drawRing(radius: showWeeklyRing ? 10 : 14, remaining: remaining, stale: stale) }
        let useWeekly = displaysWeeklyPercentage
        let percentage = useWeekly ? weeklyRemaining : remaining
        let percentageStale = useWeekly ? weeklyStale : stale
        let state = RingState.resolve(percentage, stale: percentageStale)
        let text = percentage.map { "\(Int($0.rounded()))" } ?? "—"
        drawText(text, y: 10, font: .monospacedDigitSystemFont(ofSize: 9, weight: .semibold), color: state.color)
    }
    private func drawRing(radius: CGFloat, remaining: Double?, stale: Bool, dashed: Bool = false) {
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let track = NSBezierPath(ovalIn: CGRect(x: center.x - radius, y: center.y - radius,
                                               width: radius * 2, height: radius * 2))
        track.lineWidth = dashed ? 3 : 2
        if dashed { track.setLineDash([2, 2], count: 2, phase: 0) }
        NSColor.labelColor.withAlphaComponent(0.12).setStroke()
        track.stroke()
        guard let remaining, remaining > 0, !stale else { return }
        let arc = NSBezierPath()
        arc.lineWidth = dashed ? 3 : 2
        arc.lineCapStyle = .round
        arc.appendArc(withCenter: center, radius: radius, startAngle: 90,
                      endAngle: 90 - CGFloat(min(100, max(0, remaining))) * 3.6, clockwise: true)
        RingState.resolve(remaining, stale: stale).color.setStroke()
        arc.stroke()
    }
    private func drawText(_ text: String, y: CGFloat, font: NSFont, color: NSColor) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        style.lineBreakMode = .byTruncatingTail
        (text as NSString).draw(in: CGRect(x: 2, y: y, width: bounds.width - 4, height: 12),
                               withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: style])
    }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { refresh?(); return }
        dragging = true
        dragStart = NSEvent.mouseLocation
        originStart = window?.frame.origin ?? .zero
    }
    override func mouseDragged(with event: NSEvent) {
        guard dragging else { return }
        let point = NSEvent.mouseLocation
        window?.setFrameOrigin(CGPoint(x: originStart.x + point.x - dragStart.x, y: originStart.y + point.y - dragStart.y))
    }
    override func mouseUp(with event: NSEvent) {
        if dragging, let origin = window?.frame.origin { moved?(origin) }
        dragging = false
    }
    override func rightMouseDown(with event: NSEvent) {
        if let menu = makeMenu?() { NSMenu.popUpContextMenu(menu, with: event, for: self) }
    }
}

struct ClockCity {
    let name: String
    let identifier: String
    static let presets: [ClockCity] = [
        ClockCity(name: "硅谷", identifier: "America/Los_Angeles"),
        ClockCity(name: "洛杉矶", identifier: "America/Los_Angeles"),
        ClockCity(name: "西雅图", identifier: "America/Los_Angeles"),
        ClockCity(name: "华盛顿", identifier: "America/New_York"),
        ClockCity(name: "哥伦布", identifier: "America/New_York"),
        ClockCity(name: "新加坡", identifier: "Asia/Singapore"),
        ClockCity(name: "上海", identifier: "Asia/Shanghai")
    ]
}

func versionCheckDue(lastAttempt: Double, checkedVersion: String?, currentVersion: String,
                     now: Double = Date().timeIntervalSince1970) -> Bool {
    checkedVersion != currentVersion || now - lastAttempt >= 86400
}

func resetDescription(_ resetsAt: Double?, weekly: Bool, now: Date = Date(), zone: TimeZone = .current,
                      locale: Locale = .autoupdatingCurrent) -> String {
    guard let resetsAt, resetsAt.isFinite, abs(resetsAt) < 8.64e12 else { return "重置时间未知" }
    let remaining = resetsAt - now.timeIntervalSince1970
    guard remaining > 0 else { return "已到重置时间，等待更新" }
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = zone
    formatter.setLocalizedDateFormatFromTemplate("jm")
    let date = Date(timeIntervalSince1970: resetsAt)
    let clock = formatter.string(from: date)
    formatter.dateFormat = "d'日'"
    let time = weekly ? "\(formatter.string(from: date)) \(clock)" : clock
    let duration: String
    if weekly {
        if remaining >= 86400 { duration = "\(Int(remaining / 86400))天" }
        else if remaining >= 3600 { duration = "\(Int(remaining / 3600))小时" }
        else { duration = "\(Int(ceil(remaining / 60)))分钟" }
    } else {
        let totalMinutes = Int(ceil(remaining / 60))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        duration = (hours > 0 ? "\(hours)小时" : "") + (minutes > 0 ? "\(minutes)分" : "")
    }
    return "\(duration)后 \(time) 重置"
}

func clockPeriod(at date: Date, zone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    switch calendar.component(.hour, from: date) {
    case 0..<6: return "凌晨"
    case 6..<12: return "上午"
    case 12..<18: return "下午"
    case 18..<21: return "晚上"
    default: return "深夜"
    }
}

func clockText(at date: Date, zone: TimeZone, locale: Locale = .autoupdatingCurrent) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = zone
    formatter.setLocalizedDateFormatFromTemplate("jm")
    if locale.hourCycle == .oneToTwelve || locale.hourCycle == .zeroToEleven {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = calendar.component(.hour, from: date) == 0 ? "HH:mm" : "h:mm"
        return "\(clockPeriod(at: date, zone: zone)) \(formatter.string(from: date))"
    }
    return formatter.string(from: date)
}


@MainActor
func fittedClockFont(for text: String, width: CGFloat, baseSize: CGFloat) -> NSFont {
    let base = NSFont.monospacedDigitSystemFont(ofSize: baseSize, weight: .medium)
    let measured = max(1, (text as NSString).size(withAttributes: [.font: base]).width)
    var size = min(baseSize, baseSize * max(1, width - 2) / measured)
    var font = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .medium)
    // 字体在小字号下的实际字宽不完全按比例缩放，按实测宽度校正。
    for _ in 0..<6 {
        let actual = (text as NSString).size(withAttributes: [.font: font]).width
        if actual <= width { break }
        size *= width / actual * 0.95
        font = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .medium)
    }
    return font
}

func clockState(at date: Date, zone: TimeZone) -> RingState {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let hour = calendar.component(.hour, from: date)
    if hour >= 9 && hour < 18 { return .green }
    if hour >= 18 { return .orange }
    return .red
}

@MainActor
final class ClockView: RingView {
    var zone = TimeZone(identifier: "America/Los_Angeles")!
    var cityName = "硅谷"
    override func draw(_ dirtyRect: NSRect) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let now = Date()
        let time = clockText(at: now, zone: zone)
        let timeFont = fittedClockFont(for: time, width: bounds.width, baseSize: 20)
        let timeWidth = (time as NSString).size(withAttributes: [.font: timeFont]).width
        (time as NSString).draw(in: CGRect(x: 0, y: 17, width: bounds.width, height: 25),
            withAttributes: [.font: timeFont,
                             .foregroundColor: clockState(at: now, zone: zone).color, .paragraphStyle: style])
        let city = cityName
        (city as NSString).draw(in: CGRect(x: 0, y: 1, width: bounds.width, height: 15),
            withAttributes: [.font: fittedClockFont(for: city, width: timeWidth, baseSize: 10),
                             .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: style])
    }
}

struct IPClockState {
    private(set) var zone: TimeZone?
    mutating func update(_ identifier: String?) -> Bool {
        guard let identifier, let next = TimeZone(identifier: identifier) else { zone = nil; return false }
        zone = next
        return true
    }
    func resolved(manual: TimeZone, following: Bool) -> TimeZone { following ? zone ?? manual : manual }
}

struct PublicIP: Decodable {
    let ip: String?
    let city: String?
    let timezone: String?
}
func publicIPText(ip: String?, city: String?) -> String {
    guard let ip, !ip.isEmpty else { return "IP异常" }
    return "\(city ?? "城市未知")·\(ip)"
}

// 只等待耗尽窗口，但确认恢复时必须同时检查所有已知窗口，缺失或未知不能报可用。
struct AvailabilityReminder: Codable {
    var ids: [String]
    var due: Double
    static func arm(_ windows: [UsageWindow], now: Double) -> Self? {
        guard !windows.isEmpty, windows.allSatisfy({ window in
            guard let remaining = window.remaining, remaining.isFinite, remaining >= 0,
                  let reset = window.resetsAt, reset.isFinite, reset > now else { return false }
            return true
        }) else { return nil }
        let blocked = windows.filter { $0.remaining == 0 }
        guard let due = blocked.compactMap(\.resetsAt).max() else { return nil }
        return Self(ids: windows.map(\.id), due: due)
    }
    mutating func recovered(_ windows: [UsageWindow], fetchedAt: Double, restricted: Bool, now: Double) -> Bool {
        guard now >= due, fetchedAt >= due, now - fetchedAt <= 120, !restricted,
              ids.allSatisfy({ id in windows.contains { $0.id == id } }), !windows.isEmpty else { return false }
        let blocked = windows.filter { $0.remaining == 0 }
        if let later = blocked.compactMap(\.resetsAt).filter({ $0.isFinite && $0 > now }).max() { due = later }
        return windows.allSatisfy {
            guard let remaining = $0.remaining, remaining.isFinite, remaining > 0,
                  let reset = $0.resetsAt, reset.isFinite, reset > now else { return false }
            return true
        }
    }
}
func reminderWindows(_ windows: [UsageWindow]) -> [UsageWindow] { windows.filter { ["five_hour:primary", "seven_day:primary"].contains($0.id) } }

enum LoginStartup {
    static let label = "com.unionschool.easy-claude.login"
    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/" + label + ".plist")
    }
    static func enabled(at file: URL = file) -> Bool { FileManager.default.fileExists(atPath: file.path) }
    static func setEnabled(_ enabled: Bool, node: String, cli: String, environment: [String: String], at file: URL = file) throws {
        if !enabled {
            if self.enabled(at: file) { try FileManager.default.removeItem(at: file) }
            return
        }
        guard node.hasPrefix("/"), cli.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: cli) else {
            throw NSError(domain: label, code: 1, userInfo: [NSLocalizedDescriptionKey: "启动路径无效，请从正式安装的命令重新打开浮窗"])
        }
        let config: [String: Any] = ["Label": label, "ProgramArguments": [node, cli, "show"],
                                    "RunAtLoad": true, "EnvironmentVariables": environment]
        let data = try PropertyListSerialization.data(fromPropertyList: config, format: .xml, options: 0)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
    }
}

@MainActor
final class Overlay: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    let panel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 32, height: 32),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let ring = RingView(frame: CGRect(x: 0, y: 0, width: 32, height: 32))
    let clockPanel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 96, height: 46),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let clock = ClockView(frame: CGRect(x: 0, y: 0, width: 96, height: 46))
    var clockInset = CGPoint(x: 164, y: 0)
    var clockEnabled = true
    var followIPTimeZone = UserDefaults.standard.bool(forKey: "followIPTimeZone")
    var ipClock = IPClockState()
    var ipClockCity: String?
    var manualClockZone = TimeZone(identifier: "America/Los_Angeles")!
    var manualClockCity = "硅谷"
    var status: NSStatusItem?
    var timer: Timer?
    var ipQuery: Process?
    var ipLastAttempt = Date.distantPast
    var ipText = "正在获取IP…"
    var query: Process?
    var updater: Process?
    var versionCheck: Process?
    var updateAvailable = false
    var automaticUpdateError: String?
    var versionCheckError: String?
    let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "未知"
    var reminder = UserDefaults.standard.data(forKey: "availabilityReminder").flatMap { try? JSONDecoder().decode(AvailabilityReminder.self, from: $0) }
    var reminderSending = false
    var reminderAuthorizing = false
    var reminderGeneration = 0
    var reminderError: String?
    var snapshot: Snapshot?
    var error: String?
    var lastAttempt = Date.distantPast
    var lastRect: CGRect?
    var inset = CGPoint(x: 138, y: 4)
    var node = ""
    var script = ""
    var searchPath = ""
    var claudeHome = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        let args = CommandLine.arguments
        guard args.count >= 4 else { NSApp.terminate(nil); return }
        node = args[1]; script = args[2]; searchPath = args[3]
        claudeHome = args.count > 4 ? args[4] : ""
        let prefs = UserDefaults.standard
        if prefs.object(forKey: "leftInset") != nil {
            inset = CGPoint(x: prefs.double(forKey: "leftInset"), y: prefs.double(forKey: "bottomInset"))
        }
        if let identifier = prefs.string(forKey: "clockTimeZone"), let zone = TimeZone(identifier: identifier) {
            clock.zone = zone
            let savedCity = prefs.string(forKey: "clockCity")
            let preset = ClockCity.presets.first { $0.name == savedCity && $0.identifier == identifier }
                ?? ClockCity.presets.first { $0.identifier == identifier }
            clock.cityName = preset?.name ?? identifier
        }
        manualClockZone = clock.zone; manualClockCity = clock.cityName
        applyClockTimeZone()
        ring.showWeeklyPercentage = prefs.bool(forKey: "showWeeklyPercentage")
        clockEnabled = prefs.object(forKey: "clockEnabled") == nil || prefs.bool(forKey: "clockEnabled")
        if prefs.object(forKey: "clockLeftInset") != nil {
            clockInset = CGPoint(x: prefs.double(forKey: "clockLeftInset"), y: prefs.double(forKey: "clockBottomInset"))
        }
        clockPanel.isOpaque = false
        clockPanel.backgroundColor = .clear
        clockPanel.hasShadow = false
        clockPanel.level = .floating
        clockPanel.hidesOnDeactivate = false
        clockPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        clockPanel.contentView = clock
        clock.makeMenu = { [weak self] in self?.makeMenu() ?? NSMenu() }
        clock.moved = { [weak self] point in
            guard let self, let rect = self.lastRect else { return }
            self.clockInset = CGPoint(x: point.x - rect.minX, y: point.y - rect.minY)
            prefs.set(self.clockInset.x, forKey: "clockLeftInset")
            prefs.set(self.clockInset.y, forKey: "clockBottomInset")
        }
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = ring
        ring.makeMenu = { [weak self] in self?.makeMenu() ?? NSMenu() }
        ring.refresh = { [weak self] in self?.refresh() }
        ring.moved = { [weak self] point in
            guard let self, let rect = self.lastRect else { return }
            self.inset = CGPoint(x: point.x - rect.minX, y: point.y - rect.minY)
            prefs.set(self.inset.x, forKey: "leftInset")
            prefs.set(self.inset.y, forKey: "bottomInset")
        }
        ring.setAccessibilityElement(true)
        ring.setAccessibilityRole(.button)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status?.button?.title = "EA"
        status?.button?.toolTip = "Easy Claude 额度浮窗"
        let menu = NSMenu(); menu.delegate = self; status?.menu = menu
        timer = Timer.scheduledTimer(timeInterval: 0.4, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(hide), name: NSWorkspace.didDeactivateApplicationNotification, object: nil)
        tick()
    }
    @objc func hide() { panel.orderOut(nil); clockPanel.orderOut(nil) }
    @objc func tick() {
        checkVersionIfNeeded()
        if Date().timeIntervalSince(ipLastAttempt) >= 300 { refreshIP() }
        if let reminder, Date().timeIntervalSince(lastAttempt) >= (Date().timeIntervalSince1970 >= reminder.due ? 60 : 300) { refresh() }
        guard let rect = targetWindow() else { hide(); lastRect = nil; return }
        lastRect = rect
        if clockEnabled {
            if !clock.dragging {
                let x: CGFloat = max(rect.minX, min(rect.maxX - 96, rect.minX + clockInset.x))
                let y: CGFloat = max(rect.minY, min(rect.maxY - 46, rect.minY + clockInset.y))
                clockPanel.setFrameOrigin(CGPoint(x: x, y: y))
            }
            clock.needsDisplay = true
            clock.toolTip = "\(clock.cityName) · \(clock.zone.identifier)"
            clock.setAccessibilityLabel("\(clock.cityName) \(clock.zone.identifier) \(clockText(at: Date(), zone: clock.zone))")
            if !clockPanel.isVisible { clockPanel.orderFrontRegardless() }
        } else { clockPanel.orderOut(nil) }
        if !ring.dragging { panel.setFrameOrigin(ringOrigin(in: rect, inset: inset)) }
        if !panel.isVisible { panel.orderFrontRegardless() }
        if Date().timeIntervalSince(lastAttempt) >= 300 { refresh() }
        updateRing()
    }
    func updateRing() {
        let windows = snapshot?.windows ?? []
        let weekly = windows.first { $0.id == "seven_day:primary" }
        let fiveHour = windows.first { $0.id == "five_hour:primary" }
        let now = Date().timeIntervalSince1970
        let snapshotStale = error != nil || snapshot == nil || now - (snapshot?.fetchedAt ?? 0) > 600
        func stale(_ window: UsageWindow?) -> Bool {
            snapshotStale || window?.remaining == nil || (window?.resetsAt.map { $0 <= now } ?? false)
        }
        ring.showWeeklyRing = weekly != nil || fiveHour == nil
        ring.showFiveHourRing = fiveHour != nil
        ring.remaining = fiveHour?.remaining
        ring.stale = stale(fiveHour)
        ring.weeklyRemaining = weekly?.remaining
        ring.weeklyStale = stale(weekly)
        func label(_ value: Double?) -> String { value.map { "\(Int($0.rounded()))%" } ?? "未知" }
        let summary = [
            weekly == nil ? nil : "外侧粗环 · 周额度：\(label(weekly?.remaining))\(ring.weeklyStale ? "（未知或已过期）" : "")",
            fiveHour == nil ? nil : "\(weekly == nil ? "单环" : "内侧细环") · 5 小时：\(label(fiveHour?.remaining))\(ring.stale ? "（未知或已过期）" : "")"
        ].compactMap { $0 }.joined(separator: "\n")
        let fetched = snapshot.map { Date(timeIntervalSince1970: $0.fetchedAt).formatted(date: .omitted, time: .standard) } ?? "尚未更新"
        ring.toolTip = "本机 Claude CLI 账号额度\n\(summary)\n\(error ?? snapshot?.detail ?? "正在读取")\n更新时间：\(fetched)\n中心数字为\(ring.displaysWeeklyPercentage ? "周" : "5小时")剩余；拖动校准位置；双击刷新；右键打开菜单"
        ring.setAccessibilityLabel("Claude \(summary)")
        ring.needsDisplay = true
    }
    @objc func refresh() {
        guard query == nil else { return }
        lastAttempt = Date()
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = searchPath
        if !claudeHome.isEmpty { env["CLAUDE_CONFIG_DIR"] = claudeHome }
        process.environment = env
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            Task { @MainActor in
                guard let self else { return }
                self.query = nil
                do {
                    let value = try JSONDecoder().decode(Snapshot.self, from: data)
                    if let message = value.error { self.error = message }
                    else if process.terminationStatus == 0, value.fetchedAt > 0 {
                        self.snapshot = value; self.error = nil
                    } else { self.error = "额度查询失败" }
                } catch { self.error = "无法读取额度响应，请检查 CLI 和网络" }
                self.checkReminder()
                self.updateRing()
            }
        }
        query = process
        do { try process.run() }
        catch { query = nil; self.error = "无法启动额度查询，请重新运行 easy-claude show"; updateRing() }
    }
    func applyClockTimeZone() {
        clock.zone = ipClock.resolved(manual: manualClockZone, following: followIPTimeZone)
        clock.cityName = followIPTimeZone && ipClock.zone != nil ? (ipClockCity ?? "城市未知") : manualClockCity
        clock.needsDisplay = true
    }
    func receiveIPTimeZone(_ identifier: String?, city: String? = nil) {
        _ = ipClock.update(identifier)
        ipClockCity = ipClock.zone == nil ? nil : city
        applyClockTimeZone()
    }
    @objc func toggleFollowIPTimeZone() {
        followIPTimeZone.toggle()
        UserDefaults.standard.set(followIPTimeZone, forKey: "followIPTimeZone")
        applyClockTimeZone()
        if followIPTimeZone { refreshIP() }
    }
    @objc func refreshIP() {
        guard ipQuery == nil else { return }
        ipLastAttempt = Date()
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [URL(fileURLWithPath: script).deletingLastPathComponent().appendingPathComponent("overlay-ip.js").path]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = searchPath
        process.environment = env
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let value = try? JSONDecoder().decode(PublicIP.self, from: data)
            let text = publicIPText(ip: process.terminationStatus == 0 ? value?.ip : nil, city: value?.city)
            let timezone = process.terminationStatus == 0 ? value?.timezone : nil
            let city = process.terminationStatus == 0 ? value?.city : nil
            Task { @MainActor in
                guard let self else { return }
                self.ipQuery = nil; self.ipText = text
                self.receiveIPTimeZone(timezone, city: city)
            }
        }
        ipQuery = process
        do { try process.run() }
        catch { ipQuery = nil; ipText = "IP异常"; receiveIPTimeZone(nil) }
    }
    func saveReminder() {
        if let reminder, let data = try? JSONEncoder().encode(reminder) {
            UserDefaults.standard.set(data, forKey: "availabilityReminder")
        } else { UserDefaults.standard.removeObject(forKey: "availabilityReminder") }
    }
    @objc func toggleReminder() {
        guard !reminderAuthorizing else { return }
        reminderGeneration += 1
        reminderError = nil
        if reminder != nil {
            reminder = nil; saveReminder()
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["quota-available"])
            return
        }
        let now = Date().timeIntervalSince1970
        guard error == nil, let snapshot, now - snapshot.fetchedAt <= 600,
              let candidate = AvailabilityReminder.arm(reminderWindows(snapshot.windows), now: now) else {
            reminderError = "当前额度可用，或缺少有效额度/重置时间；请刷新后重试"
            refresh(); return
        }
        reminderAuthorizing = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { @Sendable [weak self] allowed, _ in
            Task { @MainActor in
                guard let self else { return }
                self.reminderAuthorizing = false
                if allowed { self.reminder = candidate; self.saveReminder() }
                else { self.reminderError = "请在系统设置中允许本工具发送通知，再开启提醒" }
            }
        }
    }
    func checkReminder() {
        guard !reminderSending, error == nil, let snapshot, var pending = reminder else { return }
        let ready = pending.recovered(reminderWindows(snapshot.windows), fetchedAt: snapshot.fetchedAt,
                                      restricted: snapshot.restricted, now: Date().timeIntervalSince1970)
        reminder = pending; saveReminder()
        guard ready else { return }
        reminderSending = true
        let generation = reminderGeneration
        UNUserNotificationCenter.current().getNotificationSettings { @Sendable [weak self] settings in
            // 旧SDK的设置对象不是Sendable，只把判断结果送回主线程。
            let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            Task { @MainActor in
                guard let self else { return }
                guard generation == self.reminderGeneration, self.reminder != nil else { self.reminderSending = false; return }
                guard allowed else {
                    self.reminderSending = false
                    self.reminderError = "通知未获允许，提醒已保留；请在系统设置允许通知"
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = "Claude 额度已恢复"
                content.body = "已确认当前额度可用，可以继续使用了。"
                content.sound = .default
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "quota-available", content: content, trigger: nil)) { @Sendable [weak self] error in
                    let failed = error != nil
                    Task { @MainActor in
                        guard let self else { return }
                        if generation == self.reminderGeneration {
                            if !failed { self.reminder = nil; self.reminderError = nil; self.saveReminder() }
                            else { self.reminderError = "通知发送失败，提醒已保留，将稍后重试" }
                        }
                        self.reminderSending = false
                    }
                }
            }
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }
    func item(_ title: String, _ action: Selector?) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }
    func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(item("Easy Claude · CLI 账号额度", nil))
        menu.addItem(item(lastRect == nil ? "等待 Claude 前台窗口" : "拖动圆环可调整位置", nil))
        if let error { menu.addItem(item(error, nil)) }
        if snapshot?.restricted == true { menu.addItem(item("服务端提示：当前使用受限", nil)) }
        let address = item(ipText, ipQuery == nil ? #selector(refreshIP) : nil)
        address.toolTip = "点击刷新公网IP；城市为网络出口位置"
        menu.addItem(address)
        menu.addItem(.separator())
        for (id, label) in [("five_hour:primary", "5小时"), ("seven_day:primary", "周")] {
            guard let window = snapshot?.windows.first(where: { $0.id == id }) else { continue }
            let remaining = window.remaining.map { "\(Int($0.rounded()))%" } ?? "未知"
            let reset = resetDescription(window.resetsAt, weekly: id == "seven_day:primary")
            let option = item("\(label) · \(remaining) · \(reset)", #selector(selectPercentage(_:)))
            option.representedObject = id
            option.state = (ring.displaysWeeklyPercentage == (id == "seven_day:primary")) ? .on : .off
            menu.addItem(option)
        }
        menu.addItem(item(query == nil ? "立即刷新" : "正在刷新…", query == nil ? #selector(refresh) : nil))
        let alarm = item("额度可用提醒", reminderAuthorizing ? nil : #selector(toggleReminder))
        alarm.state = reminder == nil ? .off : .on
        menu.addItem(alarm)
        if let reminder {
            menu.addItem(item("等待额度恢复 · " + resetDescription(reminder.due, weekly: true), nil))
        }
        if let reminderError { menu.addItem(item(reminderError, nil)) }
        menu.addItem(item("恢复默认位置", #selector(resetPosition)))
        menu.addItem(.separator())
        let toggle = item("显示时间", #selector(toggleClock))
        toggle.state = clockEnabled ? .on : .off
        menu.addItem(toggle)
        let follow = item("跟随IP时区", #selector(toggleFollowIPTimeZone))
        follow.state = followIPTimeZone ? .on : .off
        menu.addItem(follow)
        if followIPTimeZone && ipClock.zone == nil {
            menu.addItem(item("IP时区不可用，显示自定义时间", nil))
        }
        if !followIPTimeZone {
            let zones = NSMenu()
            for city in ClockCity.presets {
                let option = item(city.name, #selector(selectTimeZone(_:)))
                option.representedObject = city.name
                option.state = clock.cityName == city.name && clock.zone.identifier == city.identifier ? .on : .off
                zones.addItem(option)
            }
            zones.addItem(item("自定义时区…", #selector(customTimeZone)))
            let zoneItem = item("\(clock.cityName)·\(clockText(at: Date(), zone: clock.zone))", nil)
            zoneItem.submenu = zones
            menu.addItem(zoneItem)
        }
        menu.addItem(.separator())
        let updateItem = item(updater == nil ? "更新版本·\(appVersion)" : "正在更新…·\(appVersion)",
                              updater == nil ? #selector(updateVersion) : nil)
        if updateAvailable {
            let title = NSMutableAttributedString(string: updateItem.title + "\t●")
            let style = NSMutableParagraphStyle()
            style.tabStops = [NSTextTab(textAlignment: .right, location: 230)]
            title.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: title.length))
            title.addAttribute(.foregroundColor, value: NSColor.systemGreen,
                               range: NSRange(location: title.length - 1, length: 1))
            updateItem.attributedTitle = title
            updateItem.setAccessibilityHelp("有新版本可更新")
        }
        menu.addItem(updateItem)
        let automatic = item("自动更新", #selector(toggleAutomaticUpdates))
        automatic.state = UserDefaults.standard.bool(forKey: "automaticUpdatesEnabled") ? .on : .off
        menu.addItem(automatic)
        if let automaticUpdateError { menu.addItem(item(automaticUpdateError, nil)) }
        if let versionCheckError { menu.addItem(item(versionCheckError, nil)) }
        let startup = item("开机启动", #selector(toggleLoginStartup))
        startup.state = LoginStartup.enabled() ? .on : .off
        startup.toolTip = "登录当前macOS用户后自动打开浮窗"
        menu.addItem(startup)
        menu.addItem(item("退出浮窗", #selector(quit)))
        return menu
    }
    @objc func toggleLoginStartup() {
        do {
            let cli = URL(fileURLWithPath: script).deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("bin/easy-claude.js").path
            let environment = ["PATH": searchPath]

            try LoginStartup.setEnabled(!LoginStartup.enabled(), node: node, cli: cli, environment: environment)
        } catch {
            let alert = NSAlert()
            alert.messageText = "无法设置开机启动"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let fresh = makeMenu()
        for item in fresh.items { fresh.removeItem(item); menu.addItem(item) }
    }
    @objc func selectPercentage(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        ring.showWeeklyPercentage = id == "seven_day:primary"
        UserDefaults.standard.set(ring.showWeeklyPercentage, forKey: "showWeeklyPercentage")
        updateRing()
    }
    @objc func toggleClock() {
        clockEnabled.toggle()
        UserDefaults.standard.set(clockEnabled, forKey: "clockEnabled")
        tick()
    }
    func setTimeZone(_ identifier: String, cityName: String? = nil) -> Bool {
        guard let zone = TimeZone(identifier: identifier) else { return false }
        manualClockZone = zone
        manualClockCity = cityName ?? ClockCity.presets.first { $0.identifier == zone.identifier }?.name ?? zone.identifier
        UserDefaults.standard.set(manualClockCity, forKey: "clockCity")
        UserDefaults.standard.set(zone.identifier, forKey: "clockTimeZone")
        followIPTimeZone = false
        UserDefaults.standard.set(false, forKey: "followIPTimeZone")
        applyClockTimeZone()
        return true
    }
    @objc func selectTimeZone(_ sender: NSMenuItem) {
        if let name = sender.representedObject as? String,
           let city = ClockCity.presets.first(where: { $0.name == name }) {
            _ = setTimeZone(city.identifier, cityName: city.name)
        }
    }
    @objc func customTimeZone() {
        let alert = NSAlert()
        alert.messageText = "设置电子时钟时区"
        alert.informativeText = "输入 IANA 时区，例如 America/Los_Angeles；自动适应夏令时。"
        let field = NSTextField(string: clock.zone.identifier)
        field.frame = CGRect(x: 0, y: 0, width: 300, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        while alert.runModal() == .alertFirstButtonReturn {
            if setTimeZone(field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) { break }
            alert.informativeText = "无效时区，请输入有效的 IANA 名称，例如 America/Los_Angeles。"
        }
    }
    @objc func resetPosition() {
        clockInset = CGPoint(x: 164, y: 0)
        UserDefaults.standard.removeObject(forKey: "clockLeftInset")
        UserDefaults.standard.removeObject(forKey: "clockBottomInset")
        inset = CGPoint(x: 138, y: 4)
        UserDefaults.standard.removeObject(forKey: "leftInset")
        UserDefaults.standard.removeObject(forKey: "bottomInset")
        tick()
    }
    func checkVersionIfNeeded() {
        let prefs = UserDefaults.standard
        updateAvailable = prefs.string(forKey: "updateCheckedVersion") == appVersion
            && prefs.bool(forKey: "updateAvailable")
        let last = prefs.double(forKey: "updateLastAttempt")
        guard versionCheck == nil, !script.isEmpty,
              versionCheckDue(lastAttempt: last, checkedVersion: prefs.string(forKey: "updateCheckedVersion"),
                              currentVersion: appVersion) else { return }
        if prefs.string(forKey: "updateCheckedVersion") != appVersion {
            prefs.set(false, forKey: "updateAvailable")
            updateAvailable = false
        }
        prefs.set(appVersion, forKey: "updateCheckedVersion")
        prefs.set(Date().timeIntervalSince1970, forKey: "updateLastAttempt")
        versionCheckError = nil
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [URL(fileURLWithPath: script).deletingLastPathComponent()
            .appendingPathComponent("check-update.js").path]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = searchPath
        process.environment = env
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let available = process.terminationStatus == 0 ? value?["available"] as? Bool : nil
            Task { @MainActor in
                guard let self else { return }
                self.versionCheck = nil
                guard let available else {
                    self.versionCheckError = "版本检查失败，保留上次结果"
                    return
                }
                self.versionCheckError = nil
                self.updateAvailable = available
                UserDefaults.standard.set(available, forKey: "updateAvailable")
                if available && UserDefaults.standard.bool(forKey: "automaticUpdatesEnabled") {
                    self.startUpdate(automatic: true)
                }
            }
        }
        versionCheck = process
        do { try process.run() }
        catch { versionCheck = nil; versionCheckError = "版本检查失败，保留上次结果" }
    }
    @objc func toggleAutomaticUpdates() {
        let prefs = UserDefaults.standard
        let enabled = !prefs.bool(forKey: "automaticUpdatesEnabled")
        prefs.set(enabled, forKey: "automaticUpdatesEnabled")
        if enabled && updateAvailable { startUpdate(automatic: true) }
    }
    @objc func updateVersion() { startUpdate(automatic: false) }
    func startUpdate(automatic: Bool) {
        guard updater == nil else { return }
        automaticUpdateError = nil
        let cli = URL(fileURLWithPath: script).deletingLastPathComponent()
            .appendingPathComponent("overlay-update.js")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [cli.path]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = searchPath
        process.environment = env
        // npm 输出可能超过管道容量，写临时文件以免等待退出时死锁。
        let output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        guard FileManager.default.createFile(atPath: output.path, contents: nil,
            attributes: [.posixPermissions: 0o600]), let handle = try? FileHandle(forUpdating: output) else {
            if automatic { automaticUpdateError = "自动更新失败：无法创建更新日志" }
            else { showUpdateResult("无法创建更新日志，请检查临时目录权限。") }
            return
        }
        // 先取消文件名，描述符仍可读写；旧浮窗退出后也不会遗留日志。
        do { try FileManager.default.removeItem(at: output) }
        catch {
            try? handle.close()
            if automatic { automaticUpdateError = "自动更新失败：无法清理临时日志" }
            else { showUpdateResult("无法清理临时更新日志，请检查临时目录权限。") }
            return
        }
        process.standardOutput = handle
        process.standardError = handle
        process.terminationHandler = { [weak self] process in
            try? handle.seek(toOffset: 0)
            let data = (try? handle.readToEnd()) ?? Data()
            try? handle.close()
            let message = String(decoding: data.suffix(4096), as: UTF8.self)
            Task { @MainActor in
                guard let self else { return }
                self.updater = nil
                if automatic {
                    if process.terminationStatus != 0 { self.automaticUpdateError = "自动更新失败，请点击更新版本查看原因" }
                } else {
                    self.showUpdateResult(process.terminationStatus == 0
                        ? message : "更新失败，请检查网络或安装目录权限。\n" + message)
                }
            }
        }
        updater = process
        do { try process.run() }
        catch {
            updater = nil
            try? handle.close()
            if automatic { automaticUpdateError = "自动更新失败：无法启动更新" }
            else { showUpdateResult("无法启动更新，请重新运行 easy-claude show。") }
        }
    }
    func showUpdateResult(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "更新版本"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        ipQuery?.terminate()
        timer?.invalidate()
        query?.terminate()
        versionCheck?.terminate()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }
}

@main
struct Main {
    @MainActor static func main() {
        if CommandLine.arguments.count >= 2 && CommandLine.arguments[1] == "--with-update-lock" {
            let args = CommandLine.arguments
            guard args.count >= 5 else { exit(72) }
            let fd = Darwin.open(args[2], O_RDWR | O_CREAT | O_NOFOLLOW | O_EXLOCK | O_NONBLOCK, mode_t(0o600))
            guard fd >= 0 else { exit(errno == EWOULDBLOCK || errno == EAGAIN ? 75 : 73) }
            // 更新不读取交互输入；通过stdin把同一个内核锁传给Node和npm子进程。
            guard dup2(fd, STDIN_FILENO) >= 0 else { Darwin.close(fd); exit(73) }
            if fd != STDIN_FILENO { Darwin.close(fd) }
            var argv = Array(args.dropFirst(3)).map { strdup($0) } + [nil]
            argv.withUnsafeMutableBufferPointer { buffer in
                _ = execv(args[3], buffer.baseAddress!)
            }
            for value in argv { free(value) }
            exit(74)
        }

        if CommandLine.arguments.contains("--self-test") {
            let manualIPTest = TimeZone(identifier: "Asia/Shanghai")!
            var ipClockTest = IPClockState()
            precondition(ipClockTest.resolved(manual: manualIPTest, following: true) == manualIPTest)
            precondition(ipClockTest.update("America/Los_Angeles"))
            precondition(ipClockTest.resolved(manual: manualIPTest, following: true).identifier == "America/Los_Angeles")
            precondition(ipClockTest.resolved(manual: manualIPTest, following: false) == manualIPTest)
            precondition(!ipClockTest.update(nil) && !ipClockTest.update("Invalid/Zone"))
            precondition(ipClockTest.zone == nil)
            precondition(ipClockTest.resolved(manual: manualIPTest, following: true) == manualIPTest)
            precondition(ipClockTest.update("Asia/Singapore"))
            precondition(ipClockTest.resolved(manual: manualIPTest, following: true).identifier == "Asia/Singapore")
            _ = NSApplication.shared
            let periodZone = TimeZone(secondsFromGMT: 0)!
            for (minutes, expected) in [(0,"凌晨"),(359,"凌晨"),(360,"上午"),(719,"上午"),(720,"下午"),(1079,"下午"),(1080,"晚上"),(1259,"晚上"),(1260,"深夜"),(1439,"深夜")] {
                let date = Date(timeIntervalSince1970: Double(minutes * 60))
                precondition(clockPeriod(at: date, zone: periodZone) == expected)
                precondition(clockText(at: date, zone: periodZone, locale: Locale(identifier: "en_US")).contains(expected))
            }
            let midnight = Date(timeIntervalSince1970: 12 * 60)
            precondition(clockText(at: midnight, zone: periodZone, locale: Locale(identifier: "en_US")) == "凌晨 00:12")
            precondition(clockText(at: midnight, zone: periodZone, locale: Locale(identifier: "en_GB")) == "00:12")
            precondition(clockText(at: Date(timeIntervalSince1970: 12 * 3600 + 12 * 60), zone: periodZone, locale: Locale(identifier: "en_US")) == "下午 12:12")
            precondition(clockPeriod(at: midnight, zone: TimeZone(identifier: "Asia/Shanghai")!) == "上午")
            let startupTest = FileManager.default.temporaryDirectory.appendingPathComponent("easy-startup-" + UUID().uuidString)
            let startupFile = startupTest.appendingPathComponent("launch.plist")
            do {
                defer { try? FileManager.default.removeItem(at: startupTest) }
                precondition(!LoginStartup.enabled(at: startupFile))
                try FileManager.default.createDirectory(at: startupTest, withIntermediateDirectories: true)
                let cli = startupTest.appendingPathComponent("tool with spaces.js")
                try Data().write(to: cli)
                try LoginStartup.setEnabled(true, node: "/usr/bin/true", cli: cli.path, environment: ["PATH":"/usr/bin"], at: startupFile)
                precondition(LoginStartup.enabled(at: startupFile))
                let config = try PropertyListSerialization.propertyList(from: Data(contentsOf: startupFile), options: [], format: nil) as! [String: Any]
                precondition(config["ProgramArguments"] as? [String] == ["/usr/bin/true", cli.path, "show"])
                precondition(config["RunAtLoad"] as? Bool == true && config["KeepAlive"] == nil)
                try LoginStartup.setEnabled(false, node: "", cli: "", environment: [:], at: startupFile)
                precondition(!LoginStartup.enabled(at: startupFile))
                do {
                    try LoginStartup.setEnabled(true, node: "relative", cli: cli.path, environment: [:], at: startupFile)
                    preconditionFailure("无效启动路径不得保存")
                } catch { precondition(!LoginStartup.enabled(at: startupFile)) }
            } catch { preconditionFailure("登录启动配置测试失败：\(error)") }
            print("12小时时段边界、零点/正午及登录启动开关自检通过")

            for time in ["8:52", "12:59", "上午8:52"] {
                let font = fittedClockFont(for: time, width: 96, baseSize: 20)
                let width = (time as NSString).size(withAttributes: [.font: font]).width
                for city in ["Los Angeles", "上海", String(repeating: "W", count: 60)] {
                    let cityFont = fittedClockFont(for: city, width: width, baseSize: 10)
                    precondition((city as NSString).size(withAttributes: [.font: cityFont]).width <= width + 0.01)
                }
            }

            let clockMenuTest = Overlay()
            clockMenuTest.manualClockZone = manualIPTest
            clockMenuTest.manualClockCity = "上海"
            clockMenuTest.followIPTimeZone = true
            clockMenuTest.receiveIPTimeZone("America/Los_Angeles", city: "Los Angeles")
            clockMenuTest.applyClockTimeZone()
            precondition(clockMenuTest.clock.zone.identifier == "America/Los_Angeles")
            precondition(clockMenuTest.clock.cityName == "Los Angeles")
            clockMenuTest.receiveIPTimeZone("America/Los_Angeles")
            precondition(clockMenuTest.clock.cityName == "城市未知")
            clockMenuTest.receiveIPTimeZone("America/Los_Angeles", city: "Los Angeles")
            precondition(!clockMenuTest.makeMenu().items.contains { $0.submenu != nil })
            clockMenuTest.receiveIPTimeZone(nil)
            precondition(clockMenuTest.clock.zone == manualIPTest && clockMenuTest.clock.cityName == "上海")
            precondition(clockMenuTest.followIPTimeZone)
            clockMenuTest.followIPTimeZone = false
            clockMenuTest.applyClockTimeZone()
            precondition(clockMenuTest.makeMenu().items.contains { $0.submenu != nil })
            print("跟随IP时区：开关、手动恢复、失败回退及出口变化检查通过")
            precondition(publicIPText(ip: nil, city: "City") == "IP异常")
            precondition(publicIPText(ip: "203.0.113.1", city: nil) == "城市未知·203.0.113.1")
            precondition(publicIPText(ip: "203.0.113.1", city: "City") == "City·203.0.113.1")
            func quota(_ id: String, _ remaining: Double?, _ reset: Double?) -> UsageWindow {
                UsageWindow(id: id, label: id, name: id, remaining: remaining, resetsAt: reset)
            }
            let a = quota("five", 0, 3700), b = quota("week", 0, 7300)
            precondition(AvailabilityReminder.arm([a, b], now: 100)?.due == 7300)
            precondition(AvailabilityReminder.arm([quota("five", 0, 10900), b], now: 100)?.due == 10900)
            precondition(AvailabilityReminder.arm([a, quota("week", 30, 7300)], now: 100)?.due == 3700)
            precondition(AvailabilityReminder.arm([b], now: 100)?.due == 7300)
            precondition(AvailabilityReminder.arm([quota("five", 10, 3700)], now: 100) == nil)
            precondition(AvailabilityReminder.arm([quota("five", nil, 3700)], now: 100) == nil)
            precondition(AvailabilityReminder.arm([quota("five", 0, nil)], now: 100) == nil)
            var alarm = AvailabilityReminder.arm([a, b], now: 100)!
            let restored = try! JSONDecoder().decode(AvailabilityReminder.self, from: JSONEncoder().encode(alarm))
            precondition(restored.ids == alarm.ids && restored.due == 7300)
            let usable = [quota("five", 100, 18000), quota("week", 100, 600000)]
            precondition(!alarm.recovered(usable, fetchedAt: 7300, restricted: false, now: 7299))
            precondition(!alarm.recovered(usable, fetchedAt: 7200, restricted: false, now: 7400))
            precondition(!alarm.recovered(usable, fetchedAt: 7300, restricted: false, now: 7500))
            precondition(!alarm.recovered(usable, fetchedAt: 7400, restricted: true, now: 7400))
            precondition(!alarm.recovered([usable[0]], fetchedAt: 7400, restricted: false, now: 7400))
            precondition(!alarm.recovered([quota("five", nil, 18000), usable[1]], fetchedAt: 7400, restricted: false, now: 7400))
            precondition(alarm.recovered(usable, fetchedAt: 7400, restricted: false, now: 7400))
            precondition(!alarm.recovered([quota("five", 0, 18000), usable[1]], fetchedAt: 7400, restricted: false, now: 7400))
            precondition(alarm.due == 18000)
            print("额度提醒：较晚恢复、单窗口、未知/过期/受限、重启保存及再次耗尽检查通过")
            let preferenceSuite = "easy-auto-update-self-test-" + UUID().uuidString
            let preferences = UserDefaults(suiteName: preferenceSuite)!
            precondition(!preferences.bool(forKey: "automaticUpdatesEnabled"))
            preferences.set(true, forKey: "automaticUpdatesEnabled")
            precondition(UserDefaults(suiteName: preferenceSuite)!.bool(forKey: "automaticUpdatesEnabled"))
            preferences.set(false, forKey: "automaticUpdatesEnabled")
            precondition(!preferences.bool(forKey: "automaticUpdatesEnabled"))
            preferences.removePersistentDomain(forName: preferenceSuite)
            precondition(!versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.0", now: 86499))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.0", now: 86500))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: nil, currentVersion: "1.0.0", now: 100))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.1", now: 100))
            precondition(ClockCity.presets.map(\.name) == ["硅谷", "洛杉矶", "西雅图", "华盛顿", "哥伦布", "新加坡", "上海"])
            precondition(ClockCity.presets.allSatisfy { TimeZone(identifier: $0.identifier) != nil })
            let countdownStart = ISO8601DateFormatter().date(from: "2026-10-15T04:57:00Z")!
            let countdownUTC = TimeZone(secondsFromGMT: 0)!
            let afternoon = ISO8601DateFormatter().date(from: "2026-10-21T14:30:00Z")!
            for identifier in ["en_US", "en_GB", "zh_CN"] {
                let text = clockText(at: afternoon, zone: countdownUTC, locale: Locale(identifier: identifier))
                if identifier == "en_US" { precondition(text.contains("下午") && !text.contains("14:30")) }
                else { precondition(text == "14:30") }
                let font = fittedClockFont(for: text, width: 96, baseSize: 20)
                precondition((text as NSString).size(withAttributes: [.font: font]).width <= 96 - 1)
            }
            let laClock = clockText(at: afternoon, zone: TimeZone(identifier: "America/Los_Angeles")!, locale: Locale(identifier: "en_US"))
            precondition(laClock.contains("7:30") && laClock.contains("上午"))

            let morning = ISO8601DateFormatter().date(from: "2026-10-21T02:30:00Z")!
            for weekly in [false, true] {
                let us = resetDescription(afternoon.timeIntervalSince1970, weekly: weekly,
                    now: morning, zone: countdownUTC, locale: Locale(identifier: "en_US"))
                precondition(us.contains("2:30") && us.contains("PM") && !us.contains("14:30"))
                precondition(!weekly || us.contains("21日"))
                let gb = resetDescription(afternoon.timeIntervalSince1970, weekly: weekly,
                    now: morning, zone: countdownUTC, locale: Locale(identifier: "en_GB"))
                precondition(gb.contains("14:30") && !gb.contains("PM"))
                let am = resetDescription(morning.timeIntervalSince1970, weekly: weekly,
                    now: morning.addingTimeInterval(-60), zone: countdownUTC, locale: Locale(identifier: "en_US"))
                precondition(am.contains("2:30") && am.contains("AM"))
            }
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 10920, weekly: false, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "3小时2分后 07:59 重置")
            let weekStart = ISO8601DateFormatter().date(from: "2026-10-14T08:03:00Z")!
            precondition(resetDescription(weekStart.timeIntervalSince1970 + 345360, weekly: true, now: weekStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "3天后 18日 07:59 重置")
            precondition(resetDescription(nil, weekly: true) == "重置时间未知")
            precondition(resetDescription(countdownStart.timeIntervalSince1970, weekly: false, now: countdownStart) == "已到重置时间，等待更新")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 1, weekly: false, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "1分后 04:57 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86160, weekly: true, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "23小时后 16日 04:53 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 120, weekly: true, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "2分钟后 15日 04:59 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86400, weekly: true, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "1天后 16日 04:57 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86399, weekly: true, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "23小时后 16日 04:56 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 3599, weekly: false, now: countdownStart, zone: countdownUTC, locale: Locale(identifier: "en_GB")) == "1小时后 05:56 重置")
            let testRing = RingView()
            testRing.showFiveHourRing = false
            precondition(testRing.displaysWeeklyPercentage)
            testRing.showWeeklyPercentage = true
            testRing.showWeeklyRing = false
            testRing.showFiveHourRing = true
            precondition(!testRing.displaysWeeklyPercentage)
            let la = TimeZone(identifier: "America/Los_Angeles")!
            let singapore = TimeZone(identifier: "Asia/Singapore")!
            let winter = ISO8601DateFormatter().date(from: "2026-01-15T12:00:00Z")!
            let summer = ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z")!
            precondition(clockText(at: winter, zone: la, locale: Locale(identifier: "en_GB")) == "04:00")
            precondition(clockText(at: summer, zone: la, locale: Locale(identifier: "en_GB")) == "05:00")
            precondition(clockText(at: winter, zone: singapore, locale: Locale(identifier: "en_GB")) == "20:00")
            precondition(TimeZone(identifier: "Invalid/Zone") == nil)
            let utc = TimeZone(secondsFromGMT: 0)!
            for (hour, state) in [(0, RingState.red), (6, .red), (8, .red), (9, .green), (14, .green), (15, .green), (17, .green), (18, .orange), (23, .orange)] {
                let date = Date(timeIntervalSince1970: Double(hour * 3600))
                precondition(clockState(at: date, zone: utc) == state)
            }
            for (seconds, state) in [(32399.0, RingState.red), (32400.0, .green), (64799.0, .green), (64800.0, .orange), (86400.0, .red)] {
                precondition(clockState(at: Date(timeIntervalSince1970: seconds), zone: utc) == state)
            }
            precondition(clockState(at: winter, zone: la) == .red)
            precondition(clockState(at: winter, zone: singapore) == .orange)
            assert(RingState.resolve(51, stale: false) == .green)
            assert(RingState.resolve(50, stale: false) == .orange)
            assert(RingState.resolve(20, stale: false) == .orange)
            assert(RingState.resolve(19, stale: false) == .red)
            assert(RingState.resolve(nil, stale: false) == .unknown)
            assert(RingState.resolve(99, stale: true) == .unknown)
            assert(appKitRect(CGRect(x: -900, y: 100, width: 800, height: 600), primaryHeight: 900).origin == CGPoint(x: -900, y: 200))
            let bounds = CGRect(x: 100, y: 100, width: 800, height: 600)
            assert(ringOrigin(in: bounds, inset: CGPoint(x: 138, y: 4)) == CGPoint(x: 238, y: 104))
            assert(ringOrigin(in: bounds, inset: CGPoint(x: -100, y: -100)) == CGPoint(x: 100, y: 100))
            assert(ringOrigin(in: bounds, inset: CGPoint(x: 9999, y: 9999)) == CGPoint(x: 868, y: 668))
            print("Swift 圆环颜色与窗口坐标检查通过")
            return
        }
        if CommandLine.arguments.contains("--quit-running") {
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.unionschool.easy-claude.overlay")
                .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
            for app in running { _ = app.terminate() }
            let deadline = Date().addingTimeInterval(5)
            while running.contains(where: { !$0.isTerminated }), Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
            if running.contains(where: { !$0.isTerminated }) {
                fputs("旧浮窗尚未退出，请从菜单退出后重试。\n", stderr)
                exit(1)
            }
            return
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--diagnose") {
            print("targetFrontmost=\(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.anthropic.claudefordesktop")")
            print("targetWindow=\(targetWindow().map { NSStringFromRect($0) } ?? "unavailable")")
            return
        }
        if let i = CommandLine.arguments.firstIndex(of: "--render-preview"), CommandLine.arguments.count > i + 1 {
            let image = NSImage(size: NSSize(width: 340, height: 100))
            image.lockFocus()
            for (index, value) in [75.0, 35.0, 10.0, -1.0].enumerated() {
                NSGraphicsContext.saveGraphicsState()
                let transform = AffineTransform(translationByX: CGFloat(index * 84 + 4), byY: 8)
                (transform as NSAffineTransform).concat()
                let view = RingView(frame: CGRect(x: 0, y: 0, width: 32, height: 32))
                view.remaining = value < 0 ? nil : value; view.stale = value < 0
                view.weeklyRemaining = value < 0 ? nil : 100 - value; view.weeklyStale = value < 0
                if index == 0 { view.showFiveHourRing = false }
                if index == 1 { view.showWeeklyRing = false }
                view.caption = value < 0 ? "额度未知" : "7天"
                view.draw(view.bounds)
                NSGraphicsContext.restoreGraphicsState()
            }
            image.unlockFocus()
            if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                do { try png.write(to: URL(fileURLWithPath: CommandLine.arguments[i+1])) }
                catch { fputs("预览写入失败\n", stderr); exit(1) }
            }
            return
        }
        let delegate = Overlay()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
