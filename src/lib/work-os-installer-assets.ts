/** Fixed release asset names. Kept free of Node imports so the public download
 * page can reason about them without pulling the release proxy into the client. */
export const WINDOWS_INSTALLER_ASSET = "Work-OS-Companion-Setup-UNSIGNED.exe";
export const WINDOWS_INSTALLER_SIGNATURE_ASSET = `${WINDOWS_INSTALLER_ASSET}.sig`;
export const WINDOWS_CHECKSUM_ASSET = "SHA256SUMS.txt";
export const MACOS_INSTALLER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg";
export const MACOS_UPDATER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.app.tar.gz";
