import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCHEDULED_RECAP_FAILURE_BACKOFF_MS,
  scheduledRecapEligible,
  scheduledRecapRetryBlocked,
  settleDueActivityRecaps,
  runScheduledActivityRecaps,
} from "../src/lib/work-os-activity-recap-schedule";
import { PGlite } from "@electric-sql/pglite";
import type { WorkOsAccess } from "../src/lib/work-os-api";

const at = new Date("2026-11-12T15:30:00.000Z");
const access = { organizationId: "org", personId: "person" } as WorkOsAccess;
const receipt = (promptDueAt: string, status: "ready" | "unavailable" = "ready", reason?: string) => ({ status, reason, slot: { sessionId: "session-1", promptDueAt }, mayAdvance: true, readyTransition: "new" as const });

function workday(kind: "follow_up" | "hourly_fallback" | "plan" | null, nextPromptAt: string | null, goal: string | null = "Ship the audit"): any {
  return { session: { id: "session-1" }, plan: goal ? { status: "confirmed", goal_text: goal } : { status: "confirmed" },
    prompt: { kind, nextPromptAt }, cadence: { checkInIntervalMinutes: 30, firstFollowUpMinutes: 10 },
    shift: null, shiftDate: "2026-11-12", at: at.toISOString() };
}

test("a recent failed slot waits for the retry window", () => {
  const row = { generation_status: "failed", updated_at: "2026-11-12T15:20:00.000Z" };
  assert.equal(scheduledRecapRetryBlocked(row, at.getTime()), true);
  assert.equal(scheduledRecapRetryBlocked(row, at.getTime() + SCHEDULED_RECAP_FAILURE_BACKOFF_MS), false);
  assert.equal(scheduledRecapRetryBlocked(null, at.getTime()), false);
});

test("a ready plan-hold recap without a goal waits for the retry window", () => {
  const row = { generation_status: "ready", updated_at: "2026-11-12T15:20:00.000Z" };
  assert.equal(scheduledRecapRetryBlocked(row, at.getTime(), { promptKind: "plan", planHasGoal: false }), true);
  assert.equal(scheduledRecapRetryBlocked(row, at.getTime() + SCHEDULED_RECAP_FAILURE_BACKOFF_MS, { promptKind: "plan", planHasGoal: false }), false);
  assert.equal(scheduledRecapRetryBlocked(row, at.getTime(), { promptKind: "plan", planHasGoal: true }), false);
});

test("a settled empty or timed-out ordinary slot advances without an extra backoff", () => {
  for (const reason of ["no_usable_frames", "evidence_timeout"]) {
    assert.equal(scheduledRecapRetryBlocked({ generation_status: "unavailable", failure_reason: reason, updated_at: "2026-11-12T15:29:59Z" }, at.getTime(), { promptKind: "hourly_fallback", planHasGoal: true }), false);
  }
});

test("a due follow-up is generated once and advances its prompt", async () => {
  const calls: string[] = [];
  const days = [workday("follow_up", "2026-11-12T15:00:00.000Z"), workday("follow_up", "2026-11-12T16:00:00.000Z")];
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => days.shift()!,
    loadSlot: async () => null,
    ensure: async () => { calls.push("ensure"); return receipt("2026-11-12T15:00:00.000Z"); },
    deliver: async () => { calls.push("deliver"); return { delivered: true, prompt: { kind: "follow_up", nextPromptAt: "2026-11-12T16:00:00.000Z" } } as any; },
  } });
  assert.deepEqual(calls, ["ensure", "deliver"]);
  assert.equal(result.generated, 1);
  assert.equal(result.advanced, 1);
});

test("a future or missing prompt does nothing", async () => {
  let ensured = 0;
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("follow_up", "2026-11-12T16:00:00.000Z"),
    loadSlot: async () => null,
    ensure: async () => { ensured += 1; return receipt("2026-11-12T16:00:00.000Z"); },
  } });
  assert.equal(ensured, 0);
  assert.equal(result.generated, 0);
});

test("a scheduler finishing slot A cannot advance B", async () => {
  const due = "2026-11-12T14:30:00.000Z";
  const receipts: unknown[] = [];
  let reads = 0;
  const result = await settleDueActivityRecaps(access, { at, maxSlots: 1, deps: {
    getWorkday: async () => workday("hourly_fallback", reads++ === 0 ? due : "2026-11-12T15:30:00.000Z"),
    loadSlot: async () => null,
    ensure: async (_access, input) => {
      receipts.push(input.expectedSlot);
      return receipt(due);
    },
    deliver: async (_access, _at, slot) => {
      receipts.push(slot);
      return { delivered: slot?.promptDueAt === "2026-11-12T15:30:00.000Z" } as any;
    },
  } });
  assert.equal(result.advanced, 0);
  assert.deepEqual(receipts, [
    { sessionId: "session-1", promptDueAt: due },
    { sessionId: "session-1", promptDueAt: due },
  ]);
});

