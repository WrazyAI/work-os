import { describe, expect, it } from "vitest";
import { changelogBulletsFor, changelogHistory, formatReleaseDate, parseChangelog, shouldAnnounceUpdate, updateInstalledCopy } from "./whatsNew";

const SAMPLE = `# Changelog

## Unreleased

- Something in flight.

## 0.3.9 — 2026-10-02

- First launch announces itself.
- View changelog opens this modal.
  continued prose is not a bullet.

## 0.3.8 — 2026-09-20

* Star bullets count too.
`;

describe("post-install announcement", () => {
  it("announces fresh installs and unannounced builds, never the seen version", () => {
    expect(shouldAnnounceUpdate("0.3.9", null)).toBe(true);
    expect(shouldAnnounceUpdate("0.3.9", "")).toBe(true);
    expect(shouldAnnounceUpdate("0.3.9", "0.3.8")).toBe(true);
    expect(shouldAnnounceUpdate("0.3.9", "0.3.9")).toBe(false);
    expect(shouldAnnounceUpdate("", null)).toBe(false);
    expect(shouldAnnounceUpdate(null, null)).toBe(false);
  });

  it("parses version sections with their ship dates and skips Unreleased and prose", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((entry) => entry.version)).toEqual(["0.3.9", "0.3.8"]);
    expect(entries.map((entry) => entry.date)).toEqual(["2026-10-02", "2026-09-20"]);
    expect(entries[0]?.bullets).toEqual([
      "First launch announces itself.",
      "View changelog opens this modal.",
    ]);
    expect(entries[1]?.bullets).toEqual(["Star bullets count too."]);
  });

  it("keeps legacy undated headings and headings with an unrecognized suffix", () => {
    const legacy = "## 0.2.0\n\n- Old note.\n\n## 0.2.1 (hotfix)\n\n- New note.\n";
    const entries = parseChangelog(legacy);
    expect(entries.map((entry) => [entry.version, entry.date])).toEqual([["0.2.0", null], ["0.2.1", null]]);
    expect(changelogBulletsFor(legacy, "0.2.1")).toEqual(["New note."]);
  });

  it("formats a logged ship date for display and rejects malformed values", () => {
    expect(formatReleaseDate("2026-10-12")).toBe("October 12, 2026");
    expect(formatReleaseDate("2026-02-30")).toBeNull();
    expect(formatReleaseDate("not-a-date")).toBeNull();
    expect(formatReleaseDate(null)).toBeNull();
  });

  it("parses a changelog checked out with Windows line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(changelogBulletsFor(crlf, "0.3.9")).toEqual([
      "First launch announces itself.",
      "View changelog opens this modal.",
    ]);
    expect(parseChangelog(crlf).map((entry) => entry.version)).toEqual(["0.3.9", "0.3.8"]);
  });

  it("lists every logged release newest first and flags the installed one", () => {
    const shuffled = [
      "## 0.3.9 — 2026-09-30",
      "",
      "- Middle release.",
      "",
      "## 0.4.0 — 2026-10-03",
      "",
      "- Newest release.",
      "",
      "## 0.3.8 — 2026-09-20",
      "",
      "- Oldest release.",
    ].join("\n");
    const history = changelogHistory(shuffled, "0.3.9");
    expect(history.map((entry) => entry.version)).toEqual(["0.4.0", "0.3.9", "0.3.8"]);
    expect(history.map((entry) => entry.installed)).toEqual([false, true, false]);
    expect(history.find((entry) => entry.version === "0.3.9")?.date).toBe("2026-09-30");
    expect(history.find((entry) => entry.version === "0.3.9")?.bullets).toEqual(["Middle release."]);
    expect(changelogHistory("", "0.3.9")).toEqual([]);
  });

  it("keeps the newest section when a version repeats and reads CRLF files", () => {
    const repeated = "## 0.3.9\n\n- First copy.\n\n## 0.3.9\n\n- Second copy.\n";
    expect(changelogHistory(repeated, "0.3.9")[0]?.bullets).toEqual(["First copy."]);
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(changelogHistory(crlf, "0.3.9").map((entry) => entry.version)).toEqual(["0.3.9", "0.3.8"]);
  });

  it("returns bullets per version and [] when the build shipped without notes", () => {
    expect(changelogBulletsFor(SAMPLE, "0.3.9")).toHaveLength(2);
    expect(changelogBulletsFor(SAMPLE, " 0.3.8 ")).toEqual(["Star bullets count too."]);
    expect(changelogBulletsFor(SAMPLE, "0.4.0")).toEqual([]);
    expect(changelogBulletsFor("", "0.3.9")).toEqual([]);
  });

  it("names the installed version with the padded display form", () => {
    const copy = updateInstalledCopy("0.3.9");
    expect(copy.title).toBe("Update 0.3.09 installed");
    expect(copy.message).toBe("Version 0.3.09 installed successfully.");
    expect(copy.changelogLabel).toBe("View changelog");
    expect(copy.dismissLabel).toBe("Dismiss");
  });

  it("keeps the shipped changelog parseable with a section per release", () => {
    expect(SAMPLE).toContain("## Unreleased");
  });
});
