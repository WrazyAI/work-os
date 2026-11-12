# Server-side Activity Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate activity recaps on a server schedule whether or not the companion is open, surface only the newest unapproved recap at launch, keep older recaps in the queue, and hide intervals with no usable activity.

**Architecture:** A cron-only scheduler walks active work sessions, advances due prompt slots through the existing `ensureActivityInterval` and `deliverWorkdayPrompt` paths, and leaves empty intervals hidden. The employee stream filters to real recaps. A new latest endpoint drives the floating mascot and the main-window launch flyout. Companion-only UI adds the launch recap bubble and the post-approval unapproved-recaps prompt.

**Tech Stack:** Next.js 16 route handlers, TypeScript, node:test + PGlite, Vitest + React static render tests, Tauri companion React, systemd user timers in Agent OS.

**Spec:** `docs/superpowers/specs/2026-11-12-server-side-activity-recaps-design.md`

## Global Constraints

- Activity inference must never create `work_check_ins` rows or advance `work_sessions.last_substantive_update_at`.
- Use `src/lib/work-os-ai-model.ts`; do not add a second model client.
- Every employee read/write stays scoped by `organization_id` and `person_id`.
- The scheduled route is authenticated only by `CRON_SECRET`.
- No companion version bump or release dispatch; this is pending update 3 of 5.
- Keep the employee Recent activity queue to `preparing` and `ready` intervals.
- The newest ready recap is the only recap that may auto-surface, and only while it is `inferred`.
- The floating companion owns the system toast; the main window owns only its in-app flyout.
- Use the native WSL Node toolchain: `export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH`.

## Review Focus

- A break/idle interval with no usable frames must never appear in the employee queue or fire a notification. Tested in Task 3 and Task 5.
- A server restart after a long gap must not create duplicate or replay every missed slot. Tested in Task 1.
- Approving the newest recap must not make an older recap auto-surface. Tested in Task 4 and Task 6.
- Overlapping scheduler runs must not double-advance a prompt. Tested in Task 1 and Task 2.
- A failed synthesis or a goal-less plan hold must not call the model every five minutes. Tested in Task 1.

---

### Task 1: Scheduler decisions and due-slot loop

**Files:**
- Create: `src/lib/work-os-activity-recap-schedule.ts`
- Create: `test/work-os-activity-recap-schedule.test.mts`

**Interfaces:**
- Consumes: `getWorkday`, `deliverWorkdayPrompt` from `src/lib/work-os-workday.ts`; `ensureActivityInterval`, `activityIntervalSlotKey`, `ActivityIntervalRecord` from `src/lib/work-os-activity-intervals.ts`.
- Produces:
  - `export const SCHEDULED_RECAP_MAX_SLOTS = 4`
  - `export const SCHEDULED_RECAP_FAILURE_BACKOFF_MS = 15 * 60_000`
  - `export function scheduledRecapRetryBlocked(row: ActivityIntervalRecord | null, atMs: number, options?: { promptKind?: string | null; planHasGoal?: boolean }): boolean`
  - `export type ScheduledRecapDeps`
  - `export async function settleDueActivityRecaps(access: WorkOsAccess, options: { at: Date; maxSlots?: number; deps?: Partial<ScheduledRecapDeps> }): Promise<{ generated: number; skipped: number; failed: number; advanced: number; results: Array<{ slotKey: string; status: string; advanced: boolean }> }>`

- [ ] **Step 1: Write the failing scheduler-loop tests**

Create `test/work-os-activity-recap-schedule.test.mts` with fakes shaped like the real workday:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHEDULED_RECAP_FAILURE_BACKOFF_MS,
  scheduledRecapRetryBlocked,
  settleDueActivityRecaps,
} from "../src/lib/work-os-activity-recap-schedule";
import type { WorkOsAccess } from "../src/lib/work-os-api";

const at = new Date("2026-11-12T15:30:00.000Z");
const access = { organizationId: "org", personId: "person" } as WorkOsAccess;