test("a failed synthesis stops without advancing and is not retried inside the run", async () => {
  let delivered = 0;
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("follow_up", "2026-11-12T15:00:00.000Z"),
    loadSlot: async () => null,
    ensure: async () => ({ ...receipt("2026-11-12T15:00:00.000Z"), status: "failed", mayAdvance: false, reason: "provider unavailable" }),
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: null, nextPromptAt: null } } as any; },
  } });
  assert.equal(delivered, 0);
  assert.equal(result.failed, 1);
});

test("an empty interval advances the prompt but counts as skipped", async () => {
  let delivered = 0;
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("follow_up", "2026-11-12T15:00:00.000Z"),
    loadSlot: async () => null,
    ensure: async () => receipt("2026-11-12T15:00:00.000Z", "unavailable", "no_usable_frames"),
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: "follow_up", nextPromptAt: "2026-11-12T16:00:00.000Z" } } as any; },
  } });
  assert.equal(delivered, 1);
  assert.equal(result.skipped, 1);
});

test("a plan hold that writes no goal stops instead of looping", async () => {
  let delivered = 0;
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("plan", "2026-11-12T15:20:00.000Z", null),
    loadSlot: async () => null,
    ensure: async () => receipt("2026-11-12T15:20:00.000Z"),
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: null, nextPromptAt: null } } as any; },
  } });
  assert.equal(delivered, 0);
  assert.equal(result.generated, 1);
});

test("a recent failed row is not synthesized again", async () => {
  let ensured = 0;
  await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("follow_up", "2026-11-12T15:00:00.000Z"),
    loadSlot: async () => ({ generation_status: "failed", updated_at: "2026-11-12T15:25:00.000Z" }),
    ensure: async () => { ensured += 1; return receipt("2026-11-12T15:00:00.000Z"); },
  } });
  assert.equal(ensured, 0);
});

test("scheduled recap eligibility fails closed", () => {
  const base = { featureFlags: { screenshot_summaries: true }, consent: { tracking: true, screenshotAnalysis: true },
    worktivityEmployeeId: "wt-1", exceptionKind: null };
  assert.equal(scheduledRecapEligible(base), true);
  assert.equal(scheduledRecapEligible({ ...base, featureFlags: {} }), false);
  assert.equal(scheduledRecapEligible({ ...base, featureFlags: { screenshot_summaries: true, activity_intervals: false } }), false);
  assert.equal(scheduledRecapEligible({ ...base, consent: { tracking: false, screenshotAnalysis: true } }), false);
  assert.equal(scheduledRecapEligible({ ...base, consent: { tracking: true, screenshotAnalysis: false } }), false);
  assert.equal(scheduledRecapEligible({ ...base, worktivityEmployeeId: null }), false);
  assert.equal(scheduledRecapEligible({ ...base, exceptionKind: "leave" }), false);
});

test("a long-gap catch-up advances one slot and stops", async () => {
  let delivered = 0;
  const days = [workday("hourly_fallback", "2026-11-12T13:00:00.000Z"), workday("hourly_fallback", "2026-11-12T16:00:00.000Z")];
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => days.shift()!,
    loadSlot: async () => null,
    ensure: async () => receipt("2026-11-12T13:00:00.000Z"),
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: "hourly_fallback", nextPromptAt: "2026-11-12T16:00:00.000Z" } } as any; },
  } });
  assert.equal(delivered, 1);
  assert.equal(result.generated, 1);
  assert.equal(result.advanced, 1);
});

