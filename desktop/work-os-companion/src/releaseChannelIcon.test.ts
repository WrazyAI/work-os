import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("release-channel app icon", () => {
  it("grants the main window the runtime icon command", () => {
    const allow = readFileSync(resolve(root, "src-tauri/permissions/allow-app-commands.toml"), "utf8");
    const capability = readFileSync(resolve(root, "src-tauri/capabilities/default.json"), "utf8");
    expect(capability).toContain("allow-app-commands");
    expect(allow).toContain("set_update_channel_icon");
  });

  it("registers the command and updates both windows and the tray", () => {
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).toContain("fn set_update_channel_icon");
    expect(rust).toContain("set_update_channel_icon,");
    expect(rust).toContain('TrayIconBuilder::with_id("main")');
    expect(rust).toContain("set_macos_dock_icon");
    expect(rust).toContain("channel_icon_bytes");
    expect(rust).toContain("channel_tray_icon_bytes");
    const manifest = readFileSync(resolve(root, "src-tauri/build.rs"), "utf8");
    expect(manifest).toContain('"set_update_channel_icon"');
  });

  it("switches the live icon from the update channel state", () => {
    const hook = readFileSync(resolve(root, "src/app/hooks/useUpdaterFlow.ts"), "utf8");
    expect(hook).toContain('invoke("set_update_channel_icon", { channel: updateChannel })');
  });

  it("ships a Nightly PNG with the NIGHTLY pill", () => {
    const png = readFileSync(resolve(root, "src-tauri/icons/nightly-runtime.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const svg = readFileSync(resolve(root, "src-tauri/icons/nightly-icon.svg"), "utf8");
    expect(svg).toContain("NIGHTLY");
    expect(svg).toContain("#7C3AED");
  });

  it("keeps the stable icon in the executable and installer", () => {
    const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    expect(config.bundle.icon).not.toContain("icons/nightly-runtime.png");
    expect(config.bundle.windows.nsis.installerIcon).toBe("icons/icon.ico");
  });

  it("ships a separate transparent moon for the menu bar and caption bar", () => {
    const tray = readFileSync(resolve(root, "src-tauri/icons/nightly-tray.png"));
    expect(tray.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const traySvg = readFileSync(resolve(root, "src-tauri/icons/nightly-tray.svg"), "utf8");
    expect(traySvg).toContain("crescent");
    const moon = readFileSync(resolve(root, "src/NightlyMoon.tsx"), "utf8");
    expect(moon).toContain("nightly-moon-crescent");
    const menuBar = readFileSync(resolve(root, "src/AppMenuBar.tsx"), "utf8");
    expect(menuBar).toContain("wc-nightly-tag");
    expect(menuBar).toContain("nightly?: boolean");
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).toContain("NIGHTLY_TRAY_PNG");
    expect(rust).toContain("channel_tray_icon_bytes");
  });

  it("switches the Windows taskbar big icon separately from the small window icon", () => {
    const ico = readFileSync(resolve(root, "src-tauri/icons/nightly-runtime.ico"));
    expect(ico.subarray(0, 4).toString("hex")).toBe("00000100");
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).toContain("NIGHTLY_ICON_ICO");
    expect(rust).toContain("channel_taskbar_icon_ico");
    expect(rust).toContain("set_windows_taskbar_icon");
    expect(rust).toContain("WM_SETICON");
    expect(rust).toContain("ICON_BIG");
    const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
    expect(cargo).toContain("Win32_UI_WindowsAndMessaging");
  });
});
