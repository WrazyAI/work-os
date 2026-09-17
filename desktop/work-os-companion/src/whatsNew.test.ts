import { describe, expect, it } from "vitest";
import { changelogBulletsFor, parseChangelog, shouldAnnounceUpdate, updateInstalledCopy } from "./whatsNew";

const SAMPLE = `# Changelog

## Unreleased

- Something in flight.

## 0.3.9

- First launch announces itself.
- View changelog opens this modal.
  continued prose is not a bullet.

## 0.3.8

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

  it("parses version sections and skips Unreleased and prose", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((entry) => entry.version)).toEqual(["0.3.9", "0.3.8"]);
    expect(entries[0]?.bullets).toEqual([
      "First launch announces itself.",
      "View changelog opens this modal.",
    ]);
    expect(entries[1]?.bullets).toEqual(["Star bullets count too."]);
  });

  it("parses a changelog checked out with Windows line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(changelogBulletsFor(crlf, "0.3.9")).toEqual([
      "First launch announces itself.",
      "View changelog opens this modal.",
    ]);
    expect(parseChangelog(crlf).map((entry) => entry.version)).toEqual(["0.3.9", "0.3.8"]);
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