function workday(kind: "follow_up" | "hourly_fallback" | "plan" | null, nextPromptAt: string | null, goal: string | null = "Ship the audit") {
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
    deliver: async () => { calls.push("deliver"); return { delivered: true, prompt: { kind: "follow_up", nextPromptAt: "2026-11-12T16:00:00.000Z" } }; },
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
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: null, nextPromptAt: null } }; },
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
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: "follow_up", nextPromptAt: "2026-11-12T16:00:00.000Z" } }; },
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
    deliver: async () => { delivered += 1; return { delivered: true, prompt: { kind: null, nextPromptAt: null } }; },
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test test/work-os-activity-recap-schedule.test.mts`
Expected: FAIL because `src/lib/work-os-activity-recap-schedule.ts` does not exist.

- [ ] **Step 3: Implement the scheduler loop**

In `src/lib/work-os-activity-recap-schedule.ts` implement the exports above. The loop is:

1. Read the workday at `at`.
2. Stop when the prompt has no due instant or is more than 60 seconds in the future.
3. Compute the slot key with `activityIntervalSlotKey(String(workday.session?.id), prompt.nextPromptAt)`.
4. Load the slot row; stop when `scheduledRecapRetryBlocked(row, at.getTime(), { promptKind: prompt.kind, planHasGoal: Boolean(dailyPlanGoalText(workday.plan)) })` is true.
5. Call `ensureActivityInterval(access, { promptDueAt: prompt.nextPromptAt, at })`.
6. On `failed`, increment `failed` and stop.
7. On `no_prompt`, stop.
8. Re-read the workday. If it is still the same due `plan` prompt, stop without delivering.
9. Otherwise call `deliverWorkdayPrompt(access, at)`; increment `advanced` when delivered.
10. Stop at `maxSlots` (default `SCHEDULED_RECAP_MAX_SLOTS`), or when the next prompt is not due.

`deps` defaults to the real imports and real slot loader. The real slot loader queries `work_activity_intervals` by organization, person, and slot key.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test test/work-os-activity-recap-schedule.test.mts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-activity-recap-schedule.ts test/work-os-activity-recap-schedule.test.mts
git commit -m "feat(work-os): settle due activity recaps server-side"
```

---

### Task 2: Scheduler candidate gates and cron route

**Files:**
- Modify: `src/lib/work-os-activity-recap-schedule.ts`
- Create: `src/app/api/work-os/evidence/activity-intervals/run-scheduled/route.ts`
- Modify: `test/work-os-activity-recap-schedule.test.mts`
- Modify: `test/work-os-route-contracts.test.mts`

**Interfaces:**
- Consumes: `settleDueActivityRecaps` from Task 1; `employeeTrackingConsent` from `src/lib/work-os-onboarding.ts`.
- Produces:
  - `export function scheduledRecapEligible(input: { featureFlags: Record<string, boolean>; consent: { tracking: boolean; screenshotAnalysis: boolean }; worktivityEmployeeId: string | null; exceptionKind: string | null }): boolean`
  - `export async function runScheduledActivityRecaps(limit = 24, at = new Date()): Promise<{ attempted: number; employees: number; generated: number; skipped: number; failed: number; results: Array<{ organizationId: string; personId: string; status: string; generated: number; skipped: number; failed: number }> }>`

- [ ] **Step 1: Write the failing eligibility and route-contract tests**

Append to `test/work-os-activity-recap-schedule.test.mts`, adding `scheduledRecapEligible` to the existing import from the scheduler module:

```ts
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
```

Add to `test/work-os-route-contracts.test.mts`, beside the screenshot scheduled route contract:

```ts
test("the scheduled recap route is cron-only and bounded", async () => {
  const routeSource = await source("src/app/api/work-os/evidence/activity-intervals/run-scheduled/route.ts");
  assert.match(routeSource, /CRON_SECRET/);
  assert.match(routeSource, /runScheduledActivityRecaps/);
  assert.match(routeSource, /Math\.min\(48/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-name-pattern "scheduled recap eligibility|scheduled recap route" test/work-os-activity-recap-schedule.test.mts test/work-os-route-contracts.test.mts`
Expected: FAIL because the exports and route do not exist.

- [ ] **Step 3: Implement eligibility, candidate discovery, and the route**

`runScheduledActivityRecaps` must:

