// The provider ignores StartDate/EndDate on /Screenshots/List and only honors
// a DateFilter preset, so the client owns the day boundary — and that boundary
// is the employee's local day. These tests pin the boundary math, the pure day
// filter, and the contracts that day-scoped reads depend on.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localDateForTimezone, localDayBounds } from "../src/modules/work-os/companion";
import { framesWithinDay } from "../src/lib/worktivity";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("local day bounds are local-midnight to local-midnight, half-open", () => {
  assert.deepEqual(localDayBounds("2026-01-15", "UTC"), {
    startIso: "2026-01-15T00:00:00.000Z",
    endIso: "2026-01-16T00:00:00.000Z",
  });
  // UTC+1 in winter.
  assert.deepEqual(localDayBounds("2026-01-15", "Europe/Amsterdam"), {
    startIso: "2026-01-14T23:00:00.000Z",
    endIso: "2026-01-15T23:00:00.000Z",
  });
  // DST starts 2026-03-29 in Amsterdam: a 23-hour local day.
  assert.deepEqual(localDayBounds("2026-03-29", "Europe/Amsterdam"), {
    startIso: "2026-03-28T23:00:00.000Z",
    endIso: "2026-03-29T22:00:00.000Z",
  });
  // A negative offset lands the local day on the previous UTC date.
  assert.deepEqual(localDayBounds("2026-09-15", "America/New_York"), {
    startIso: "2026-09-15T04:00:00.000Z",
    endIso: "2026-09-16T04:00:00.000Z",
  });
  // Invalid inputs degrade instead of throwing mid-run.
  assert.deepEqual(localDayBounds("not-a-date", "UTC"), { startIso: "", endIso: "" });
  assert.deepEqual(localDayBounds("2026-02-30", "UTC"), { startIso: "", endIso: "" });
  assert.deepEqual(localDayBounds("2026-09-15", "Not/AZone"), {
    startIso: "2026-09-15T00:00:00.000Z",
    endIso: "2026-09-16T00:00:00.000Z",
  });
});

test("a DST-skipped local midnight still starts on the requested local day", () => {
  // Santiago starts DST at 00:00 on 2026-09-06: local midnight does not exist.
  const bounds = localDayBounds("2026-09-06", "America/Santiago");
  assert.equal(bounds.startIso, "2026-09-06T04:00:00.000Z", "first valid instant of the local day");
  assert.ok(Date.parse(bounds.startIso) < Date.parse(bounds.endIso));
  assert.equal(localDateForTimezone(new Date(bounds.startIso), "America/Santiago"), "2026-09-06");
  // The previous local day must not leak into the window.
  assert.equal(localDateForTimezone(new Date(Date.parse(bounds.startIso) - 1), "America/Santiago"), "2026-09-05");
});

test("frames are kept by local day, so near-midnight frames stay with the workday", () => {
  const frames = [
    { ID: "a", CaptureDate: "2026-09-15T00:00:00.000Z" },
    { ID: "b", CaptureDate: "2026-09-15T23:59:59.999Z" },
    { ID: "c", CaptureDate: "2026-09-16T00:00:00.000Z" },
    { ID: "d", CaptureDate: "2026-09-14T23:59:59.999Z" },
    { ID: "e", CreateDate: "2026-09-15T12:00:00.000Z" },
    // 00:30 local on Sep 15 in Amsterdam — 22:30 UTC on Sep 14.
    { ID: "f", CaptureDate: "2026-09-15T00:30:00+02:00" },
    // 23:30 local on Sep 15 in Amsterdam — 21:30 UTC on Sep 15.
    { ID: "g", CaptureDate: "2026-09-15T23:30:00+02:00" },
    { ID: "h", CaptureDate: null, CreateDate: null },
  ];
  // Amsterdam is UTC+2: the local day runs 22:00Z → 22:00Z, so the frame at
  // 23:59Z on Sep 14 (01:59 local) belongs to Sep 15, and the one at 23:59Z on
  // Sep 15 (01:59 local next day) does not.
  assert.deepEqual(framesWithinDay(frames, "2026-09-15", "Europe/Amsterdam").map((frame) => frame.ID), ["a", "d", "e", "f", "g"]);
  // Under UTC the early-morning local frame belongs to the previous UTC day.
  assert.deepEqual(framesWithinDay(frames, "2026-09-14", "UTC").map((frame) => frame.ID), ["d", "f"]);
  assert.deepEqual(framesWithinDay(frames, "2026-09-16", "UTC").map((frame) => frame.ID), ["c"]);
  assert.deepEqual(framesWithinDay(frames, "not-a-date"), []);
});

