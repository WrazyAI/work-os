import assert from "node:assert/strict";
import test from "node:test";
import { checkInCadenceOverridden, checkInIntervalMs, decideWorkdayPrompt, dedupePlanCandidates, firstFollowUpAt, firstFollowUpMinutes, MAX_DAILY_PLAN_ITEMS, nextSessionState, PLAN_ITEM_DRAFT_HEADROOM, planningPromptAnswered, prioritizePlanCandidates, suppressPromptForSubmittedEod } from "../src/modules/work-os/workday";

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

test("prompt contract keeps the planning prompt until a progress check-in is due and suppresses breaks, final hour, and post clock-out", () => {
  const firstPrompt = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, at: "2026-08-12T09:05:00.000Z" });
  assert.equal(firstPrompt.kind, "plan");
  assert.equal(firstPrompt.nextPromptAt, "2026-08-12T09:00:00.000Z");
  // An unconfirmed plan no longer silences the cadence once the first follow-up is due.
  const progressPrompt = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, at: "2026-08-12T10:20:00.000Z" });
  assert.equal(progressPrompt.kind, "follow_up");
  assert.equal(progressPrompt.nextPromptAt, "2026-08-12T10:15:00.000Z");
  assert.equal(progressPrompt.required, false);
  assert.equal(decideWorkdayPrompt({ session, breaks: [{ startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-12T12:30:00.000Z" }], hasConfirmedPlan: true, at: "2026-08-12T12:05:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:15:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:51:00.000Z" }).kind, "eod");
  assert.equal(decideWorkdayPrompt({ session: { ...session, state: "clocked_out" }, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T18:00:00.000Z" }).kind, null);
});

test("the planning prompt stands down once the employee has engaged with the day", () => {
  // No engagement yet: the planning prompt is required at clock-in.
  const awaiting = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, at: "2026-08-12T09:05:00.000Z" });
  assert.equal(awaiting.kind, "plan");
  assert.equal(awaiting.required, true);
  // A substantive update recorded since clock-in answers the planning question:
  // the returned prompt is the cadence's waiting state, never the required plan.
  const engaged = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, lastSubstantiveUpdateAt: "2026-08-12T09:30:00.000Z", at: "2026-08-12T09:40:00.000Z" });
  assert.notEqual(engaged.kind, "plan");
  assert.equal(engaged.required, false);
  assert.equal(engaged.nextPromptAt, "2026-08-12T10:15:00.000Z");
  // An update from a previous shift does not count.
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, lastSubstantiveUpdateAt: "2026-08-11T09:30:00.000Z", at: "2026-08-12T09:40:00.000Z" }).kind, "plan");
  // Once a check-in has been delivered, the plan prompt no longer returns between check-ins.
  const afterCheckIn = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, lastPromptKind: "hourly_fallback", at: "2026-08-12T10:40:00.000Z" });
  assert.equal(afterCheckIn.kind, null);
  assert.equal(afterCheckIn.required, false);
  // The cadence still wins when it is actually due.
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, lastSubstantiveUpdateAt: "2026-08-12T09:30:00.000Z", at: "2026-08-12T10:20:00.000Z" }).kind, "follow_up");
});

test("planningPromptAnswered recognizes engagement without a confirmed plan", () => {
  assert.equal(planningPromptAnswered({ session, breaks: [], at: "2026-08-12T09:05:00.000Z" }), false);
  assert.equal(planningPromptAnswered({ session, breaks: [], lastPromptKind: "follow_up", at: "2026-08-12T09:05:00.000Z" }), true);
  assert.equal(planningPromptAnswered({ session, breaks: [], lastPromptKind: "hourly_fallback", at: "2026-08-12T11:05:00.000Z" }), true);
  assert.equal(planningPromptAnswered({ session, breaks: [], lastSubstantiveUpdateAt: "2026-08-12T09:30:00.000Z", at: "2026-08-12T09:40:00.000Z" }), true);
  // Exactly at clock-in counts as engagement; before it does not.
  assert.equal(planningPromptAnswered({ session, breaks: [], lastSubstantiveUpdateAt: "2026-08-12T09:00:00.000Z", at: "2026-08-12T09:40:00.000Z" }), true);
  assert.equal(planningPromptAnswered({ session, breaks: [], lastSubstantiveUpdateAt: "2026-08-12T08:59:00.000Z", at: "2026-08-12T09:40:00.000Z" }), false);
});

test("check-in cadence defaults to an hourly fallback and accepts bounded configuration", () => {
  assert.equal(checkInIntervalMs(undefined), 60 * 60_000);
  assert.equal(checkInIntervalMs("5"), 5 * 60_000);
  assert.equal(checkInIntervalMs("10"), 10 * 60_000);
  assert.equal(checkInIntervalMs("15"), 15 * 60_000);
  assert.equal(checkInIntervalMs("4"), 60 * 60_000);
  assert.equal(checkInIntervalMs("0"), 60 * 60_000);
  assert.equal(checkInIntervalMs("241"), 60 * 60_000);
});

test("only a valid non-hourly cadence counts as an override", () => {
  assert.equal(checkInCadenceOverridden(undefined), false);
  assert.equal(checkInCadenceOverridden("60"), false);
  assert.equal(checkInCadenceOverridden("10"), true);
  assert.equal(checkInCadenceOverridden("5"), true);
  assert.equal(checkInCadenceOverridden("120"), true);
  assert.equal(checkInCadenceOverridden("4"), false);
  assert.equal(checkInCadenceOverridden("241"), false);
  assert.equal(checkInCadenceOverridden("nope"), false);
});