1. Require `WORK_OS_SCREENSHOT_ENCRYPTION_KEY` and `CRON_SECRET`; throw the same readiness error shape as the screenshot scheduler.
2. Coalesce overlapping runs through one module-level in-flight promise.
3. Select sessions from `work_sessions` with state `clocked_in` or `active`, `clocked_in_at` not null, and `clocked_in_at >= at - 24h`. Keep only rows where `next_fallback_at` is due or `last_prompt_at` is null (the first follow-up still has to be checked); order by `next_fallback_at` ascending with nulls first, then `clocked_in_at`, and read at most `limit * 4` rows.
4. For each unique person/organization, load the organization `feature_flags, legacy_owner_id, created_by`, the person `worktivity_employee_id, active`, the local-date schedule exception `kind`, and tracking consent. Cache organization and person rows per run.
5. Apply `scheduledRecapEligible`.
6. Build `WorkOsAccess` with the real feature flags, `role: "admin"`, `membershipId: "system-activity-recap-schedule:<personId>"`, and the owner as `ctx.user.id`.
7. Call `settleDueActivityRecaps` and collect counts. Stop after `limit` eligible employees.

Create `src/app/api/work-os/evidence/activity-intervals/run-scheduled/route.ts` with `runtime = "nodejs"`, `dynamic = "force-dynamic"`, a `POST` handler that compares `authorization` to `Bearer ${CRON_SECRET}`, parses `limit` from JSON, clamps it to `Math.min(48, Math.max(1, Number(body.limit) || 24))`, and returns `NextResponse.json(await runScheduledActivityRecaps(limit))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-name-pattern "scheduled recap eligibility|scheduled recap route" test/work-os-activity-recap-schedule.test.mts test/work-os-route-contracts.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-activity-recap-schedule.ts src/app/api/work-os/evidence/activity-intervals/run-scheduled/route.ts test/work-os-activity-recap-schedule.test.mts test/work-os-route-contracts.test.mts
git commit -m "feat(work-os): add scheduled recap cron service"
```

---

### Task 3: Hide no-activity intervals, guard retries, and add the latest endpoint

**Files:**
- Modify: `src/lib/work-os-activity-intervals.ts`
- Create: `src/app/api/work-os/me/activity-intervals/latest/route.ts`
- Modify: `test/work-os-activity-intervals.test.mts`
- Modify: `test/work-os-route-contracts.test.mts`

**Interfaces:**
- Produces:
  - `export const ACTIVITY_INTERVAL_RETRY_BACKOFF_MS = 15 * 60_000`
  - `export function activityIntervalRetryBlocked(row: ActivityIntervalRecord | null, atMs: number, backoffMs?: number): boolean`
  - `export function intervalAuditActorId(access: WorkOsAccess): string | null`
  - `export async function latestActivityInterval(access: WorkOsAccess): Promise<{ interval: ActivityIntervalView | null; pendingCount: number }>`
  - `GET /api/work-os/me/activity-intervals/latest` returning that shape.
- Changes: `listActivityIntervals` only returns rows whose `generation_status` is `preparing` or `ready`, and its page/count/cursor all use that same filter. `ensureActivityInterval` returns a recent `unavailable` or `failed` row without re-preparing it.

- [ ] **Step 1: Write the failing list-filter and latest tests**

Add to `test/work-os-activity-intervals.test.mts` a PGlite test that extends the local schema with the columns and `work_recap_reviews` table used by `intervalView`/`activityIntervalFullView`, then inserts four rows for one person and date:

- `ready`, `inferred`, newest `window_end`
- `preparing`, `inferred`, second newest
- `unavailable`, `inferred`, `failure_reason='no_usable_frames'`
- `failed`, `inferred`

Assert:

```ts
const page = await intervalEngine.listActivityIntervals(access, { date: "2026-11-12", days: 1, limit: 10 });
assert.deepEqual(page.intervals.map((entry) => entry.generationStatus), ["ready", "preparing"]);
assert.equal(page.total, 2);
const latest = await intervalEngine.latestActivityInterval(access);
assert.equal(latest.interval?.id, readyId);
assert.equal(latest.pendingCount, 1);
```

Also mark the newest `ready` row `confirmed` and assert the latest endpoint still returns it and reports `pendingCount = 0`.

Add a pure test for the retry guard:

