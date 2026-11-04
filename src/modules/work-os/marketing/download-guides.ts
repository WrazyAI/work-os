/** Public install help for the two unsigned desktop builds. The copy is plain,
 * specific, and tied to the real file names and OS dialogs; it never suggests
 * disabling a security feature for the whole machine. */

export type DownloadGuidePlatform = "windows" | "macos";

export interface DownloadGuideStep {
  readonly title: string;
  readonly body: string;
}

export interface DownloadGuidePrompt {
  readonly title: string;
  readonly body: string;
}

export interface DownloadGuide {
  readonly platform: DownloadGuidePlatform;
  readonly label: string;
  readonly fileLabel: string;
  readonly fileName: string;
  readonly lede: string;
  readonly steps: readonly DownloadGuideStep[];
  readonly prompts: readonly DownloadGuidePrompt[];
  readonly checksumCommand: string;
  readonly after: string;
}

export const DOWNLOAD_GUIDES: readonly DownloadGuide[] = [
  {
    platform: "windows",
    label: "Windows",
    fileLabel: "Your Windows file",
    fileName: "Work-OS-Companion-Setup-UNSIGNED.exe",
    lede: "Thanks for downloading Work OS. Windows and your browser may ask you to confirm an internal build before it will run. That is expected — these are the exact clicks that get you through.",
    steps: [
      { title: "Find the file in Downloads", body: "In Edge or Chrome, open the Downloads list. If the browser says the file isn’t commonly downloaded, choose Keep, or open the file’s menu and choose Keep anyway." },
      { title: "Run the installer", body: "Double-click the file. If Windows protected your PC appears, click More info, then Run anyway. If Windows asks whether to allow changes, choose Yes." },
      { title: "Let the installer finish", body: "Keep the standard options. Antivirus may scan the new file for a minute or longer; if the installer seems stuck, wait for the scan to finish and try once more." },
      { title: "Open Work OS and sign in", body: "Launch Work OS, sign in through your browser, choose your workspace, and approve the device." },
    ],
    prompts: [
      {
        title: "Windows protected your PC",
        body: "Click More info, then Run anyway. The Run anyway button only appears after you click More info.",
      },
      {
        title: "This file isn’t commonly downloaded",
        body: "Open your browser’s Downloads list. Choose Keep, or open the file’s menu and choose Keep anyway. Do not choose Discard.",
      },
      {
        title: "Do you want to allow this app to make changes?",
        body: "The publisher may show as Unknown. Choose Yes only if the file name matches the name above and the SHA-256 value matches. If you are not sure, stop and ask your admin.",
      },
      {
        title: "Your antivirus held or removed the file",
        body: "Wait for the scan to finish, then open your antivirus protection history and restore the file only if the checksum matches. Do not turn off antivirus protection for this install.",
      },
      {
        title: "Run anyway is missing",
        body: "Your organization may manage this PC. Ask your admin to allow the Work OS installer, then try the download again.",
      },
    ],
    checksumCommand: 'Get-FileHash "$HOME\\Downloads\\Work-OS-Companion-Setup-UNSIGNED.exe" -Algorithm SHA256',
    after: "Sign in after it opens. Work OS opens your browser to connect the workspace. Your Wrazy membership is what unlocks it, not the installer.",
  },
  {
    platform: "macos",
    label: "macOS",
    fileLabel: "Your Mac file",
    fileName: "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg",
    lede: "Thanks for downloading Work OS. The disk image works on Intel and Apple Silicon Macs. Because Apple has not notarized this internal build, macOS will probably ask you to confirm it. Here is the safe way through.",
    steps: [
      { title: "Open the .dmg from Downloads", body: "If macOS says it cannot verify the disk image, click Done — not Move to Bin. You will allow it in the next step." },
      { title: "Allow it in Privacy & Security", body: "Open System Settings → Privacy & Security. Scroll down to Security. Next to the message about Work OS, click Open Anyway. Enter your Mac password or use Touch ID. If the warning appears again, click Open." },
      { title: "Drag Work OS Companion to Applications", body: "Open the disk image window, drag the Work OS Companion icon into Applications, then eject the disk image." },
      { title: "Open it from Applications and sign in", body: "If macOS asks again, use Open Anyway. Then sign in through your browser, choose your workspace, and approve the device." },
    ],
    prompts: [
      {
        title: "Apple could not verify this app is free of malware",
        body: "Click Done, not Move to Bin. Then open System Settings → Privacy & Security, scroll to Security, and click Open Anyway.",
      },
      {
        title: "Open Anyway is not showing",
        body: "Try opening the .dmg or the app once more, then return to Privacy & Security. macOS shows Open Anyway for about an hour after the blocked attempt.",
      },
      {
        title: "Work OS Companion is an app downloaded from the Internet",
        body: "Click Open. This is the normal first-launch prompt for an app downloaded with a browser.",
      },
      {
        title: "The app is damaged",
        body: "Delete the download, download it again, and compare the SHA-256 value before opening. If the checksum matches and macOS still says it is damaged, ask your workspace admin. Do not disable Gatekeeper for the whole Mac.",
      },
      {
        title: "Privacy & Security is managed by your organization",
        body: "Your Mac may be managed. Ask your IT admin to allow Work OS Companion, then try again.",
      },
    ],
    checksumCommand: "shasum -a 256 ~/Downloads/Work-OS-Companion-macOS-Universal-UNSIGNED.dmg",
    after: "Sign in after it opens. Work OS opens your browser to connect the workspace. Your Wrazy membership is what unlocks it, not the installer.",
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
