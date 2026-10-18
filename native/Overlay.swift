import AppKit
import CoreGraphics

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

func resetDescription(_ resetsAt: Double?, weekly: Bool, now: Date = Date(), zone: TimeZone = .current) -> String {
    guard let resetsAt, resetsAt.isFinite, abs(resetsAt) < 8.64e12 else { return "重置时间未知" }
    let remaining = resetsAt - now.timeIntervalSince1970
    guard remaining > 0 else { return "已到重置时间，等待更新" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = zone
    formatter.dateFormat = weekly ? "d'日' HH:mm" : "HH:mm"
    let time = formatter.string(from: Date(timeIntervalSince1970: resetsAt))
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

func clockText(at date: Date, zone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = zone
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
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
        (time as NSString).draw(in: CGRect(x: 0, y: 17, width: bounds.width, height: 25),
            withAttributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 20, weight: .medium),
                             .foregroundColor: clockState(at: now, zone: zone).color, .paragraphStyle: style])
        let city = cityName
        (city as NSString).draw(in: CGRect(x: 0, y: 1, width: bounds.width, height: 15),
            withAttributes: [.font: NSFont.systemFont(ofSize: 10),
                             .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: style])
    }
}

@MainActor
final class Overlay: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let panel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 32, height: 32),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let ring = RingView(frame: CGRect(x: 0, y: 0, width: 32, height: 32))
    let clockPanel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 96, height: 46),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let clock = ClockView(frame: CGRect(x: 0, y: 0, width: 96, height: 46))
    var clockInset = CGPoint(x: 164, y: 0)
    var clockEnabled = true
    var status: NSStatusItem?
    var timer: Timer?
    var query: Process?
    var updater: Process?
    var versionCheck: Process?
    var updateAvailable = false
    let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "未知"
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
                self.updateRing()
            }
        }
        query = process
        do { try process.run() }
        catch { query = nil; self.error = "无法启动额度查询，请重新运行 easy-claude show"; updateRing() }
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
        menu.addItem(item("恢复默认位置", #selector(resetPosition)))
        menu.addItem(.separator())
        let toggle = item("显示时间", #selector(toggleClock))
        toggle.state = clockEnabled ? .on : .off
        menu.addItem(toggle)
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
        menu.addItem(item("退出浮窗", #selector(quit)))
        return menu
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
        clock.zone = zone
        clock.cityName = cityName ?? ClockCity.presets.first { $0.identifier == zone.identifier }?.name ?? zone.identifier
        UserDefaults.standard.set(clock.cityName, forKey: "clockCity")
        UserDefaults.standard.set(zone.identifier, forKey: "clockTimeZone")
        clock.needsDisplay = true
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
        prefs.set(appVersion, forKey: "updateCheckedVersion")
        prefs.set(Date().timeIntervalSince1970, forKey: "updateLastAttempt")
        prefs.set(false, forKey: "updateAvailable")
        updateAvailable = false
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
            let available = process.terminationStatus == 0 && value?["available"] as? Bool == true
            Task { @MainActor in
                guard let self else { return }
                self.versionCheck = nil
                self.updateAvailable = available
                UserDefaults.standard.set(available, forKey: "updateAvailable")
            }
        }
        versionCheck = process
        do { try process.run() }
        catch { versionCheck = nil }
    }
    @objc func updateVersion() {
        guard updater == nil else { return }
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
            attributes: [.posixPermissions: 0o600]), let handle = try? FileHandle(forWritingTo: output) else {
            showUpdateResult("无法创建更新日志，请检查临时目录权限。")
            return
        }
        process.standardOutput = handle
        process.standardError = handle
        process.terminationHandler = { [weak self] process in
            try? handle.close()
            let data = (try? Data(contentsOf: output)) ?? Data()
            try? FileManager.default.removeItem(at: output)
            let message = String(decoding: data.suffix(4096), as: UTF8.self)
            Task { @MainActor in
                guard let self else { return }
                self.updater = nil
                self.showUpdateResult(process.terminationStatus == 0
                    ? message : "更新失败，请检查网络或安装目录权限。\n" + message)
            }
        }
        updater = process
        do { try process.run() }
        catch {
            updater = nil
            try? handle.close()
            try? FileManager.default.removeItem(at: output)
            showUpdateResult("无法启动更新，请重新运行 easy-claude show。")
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
        timer?.invalidate()
        query?.terminate()
        versionCheck?.terminate()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }
}

@main
struct Main {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            precondition(!versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.0", now: 86499))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.0", now: 86500))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: nil, currentVersion: "1.0.0", now: 100))
            precondition(versionCheckDue(lastAttempt: 100, checkedVersion: "1.0.0", currentVersion: "1.0.1", now: 100))
            precondition(ClockCity.presets.map(\.name) == ["硅谷", "洛杉矶", "西雅图", "华盛顿", "哥伦布", "新加坡", "上海"])
            precondition(ClockCity.presets.allSatisfy { TimeZone(identifier: $0.identifier) != nil })
            let countdownStart = ISO8601DateFormatter().date(from: "2026-10-15T04:57:00Z")!
            let countdownUTC = TimeZone(secondsFromGMT: 0)!
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 10920, weekly: false, now: countdownStart, zone: countdownUTC) == "3小时2分后 07:59 重置")
            let weekStart = ISO8601DateFormatter().date(from: "2026-10-14T08:03:00Z")!
            precondition(resetDescription(weekStart.timeIntervalSince1970 + 345360, weekly: true, now: weekStart, zone: countdownUTC) == "3天后 18日 07:59 重置")
            precondition(resetDescription(nil, weekly: true) == "重置时间未知")
            precondition(resetDescription(countdownStart.timeIntervalSince1970, weekly: false, now: countdownStart) == "已到重置时间，等待更新")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 1, weekly: false, now: countdownStart, zone: countdownUTC) == "1分后 04:57 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86160, weekly: true, now: countdownStart, zone: countdownUTC) == "23小时后 16日 04:53 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 120, weekly: true, now: countdownStart, zone: countdownUTC) == "2分钟后 15日 04:59 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86400, weekly: true, now: countdownStart, zone: countdownUTC) == "1天后 16日 04:57 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 86399, weekly: true, now: countdownStart, zone: countdownUTC) == "23小时后 16日 04:56 重置")
            precondition(resetDescription(countdownStart.timeIntervalSince1970 + 3599, weekly: false, now: countdownStart, zone: countdownUTC) == "1小时后 05:56 重置")
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
            precondition(clockText(at: winter, zone: la) == "04:00")
            precondition(clockText(at: summer, zone: la) == "05:00")
            precondition(clockText(at: winter, zone: singapore) == "20:00")
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
