import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const companionDir = fileURLToPath(new URL("../desktop/work-os-companion/", import.meta.url));
const tauriDir = join(companionDir, "src-tauri");
const readJson = (file: string) => JSON.parse(readFileSync(join(tauriDir, file), "utf8"));

function bmpInfo(file: string) {
  const bytes = readFileSync(join(tauriDir, file));
  assert.equal(bytes.toString("ascii", 0, 2), "BM", `${file} is not a bitmap`);
  return {
    width: bytes.readInt32LE(18),
    height: Math.abs(bytes.readInt32LE(22)),
    bitsPerPixel: bytes.readUInt16LE(28),
  };
}

function pngSize(file: string) {
  const bytes = readFileSync(join(tauriDir, file));
  assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a", `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("Windows installers use branded icons and native-size setup artwork", () => {
  const config = readJson("tauri.conf.json");
  const windows = config.bundle.windows;
  assert.equal(windows.nsis.installerIcon, "icons/icon.ico");
  assert.equal(windows.nsis.uninstallerIcon, "icons/icon.ico");
  assert.equal(windows.nsis.headerImage, "installer-art/nsis-header.bmp");
  assert.equal(windows.nsis.uninstallerHeaderImage, "installer-art/nsis-header.bmp");
  assert.equal(windows.nsis.sidebarImage, "installer-art/nsis-sidebar.bmp");
  assert.equal(windows.wix.bannerPath, "installer-art/wix-banner.bmp");
  assert.equal(windows.wix.dialogImagePath, "installer-art/wix-dialog.bmp");

  for (const file of ["icons/icon.ico", "icons/icon.png", "installer-art/nsis-header.bmp", "installer-art/nsis-sidebar.bmp", "installer-art/wix-banner.bmp", "installer-art/wix-dialog.bmp"]) {
    assert.equal(existsSync(join(tauriDir, file)), true, `Missing installer artwork: ${file}`);
  }
  assert.deepEqual(bmpInfo("installer-art/nsis-header.bmp"), { width: 150, height: 57, bitsPerPixel: 24 });
  assert.deepEqual(bmpInfo("installer-art/nsis-sidebar.bmp"), { width: 164, height: 314, bitsPerPixel: 24 });
  assert.deepEqual(bmpInfo("installer-art/wix-banner.bmp"), { width: 493, height: 58, bitsPerPixel: 24 });
  assert.deepEqual(bmpInfo("installer-art/wix-dialog.bmp"), { width: 493, height: 312, bitsPerPixel: 24 });
});

test("macOS DMG uses a branded background aligned with its icon positions", () => {
  const config = readJson("tauri.macos.conf.json");
  const dmg = config.bundle.macOS.dmg;
  assert.equal(dmg.background, "installer-art/dmg-background.png");
  assert.deepEqual(dmg.windowSize, { width: 660, height: 400 });
  assert.deepEqual(dmg.appPosition, { x: 180, y: 170 });
  assert.deepEqual(dmg.applicationFolderPosition, { x: 480, y: 170 });
  assert.deepEqual(pngSize("installer-art/dmg-background.png"), { width: 660, height: 400 });
  assert.equal(config.bundle.icon.includes("icons/icon.icns"), true);
  assert.equal(existsSync(join(tauriDir, "icons/icon.icns")), true);
});
