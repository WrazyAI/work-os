import assert from "node:assert/strict";
import test from "node:test";
import { decideWorkdayPrompt, dedupePlanCandidates, eodDueAt, firstFollowUpAt, nextSessionState, prioritizePlanCandidates } from "../src/modules/work-os/workday";

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

test("unscheduled sessions allow planning without invented EOD timing", () => {
  const result = decideWorkdayPrompt({
    session: { state: "active", scheduledStartsAt: null, scheduledEndsAt: null, clockedInAt: "2026-08-12T09:00:00.000Z" },
    breaks: [], hasConfirmedPlan: true, at: "2026-08-12T09:30:00.000Z",
  });
  assert.equal(result.kind, "follow_up");
  assert.equal(result.nextPromptAt, "2026-08-12T09:30:00.000Z");
  assert.doesNotMatch(result.reason, /EOD|final/i);
});

test("first follow-up and hourly fallback have distinct persisted cadence", () => {
  const confirmedAt = "2026-08-12T09:00:00.000Z";
  assert.equal(firstFollowUpAt({ session, planConfirmedAt: confirmedAt, at: confirmedAt }), "2026-08-12T09:30:00.000Z");
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, planConfirmedAt: confirmedAt, at: "2026-08-12T09:20:00.000Z" }).nextPromptAt, "2026-08-12T09:30:00.000Z");
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, planConfirmedAt: confirmedAt, at: "2026-08-12T09:30:00.000Z" }).kind, "follow_up");
  const afterFollowUp = { session, breaks: [], hasConfirmedPlan: true, planConfirmedAt: confirmedAt, lastPromptKind: "follow_up" as const, lastPromptAt: "2026-08-12T09:30:00.000Z", nextFallbackAt: "2026-08-12T10:30:00.000Z" };
  assert.equal(decideWorkdayPrompt({ ...afterFollowUp, at: "2026-08-12T10:00:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ ...afterFollowUp, at: "2026-08-12T10:30:00.000Z" }).kind, "hourly_fallback");
  assert.equal(decideWorkdayPrompt({ ...afterFollowUp, lastSubstantiveUpdateAt: "2026-08-12T09:45:00.000Z", at: "2026-08-12T10:30:00.000Z" }).kind, null);
});

test("EOD transition is deterministic and final-hour suppression is bounded", () => {
  assert.equal(eodDueAt("2026-08-12T17:00:00.000Z"), "2026-08-12T16:50:00.000Z");
  assert.equal(decideWorkdayPrompt({ session: { ...session, state: "eod_due" }, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:40:00.000Z" }).kind, "eod");
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:15:00.000Z" }).nextPromptAt, "2026-08-12T16:50:00.000Z");
});

test("daily plan candidates deduplicate provider and local tasks", () => {
  assert.deepEqual(dedupePlanCandidates([{ id: "a", title: "A" }, { id: "a", title: "A duplicate" }, { provider_task_id: "b", title: "B" }]).map((item) => item.title), ["A", "B"]);
});

test("daily plan prioritization carries selected and deferred work from the prior plan", () => {
  const carryOver = new Map([["carry", { disposition: "deferred" as const, rank: 4 }]]);
  const result = prioritizePlanCandidates([
    { id: "existing", title: "Later work", due_date: null },
    { id: "today", title: "Due today", due_date: "2026-08-12" },
    { id: "overdue", title: "Overdue work", due_date: "2026-08-11" },
    { id: "carry", title: "Carry-over work", due_date: null },
    { id: "carry", title: "Duplicate carry-over", due_date: null },
  ], "2026-08-12", carryOver);
  assert.deepEqual(result.map(({ id, source, disposition }) => ({ id, source, disposition })), [
    { id: "carry", source: "carry_over", disposition: "deferred" },
    { id: "overdue", source: "overdue", disposition: "selected" },
    { id: "today", source: "due_today", disposition: "selected" },
    { id: "existing", source: "existing", disposition: "selected" },
  ]);
});
