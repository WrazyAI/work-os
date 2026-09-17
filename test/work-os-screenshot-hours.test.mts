import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHourRange, screenshotHourGroups, screenshotHourHash } from "../src/lib/work-os-screenshot-hours";

const frame = (summaryId: string, capturedAt: string, summary: string, visibleApp: string | null) => ({ summaryId, capturedAt, summary, visibleApp });

test("hour ranges read in plain 12-hour language", () => {
  assert.equal(formatHourRange(0), "12–1 AM");
  assert.equal(formatHourRange(9), "9–10 AM");
  assert.equal(formatHourRange(11), "11 AM–12 PM");
  assert.equal(formatHourRange(12), "12–1 PM");
  assert.equal(formatHourRange(15), "3–4 PM");
  assert.equal(formatHourRange(23), "11 PM–12 AM");
  assert.equal(formatHourRange(24), "12–1 AM");
});

test("frames group by the employee's local hour, oldest first", () => {
  const groups = screenshotHourGroups([
    frame("a", "2026-09-17T15:40:00.000Z", "Terminal test output.", "Windows Terminal Host"),
    frame("b", "2026-09-17T15:05:00.000Z", "Repository page.", "Google Chrome"),
    frame("c", "2026-09-17T16:20:00.000Z", "Dashboard healthy.", "Google Chrome"),
  ], "UTC");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.label), ["3–4 PM", "4–5 PM"]);
  assert.equal(groups[0]?.frameCount, 2);
  assert.deepEqual(groups[0]?.frames.map((item) => item.summaryId), ["b", "a"]);
  assert.deepEqual(groups[0]?.apps, ["Google Chrome", "Windows Terminal Host"]);
});

test("the hour boundary follows the employee's timezone", () => {
  // 23:30 UTC is 7:30 PM in New York.
  const groups = screenshotHourGroups([frame("a", "2026-09-17T23:30:00.000Z", "Late review.", "VS Code")], "America/New_York");
  assert.equal(groups[0]?.label, "7–8 PM");
  const utc = screenshotHourGroups([frame("a", "2026-09-17T23:30:00.000Z", "Late review.", "VS Code")], "UTC");
  assert.equal(utc[0]?.label, "11 PM–12 AM");
});

test("the source hash tracks content, not frame order", () => {
  const one = [frame("a", "2026-09-17T15:05:00.000Z", "First.", "Chrome"), frame("b", "2026-09-17T15:40:00.000Z", "Second.", "VS Code")];
  const reordered = [one[1]!, one[0]!];
  assert.equal(screenshotHourHash(15, one), screenshotHourHash(15, reordered));
  const edited = [frame("a", "2026-09-17T15:05:00.000Z", "First, edited.", "Chrome"), one[1]!];
  assert.notEqual(screenshotHourHash(15, one), screenshotHourHash(15, edited));
  const extra = [...one, frame("c", "2026-09-17T15:50:00.000Z", "Third.", "Chrome")];
  assert.notEqual(screenshotHourHash(15, one), screenshotHourHash(15, extra));
});

console.log("Work OS screenshot hour tests passed.");
