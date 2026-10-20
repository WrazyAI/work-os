import assert from "node:assert/strict";
import test from "node:test";
import { checkInCadenceOverridden, checkInIntervalMs, decideWorkdayPrompt, dedupePlanCandidates, firstFollowUpAt, firstFollowUpMinutes, MAX_DAILY_PLAN_ITEMS, nextFallbackAfterDelivery, nextSessionState, PLAN_ITEM_DRAFT_HEADROOM, planningPromptAnswered, prioritizePlanCandidates, suppressPromptForSubmittedEod } from "../src/modules/work-os/workday";

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

test("the goal question holds the day's first prompt and suppresses breaks, final hour, and post clock-out", () => {
  const firstPrompt = decideWorkdayPrompt({ session, breaks: [], at: "2026-08-12T09:05:00.000Z" });
  assert.equal(firstPrompt.kind, "plan");
  assert.equal(firstPrompt.required, true);
  // The hold runs to the first follow-up: a due check-in cannot preempt it.
  assert.equal(firstPrompt.nextPromptAt, "2026-08-12T10:15:00.000Z");
  const heldPrompt = decideWorkdayPrompt({ session, breaks: [], at: "2026-08-12T10:20:00.000Z" });
  assert.equal(heldPrompt.kind, "plan");
  assert.equal(heldPrompt.required, true);
  // A day that already carries a goal lets the check-in cadence through.
  const progressPrompt = decideWorkdayPrompt({ session, breaks: [], hasGoal: true, at: "2026-08-12T10:20:00.000Z" });
  assert.equal(progressPrompt.kind, "follow_up");
  assert.equal(progressPrompt.nextPromptAt, "2026-08-12T10:15:00.000Z");
  assert.equal(progressPrompt.required, false);
  assert.equal(decideWorkdayPrompt({ session, breaks: [{ startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-12T12:30:00.000Z" }], hasGoal: true, at: "2026-08-12T12:05:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasGoal: true, at: "2026-08-12T16:15:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasGoal: true, at: "2026-08-12T16:51:00.000Z" }).kind, "eod");
  assert.equal(decideWorkdayPrompt({ session: { ...session, state: "clocked_out" }, breaks: [], hasGoal: true, at: "2026-08-12T18:00:00.000Z" }).kind, null);
});

test("the goal question stands down as soon as the day has a goal", () => {
  // A goal recorded in the Focus tab before the plan is confirmed is enough.
  const early = decideWorkdayPrompt({ session, breaks: [], hasGoal: true, at: "2026-08-12T09:05:00.000Z" });
  assert.equal(early.kind, "follow_up");
  assert.equal(early.required, false);
  // Without a goal the question is still the day's prompt.
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasGoal: false, at: "2026-08-12T09:05:00.000Z" }).kind, "plan");
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

test("a reopened Worktivity interval restarts the cadence instead of replaying missed prompts", () => {
  // A session whose provider interval was falsely closed mid-day is reopened
  // with the cadence restarted: the next check-in is one interval out, never an
  // overdue backlog of every prompt the false close missed. getWorkday mirrors
  // the session's cadence columns onto the prompt context.
  const reopened = {
    ...session,
    clockedInAt: "2026-08-12T00:46:29.086Z",
    lastPromptKind: "follow_up" as const,
    lastPromptAt: "2026-08-12T12:55:00.000Z",
    nextFallbackAt: "2026-08-12T13:25:00.000Z",
  };
  const reopenedContext = {
    session: reopened,
    breaks: [],
    hasConfirmedPlan: false,
    lastPromptKind: "follow_up" as const,
    lastPromptAt: "2026-08-12T12:55:00.000Z",
    nextFallbackAt: "2026-08-12T13:25:00.000Z",
    lastSubstantiveUpdateAt: "2026-08-12T12:55:00.000Z",
    checkInIntervalMinutes: 30,
    storedCheckInIntervalMinutes: 30,
  };
  const waiting = decideWorkdayPrompt({ ...reopenedContext, at: "2026-08-12T12:56:00.000Z" });
  assert.equal(waiting.kind, null);
  assert.equal(waiting.nextPromptAt, "2026-08-12T13:25:00.000Z");
  const due = decideWorkdayPrompt({ ...reopenedContext, at: "2026-08-12T13:25:30.000Z" });
  assert.equal(due.kind, "hourly_fallback");
  assert.equal(due.nextPromptAt, "2026-08-12T13:25:00.000Z");
});

test("a late check-in delivery anchors the next one to the delivery, not the missed schedule", () => {
  const interval = 30 * 60_000;
  const scheduled = Date.parse("2026-08-12T10:00:00.000Z");
  // On time (or within a poll lag): keep the drift-corrected schedule.
  assert.equal(nextFallbackAfterDelivery(scheduled, scheduled + 30_000, interval), "2026-08-12T10:30:00.000Z");
  // More than one interval late: anchor to the delivery so the cadence cannot
  // crawl through every missed slot, one delivery per poll.
  assert.equal(nextFallbackAfterDelivery(scheduled, scheduled + 31 * 60_000, interval), "2026-08-12T11:01:00.000Z");
  assert.equal(nextFallbackAfterDelivery(scheduled, Date.parse("2026-08-12T17:48:00.000Z"), interval), "2026-08-12T18:18:00.000Z");
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
  const due = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, hasGoal: true, at: "2026-08-12T16:51:00.000Z" });
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
    hasConfirmedPlan: true, hasGoal: true,
    at: "2026-08-12T10:07:00.000Z",
  });
  assert.equal(prompt.kind, "hourly_fallback");
  assert.equal(prompt.nextPromptAt, "2026-08-12T10:07:00.000Z");
});

