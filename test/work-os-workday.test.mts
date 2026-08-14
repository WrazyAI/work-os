import assert from "node:assert/strict";
import test from "node:test";
import { decideWorkdayPrompt, dedupePlanCandidates, nextSessionState } from "../src/modules/work-os/workday";

const session = {
  state: "active" as const,
  scheduledStartsAt: "2026-08-12T09:00:00.000Z",
  scheduledEndsAt: "2026-08-12T17:00:00.000Z",
  clockedInAt: "2026-08-12T09:00:00.000Z",
};

test("session transitions reject impossible branches", () => {
  assert.equal(nextSessionState("scheduled", "clock_in"), "clocked_in");
  assert.equal(nextSessionState("clocked_in", "pause"), "paused");
  assert.equal(nextSessionState("paused", "resume"), "active");
  assert.equal(nextSessionState("active", "clock_out"), "clocked_out");
  assert.throws(() => nextSessionState("clocked_out", "pause"));
});

test("prompt contract suppresses breaks, final hour, and post clock-out", () => {
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, at: "2026-08-12T09:05:00.000Z" }).kind, "plan");
  assert.equal(decideWorkdayPrompt({ session, breaks: [{ startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-12T12:30:00.000Z" }], hasConfirmedPlan: true, at: "2026-08-12T12:05:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:15:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:51:00.000Z" }).kind, "eod");
  assert.equal(decideWorkdayPrompt({ session: { ...session, state: "clocked_out" }, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T18:00:00.000Z" }).kind, null);
});

test("unscheduled Worktivity sessions allow planning without invented EOD timing", () => {
  const result = decideWorkdayPrompt({
    session: { state: "active", scheduledStartsAt: null, scheduledEndsAt: null, clockedInAt: "2026-08-12T09:00:00.000Z" },
    breaks: [], hasConfirmedPlan: true, at: "2026-08-12T09:30:00.000Z",
  });
  assert.equal(result.kind, "follow_up");
  assert.equal(result.nextPromptAt, "2026-08-12T10:00:00.000Z");
  assert.doesNotMatch(result.reason, /EOD|final/i);
});

test("daily plan candidates deduplicate provider and local tasks", () => {
  assert.deepEqual(dedupePlanCandidates([{ id: "a", title: "A" }, { id: "a", title: "A duplicate" }, { provider_task_id: "b", title: "B" }]).map((item) => item.title), ["A", "B"]);
});