```ts
test("an unavailable or failed row waits fifteen minutes before another attempt", () => {
  const recent = { generation_status: "unavailable", updated_at: "2026-11-12T15:20:00.000Z" };
  assert.equal(intervalEngine.activityIntervalRetryBlocked(recent, Date.parse("2026-11-12T15:30:00.000Z")), true);
  assert.equal(intervalEngine.activityIntervalRetryBlocked(recent, Date.parse("2026-11-12T15:36:00.000Z")), false);
  assert.equal(intervalEngine.activityIntervalRetryBlocked({ ...recent, generation_status: "ready" }, Date.parse("2026-11-12T15:30:00.000Z")), false);
});

test("scheduled audits are not attributed to the organization owner", () => {
  assert.equal(intervalEngine.intervalAuditActorId({ membershipId: "system-activity-recap-schedule:person", ctx: { user: { id: "owner" } } } as WorkOsAccess), null);
  assert.equal(intervalEngine.intervalAuditActorId({ membershipId: "session-membership", ctx: { user: { id: "owner" } } } as WorkOsAccess), "owner");
});
```

Add to `test/work-os-route-contracts.test.mts`:

```ts
test("the latest recap route is owner-scoped", async () => {
  const routeSource = await source("src/app/api/work-os/me/activity-intervals/latest/route.ts");
  assert.match(routeSource, /latestActivityInterval/);
  assert.match(routeSource, /requireWorkOsAccess/);
  assert.match(routeSource, /requirePerson: true/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-name-pattern "employee queue hides empty|latest recap|latest recap route" test/work-os-activity-intervals.test.mts test/work-os-route-contracts.test.mts`
Expected: FAIL because the filter, endpoint, and route do not exist.

- [ ] **Step 3: Implement the filter and endpoint**

In `listActivityIntervals`, add `.in("generation_status", ["preparing", "ready"])` to both the page query and the count query before ordering/limiting.

Export `activityIntervalRetryBlocked` for `unavailable`/`failed` rows whose `updated_at` is within the backoff. In `ensureActivityInterval`, after loading `existing` and before the in-flight/coalescing work, return `{ status: "unavailable", reason: existing.failure_reason, interval: existing }` when the guard blocks. Leave `ready` and `preparing` rows on the existing path. In the scheduler, keep the plan-hold branch but delegate the `failed`/`unavailable` branch to this shared helper and keep the Task 1 test green. Add `intervalAuditActorId` returning null for a membership id starting with `system-`, otherwise the context user id, and use it as `auditInterval`'s `actor_user_id`.

In `latestActivityInterval`:

1. Resolve the person timezone and a 30-day `fromDate` using the same date math as `listActivityIntervals`.
2. Query the newest `work_activity_intervals` row for the person with `generation_status = "ready"` ordered by `window_end desc, id desc`, limit 1.
3. Count `generation_status = "ready"` and `review_status = "inferred"` in the same date range with `head: true`.
4. Return `interval: row ? await activityIntervalFullView(row) : null` and the count.

Create the route with `requireWorkOsAccess({ ..., requirePerson: true, feature: "employee_companion" })` and `Cache-Control: no-store`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-name-pattern "employee queue hides empty|latest recap|latest recap route" test/work-os-activity-intervals.test.mts test/work-os-route-contracts.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-activity-intervals.ts src/app/api/work-os/me/activity-intervals/latest/route.ts test/work-os-activity-intervals.test.mts test/work-os-route-contracts.test.mts
git commit -m "feat(work-os): hide empty recaps and expose the latest recap"
```

---

### Task 4: Companion latest query and launch-selection helpers

**Files:**
- Modify: `desktop/work-os-companion/src/types.ts`
- Modify: `desktop/work-os-companion/src/queryClient.ts`
- Modify: `desktop/work-os-companion/src/workOsQueries.ts`
- Modify: `desktop/work-os-companion/src/workOsQueries.test.ts`
- Modify: `desktop/work-os-companion/src/notificationsLogic.ts`
- Modify: `desktop/work-os-companion/src/notificationsLogic.test.ts`

**Interfaces:**
- Produces:
  - `export interface ActivityIntervalLatestData { interval: ActivityInterval | null; pendingCount: number }`
  - `workOsKeys.activityIntervalLatest(): readonly ["work-os", "activity-intervals", "latest"]`
  - `export function latestActivityIntervalUrl(): "/api/work-os/me/activity-intervals/latest"`
  - `export function fetchLatestActivityInterval(signal?: AbortSignal): Promise<ActivityIntervalLatestData>`
  - `export function useLatestActivityIntervalQuery(options: { enabled: boolean; pollMs?: number }): UseQueryResult<ActivityIntervalLatestData>`
  - `export function latestReadyRecap(intervals: readonly ActivityInterval[] | undefined): ActivityInterval | null`
  - `export function recapSurfaceDecision(input: { latest: Pick<ActivityInterval, "id" | "windowStart" | "reviewStatus"> | null; watermark: string | null; pendingRecap: Pick<ActivityInterval, "id" | "windowStart"> | null }): { surface: boolean; watermark: string | null; reason: "surface" | "approved" | "older" | "not_newer" | "already_pending" | "none" }`

- [ ] **Step 1: Write the failing helper and URL tests**

In `notificationsLogic.test.ts` add:

```ts
it("selects the newest ready recap even when it is already approved", () => {
  const confirmed = interval("confirmed-newest", "2026-11-12T15:00:00.000Z", "ready", "confirmed");
  const olderPending = interval("older-pending", "2026-11-12T14:00:00.000Z", "ready", "inferred");
  expect(latestReadyRecap([olderPending, confirmed])?.id).toBe("confirmed-newest");
});

