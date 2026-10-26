import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeNiftyTask } from "../src/lib/integrations/nifty";
import { daySortRow, projectWorkspaceDay, resolveTaskDayAttribution, taskRangeAttributionDate } from "../src/lib/work-os-daily-workspace";
import { compareWorkspaceTasks } from "../src/lib/work-os-task-pagination";
import { reliableElapsedSeconds } from "../src/lib/work-os-insights";
import { canonicalNiftyEventTimestamp, niftyTaskEventIdempotencyKey } from "../src/lib/work-os";

test("Nifty completed_on is normalized exactly", () => {
  const completedOn = "2026-08-21T17:42:31.000Z";
  assert.equal(normalizeNiftyTask({ id: "task-1", name: "Done", completed: true, completed_on: completedOn }).completedAt, completedOn);
});

test("Nifty event keys canonicalize equivalent timestamp representations", () => {
  const sqlStyle = "2026-08-10 20:16:52.12+00";
  const isoStyle = "2026-08-10T20:16:52.120Z";
  assert.equal(canonicalNiftyEventTimestamp(sqlStyle), isoStyle);
  assert.equal(
    niftyTaskEventIdempotencyKey("completed", "task-1", sqlStyle),
    niftyTaskEventIdempotencyKey("completed", "task-1", isoStyle),
  );
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

test("local agent creation events appear in the day newest first", () => {
  const date = "2026-10-26";
  const older = { id: "old", title: "Older", provider_created_at: null, created_at: `${date}T08:00:00Z`, completed: false };
  const newer = { id: "new", title: "Newer", provider_created_at: null, created_at: `${date}T09:00:00Z`, completed: false };
  const events = [older, newer].map((task) => ({ id: `event-${task.id}`, task_id: task.id, event_type: "creation_observed", local_date: date, exact_at: task.created_at, task_snapshot: { completed: false } }));
  const projected = projectWorkspaceDay({ date, currentDate: date, allTasks: [older, newer], attributable: [older, newer], events, plan: null, session: null });
  assert.deepEqual(projected.tasks.map((task) => task.id), ["new", "old"]);
  assert.equal(projected.tasks[0].dayAttribution.eventId, "event-new");
});

test("a creation snapshot does not reopen a completed task today", () => {
  const date = "2026-10-26";
  const task = { id: "done", title: "Done", provider_created_at: null, created_at: `${date}T08:00:00Z`, completed: true };
  const event = { id: "created", task_id: task.id, event_type: "creation_observed", local_date: date, task_snapshot: { completed: false } };
  const projected = projectWorkspaceDay({ date, currentDate: date, allTasks: [task], attributable: [task], events: [event], plan: null, session: null });
  assert.equal(projected.tasks[0]?.completed, true);
});

test("day pagination orders equal due dates by creation, not later updates", () => {
  const old = { id: "old", due_date: "2026-10-26", created_at: "2026-10-26T08:00:00Z", provider_updated_at: "2026-10-26T11:00:00Z" };
  const recent = { id: "new", due_date: "2026-10-26", created_at: "2026-10-26T09:00:00Z", provider_updated_at: "2026-10-26T09:00:00Z" };
  assert.ok(compareWorkspaceTasks(daySortRow(recent, "due_desc"), daySortRow(old, "due_desc"), "due_desc", "2026-10-26") < 0);
});

test("day range uses the recorded local creation day across UTC midnight", () => {
  const task = { created_at: "2026-10-27T01:00:00Z", dayAttribution: { date: "2026-10-26", reason: "creation_observed" } };
  assert.equal(taskRangeAttributionDate(task, "2026-10-26"), "2026-10-26");
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
  const source = await readFile(new URL("../src/lib/work-os-nifty.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\.\(task\.completedAt \? \{ completed_at: task\.completedAt \} : \{\}\)/);
});

test("Nifty sync records idempotent exact completion and observed reopen events", async () => {
  const source = await readFile(new URL("../src/lib/work-os-nifty.ts", import.meta.url), "utf8");
  assert.match(source, /mirrorNiftyTaskDayEvents/);
  assert.match(source, /event_type: "completed", provenance: "nifty_exact"/);
  assert.match(source, /event_type: "reopened", provenance: "provider_observed"/);
});