test("the first follow-up interval is deployment-configurable and bounded", () => {
  assert.equal(firstFollowUpMinutes(undefined), 75);
  assert.equal(firstFollowUpMinutes("10"), 10);
  assert.equal(firstFollowUpMinutes("5"), 5);
  assert.equal(firstFollowUpMinutes("4"), 75);
  assert.equal(firstFollowUpMinutes("241"), 75);
  process.env.WORK_OS_FIRST_FOLLOW_UP_MINUTES = "10";
  try {
    assert.equal(firstFollowUpAt({ session, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T09:10:00.000Z");
  } finally {
    delete process.env.WORK_OS_FIRST_FOLLOW_UP_MINUTES;
  }
});

test("a submitted EOD suppresses any remaining workday prompt", () => {
  const due = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:51:00.000Z" });
  assert.deepEqual(suppressPromptForSubmittedEod(due, "2026-08-12T16:55:00.000Z"), {
    kind: null,
    nextPromptAt: null,
    required: false,
    reason: "EOD submitted.",
  });
});

test("a substantive response schedules the next configured check-in", () => {
  const prompt = decideWorkdayPrompt({
    session: { ...session, lastPromptKind: "follow_up", lastPromptAt: "2026-08-12T09:05:00.000Z" },
    breaks: [],
    lastPromptKind: "follow_up",
    lastPromptAt: "2026-08-12T09:05:00.000Z",
    lastSubstantiveUpdateAt: "2026-08-12T09:07:00.000Z",
    hasConfirmedPlan: true,
    at: "2026-08-12T10:07:00.000Z",
  });
  assert.equal(prompt.kind, "hourly_fallback");
  assert.equal(prompt.nextPromptAt, "2026-08-12T10:07:00.000Z");
});

test("a confirmed plan anchors the first follow-up at seventy-five minutes", () => {
  const prompt = decideWorkdayPrompt({
    session,
    breaks: [],
    hasConfirmedPlan: true,
    planConfirmedAt: "2026-08-12T09:10:00.000Z",
    at: "2026-08-12T09:20:00.000Z",
  });
  assert.equal(prompt.kind, "follow_up");
  assert.equal(prompt.nextPromptAt, "2026-08-12T10:25:00.000Z");
});

test("a resolved per-person cadence overrides the interval and first follow-up", () => {
  const afterPrompt = {
    session: { ...session, lastPromptKind: "hourly_fallback" as const, lastPromptAt: "2026-08-12T09:05:00.000Z" },
    breaks: [],
    lastPromptKind: "hourly_fallback" as const,
    lastPromptAt: "2026-08-12T09:05:00.000Z",
    lastSubstantiveUpdateAt: "2026-08-12T09:07:00.000Z",
    hasConfirmedPlan: true,
  };
  // A 10-minute cadence makes the next check-in due at 09:17.
  const fast = decideWorkdayPrompt({ ...afterPrompt, checkInIntervalMinutes: 10, at: "2026-08-12T09:18:00.000Z" });
  assert.equal(fast.kind, "hourly_fallback");
  assert.equal(fast.nextPromptAt, "2026-08-12T09:17:00.000Z");
  // The same story on the 60-minute default is still waiting.
  const slow = decideWorkdayPrompt({ ...afterPrompt, checkInIntervalMinutes: 60, at: "2026-08-12T09:18:00.000Z" });
  assert.equal(slow.kind, null);
  assert.equal(slow.nextPromptAt, "2026-08-12T10:07:00.000Z");
  // The context first-follow-up window anchors the computed prompt.
  assert.equal(firstFollowUpAt({ session, firstFollowUpMinutes: 10, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T09:10:00.000Z");
  assert.equal(firstFollowUpAt({ session, firstFollowUpMinutes: 30, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T09:30:00.000Z");
  // An invalid context window falls back to the environment/default path.
  assert.equal(firstFollowUpAt({ session, firstFollowUpMinutes: 4, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T10:15:00.000Z");
});

test("daily plan candidates deduplicate provider and local tasks", () => {
  assert.deepEqual(dedupePlanCandidates([{ id: "a", title: "A" }, { id: "a", title: "A duplicate" }, { provider_task_id: "b", title: "B" }]).map((item) => item.title), ["A", "B"]);
});

test("plan candidate prioritization keeps carry-over work when a seed limit applies", () => {
  const candidates = [
    { id: "new-task", title: "New task", due_date: "2026-09-12" },
    { id: "carried", title: "Carried task", due_date: "2026-09-12" },
    { id: "later", title: "Later task", due_date: "2026-09-12" },
  ];
  const carryOver = new Map([["carried", { disposition: "selected" as const, rank: 0 }]]);
  const limited = prioritizePlanCandidates(candidates, "2026-09-12", carryOver, 2);
  assert.deepEqual(limited.map((item) => item.id), ["carried", "later"]);
  assert.deepEqual(limited.map((item) => item.rank), [0, 1]);
  assert.equal(limited[0].source, "carry_over");
  assert.equal(prioritizePlanCandidates(candidates, "2026-09-12", carryOver).length, 3);
});

test("plan item bounds are coherent so a seeded plan can always be saved back", () => {
  // The seed loader reads at most a 100-task candidate window and a confirm
  // appends at most eight drafted outcomes, so the seed bound must fit both
  // under the submitted-item cap with headroom to spare.
  const seedLimit = MAX_DAILY_PLAN_ITEMS - PLAN_ITEM_DRAFT_HEADROOM;
  assert.ok(PLAN_ITEM_DRAFT_HEADROOM > 0);
  assert.ok(seedLimit >= 100);
  assert.ok(MAX_DAILY_PLAN_ITEMS >= seedLimit + 8);
});
