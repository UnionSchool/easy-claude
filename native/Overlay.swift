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
final class RingView: NSView {
    var remaining: Double?
    var stale = true
    var caption = "等待额度"
    var makeMenu: (() -> NSMenu)?
    var moved: ((CGPoint) -> Void)?
    var refresh: (() -> Void)?
    var dragging = false
    private var dragStart = CGPoint.zero
    private var originStart = CGPoint.zero

    override func draw(_ dirtyRect: NSRect) {
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let track = NSBezierPath(ovalIn: CGRect(x: center.x - 14, y: center.y - 14, width: 28, height: 28))
        track.lineWidth = 2
        NSColor.labelColor.withAlphaComponent(0.12).setStroke()
        track.stroke()
        let state = RingState.resolve(remaining, stale: stale)
        if let remaining, remaining > 0, !stale {
            let arc = NSBezierPath()
            arc.lineWidth = 2
            arc.lineCapStyle = .round
            arc.appendArc(withCenter: center, radius: 14, startAngle: 90,
                          endAngle: 90 - CGFloat(min(100, max(0, remaining))) * 3.6, clockwise: true)
            state.color.setStroke()
            arc.stroke()
        }
        let text = remaining.map { "\(Int($0.rounded()))%" } ?? "—"
        drawText(text, y: 10, font: .monospacedDigitSystemFont(ofSize: 9, weight: .semibold), color: state.color)
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

@MainActor
final class Overlay: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let panel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 32, height: 32),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let ring = RingView(frame: CGRect(x: 0, y: 0, width: 32, height: 32))
    var status: NSStatusItem?
    var timer: Timer?
    var query: Process?
    var snapshot: Snapshot?
    var error: String?
    var selectedID: String?
    var lastAttempt = Date.distantPast
    var lastRect: CGRect?
    var inset = CGPoint(x: 10, y: 74)
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
        selectedID = prefs.string(forKey: "selectedWindow")
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
    @objc func hide() { panel.orderOut(nil) }
    @objc func tick() {
        guard let rect = targetWindow() else { panel.orderOut(nil); lastRect = nil; return }
        lastRect = rect
        if !ring.dragging { panel.setFrameOrigin(ringOrigin(in: rect, inset: inset)) }
        if !panel.isVisible { panel.orderFrontRegardless() }
        if Date().timeIntervalSince(lastAttempt) >= 300 { refresh() }
        updateRing()
    }
    var chosen: UsageWindow? {
        guard let windows = snapshot?.windows else { return nil }
        if let selectedID { return windows.first { $0.id == selectedID } }
        // 默认优先 claude 桶，取其中最紧张的窗口，不把不同窗口相加。
        let claude = windows.filter { $0.id.hasPrefix("claude:") }
        return (claude.isEmpty ? windows : claude).filter { $0.remaining != nil }.min { $0.remaining! < $1.remaining! }
            ?? windows.first
    }
    func updateRing() {
        let stale = error != nil || snapshot == nil || Date().timeIntervalSince1970 - (snapshot?.fetchedAt ?? 0) > 600
            || (chosen?.resetsAt.map { $0 <= Date().timeIntervalSince1970 } ?? false)
        ring.remaining = chosen?.remaining
        ring.stale = stale
        ring.caption = stale ? (snapshot == nil ? "等待额度" : "数据过期") : chosen?.label ?? "额度未知"
        let fetched = snapshot.map { Date(timeIntervalSince1970: $0.fetchedAt).formatted(date: .omitted, time: .standard) } ?? "尚未更新"
        ring.toolTip = "本机 Claude CLI 账号额度\n\(chosen?.name ?? "未选择窗口")\n\(error ?? snapshot?.detail ?? "正在读取")\n状态：\(stale ? "数据未知或已过期" : "已更新")\n更新时间：\(fetched)\n拖动校准位置；双击刷新；右键打开菜单"
        ring.setAccessibilityLabel("Claude \(chosen?.name ?? "") 剩余 \(chosen?.remaining.map { "\(Int($0.rounded()))%" } ?? "未知")，\(ring.caption)")
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
        catch { query = nil; self.error = "无法启动额度查询，请重新运行 easy-claude overlay"; updateRing() }
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
        for window in snapshot?.windows ?? [] {
            let remaining = window.remaining.map { "\(Int($0.rounded()))%" } ?? "未知"
            let option = item("\(window.name) · \(remaining)", #selector(selectWindow(_:)))
            option.representedObject = window.id
            option.state = chosen?.id == window.id ? .on : .off
            menu.addItem(option)
        }
        menu.addItem(item(query == nil ? "立即刷新" : "正在刷新…", query == nil ? #selector(refresh) : nil))
        menu.addItem(item("恢复默认位置", #selector(resetPosition)))
        menu.addItem(.separator())
        menu.addItem(item("退出浮窗", #selector(quit)))
        return menu
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let fresh = makeMenu()
        for item in fresh.items { fresh.removeItem(item); menu.addItem(item) }
    }
    @objc func selectWindow(_ sender: NSMenuItem) {
        selectedID = sender.representedObject as? String
        UserDefaults.standard.set(selectedID, forKey: "selectedWindow")
        updateRing()
    }
    @objc func resetPosition() {
        inset = CGPoint(x: 10, y: 74)
        UserDefaults.standard.removeObject(forKey: "leftInset")
        UserDefaults.standard.removeObject(forKey: "bottomInset")
        tick()
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        query?.terminate()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }
}

@main
struct Main {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            assert(RingState.resolve(51, stale: false) == .green)
            assert(RingState.resolve(50, stale: false) == .orange)
            assert(RingState.resolve(20, stale: false) == .orange)
            assert(RingState.resolve(19, stale: false) == .red)
            assert(RingState.resolve(nil, stale: false) == .unknown)
            assert(RingState.resolve(99, stale: true) == .unknown)
            assert(appKitRect(CGRect(x: -900, y: 100, width: 800, height: 600), primaryHeight: 900).origin == CGPoint(x: -900, y: 200))
            let bounds = CGRect(x: 100, y: 100, width: 800, height: 600)
            assert(ringOrigin(in: bounds, inset: CGPoint(x: 10, y: 74)) == CGPoint(x: 110, y: 174))
            assert(ringOrigin(in: bounds, inset: CGPoint(x: -100, y: -100)) == CGPoint(x: 100, y: 100))
            assert(ringOrigin(in: bounds, inset: CGPoint(x: 9999, y: 9999)) == CGPoint(x: 868, y: 668))
            print("Swift 圆环颜色与窗口坐标检查通过")
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