test("the scheduler never writes check-ins or substantive updates", () => {
  const source = readFileSync(new URL("../src/lib/work-os-activity-recap-schedule.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /work_check_ins|last_substantive_update_at/);
});

test("scheduler distinguishes empty, deferred, generated, reused and broken outcomes", async () => {
  const due = "2026-11-12T15:00:00.000Z";
  const cases = [
    { result: { ...receipt(due), readyTransition: "new", interval: { generated_at: "2026-11-12T15:02:00Z", prompt_due_at: due } }, outcome: "generated", generated: 1, failed: 0, latency: 120_000 },
    { result: { ...receipt(due), readyTransition: "existing" }, outcome: "already_ready", generated: 0, failed: 0, latency: 0 },
    { result: receipt(due, "unavailable", "no_usable_frames"), outcome: "empty", generated: 0, failed: 0, latency: 0 },
    { result: { ...receipt(due), status: "awaiting_evidence", mayAdvance: false }, outcome: "awaiting_evidence", generated: 0, failed: 0, latency: 0 },
    { result: receipt(due, "unavailable", "evidence_timeout"), outcome: "failed", generated: 0, failed: 1, latency: 0 },
  ] as const;
  for (const entry of cases) {
    const settled = await settleDueActivityRecaps(access, { at, maxSlots: 1, deps: {
      getWorkday: async () => workday("follow_up", due), loadSlot: async () => null,
      ensure: async () => entry.result,
      deliver: async () => ({ delivered: true }) as any,
    } });
    assert.equal(settled.coverage.outcomes[entry.outcome], 1, entry.outcome);
    assert.equal(settled.generated, entry.generated);
    assert.equal(settled.failed, entry.failed);
    assert.equal(settled.coverage.readyLatencyMs.sum, entry.latency);
    assert.equal(settled.coverage.readyLatencyMs.count, entry.generated);
    assert.equal(settled.coverage.dueSlotsObserved, 1);
  }
});

test("slot lost after ready preserves generation and reports the lost delivery", async () => {
  const due = "2026-11-12T15:00:00Z";
  const settled = await settleDueActivityRecaps(access, { at, maxSlots: 1, deps: {
    getWorkday: async () => workday("follow_up", due), loadSlot: async () => null,
    ensure: async () => ({ ...receipt(due), readyTransition: "new" }),
    deliver: async () => ({ delivered: false }) as any,
  } });
  assert.equal(settled.coverage.outcomes.generated, 1);
  assert.equal(settled.coverage.reasons.slot_changed, 1);
  assert.equal(settled.advanced, 0);
});

test("a delivery failure after generation keeps its coverage", async () => {
  const due = "2026-11-12T15:00:00.000Z";
  const settled = await settleDueActivityRecaps(access, { at, maxSlots: 1, deps: {
    getWorkday: async () => workday("follow_up", due), loadSlot: async () => null,
    ensure: async () => ({ ...receipt(due), readyTransition: "new", interval: { generated_at: "2026-11-12T15:02:00Z", prompt_due_at: due } }),
    deliver: async () => { throw new Error("transport down"); },
  } });
  assert.equal(settled.generated, 1);
  assert.equal(settled.coverage.outcomes.generated, 1);
  assert.equal(settled.failed, 1);
  assert.equal(settled.coverage.reasons.delivery_failed, 1);
  assert.equal(settled.coverage.readyLatencyMs.count, 1);
});

test("consent lookup failure leaves later scheduler candidates runnable and the summary private", async () => {
  const database = new PGlite();
  const previous = globalThis.__workOsPgPool;
  const oldKey = process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY, oldSecret = process.env.CRON_SECRET;
  try {
    process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY = "test-only"; process.env.CRON_SECRET = "test-only";
    await database.exec(`create table work_sessions(id text,organization_id text,person_id text,timezone text,clocked_in_at timestamptz,state text,next_fallback_at timestamptz,last_prompt_at timestamptz,first_follow_up_at timestamptz);
      create table work_organizations(id text,feature_flags jsonb,legacy_owner_id text,created_by text);
      create table work_people(id text,organization_id text,active boolean,worktivity_employee_id text);
      create table work_schedule_exceptions(organization_id text,person_id text,exception_date date,kind text);
      insert into work_organizations values ('private-org','{"screenshot_summaries":true}','owner',null);
      insert into work_people values ('private-a','private-org',true,'wt-a'),('private-b','private-org',true,'wt-b');
      insert into work_sessions values ('session-a','private-org','private-a','UTC','2026-11-12T13:00Z','active','2026-11-12T14:00Z',null,'2026-11-12T14:00Z'),
       ('session-b','private-org','private-b','UTC','2026-11-12T13:01Z','active','2026-11-12T14:01Z',null,'2026-11-12T14:01Z');`);
    globalThis.__workOsPgPool = { query: (sql: string, values?: unknown[]) => database.query(sql, values) } as never;
    let settled = 0;
    const run = await runScheduledActivityRecaps(24, at, {
      consent: async (_org, person) => { if (person === "private-a") throw new Error("private-provider-token"); return { tracking: true, screenshotAnalysis: true }; },
      settle: async () => { settled++; return settleDueActivityRecaps(access, { at, deps: { getWorkday: async () => workday(null, null) } }); },
    });
    assert.equal(settled, 1);
    assert.equal(run.failed, 1);
    assert.equal(run.coverage.scanned, 2);
    assert.equal(run.coverage.reasons.candidate_lookup_failed, 1);
    assert.doesNotMatch(JSON.stringify(run), /private-|owner|personId|organizationId/);
    await database.exec("delete from work_sessions");
    const empty = await runScheduledActivityRecaps(24, at);
    assert.equal(empty.coverage.scanned, 0);
    assert.equal(Object.values(empty.coverage.outcomes).reduce((a, b) => a + b, 0), 0);
  } finally {
    globalThis.__workOsPgPool = previous;
    if (oldKey === undefined) delete process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY; else process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
    await database.close();
  }
});
