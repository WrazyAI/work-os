import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeNiftyTask } from "../src/lib/integrations/nifty";
import { resolveTaskDayAttribution } from "../src/lib/work-os-daily-workspace";
import { reliableElapsedSeconds } from "../src/lib/work-os-insights";

test("Nifty completed_on is normalized exactly", () => {
  const completedOn = "2026-08-21T17:42:31.000Z";
  assert.equal(normalizeNiftyTask({ id: "task-1", name: "Done", completed: true, completed_on: completedOn }).completedAt, completedOn);
});

test("task-day attribution follows due, surfaced, completed, creation, carry priority", () => {
  const date = "2026-08-21";
  const events = [
    { id: "carry", event_type: "carried" },
    { id: "complete", event_type: "completed" },
    { id: "surface", event_type: "surfaced" },
  ];
  assert.equal(resolveTaskDayAttribution({ due_date: date }, events, date)?.reason, "due_date");
  assert.equal(resolveTaskDayAttribution({}, events, date)?.reason, "surfaced");
  assert.equal(resolveTaskDayAttribution({}, events.slice(0, 2), date)?.reason, "completed");
  assert.equal(resolveTaskDayAttribution({ provider_created_at: `${date}T08:00:00Z` }, events.slice(0, 1), date)?.reason, "creation_observed");
  assert.equal(resolveTaskDayAttribution({}, events.slice(0, 1), date)?.reason, "carried");
});

test("past unclosed sessions contribute no duration", () => {
  const now = new Date("2026-08-23T12:00:00Z");
  assert.equal(reliableElapsedSeconds({ shift_date: "2026-08-21", clocked_in_at: "2026-08-21T09:00:00Z", clocked_out_at: null, correction_status: "needs_correction" }, now, "2026-08-23", false), 0);
});

test("correction-required sessions cannot become the active daily workspace", async () => {
  const source = await readFile(new URL("../src/lib/work-os-workday.ts", import.meta.url), "utf8");
  assert.match(source, /\.in\("state", \["clocked_in", "active", "paused", "eod_due"\]\)[\s\S]*?\.neq\("correction_status", "needs_correction"\)\.maybeSingle\(\)/);
});

test("Nifty sync never overwrites a known completion with null", async () => {
  const source = await readFile(new URL("../src/lib/work-os.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\.\(task\.completedAt \? \{ completed_at: task\.completedAt \} : \{\}\)/);
});
