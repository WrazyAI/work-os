// The provider ignores StartDate/EndDate on /Screenshots/List and only honors
// a DateFilter preset, so the client owns the day boundary. These tests pin the
// pure day filter and the request contract that prior-day retrieval depends on.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { framesWithinDay } from "../src/lib/worktivity";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("frames are kept only when captured inside the requested UTC day", () => {
  const frames = [
    { ID: "a", CaptureDate: "2026-09-15T00:00:00.000Z" },
    { ID: "b", CaptureDate: "2026-09-15T23:59:59.999Z" },
    { ID: "c", CaptureDate: "2026-09-16T00:00:00.000Z" },
    { ID: "d", CaptureDate: "2026-09-14T23:59:59.999Z" },
    { ID: "e", CreateDate: "2026-09-15T12:00:00.000Z" },
    { ID: "f", CaptureDate: "2026-09-15T23:00:00+02:00" },
    { ID: "g", CaptureDate: null, CreateDate: null },
  ];
  assert.deepEqual(framesWithinDay(frames, "2026-09-15").map((frame) => frame.ID), ["a", "b", "e", "f"]);
  assert.deepEqual(framesWithinDay(frames, "2026-09-16").map((frame) => frame.ID), ["c"]);
  assert.deepEqual(framesWithinDay(frames, "2026-09-14").map((frame) => frame.ID), ["d"]);
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
  assert.match(lib, /framesWithinDay\(\[\.\.\.collected\.values\(\)\], date\)/);
  assert.doesNotMatch(lib, /StartDate: `\$\{date\}/, "the old ignored PascalCase range is gone");
});

test("screenshot processing enforces the day boundary and reports unavailability", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /const shots = framesWithinDay\(fetched, date\)/);
  assert.match(lib, /unavailable: boolean;/);
  assert.match(lib, /unavailable: result\.logs === 0/);
  assert.match(lib, /action: "screenshot\.due_sync_unavailable"/);
  assert.match(lib, /if \(run\.logs === 0\) \{/);
  // Retrying an empty day every tick would starve older candidates.
  assert.match(lib, /Date\.now\(\) - lastUnavailableAt < 24 \* 60 \* 60_000/);
  const unavailableBranch = lib.slice(lib.indexOf("if (run.logs === 0) {"), lib.indexOf("const { error: auditError } = await supabase.from(\"work_audit_log\").insert({\n        organization_id: row.organization_id,\n        actor_user_id: null,\n        action: \"screenshot.due_sync_completed\""));
  assert.doesNotMatch(unavailableBranch, /screenshot\.due_sync_completed/, "an empty day is never settled as completed");
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
