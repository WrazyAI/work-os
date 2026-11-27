/** Fixed release asset names. Kept free of Node imports so the public download
 * page can reason about them without pulling the release proxy into the client. */
export const WINDOWS_INSTALLER_ASSET = "Work-OS-Companion-Setup-UNSIGNED.exe";
export const WINDOWS_INSTALLER_SIGNATURE_ASSET = `${WINDOWS_INSTALLER_ASSET}.sig`;
export const WINDOWS_CHECKSUM_ASSET = "SHA256SUMS.txt";
export const MACOS_INSTALLER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg";
export const MACOS_UPDATER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.app.tar.gz";

/** Nightly downloads add `Nightly` to the install surfaces so testers can tell
 * them apart from Stable. Keep these in step with
 * `desktop/work-os-companion/scripts/macos-release.mjs`. */
export const NIGHTLY_WINDOWS_INSTALLER_ASSET = "Work-OS-Companion-Nightly-Setup-UNSIGNED.exe";
export const NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET = `${NIGHTLY_WINDOWS_INSTALLER_ASSET}.sig`;
export const NIGHTLY_MACOS_INSTALLER_ASSET = "Work-OS-Companion-Nightly-macOS-Universal-UNSIGNED.dmg";
export const NIGHTLY_MACOS_UPDATER_ASSET = "Work-OS-Companion-Nightly-macOS-Universal-UNSIGNED.app.tar.gz";

export type InstallerChannel = "stable" | "nightly";

export function windowsInstallerAsset(channel: InstallerChannel = "stable"): string {
  return channel === "nightly" ? NIGHTLY_WINDOWS_INSTALLER_ASSET : WINDOWS_INSTALLER_ASSET;
}

export function macosInstallerAsset(channel: InstallerChannel = "stable"): string {
  return channel === "nightly" ? NIGHTLY_MACOS_INSTALLER_ASSET : MACOS_INSTALLER_ASSET;
}

export function macosUpdaterAsset(channel: InstallerChannel = "stable"): string {
  return channel === "nightly" ? NIGHTLY_MACOS_UPDATER_ASSET : MACOS_UPDATER_ASSET;
}
