// CI-only native geometry probe. No account, DOM text, or employee data is read.
import AppKit
import CoreGraphics
import Foundation

func fail(_ message: String, code: Int32 = 1) -> Never {
    fputs(message + "\n", stderr)
    exit(code)
}

if CommandLine.arguments.dropFirst().first == "--compact-display" {
    guard ProcessInfo.processInfo.environment["CI"] == "true" else {
        fail("Display-mode changes are restricted to disposable CI runners")
    }
    let display = CGMainDisplayID()
    let modes = CGDisplayCopyAllDisplayModes(display, nil) as? [CGDisplayMode] ?? []
    let compact = modes.filter { $0.width >= 1000 && $0.height >= 700 && $0.height <= 900 }
        .sorted { $0.height == $1.height ? $0.width < $1.width : $0.height < $1.height }
    guard let mode = compact.first else {
        fail("No compact display mode available: " + modes.map { "\($0.width)x\($0.height)" }.joined(separator: ", "), code: 3)
    }
    guard CGDisplaySetDisplayMode(display, mode, nil) == .success else {
        fail("Could not select compact display mode")
    }
    print("Selected native display mode \(mode.width)x\(mode.height)")
    exit(0)
}

if CommandLine.arguments.dropFirst().first == "--compact-work-area" {
    guard let screen = NSScreen.screens.first else { fail("No native screen is available") }
    print("Native usable height: \(screen.visibleFrame.height)")
    exit(screen.visibleFrame.height <= 940 ? 0 : 2)
}

guard let argument = CommandLine.arguments.dropFirst().first, let pid = Int32(argument) else {
    fail("Usage: macos-window-bounds <app-pid> | --compact-display")
}
let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let frames: [CGRect] = rows.compactMap { row in
    guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
          (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
          let bounds = row[kCGWindowBounds as String] as? [String: Any],
          let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary), frame.width >= 700 else { return nil }
    return frame
}
guard let frame = frames.max(by: { $0.width * $0.height < $1.width * $1.height }) else {
    fail("Waiting for the main native window", code: 2)
}
guard let main = NSScreen.screens.first else { fail("No native screen is available") }
// Core Graphics uses a top-left origin; AppKit uses a bottom-left origin.
let workAreas = NSScreen.screens.map { screen -> CGRect in
    let r = screen.visibleFrame
    return CGRect(x: r.minX, y: main.frame.maxY - r.maxY, width: r.width, height: r.height)
}
guard let area = workAreas.max(by: {
    $0.intersection(frame).width * $0.intersection(frame).height < $1.intersection(frame).width * $1.intersection(frame).height
}) else { fail("No usable native work area") }
func values(_ r: CGRect) -> [String: Double] {
    return ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height, "bottom": r.maxY]
}
let fits = frame.minX >= area.minX - 1 && frame.minY >= area.minY - 1 && frame.maxX <= area.maxX + 1 && frame.maxY <= area.maxY + 1
let evidence: [String: Any] = ["window": values(frame), "workArea": values(area), "fullyVisible": fits]
let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
if !fits { fail("The main native window extends outside the monitor's usable area") }
