# Flexible Contractor Onboarding Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task inline.

**Goal:** Fixed workdays with flexible times and no hours target, proposed by the worker and approved by an administrator.
**Architecture:** Extend existing schedule records with an explicit arrangement discriminator and nullable times for flexible records. Reuse onboarding proposals and add a transactional admin review that preserves effective-dated history. Shift-window resolution never manufactures a window for flexible records.
**Tech Stack:** Next.js 16, React, Tauri React companion, TypeScript, PostgreSQL, node:test.
**Spec:** `docs/superpowers/specs/2026-11-13-flexible-contractor-onboarding-design.md`

## Global Constraints
- No daily or weekly hours targets; no fabricated shift times or late/short-hours warnings for flexible workers.
- Existing scheduled clients and historical proposals retain scheduled semantics.
- Proposal submission never overwrites an employee's official arrangement; tenant isolation and session history are preserved.
- Companion packaging follows the five-outcome release gate; no release authorization is inferred.

## Review Focus
- Invalid/unknown arrangement and invalid weekdays fail server validation (Task 1).
- Old clients omit the arrangement discriminator and remain scheduled (Task 1).
- Leave/working-day exceptions and timezone day boundaries preserve fixed flexible workdays (Task 2).
- Concurrent review/resubmission cannot approve a stale proposal or cross tenants (Task 3).
- Pending proposals and arrangement transitions never restamp historical/open sessions (Task 3).

### Task 1: Proposal validation and compatible schedule schema
**Files:** `src/modules/work-os/work-arrangement.ts` (new), `src/lib/work-os-onboarding.ts`, `src/modules/work-os/companion.ts`, `supabase/migrations/0074_work_os_flexible_arrangements.sql` (new), `test/work-os-flexible-arrangements.test.mts` (new).
**Interfaces:** `normalizeWorkArrangement(value: unknown)` returns validated `{ arrangement: 'scheduled'|'flexible', daysOfWeek: number[], shiftStart: string|null, shiftEnd: string|null, breaks: {start:string,end:string}[] }`. Flexible records use null times and empty breaks. Official rows use `arrangement` with default `scheduled`.
- [ ] Write and run failing behavioral tests for flexible validation, invalid weekdays/discriminator and legacy scheduled defaults.
- [ ] Implement validation, additive schema constraints and onboarding hydration/completion/draft/submission support; preserve pending proposals separately from official state.
- [ ] Run focused tests and commit the validated proposal/schema deliverable.

### Task 2: Flexible workdays and attendance
**Files:** `src/modules/work-os/companion.ts`, `src/lib/work-os-workday.ts`, affected schedule consumers, `test/work-os-flexible-arrangements.test.mts`.
**Interfaces:** Existing shift resolvers return null for flexible arrangements; `hasScheduledShiftOnDate` checks flexible weekdays/period/exceptions without a timed window. Workday response exposes `arrangement` metadata for truthful client controls.
- [ ] Write/run failing tests for flexible dates, exception precedence, effective periods and no timed shift, retaining legacy behavior.
- [ ] Update workday clock-in contract so approved flexible work does not require a no-schedule/late acknowledgment; leave off-day work recordable. Preserve session-relative cadence and cross-midnight session attribution.
- [ ] Run relevant schedule/workday suites and commit.

### Task 3: Administrator review
**Files:** `src/lib/work-os-arrangement-review.ts` (new), `src/app/api/work-os/admin/people/[personId]/arrangement/route.ts` (new), person-detail route, desktop and web People detail components/types/adapters, review tests.
**Interfaces:** POST decision `{ action: 'approve'|'request_changes', revision: number, submittedAt: string, schedule?: proposal, timezone?: string, note?: string }`; server verifies admin/person scope and locks onboarding and person records. Approval atomically closes previous effective periods, inserts the new official row and records review/audit. Refuse an approval during an open session rather than changing its stamp. Request changes preserves official state.
- [ ] Write/run failing tests for authorization, stale revisions/submission, request-changes behavior and atomic approval/history.
- [ ] Implement bounded proposal read, review API, and person-drawer review controls with pending/error/confirmed states and explicit admin correction of days/timezone.
- [ ] Run review/route/render tests and commit.

### Task 4: Employee UI and verification
**Files:** companion `Onboarding.tsx`, `types.ts`, web `EmployeeSettings.tsx`, schedule display consumers, render tests, `design.md`, companion changelog/queue once verified.
**Interfaces:** Onboarding sends the Task 1 proposal shape; radios select scheduled/flexible, days and timezone remain visible, times and scheduled breaks only render for scheduled.
- [ ] Write/run failing render/serialization tests, then implement desktop/web controls and clear official-versus-proposed status.
- [ ] Verify draft resume, selected days, no hidden times/targets, loading/error/keyboard/narrow/reduced motion using real rendered controls.
- [ ] Run focused tests, `npm run work-os:typecheck`, `npm run work-os:test`, applicable builds and TestSprite; record exact results and blockers.
- [ ] Run one CodeRabbit/independent whole-branch review; fix valid findings with regression tests. Add one verified employee-facing release outcome, inspect release queue and commit.

## Execution checkpoint
- Ledger task: `e4354fdb-334e-47ca-bd73-22ca5364ca35`.
- Worktree: `/home/maigreeks/projects/.worktrees/flexible-contractor-design`, branch `codex/flexible-contractor-design`.
- Ruling: approval during an open session is refused with a clear retry-after-clock-out response; this avoids silently changing current shift boundaries.
- Ruling: use an explicit schedule discriminator with null times, not a separate competing schedule source. All timed consumers must exclude flexible rows or format them explicitly.
- No merge, migration against production, deployment or installer publication until verification and appropriate authorization.