test("a confirmed plan anchors the first follow-up at seventy-five minutes", () => {
  const prompt = decideWorkdayPrompt({
    session,
    breaks: [],
    hasConfirmedPlan: true, hasGoal: true,
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
    hasConfirmedPlan: true, hasGoal: true,
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
  // A stored anchor written under the resolved cadence is preserved, including
  // its sub-minute confirmation precision.
  assert.equal(firstFollowUpAt({ session, firstFollowUpAt: "2026-08-12T09:10:30.000Z", firstFollowUpMinutes: 10, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T09:10:30.000Z");
  // A stored anchor from an older cadence is rebased once the cadence changes.
  assert.equal(firstFollowUpAt({ session, firstFollowUpAt: "2026-08-12T09:10:00.000Z", firstFollowUpMinutes: 30, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T09:30:00.000Z");
  // Even a one-minute cadence edit is detected and rebased.
  assert.equal(firstFollowUpAt({ session, firstFollowUpAt: "2026-08-12T10:00:00.000Z", firstFollowUpMinutes: 61, at: "2026-08-12T09:05:00.000Z" }), "2026-08-12T10:01:00.000Z");
});

test("a cadence edit rebases the persisted next check-in deadline", () => {
  const waiting = {
    session: { ...session, lastPromptKind: "hourly_fallback" as const, lastPromptAt: "2026-08-12T09:05:00.000Z" },
    breaks: [],
    lastPromptKind: "hourly_fallback" as const,
    lastPromptAt: "2026-08-12T09:05:00.000Z",
    hasConfirmedPlan: true, hasGoal: true,
  };
  // A persisted deadline that still matches the resolved cadence (within the
  // delivery lag) is preserved exactly.
  const kept = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T09:15:30.000Z", checkInIntervalMinutes: 10, at: "2026-08-12T09:16:00.000Z" });
  assert.equal(kept.kind, "hourly_fallback");
  assert.equal(kept.nextPromptAt, "2026-08-12T09:15:30.000Z");
  // A normal companion delivery lag (more than a minute) still preserves the
  // drift-corrected deadline.
  const lateDelivery = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T09:17:00.000Z", checkInIntervalMinutes: 10, at: "2026-08-12T09:17:30.000Z" });
  assert.equal(lateDelivery.kind, "hourly_fallback");
  assert.equal(lateDelivery.nextPromptAt, "2026-08-12T09:17:00.000Z");
  // A deadline persisted under a longer cadence rebases onto the shorter one.
  const shortened = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T10:05:00.000Z", checkInIntervalMinutes: 10, at: "2026-08-12T09:18:00.000Z" });
  assert.equal(shortened.kind, "hourly_fallback");
  assert.equal(shortened.nextPromptAt, "2026-08-12T09:15:00.000Z");
  // A deadline persisted under a shorter cadence rebases onto the longer one.
  const lengthened = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T09:15:00.000Z", checkInIntervalMinutes: 60, at: "2026-08-12T09:18:00.000Z" });
  assert.equal(lengthened.kind, null);
  assert.equal(lengthened.nextPromptAt, "2026-08-12T10:05:00.000Z");
  // With the recorded interval, even a small cadence edit rebases instead of
  // being mistaken for delivery lag.
  const storedSmallEdit = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T10:05:00.000Z", storedCheckInIntervalMinutes: 60, checkInIntervalMinutes: 65, at: "2026-08-12T09:18:00.000Z" });
  assert.equal(storedSmallEdit.kind, null);
  assert.equal(storedSmallEdit.nextPromptAt, "2026-08-12T10:10:00.000Z");
  // A recorded interval matching the resolved cadence preserves the deadline.
  const storedMatch = decideWorkdayPrompt({ ...waiting, nextFallbackAt: "2026-08-12T09:20:00.000Z", storedCheckInIntervalMinutes: 10, checkInIntervalMinutes: 10, at: "2026-08-12T09:21:00.000Z" });
  assert.equal(storedMatch.kind, "hourly_fallback");
  assert.equal(storedMatch.nextPromptAt, "2026-08-12T09:20:00.000Z");
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
