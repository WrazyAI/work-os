import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkInCadenceOverridden, checkInIntervalMs, decideWorkdayPrompt, dedupePlanCandidates, firstFollowUpAt, firstFollowUpMinutes, MAX_DAILY_PLAN_ITEMS, nextFallbackAfterDelivery, nextSessionState, PLAN_ITEM_DRAFT_HEADROOM, planningPromptAnswered, prioritizePlanCandidates, promptInstant, suppressPromptForSubmittedEod } from "../src/modules/work-os/workday";
import { ensureDailyPlan, ensureDailyPlanForDate, syncWorktivitySession } from "../src/lib/work-os-workday";
import { resolveActivityIntervalWindow } from "../src/lib/work-os-activity-intervals";
import type { AttendanceProjection } from "../src/modules/work-os/attendance";
import type { WorkOsAccess } from "../src/lib/work-os-api";

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

test("prompt instants keep the database millisecond precision", () => {
  const fromDatabase = new Date("2026-11-02T15:04:14.974Z");
  assert.equal(promptInstant(fromDatabase), "2026-11-02T15:04:14.974Z");
  assert.equal(promptInstant("2026-11-02T15:04:14.974Z"), "2026-11-02T15:04:14.974Z");
  assert.equal(promptInstant(null), null);
  assert.equal(promptInstant("not-a-date"), null);
  // Two prompt instances that differ only below a second must not collapse.
  assert.notEqual(promptInstant(fromDatabase), promptInstant("2026-11-02T15:04:14.000Z"));
});

test("a backdated provider session starts its cadence at the session row", () => {
  const backdated = { ...session, clockedInAt: "2026-08-12T09:00:00.000Z", createdAt: "2026-08-12T12:00:00.000Z" };
  assert.equal(
    firstFollowUpAt({ session: backdated, firstFollowUpMinutes: 10, at: "2026-08-12T12:01:00.000Z" }),
    "2026-08-12T12:10:00.000Z",
  );
  const normal = { ...session, clockedInAt: "2026-08-12T09:00:00.000Z", createdAt: "2026-08-12T09:00:30.000Z" };
  assert.equal(
    firstFollowUpAt({ session: normal, firstFollowUpMinutes: 10, at: "2026-08-12T09:01:00.000Z" }),
    "2026-08-12T09:10:00.000Z",
  );
  assert.equal(
    firstFollowUpAt({ session: backdated, planConfirmedAt: "2026-08-12T11:00:00.000Z", firstFollowUpMinutes: 10, at: "2026-08-12T11:01:00.000Z" }),
    "2026-08-12T11:10:00.000Z",
  );
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

test("working the day does not answer the goal question: only a goal ends it", () => {
  // The question is required at clock-in.
  const awaiting = decideWorkdayPrompt({ session, breaks: [], at: "2026-08-12T09:05:00.000Z" });
  assert.equal(awaiting.kind, "plan");
  assert.equal(awaiting.required, true);
  // A substantive update records work, not a goal, so the question stays.
  const engaged = decideWorkdayPrompt({ session, breaks: [], lastSubstantiveUpdateAt: "2026-08-12T09:30:00.000Z", at: "2026-08-12T09:40:00.000Z" });
  assert.equal(engaged.kind, "plan");
  assert.equal(engaged.required, true);
  assert.equal(engaged.nextPromptAt, "2026-08-12T10:15:00.000Z");
  // A delivered check-in does not answer it either.
  const afterCheckIn = decideWorkdayPrompt({ session, breaks: [], lastPromptKind: "hourly_fallback", at: "2026-08-12T10:40:00.000Z" });
  assert.equal(afterCheckIn.kind, "plan");
  // A goal — the employee's or the suggested one — lets the cadence through.
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasGoal: true, lastSubstantiveUpdateAt: "2026-08-12T09:30:00.000Z", at: "2026-08-12T10:20:00.000Z" }).kind, "follow_up");
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasGoal: true, lastPromptKind: "hourly_fallback", at: "2026-08-12T10:40:00.000Z" }).kind, null);
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

