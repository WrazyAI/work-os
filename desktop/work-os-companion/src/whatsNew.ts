import { displayUpdateVersion } from "./updater";

/* Post-install announcement rules. The first launch running a build the
 * device has not announced yet raises one success flyout with a View
 * changelog action; either choice marks the version seen and it never
 * reappears. The changelog itself is bundled (CHANGELOG.md via ?raw) so
 * the modal renders offline. */

/** localStorage marker holding the last announced canonical version. */
export const WHATS_NEW_SEEN_KEY = "work-os.update.announcedVersion.v1";

/** Persistent flyout key for the post-install announcement card. */
export const WHATS_NEW_ANNOUNCE_KEY = "work-os-update-announced";

export function readAnnouncedVersion(): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeAnnouncedVersion(version: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch {
    /* best effort: a rejected write only means the next launch announces again */
  }
}

/** True when the running build has not been announced on this device yet.
 * Fresh installs (no marker) announce; an unreadable running version never
 * does. Comparison is canonical-to-canonical; display padding is UI-only. */
export function shouldAnnounceUpdate(runningVersion: string | null | undefined, announcedVersion: string | null | undefined): boolean {
  const running = (runningVersion ?? "").trim();
  if (!running) return false;
  return running !== (announcedVersion ?? "").trim();
}

export type ChangelogEntry = { version: string; bullets: string[] };

/** Parses `## x.y.z` sections and their `- ` bullets. Non-version headings
 * (Unreleased, prose) are skipped; bullets before the first version heading
 * are dropped. Bullets render as plain text, never HTML. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  // Windows checkouts deliver CRLF; `.` never matches \r, so an unnormalized
  // split silently dropped every bullet while the headings still matched.
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(\d+\.\d+\.\d+)\s*$/);
    if (heading) {
      current = { version: heading[1]!, bullets: [] };
      entries.push(current);
      continue;
    }
    if (/^#\s/.test(line) || /^##\s/.test(line)) {
      current = null;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(\S.*)$/);
    if (bullet && current) current.bullets.push(bullet[1]!.trim());
  }
  return entries;
}

/** Bullets for one canonical version, or [] when the build shipped without
 * a section. The modal renders a deliberate fallback in that case. */
export function changelogBulletsFor(markdown: string, version: string): string[] {
  const canonical = version.trim();
  return parseChangelog(markdown).find((entry) => entry.version === canonical)?.bullets ?? [];
}

export function updateInstalledCopy(version: string): {
  title: string;
  message: string;
  changelogLabel: string;
  dismissLabel: string;
} {
  const display = displayUpdateVersion(version);
  return {
    title: `Update ${display} installed`,
    message: `Version ${display} installed successfully.`,
    changelogLabel: "View changelog",
    dismissLabel: "Dismiss",
  };
}