it("surfaces only an inferred newest recap that is newer than the session watermark", () => {
  const latest = interval("latest", "2026-11-12T15:00:00.000Z", "ready", "inferred");
  expect(recapSurfaceDecision({ latest, watermark: null, pendingRecap: null }).surface).toBe(true);
  expect(recapSurfaceDecision({ latest, watermark: "2026-11-12T15:00:00.000Z", pendingRecap: null }).surface).toBe(false);
  expect(recapSurfaceDecision({ latest: { ...latest, reviewStatus: "confirmed" }, watermark: null, pendingRecap: null })).toMatchObject({ surface: false, reason: "approved" });
  expect(recapSurfaceDecision({ latest, watermark: null, pendingRecap: { ...latest, id: "newer-chat", windowStart: "2026-11-12T16:00:00.000Z" } })).toMatchObject({ surface: false, reason: "already_pending" });
});
```

In `workOsQueries.test.ts` add `latestActivityIntervalUrl` to the existing query import and import `workOsKeys` from `./queryClient`, then add:

```ts
it("reads the owner-scoped latest recap and pending count", () => {
  expect(latestActivityIntervalUrl()).toBe("/api/work-os/me/activity-intervals/latest");
  expect(workOsKeys.activityIntervalLatest()).toEqual(["work-os", "activity-intervals", "latest"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/notificationsLogic.test.ts src/workOsQueries.test.ts`
Expected: FAIL because the exports do not exist.

- [ ] **Step 3: Implement the types, key, query, and helpers**

- Add `ActivityIntervalLatestData` to `types.ts`.
- Add the key to `queryClient.ts`.
- Add `latestActivityIntervalUrl`, `fetchLatestActivityInterval` (uses `apiRequest` with a 20-second timeout), and `useLatestActivityIntervalQuery` (60-second default poll, 15-second stale time) to `workOsQueries.ts`.
- Add `latestReadyRecap`: filter `generationStatus === "ready"`, sort by `windowStart` descending, return the first regardless of review state.
- Add `recapSurfaceDecision`: return `approved` when the latest is not `inferred`; `already_pending` when a chat pending recap is the same id or has a `windowStart` at/after the latest; `not_newer` when the watermark is at/after the latest; otherwise `surface: true` with the latest `windowStart` as the new watermark.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop/work-os-companion && npx vitest run src/notificationsLogic.test.ts src/workOsQueries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/types.ts desktop/work-os-companion/src/queryClient.ts desktop/work-os-companion/src/workOsQueries.ts desktop/work-os-companion/src/workOsQueries.test.ts desktop/work-os-companion/src/notificationsLogic.ts desktop/work-os-companion/src/notificationsLogic.test.ts
git commit -m "feat(companion): read and select the latest recap"
```

---

### Task 5: Floating companion launch surfacing and post-approval bubble

**Files:**
- Modify: `desktop/work-os-companion/src/AvatarApp.tsx`
- Modify: `desktop/work-os-companion/src/avatar.css`
- Modify: `desktop/work-os-companion/src/avatarFixture.ts`
- Modify: `desktop/work-os-companion/src/RecapSpeechSurfaces.test.ts`

**Interfaces:**
- Consumes: `useLatestActivityIntervalQuery`, `fetchLatestActivityInterval`, `recapSurfaceDecision`, `latestReadyRecap` from Task 4.
- Produces: a DEV fixture `?window=avatar&avatar-unapproved-recaps` that renders the bubble with two pending recaps; no new production export.

- [ ] **Step 1: Write the failing source/fixture contracts**

Add to `RecapSpeechSurfaces.test.ts`:

```ts
it("wires the launch recap query and the unapproved-recaps bubble", () => {
  const avatar = read("./AvatarApp.tsx");
  expect(avatar).toContain("useLatestActivityIntervalQuery");
  expect(avatar).toContain("recapSurfaceDecision");
  expect(avatar).toContain("You have unapproved recaps");
  expect(avatar).toContain("View recaps");
  expect(avatar).toContain("avatarUnapprovedRecapsFixtureRequested");
});
```

Add a fixture request helper in `avatarFixture.ts` named `avatarUnapprovedRecapsFixtureRequested(search: string): boolean` that is true for `avatar-unapproved-recaps`, and make the fixture facts include `promptRequired: false`, `nextPromptAt: null`, and a recorded recap count of 2.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/RecapSpeechSurfaces.test.ts`
Expected: FAIL because the wiring and fixture do not exist.

- [ ] **Step 3: Add the launch query and surfacing effect**

In `AvatarApp.tsx`, call `useLatestActivityIntervalQuery({ enabled: facts.loaded && connected !== false && !avatarFixture, pollMs: 60_000 })`. Keep `recapAnnouncedIds` and `recapSurfaceWatermark` refs. Add one effect after `pendingRecap` that gets `latestRecapQuery.data?.interval`, calls `recapSurfaceDecision` with the watermark and `pendingRecap`, updates the watermark, and when `surface` is true sets `activityPrompt`, clears `unapprovedRecapsPrompt`, and fires one `fireNotification` with kind `"hourly"`, key `recap:<id>`, title `"Your recap is ready"`, and body `label: headline`. When the decision reason is `approved`, set a `recapSurfaceBlocked` state and make `pendingRecap` return null so an older persisted chat recap cannot drive the mascot bubble. Whenever the latest is inferred and not in `recapAnnouncedIds`, fire the toast even when the card replacement is skipped as `already_pending`; only the card replacement is skipped. Reuse `recapAnnouncedIds` in the existing ensure path so a client-generated recap never fires two toasts.

- [ ] **Step 4: Add the pending count and post-approval trigger**

In `decideActivityPrompt`, after a successful decision call `fetchLatestActivityInterval()`; store `pendingCount` in `pendingUnapprovedRecaps` state and set `awaitingUnapprovedBubble` true. Add an effect that watches `nextStepsCelebration`: when it transitions from true to false, `awaitingUnapprovedBubble` is true, and `pendingUnapprovedRecaps > 0`, set `unapprovedRecapsPrompt` true and clear the ref.

- [ ] **Step 5: Render and style the bubble**

Render a compact bubble when `workspaceView === "employee" && bubble === null && unapprovedRecapsPrompt`. It reads `You have unapproved recaps`, a supporting line `Open the recaps tab to review them.`, and one `View recaps` button. The button clears the prompt, sets the avatar tab to `tasks`, and calls `toggleExpanded(true)`. Clear `unapprovedRecapsPrompt` when a new recap surfaces or when `pendingUnapprovedRecaps` becomes 0. Add `.avatar-unapproved-bubble` styles in `avatar.css`: reuse the compact prompt surface, keep the action full-width, give the action a visible `:focus-visible` outline, and remove only the entrance under reduced motion.

- [ ] **Step 6: Add the DEV fixture**

Add the fixture branch so `avatar-unapproved-recaps` starts with `unapprovedRecapsPrompt` true and `pendingUnapprovedRecaps` 2.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/RecapSpeechSurfaces.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/work-os-companion/src/AvatarApp.tsx desktop/work-os-companion/src/avatar.css desktop/work-os-companion/src/avatarFixture.ts desktop/work-os-companion/src/RecapSpeechSurfaces.test.ts
git commit -m "feat(companion): surface the latest recap and unapproved queue"
```

---

### Task 6: Main-window launch flyout and post-approval message

**Files:**
- Modify: `desktop/work-os-companion/src/App.tsx`
- Modify: `desktop/work-os-companion/src/ActivityIntervalList.tsx`
- Modify: `desktop/work-os-companion/src/ActivityIntervalCard.render.test.ts`

**Interfaces:**
- Consumes: `latestReadyRecap` from Task 4; `fetchLatestActivityInterval` from Task 4.
- Produces: `ActivityIntervalStream` accepts optional `onViewRecaps?: () => void`.

- [ ] **Step 1: Write the failing behavior guard**

Add `import { readFileSync } from "node:fs";` to `ActivityIntervalCard.render.test.ts`, then add:

```ts
it("exposes a View recaps action only when the stream can navigate there", () => {
  const source = readFileSync(new URL("./ActivityIntervalList.tsx", import.meta.url), "utf8");
  expect(source).toContain("onViewRecaps");
  expect(source).toContain("You have unapproved recaps");
  expect(source).toContain("View recaps");
});

it("announces recaps from the session watermark instead of the old persistent registry", () => {
  const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  expect(source).toContain("latestReadyRecap");
  expect(source).not.toContain("RECAP_NOTIFIED_KEY");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/ActivityIntervalCard.render.test.ts -t "View recaps action"`
Expected: FAIL because the stream does not accept or render the prop.

- [ ] **Step 3: Add the post-approval notice to the stream**

In `ActivityIntervalList.tsx`, add `onViewRecaps?: () => void` to `ActivityIntervalStream` props, import `useNotifications` and `fetchLatestActivityInterval`, and in the `decide` function after `await decideActivityIntervalReview(...)` fetch the latest data. When `pendingCount > 0`, call `notifications.info("Other recaps are still waiting for your review.", "You have unapproved recaps", { label: "View recaps", onClick: onViewRecaps }, { icon: "otto" })`. If the latest read fails, fall back to the loaded intervals and show the notice when another `ready`/`inferred` interval exists besides the decided id. Do not show it when the decision fails or `onViewRecaps` is absent.

- [ ] **Step 4: Add the session-watermark flyout and wire the action**

In `App.tsx`, replace the persistent `RECAP_NOTIFIED_KEY` gate with a session watermark. Use `latestReadyRecap(notificationIntervalsQuery.data?.intervals)`; if the latest is not inferred, set the watermark and show nothing; if it is inferred and newer than the watermark, show the existing `Your recap is ready` flyout. A later launch starts with an empty watermark, so an unapproved newest recap announces again. Keep `readyRecap` for the bell's one recap row and badge. Pass `onViewRecaps={openGoalComposer}` to the `ActivityIntervalStream` in the Focus tab.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/ActivityIntervalCard.render.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/App.tsx desktop/work-os-companion/src/ActivityIntervalList.tsx desktop/work-os-companion/src/ActivityIntervalCard.render.test.ts
git commit -m "feat(companion): add launch and post-approval recap notices"
```

---

### Task 7: Agent OS timer and release record

**Files:**
- Create in Agent OS: `deploy/systemd/work-os-activity-recap.service`
- Create in Agent OS: `deploy/systemd/work-os-activity-recap.timer`
- Modify: `desktop/work-os-companion/release-queue.json`
- Modify: `desktop/work-os-companion/CHANGELOG.md`

**Interfaces:**
- Consumes: the cron route from Task 2.
- Produces: a five-minute systemd timer and one pending companion outcome.

- [ ] **Step 1: Create the Agent OS worktree**

From the Work OS checkout:

```bash
git fetch agentos
git worktree add /home/maigreeks/projects/.worktrees/agentos-recap-schedule \
  -b codex/recap-server-schedule agentos/main
ln -s /home/maigreeks/projects/.worktrees/recap-server-schedule/node_modules \
  /home/maigreeks/projects/.worktrees/agentos-recap-schedule/node_modules
```

- [ ] **Step 2: Add the Agent OS timer units**

In `/home/maigreeks/projects/.worktrees/agentos-recap-schedule/deploy/systemd/`, create:

`work-os-activity-recap.service`

```ini
[Unit]
Description=Run Work OS scheduled activity recaps
Wants=agentos-web.service
After=agentos-web.service

[Service]
Type=oneshot
WorkingDirectory=/home/dev/agent-os
EnvironmentFile=-/home/dev/agent-os/.env
EnvironmentFile=-/home/dev/agent-os/.env.local
ExecStart=/usr/bin/curl --fail --silent --show-error --request POST --header "Authorization: Bearer ${CRON_SECRET}" --header "Content-Type: application/json" --data '{"limit":24}' http://127.0.0.1:3000/api/work-os/evidence/activity-intervals/run-scheduled
```

`work-os-activity-recap.timer`

```ini
[Unit]
Description=Run Work OS scheduled activity recaps every five minutes

[Timer]
OnBootSec=4m
OnUnitActiveSec=5m
Persistent=true
Unit=work-os-activity-recap.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Add the release-queue record and changelog line**

Append one record with id `server-side-recap-launch`, type `feature`, a short employee-facing summary, and a verification string naming the actual branch, focused tests, rendered states, and live deploy evidence. Add one `## Unreleased` bullet: `Activity recaps keep arriving while the app is closed; opening Work OS shows the newest one first, with the rest waiting in your recaps.` Do not change `package.json`, `tauri.conf.json`, or `Cargo.toml`.

- [ ] **Step 4: Verify the release gate still blocks**

Run: `export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH && npm run companion:release:status`
Expected: `pendingCount: 3`, `eligible: false`, no version bump.

- [ ] **Step 5: Commit**

Commit the Agent OS timer in its worktree and the queue/changelog in this worktree separately.

---

### Task 8: Full verification and deployment

**Files:** no new files.

- [ ] **Step 1: Run the focused suites**

```bash
export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH
node --import tsx --test test/work-os-activity-recap-schedule.test.mts test/work-os-activity-intervals.test.mts test/work-os-route-contracts.test.mts
cd desktop/work-os-companion && npx vitest run src/notificationsLogic.test.ts src/workOsQueries.test.ts src/ActivityIntervalCard.render.test.ts src/RecapSpeechSurfaces.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck and the full Work OS suite**

```bash
npm run work-os:typecheck
npm run work-os:test
```

Expected: typecheck passes; full suite reports 0 failed.

- [ ] **Step 3: Run the production build and lint**

```bash
npm run build
npx eslint src/lib/work-os-activity-recap-schedule.ts src/lib/work-os-activity-intervals.ts src/app/api/work-os/evidence/activity-intervals/run-scheduled/route.ts src/app/api/work-os/me/activity-intervals/latest/route.ts desktop/work-os-companion/src/AvatarApp.tsx desktop/work-os-companion/src/App.tsx desktop/work-os-companion/src/ActivityIntervalList.tsx desktop/work-os-companion/src/notificationsLogic.ts desktop/work-os-companion/src/workOsQueries.ts
```

Expected: build succeeds; no new errors.

- [ ] **Step 4: Render and inspect the new states**

Run the companion Vite server and capture:

- `?window=avatar&avatar-recap-live` — newest recap bubble.
- `?window=avatar&avatar-unapproved-recaps` — post-approval bubble.
- A no-recap fixture — no bubble.
- At 1440×900 and 390×844, keyboard focus on `View recaps`, reduced motion, and no horizontal overflow.

Inspect the main-window Focus tab with a seeded recap stream and the post-approval flyout.

- [ ] **Step 5: Reconcile and deploy through Agent OS**

In `/home/maigreeks/projects/.worktrees/agentos-recap-schedule`, fetch the Work OS feature branch and port the changed files by content — never a bulk tree copy or merge. Compare each shared path first with `git diff agentos/main origin/main -- <path>`. Run the Agent OS focused tests for the ported scheduler, recap, and route files plus `npm run work-os:typecheck`. Then deploy with `npm run redeploy` through the Agent OS checkout on the VPS, install the timer units into `~/.config/systemd/user/`, run `systemctl --user daemon-reload`, and enable/start `work-os-activity-recap.timer`. Restart the runner if the redeploy asks.

- [ ] **Step 6: Verify live**

Close the companion, wait for a due recap, confirm the timer service ran and a recap row was generated, reopen the companion, confirm only the newest recap appears in the mascot with one notification, confirm older recaps are in the Tasks recaps queue, and confirm a break interval leaves no queue row. Record the exact interval id and timestamps in the ledger.

- [ ] **Step 7: Final commit and PR**

Commit any remaining verification changes, push the branch, open the Work OS PR, and record the Agent OS timer PR separately. Include the live evidence and note that no companion version bump was made.
