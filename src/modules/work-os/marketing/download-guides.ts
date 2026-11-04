/** Platform-specific instructions for unsigned internal installers. Reputation
 * prompts are not malware verdicts: quarantine/damage always stops at IT. */
export type DownloadGuidePlatform = "windows" | "macos";

export interface DownloadGuideStep {
  readonly title: string;
  readonly body: string;
}

export interface DownloadGuidePrompt extends DownloadGuideStep {
  readonly action?: string;
}

export interface DownloadGuide {
  readonly platform: DownloadGuidePlatform;
  readonly label: string;
  readonly fileName: string;
  readonly securityNote: string;
  readonly warnings: readonly DownloadGuidePrompt[];
  readonly safety: string;
  readonly steps: readonly DownloadGuideStep[];
  readonly prompts: readonly DownloadGuidePrompt[];
  readonly checksumCommand: string;
}

export const DOWNLOAD_GUIDES: readonly DownloadGuide[] = [
  {
    platform: "windows",
    label: "Windows",
    fileName: "Work-OS-Companion-Setup-UNSIGNED.exe",
    securityNote: "This internal build has no recognized publisher signature. Check the file before allowing it to run.",
    warnings: [
      { title: "Antivirus may pause or block installation", body: "Wait for the scan to finish. If it removes or quarantines the file, stop and ask your IT admin." },
      { title: "“Windows protected your PC”", action: "More info → Run anyway", body: "Use these buttons only for the verified Work OS installer." },
    ],
    safety: "Do not turn off antivirus protection or bypass a malware alert.",
    steps: [
      { title: "Open the file in Downloads", body: "If your browser says it isn’t commonly downloaded, choose Keep → Keep anyway only after verifying the file." },
      { title: "Finish the installer", body: "If asked to allow changes, choose Yes only for the verified file. Keep the standard install options." },
      { title: "Open Work OS and sign in", body: "Sign in through your browser, choose your workspace, and approve the device." },
    ],
    prompts: [
      { title: "Run anyway is missing", body: "Your PC may be managed. Ask your IT admin to allow the installer." },
      { title: "The publisher is Unknown", body: "This build is not Authenticode-signed. If the file name or SHA-256 differs, do not run it. Ask your admin." },
      { title: "No file arrived", body: "Check your browser’s Downloads list and antivirus history. If the build is unavailable, try again later or ask your admin." },
    ],
    checksumCommand: 'Get-FileHash "$HOME\\Downloads\\Work-OS-Companion-Setup-UNSIGNED.exe" -Algorithm SHA256',
  },
  {
    platform: "macos",
    label: "macOS",
    fileName: "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg",
    securityNote: "This internal build is not notarized by Apple. Check the file before allowing it to open.",
    warnings: [
      { title: "“Apple could not verify”", action: "Done → Privacy & Security → Open Anyway", body: "For a verified download, choose Done, not Move to Bin. Find Privacy & Security in System Settings." },
      { title: "Antivirus, malware or “damaged” alert?", body: "Stop and ask your IT admin. Do not restore a quarantined file or bypass a malware warning." },
    ],
    safety: "Do not disable Gatekeeper or antivirus protection.",
    steps: [
      { title: "Open the .dmg in Downloads", body: "Use the security steps above if macOS blocks this verified file." },
      { title: "Drag Work OS Companion to Applications", body: "When the copy finishes, eject the disk image." },
      { title: "Open Work OS and sign in", body: "Open it from Applications. Sign in through your browser and approve your workspace." },
    ],
    prompts: [
      { title: "Open Anyway is not showing", body: "Try opening the file once, then return to System Settings → Privacy & Security. On a managed Mac, ask your IT admin." },
      { title: "The app is damaged", body: "Download it again and compare the SHA-256. If it matches and the warning remains, stop and ask your admin." },
      { title: "Downloaded from the Internet", body: "Click Open only for the verified Work OS download. If unsure, stop and ask your admin." },
    ],
    checksumCommand: "shasum -a 256 ~/Downloads/Work-OS-Companion-macOS-Universal-UNSIGNED.dmg",
  },
];

export function downloadGuide(platform: string): DownloadGuide | null {
  return DOWNLOAD_GUIDES.find((guide) => guide.platform === platform) ?? null;
}

export function downloadGuidePath(platform: DownloadGuidePlatform): string {
  return `/work-os/downloads/thank-you/${platform}`;
}

export function downloadHref(platform: DownloadGuidePlatform): string {
  return `/downloads/work-os/${platform}`;
}
