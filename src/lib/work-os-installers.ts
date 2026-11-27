import {
  macosInstallerAsset,
  windowsInstallerAsset,
  WINDOWS_CHECKSUM_ASSET,
  type InstallerChannel,
} from "./work-os-installer-assets";

/** The public install surface. Only published installer files are exposed;
 * updater grants and the release listing remain private. */
export type PublicInstallerPlatform = "windows-x86_64" | "darwin-universal";

export function publicInstallerPlatform(value: string): PublicInstallerPlatform | null {
  if (value === "windows") return "windows-x86_64";
  if (value === "macos") return "darwin-universal";
  return null;
}

export function publicInstallerAsset(
  platform: PublicInstallerPlatform,
  channel: InstallerChannel = "stable",
): string {
  return platform === "windows-x86_64" ? windowsInstallerAsset(channel) : macosInstallerAsset(channel);
}

export function publicChecksumAsset(): typeof WINDOWS_CHECKSUM_ASSET {
  return WINDOWS_CHECKSUM_ASSET;
}

export type DetectedPlatform = "windows" | "macos" | "linux" | "unknown";

/** Detect the visitor's computer without sending anything to a server. Linux is
 * named honestly so the page can say it is coming later. */
export function detectPlatform(input: { platform?: string; userAgent?: string }): DetectedPlatform {
  const platform = input.platform ?? "";
  const agent = input.userAgent ?? "";
  if (/Win/i.test(platform) || /Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(agent)) return "macos";
  if (/Linux|X11/i.test(platform) || /Linux/i.test(agent)) return "linux";
  return "unknown";
}