test("the provider request uses the custom-range DateFilter with lowercase dates", async () => {
  const lib = await source("src/lib/worktivity.ts");
  assert.match(lib, /WT_SCREENSHOT_CUSTOM_RANGE = 10/);
  assert.match(lib, /DateFilter: WT_SCREENSHOT_CUSTOM_RANGE/);
  assert.match(lib, /startDate: `\$\{shiftIsoDate\(date, -1\)\}T00:00:00Z`/);
  assert.match(lib, /endDate: `\$\{shiftIsoDate\(date, 1\)\}T23:59:59Z`/);
  assert.match(lib, /const SCREENSHOT_MAX_PAGES = 8/);
  assert.match(lib, /SCREENSHOT_DAY_CACHE_MS = 90_000/);
  assert.match(lib, /framesWithinDay\(\[\.\.\.collected\.values\(\)\], date, timezone\)/);
  assert.match(lib, /const cacheKey = `\$\{employeeId\}:\$\{date\}:\$\{timezone\}`/, "the timezone defines the cached bounds");
  assert.doesNotMatch(lib, /StartDate: `\$\{date\}/, "the old ignored PascalCase range is gone");
});

test("screenshot processing derives every day window from the workday window or the local bounds", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /const bounds = options\.window \?\? localDayBounds\(date, timezone\)/, "an explicit workday window wins; otherwise the local day");
  assert.match(lib, /const shots = framesWithinBounds\(fetched, bounds\)/);
  assert.match(lib, /terminallyAnalyzedFrames\(access\.organizationId, personId, bounds\)/);
  assert.match(lib, /\.gte\("occurred_at", bounds\.startIso\)\.lt\("occurred_at", bounds\.endIso\)/, "terminal matching uses the local day");
  const eod = await source("src/lib/work-os-eod.ts");
  assert.match(eod, /listEodScreenshots\(access\.organizationId, personId, reportDate, timezone\)/, "the draft gallery resolves the employee's local day");
  assert.match(lib, /const bounds = window \? \{ startIso: window\.startIso, endIso: window\.endIso \} : localDayBounds\(date, resolvedTimezone\)/, "the EOD gallery follows the workday window with a local-day fallback");
  assert.match(lib, /mirrorSummary\(access, personId, event\.id, captureAt\(log\), observation\.summary, SCREENSHOT_MODEL, timezone\)/, "the mirror day follows the capture instant, not the provider create date");
  assert.match(lib, /localDateForTimezone\(capturedAt, timezone\)/);
  assert.match(lib, /summarizeWorktivityScreenshots\(access, row\.person_id as string, shiftDate, \{ timezone \}\)/);
  assert.match(lib, /summarizeWorktivityScreenshots\(access, person\.id, localDate, \{ maxScreenshots: cap, timezone \}\)/);
  assert.match(lib, /export async function personTimezone/);
  assert.match(lib, /unavailable: boolean;/);
  assert.match(lib, /unavailable: result\.logs === 0/);
  assert.match(lib, /action: "screenshot\.due_sync_unavailable"/);
  assert.match(lib, /if \(run\.logs === 0\) \{/);
  // Retrying an empty day every tick would starve older candidates.
  assert.match(lib, /Date\.now\(\) - lastUnavailableAt < 24 \* 60 \* 60_000/);
  const unavailableBranch = lib.slice(lib.indexOf("if (run.logs === 0) {"), lib.indexOf("const { error: auditError } = await supabase.from(\"work_audit_log\").insert({\n        organization_id: row.organization_id,\n        actor_user_id: null,\n        action: \"screenshot.due_sync_completed\""));
  assert.doesNotMatch(unavailableBranch, /screenshot\.due_sync_completed/, "an empty day is never settled as completed");
});

test("draft context and hourly synthesis share the workday window", async () => {
  const aiEod = await source("src/lib/aiEod.ts");
  assert.match(aiEod, /const bounds = window \? \{ startIso: window\.startIso, endIso: window\.endIso \} : localDayBounds\(date, resolvedTimezone\)/);
  assert.match(aiEod, /\.gte\("occurred_at", bounds\.startIso\)\.lt\("occurred_at", bounds\.endIso\)/);
  const hours = await source("src/lib/work-os-screenshot-hours.ts");
  assert.match(hours, /eodActivityWindowFor\(input\.organizationId, input\.personId, input\.date\)/, "hourly synthesis uses the same workday window");
  assert.match(hours, /const bounds = localDayBounds\(date, timezone \|\| "UTC"\)/);
  assert.match(hours, /import \{ personTimezone \} from "@\/lib\/work-os-screenshots"/);
});

test("the companion stops waiting when the provider has no frames for the day", async () => {
  const app = await source("desktop/work-os-companion/src/App.tsx");
  assert.match(app, /if \(preparation\.unavailable \|\| preparation\.total === 0\)/);
  assert.match(app, /Worktivity has no retrievable screenshots for this day\./);
  assert.match(app, /screenshotNotice=\{eodScreenshotNotice\}/);
  const composer = await source("desktop/work-os-companion/src/taskSurfaces.tsx");
  assert.match(composer, /screenshotNotice && !preparing/);
});

console.log("Worktivity day-filter tests passed.");