test("a real follow-up delivery waits for its next deadline instead of replaying missed prompts", () => {
  // These are actual delivered-prompt timestamps, not a synthetic reopen.
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
    hasGoal: true,
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

test("a submitted EOD suppresses only the EOD prompt", () => {
  const progress = decideWorkdayPrompt({ session, breaks: [], hasGoal: true, at: "2026-08-12T09:05:00.000Z" });
  const eod = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, hasGoal: true, at: "2026-08-12T16:51:00.000Z" });
  assert.equal(progress.kind, "follow_up");
  assert.deepEqual(suppressPromptForSubmittedEod(progress, "2026-08-12T16:55:00.000Z"), progress);
  assert.deepEqual(suppressPromptForSubmittedEod(eod, "2026-08-12T16:55:00.000Z"), {
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

const planOrg = "10000000-0000-4000-8000-000000000001";
const planPerson = "20000000-0000-4000-8000-000000000001";
const planSession = "30000000-0000-4000-8000-000000000001";
const planId = "40000000-0000-4000-8000-000000000001";
const planAccess = {
  organizationId: planOrg,
  personId: planPerson,
  role: "employee",
  ctx: { user: { id: planPerson }, profile: { email: "recap-fixture@example.test" } },
  featureFlags: {},
} as unknown as WorkOsAccess;

async function planReopenFixture() {
  const database = new PGlite();
  await database.exec(`
    create table work_daily_plans(
      id uuid primary key, organization_id uuid not null, person_id uuid not null, session_id uuid,
      shift_date date not null, status text not null default 'draft', revision integer not null default 1,
      confirmed_at timestamptz, freeform_intent text, focus_summary text, goal_provenance text,
      suggestion_task_ids jsonb default '[]', interpretation_metadata jsonb default '{}',
      clarification_answers jsonb default '{}', updated_at timestamptz default now()
    );
    create table work_daily_plan_items(
      id uuid primary key, plan_id uuid references work_daily_plans(id), task_id uuid,
      title_snapshot text, disposition text, item_kind text, completion_state text, rank integer
    );
    create table work_audit_log(
      organization_id uuid, actor_user_id uuid, action text, target_type text, target_id text,
      metadata jsonb, created_at timestamptz default now()
    );
  `);
  await database.query(`
    insert into work_daily_plans(id, organization_id, person_id, session_id, shift_date, status, revision, confirmed_at, updated_at)
    values ($1, $2, $3, $4, '2026-11-06', 'closed', 3, null, '2026-11-06T16:26:19Z')
  `, [planId, planOrg, planPerson, planSession]);
  const previousPool = globalThis.__workOsPgPool;
  globalThis.__workOsPgPool = {
    query: async (sql: string, values?: unknown[]) => database.query(sql, values),
  } as never;
  return {
    database,
    close: async () => {
      globalThis.__workOsPgPool = previousPool;
      await database.close();
    },
  };
}

test("a live session reopens its closed plan without discarding the editor's revision", async () => {
  const fixture = await planReopenFixture();
  try {
    const plan = await ensureDailyPlan(planAccess, {
      id: planSession,
      shift_date: "2026-11-06",
      state: "active",
    });
    assert.equal(plan.status, "draft");
    assert.equal(plan.revision, 3, "reopening a lifecycle status must not make an in-flight save stale");
    const audit = await fixture.database.query(
      "select action, metadata from work_audit_log where target_id = $1",
      [planId],
    );
    assert.equal(audit.rows.length, 1);
    assert.equal((audit.rows[0] as { action: string }).action, "plan.workday_reopened");
    assert.equal((audit.rows[0] as { metadata: { revision: number } }).metadata.revision, 3);
  } finally {
    await fixture.close();
  }
});

test("today's plan read reopens a live session's plan and leaves a clocked-out day closed", async () => {
  const fixture = await planReopenFixture();
  try {
    const live = await ensureDailyPlanForDate(planAccess, "2026-11-06", {
      id: planSession,
      state: "active",
    });
    assert.equal(live.status, "draft");

    await fixture.database.query("update work_daily_plans set status = 'closed' where id = $1", [planId]);
    const closed = await ensureDailyPlanForDate(planAccess, "2026-11-06", {
      id: planSession,
      state: "clocked_out",
    });
    assert.equal(closed.status, "closed");
  } finally {
    await fixture.close();
  }
});

async function recapSessionFixture() {
  const f = await planReopenFixture();
  await f.database.exec(`
    create table work_sessions (
      id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid, schedule_id uuid,
      shift_date date, state text, timezone text default 'UTC', source text,
      scheduled_starts_at timestamptz, scheduled_ends_at timestamptz, clocked_in_at timestamptz, clocked_out_at timestamptz,
      paused_at timestamptz, paused_seconds int default 0, correction_status text default 'valid',
      clock_in_idempotency_key text, clock_out_idempotency_key text, attendance_status text, attendance_observed_at timestamptz,
      first_follow_up_at timestamptz, next_fallback_at timestamptz, last_prompt_kind text, last_prompt_at timestamptz,
      last_substantive_update_at timestamptz, check_in_interval_minutes int, snoozed_until timestamptz,
      late_acknowledged_at timestamptz, late_reason text, late_reason_provided_at timestamptz,
      exception_acknowledged_at timestamptz, exception_reason text, created_by uuid,
      created_at timestamptz default '2026-11-06T18:00Z', updated_at timestamptz
    );
    create unique index active_session on work_sessions(organization_id,person_id) where state in ('clocked_in','active','paused','eod_due');
    create table work_session_events (organization_id uuid,person_id uuid,session_id uuid,event_type text,from_state text,to_state text,
      source text,observed_at timestamptz,actor_user_id uuid,idempotency_key text unique,metadata jsonb);
    create table work_employee_onboarding (organization_id uuid,person_id uuid,timezone text);
    create table work_schedules (organization_id uuid,person_id uuid,active boolean,effective_from date);
    create table work_schedule_exceptions (organization_id uuid,person_id uuid,exception_date date);
    create table work_organizations (id uuid primary key,feature_flags jsonb);
    create table work_activity_intervals (id uuid primary key,work_session_id uuid,review_status text,window_end timestamptz);
    create table work_check_ins (id uuid primary key);
    insert into work_organizations values ('${planOrg}','{}');
    insert into work_employee_onboarding values ('${planOrg}','${planPerson}','UTC');
    insert into work_sessions(id,organization_id,person_id,shift_date,state,source,clocked_in_at,clocked_out_at,
      scheduled_starts_at,scheduled_ends_at,clock_in_idempotency_key,created_at)
      values ('${planSession}','${planOrg}','${planPerson}','2026-11-06','clocked_out','worktivity',
        '2026-11-06T15:32:12Z','2026-11-06T15:45Z','2026-11-06T15:00Z','2026-11-06T21:00Z',
        'worktivity:clock-in:${planPerson}:2026-11-06T15:32:12Z','2026-11-06T15:35Z');
  `);
  return f;
}

const resumedProjection = {
  source: "worktivity", stale: false, state: "active", status: "working",
  clockedInAt: "2026-11-06T15:32:12Z", observedAt: "2026-11-06T17:45:00Z",
} as AttendanceProjection;

function sessionPrompt(row: Record<string, any>, at = "2026-11-06T17:46:00Z", planConfirmedAt: string | null = null) {
  return decideWorkdayPrompt({
    session: { state: row.state, clockedInAt: promptInstant(row.clocked_in_at), createdAt: promptInstant(row.created_at),
      scheduledStartsAt: "2026-11-06T15:00Z", scheduledEndsAt: "2026-11-06T21:00Z" },
    hasGoal: true, breaks: [], at, firstFollowUpMinutes: 75, checkInIntervalMinutes: 60,
    lastPromptKind: row.last_prompt_kind, lastPromptAt: promptInstant(row.last_prompt_at),
    nextFallbackAt: promptInstant(row.next_fallback_at), lastSubstantiveUpdateAt: promptInstant(row.last_substantive_update_at),
    planConfirmedAt, storedCheckInIntervalMinutes: row.check_in_interval_minutes,
  });
}

test("a late-start session's false clock-out does not invent recap delivery or progress on reopen", async () => {
  const f = await recapSessionFixture();
  try {
    const row = await syncWorktivitySession(planAccess, resumedProjection);
    assert.equal(row.state, "active");
    assert.equal(row.last_prompt_at, null, "attendance is not recap delivery");
    assert.equal(row.last_substantive_update_at, null, "attendance is not an employee work update");
    assert.equal(row.next_fallback_at, null);
    const due = sessionPrompt(row);
    assert.equal(due.kind, "follow_up");
    assert.equal(due.nextPromptAt, "2026-11-06T16:50:00.000Z");
    assert.deepEqual(resolveActivityIntervalWindow({ promptDueAt: due.nextPromptAt!, dayStartIso: "2026-11-06T00:00Z",
      clockedInAt: promptInstant(row.clocked_in_at), lastSubstantiveUpdateAt: promptInstant(row.last_substantive_update_at) }),
    { startIso: "2026-11-06T15:32:12.000Z", endIso: "2026-11-06T16:50:00.000Z" });
    assert.equal((await f.database.query<{ n: number }>("select count(*)::int as n from work_check_ins")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("repeated same-interval reopen preserves real delivery, employee updates and pending or reviewed recaps", async () => {
  const f = await recapSessionFixture();
  try {
    await f.database.exec(`update work_sessions set last_prompt_kind='follow_up',last_prompt_at='2026-11-06T16:00Z',
      next_fallback_at='2026-11-06T17:00Z',check_in_interval_minutes=60,last_substantive_update_at='2026-11-06T16:10Z';
      insert into work_activity_intervals values (gen_random_uuid(),'${planSession}','confirmed','2026-11-06T16:00Z'),
        (gen_random_uuid(),'${planSession}','pending','2026-11-06T17:00Z');`);
    for (const observedAt of ["2026-11-06T17:45Z", "2026-11-06T18:00Z"]) {
      const row = await syncWorktivitySession(planAccess, { ...resumedProjection, observedAt });
      assert.equal(promptInstant(row.last_prompt_at), "2026-11-06T16:00:00.000Z");
      assert.equal(promptInstant(row.last_substantive_update_at), "2026-11-06T16:10:00.000Z");
      assert.equal(promptInstant(row.next_fallback_at), "2026-11-06T17:00:00.000Z");
      assert.equal(sessionPrompt(row, observedAt).nextPromptAt, "2026-11-06T17:10:00.000Z");
      await f.database.exec("update work_sessions set state='clocked_out',clocked_out_at='2026-11-06T17:50Z'");
    }
    assert.deepEqual((await f.database.query("select review_status from work_activity_intervals order by window_end")).rows,
      [{ review_status: "confirmed" }, { review_status: "pending" }]);
    assert.equal(nextFallbackAfterDelivery(Date.parse("2026-11-06T17:10Z"), Date.parse("2026-11-06T18:30Z"), 60 * 60_000),
      "2026-11-06T19:30:00.000Z", "only actual late delivery rebases the next slot, not every reopen");
  } finally { await f.close(); }
});

test("adopting a later provider clock-in starts a fresh cadence without forging an employee update", async () => {
  const f = await recapSessionFixture();
  try {
    await f.database.exec(`update work_sessions set state='active',clocked_out_at=null,
      last_prompt_kind='follow_up',last_prompt_at='2026-11-06T16:00Z',next_fallback_at='2026-11-06T17:00Z',
      last_substantive_update_at='2026-11-06T16:10Z';`);
    const row = await syncWorktivitySession(planAccess, { ...resumedProjection, clockedInAt: "2026-11-06T18:00Z", observedAt: "2026-11-06T18:05Z" });
    assert.equal(promptInstant(row.last_substantive_update_at), "2026-11-06T16:10:00.000Z");
    assert.equal(row.last_prompt_at, null);
    const due = sessionPrompt(row, "2026-11-06T19:15Z", "2026-11-06T15:40Z");
    assert.equal(due.nextPromptAt, "2026-11-06T19:15:00.000Z");
  } finally { await f.close(); }
});

test("a real clock-out and new clock-in preserves the old interval and schedules a recap after the new start", async () => {
  const f = await recapSessionFixture();
  try {
    const row = await syncWorktivitySession(planAccess, { ...resumedProjection, clockedInAt: "2026-11-06T18:00Z", observedAt: "2026-11-06T18:05Z" });
    assert.notEqual(row.id, planSession);
    assert.equal(row.last_substantive_update_at, null);
    assert.equal(sessionPrompt(row, "2026-11-06T19:15Z", "2026-11-06T15:40Z").nextPromptAt, "2026-11-06T19:15:00.000Z");
    const old = (await f.database.query<{ state: string; clocked_out_at: Date }>("select state,clocked_out_at from work_sessions where id=$1", [planSession])).rows[0];
    assert.equal(old.state, "clocked_out");
    assert.equal(promptInstant(old.clocked_out_at), "2026-11-06T15:45:00.000Z");
  } finally { await f.close(); }
});

test("a plan confirmed before a restarted interval cannot strand the recap deadline before clock-in", () => {
  assert.equal(firstFollowUpAt({ session: { ...session, clockedInAt: "2026-11-06T18:00Z", createdAt: "2026-11-06T18:00Z" },
    planConfirmedAt: "2026-11-06T15:40Z", firstFollowUpMinutes: 75, at: "2026-11-06T18:05Z" }), "2026-11-06T19:15:00.000Z");
});

test("a competing adoption cannot erase a recap delivered after the new interval was adopted", async () => {
  const f = await recapSessionFixture();
  try {
    await f.database.exec("update work_sessions set state='active',clocked_out_at=null");
    const pool = globalThis.__workOsPgPool!;
    let interleaved = false;
    globalThis.__workOsPgPool = { query: async (sql: string, values?: unknown[]) => {
      if (!interleaved && sql.startsWith('UPDATE "work_sessions"') && sql.includes('"clocked_in_at"')) {
        interleaved = true;
        // Another sync adopts first, then a real recap is delivered while our
        // sync is still holding the old session snapshot. Execute real SQL.
        await f.database.exec(`update work_sessions set clocked_in_at='2026-11-06T18:00Z',last_prompt_kind='follow_up',
          last_prompt_at='2026-11-06T19:20Z',next_fallback_at='2026-11-06T20:20Z',check_in_interval_minutes=60`);
      }
      return pool.query(sql, values);
    } } as never;
    const row = await syncWorktivitySession(planAccess, { ...resumedProjection, clockedInAt: "2026-11-06T18:00Z", observedAt: "2026-11-06T19:21Z" });
    assert.equal(interleaved, true);
    assert.equal(promptInstant(row.last_prompt_at), "2026-11-06T19:20:00.000Z");
    assert.equal(promptInstant(row.next_fallback_at), "2026-11-06T20:20:00.000Z");
  } finally { await f.close(); }
});
