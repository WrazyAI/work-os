import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCHEDULED_RECAP_FAILURE_BACKOFF_MS,
  scheduledRecapEligible,
  scheduledRecapRetryBlocked,
  settleDueActivityRecaps,
} from "../src/lib/work-os-activity-recap-schedule";
import type { WorkOsAccess } from "../src/lib/work-os-api";

const at = new Date("2026-11-12T15:30:00.000Z");
const access = { organizationId: "org", personId: "person" } as WorkOsAccess;

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

test("a due follow-up is generated once and advances its prompt", async () => {
  const calls: string[] = [];
  const days = [workday("follow_up", "2026-11-12T15:00:00.000Z"), workday("follow_up", "2026-11-12T16:00:00.000Z")];
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => days.shift()!,
    loadSlot: async () => null,
    ensure: async () => { calls.push("ensure"); return { status: "ready" }; },
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
    ensure: async () => { ensured += 1; return { status: "ready" }; },
  } });
  assert.equal(ensured, 0);
  assert.equal(result.generated, 0);
});

test("a failed synthesis stops without advancing and is not retried inside the run", async () => {
  let delivered = 0;
  const result = await settleDueActivityRecaps(access, { at, deps: {
    getWorkday: async () => workday("follow_up", "2026-11-12T15:00:00.000Z"),
    loadSlot: async () => null,
    ensure: async () => ({ status: "failed", reason: "provider unavailable" }),
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
    ensure: async () => ({ status: "unavailable", reason: "no_usable_frames" }),
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
    ensure: async () => ({ status: "ready" }),
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
    ensure: async () => { ensured += 1; return { status: "ready" }; },
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
    ensure: async () => ({ status: "ready" }),
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
