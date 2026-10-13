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

export type ChangelogEntry = { version: string; date: string | null; bullets: string[] };

/** Parses `## x.y.z` sections and their `- ` bullets. A section may carry the
 * date it shipped after the version (`## 0.4.25 — 2026-10-12`); a recognized
 * ISO date in the suffix is captured, an unrecognized suffix still parses the
 * section without one (the modal never drops notes over a heading detail).
 * Non-version headings (Unreleased, prose) are skipped; bullets before the
 * first version heading are dropped. Bullets render as plain text, never HTML. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  // Windows checkouts deliver CRLF; `.` never matches \r, so an unnormalized
  // split silently dropped every bullet while the headings still matched.
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(\d+\.\d+\.\d+)\b(.*)$/);
    if (heading) {
      const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(heading[2] ?? "")?.[1] ?? null;
      current = { version: heading[1]!, date, bullets: [] };
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

/** "October 12, 2026" for an ISO release date, or null when the value is
 * missing or malformed. Date-only values render in UTC so the calendar day
 * never shifts with the employee's timezone. */
export function formatReleaseDate(value?: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(date);
  } catch {
    return null;
  }
}

/** Numeric SemVer comparison; invalid segments sort below valid ones. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : -1;
  });
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type ChangelogHistoryEntry = ChangelogEntry & { installed: boolean };

/** Every logged release, newest first, with the running version flagged so the
 * modal can mark where the employee is in the timeline. Duplicate headings keep
 * their first (newest) section. */
export function changelogHistory(markdown: string, currentVersion?: string | null): ChangelogHistoryEntry[] {
  const canonical = (currentVersion ?? "").trim();
  const seen = new Set<string>();
  return parseChangelog(markdown)
    .filter((entry) => {
      if (seen.has(entry.version)) return false;
      seen.add(entry.version);
      return true;
    })
    .map((entry) => ({ ...entry, installed: entry.version === canonical }))
    .sort((left, right) => compareVersions(right.version, left.version));
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
