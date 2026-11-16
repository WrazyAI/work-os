# Work OS Payroll Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only, semimonthly payroll evidence review with deterministic hours, payroll recap auto-approval, weekly briefs, cited questions, immutable approvals, snapshot exports, and 30-day payroll retention.

**Architecture:** A pure interval engine computes hours from verified provider samples and Work OS attendance; PostgreSQL owns revisioned inputs, durable leased analysis, decisions, approval snapshots, and expiry. Existing screenshot processing supplies scoped neutral observations and encrypted evidence; OpenRouter only classifies ambiguity and produces cited text, never hours or approvals. Thin admin APIs and label/content UI consume the same services; cron and browser requests share fenced bounded advancers.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, TypeScript, Better Auth, Neon PostgreSQL via `pg`, existing Work OS DB/storage adapters, OpenRouter via the existing model-policy helper, node:test/PGlite, real disposable PostgreSQL concurrency tests, companion Vitest, browser and TestSprite acceptance.

**Spec:** `docs/superpowers/specs/2026-11-16-work-os-payroll-review-design.md` (approved, including §8.6 and §19).

## Global Constraints

- Admin-only; Work OS is the approved-hours/export source. No Worktivity mutations, money/rates/currency, employee payroll page, or Codex CLI.
- Pay date 16th: current 1st–15th. Pay date 1st: previous 16th–month end. Week 1 = first seven days; Week 2 = remainder; show exact dates.
- No pre-shift time; eligible window is half-open `[scheduled_start, scheduled_end + 60 minutes)`.
- Breaks are unpaid. Union break intervals; never deduct a break twice or extrapolate unlocated aggregate break totals onto the timeline.
- A continuous verified exact-zero activity run qualifies at exactly 180 seconds; exclude the whole qualifying run, subject to meeting/work-related training/reading exceptions and the spec's review rules.
- Null, malformed, sparse or absent samples are not zero. A frame is a point observation, not a duration. Preserve `performed` versus `triggered` provider attribution.
- Exact duration arithmetic first; whole-day largest-remainder integer-minute allocation, half-up day target, payable-first stable ties; period totals sum displayed days.
- Pending ready recaps in the period count; on payroll morning auto-approve with `review_source='payroll_auto'`, never fabricated employee confirmation. Do not create check-ins, task proposals, or advance cadence.
- Default payroll auto-approval cutoff is 06:00 employee-local; cron hourly, idempotent on-demand catch-up. Auto-approval of recaps is not approval of payable hours.
- All AI calls use `work-os-ai-model.ts` policy and usage logging. DeepSeek V4.1 Flash/high for payroll text; GPT-6 Luna for perception; unsupported max/model/provider configurations fail visibly, not silently downgrade.
- Reuse Work OS consent/exclusion/encryption/expiry processing. Raw admin frames require a server-validated flagged/disputed finding, a reason, and durable audit before bytes.
- Decisions and approvals are revisioned, transactionally audited and retry-safe. Approved receipts never change when evidence arrives; reopen is explicit and audited.
- Payroll artifacts expire 30 days after the later of pay date, approval, or **first** export. A re-export/read/Q&A/retry does not extend retention. Original employee recaps/review ledger retain their existing policy; raw images never get a payroll extension or expired-frame re-fetch.
- Use existing `design.md` palette, self-hosted fonts, Group/Panel/Dialog patterns, 1440/1024/720/390 checks, keyboard/focus, reduced motion, Light and Dark. The mockup structure is approved, not complete visual acceptance.
- Additive migrations only; verify resolved DB host before any DB write. No production mutation or deployment is implied by this plan's approval.
- Never replace Agent OS layout, proxy, config, runner, or deploy shell. Port shared behavior file-by-file after comparing content.
- Companion outcome queue is append-only; five-outcome release gate applies. No version bump/package dispatch merely for completing this plan.

## Review Focus

1. **Missing data masquerading as zero:** invalid/null/absent captures, provider truncation and unknown capture direction must not create deductions (Tasks 3–4).
2. **Attendance boundaries and overlap:** overnight pay-period rollover, split shifts, DST and overlapping break/held findings must attribute each instant once (Tasks 1, 4, 7, 11).
3. **Silent system-as-employee attribution:** payroll auto-approval must survive all DTOs, speech/EOD, notifications, amendments and next-step eligibility without implying employee confirmation (Tasks 5–6, 16).
4. **Time-of-check races:** approval versus source edits/recap amendment, expired-worker writes and consent changes during frame reuse must fail closed or yield a coherent historical version (Tasks 7–8, 10–12).
5. **History outliving authorization or retention:** cross-tenant IDs, copied sensitive evidence, first-export retries and purge versus in-flight work must not leak or revive deleted records (Tasks 2, 12–15, 18).

---

## Execution context and scope

- Existing worktree: `/home/maigreeks/projects/.worktrees/payroll-review-design`, branch `codex/payroll-review-design`. At planning, rebased on `origin/main` `152711c0`; design commits are local. Preserve any newer user work. Before execution re-fetch/rebase this branch rather than recreate the design.
- Ledger task: `d8ccca72-8b4e-41ea-885f-1cd0cb9ef6eb`; checkpoint `docs/superpowers/payroll-design-checkpoint.md`. Update it after every completed task with commit, checks, blocker and next step.
- Main agent implements inline by repository default; use one bounded independent security/data-integrity review for the completed surface. Do not spawn overlapping implementers or recursive agents.
- This is one coupled feature, not four unrelated projects. Recap provenance is an independently testable prerequisite; the hours engine, decision record and export must agree. Optional briefs/Q&A may fail locally without failing valid hours.
- No new package is required. Link existing dependency directories; never run install over a running server. The documented Node v22 path is absent on the planning machine; available native WSL Node is `/home/zahemen/.nvm/versions/node/v24.20.0/bin/node`. Resolve the approved native toolchain at execution, record it, never fall through to Windows binaries.
- Read the relevant `node_modules/next/dist/docs/` guides for route handlers, dynamic params, caching and layouts before route/UI code. This plan does not assume older Next APIs.
- Agent OS content differs from Work OS: newer screenshot-run/arrangement changes are present only there. Do not copy whole files from this worktree over them. Its sidebar is `src/components/Sidebar.tsx`; there is no Work OS `src/components` tree to create.
- No live capture/model gate has been run during planning. Task 3 and Task 8 are enablement gates, not facts assumed true.

## File and responsibility map

Types live under `src/modules/work-os/payroll/`; server behavior is flat `src/lib/work-os-payroll-*.ts` to match neighboring modules. UI lives in `src/modules/work-os/admin/payroll/`. Do not make one payroll service own transport, arithmetic, SQL and UI.

| Files | Responsibility / owning task |
|---|---|
| `src/modules/work-os/payroll/contracts.ts`, `recap-policy.ts`; `src/modules/work-os/recap-review.ts` | browser-safe contracts, cutoff/labels, source-aware recap provenance; 1, 5 |
| `src/lib/work-os-payroll-period.ts`, `-intervals.ts`, `-hours.ts` | period/date resolution, interval algebra, partition/rounding; 1, 4 |
| `supabase/migrations/0074_work_payroll_review.sql`, `0075_work_payroll_recap_provenance.sql` | new org-scoped schema and additive source provenance; 2, 5 |
| `src/lib/work-os-payroll-provider.ts`, `-sources.ts`, `-freshness.ts` | verified provider adapter, scoped source manifest and local writer fence; 3, 7 |
| `src/lib/work-os-payroll-store.ts`, `-runs.ts` | SQL transactions, revision/run/lease/checkpoint/publish; 2, 10 |
| `src/lib/work-os-payroll-ai.ts`, `-vision.ts`, `-briefs.ts`, `-questions.ts` | single model-policy consumer, classification, cited text; 8, 9, 17 |
| `src/lib/work-os-payroll-decisions.ts`, `-approvals.ts`, `-reads.ts`, `-api.ts` | versioned admin workflow and safe read/HTTP projections; 11, 15 |
| `src/lib/work-os-payroll-screenshots.ts` | scoped finding authorization, audit, restricted bytes; 12 |
| `src/lib/work-os-payroll-exports.ts`, `-retention.ts` | stable CSV/print snapshots, expiry/fenced purge; 13, 14 |
| `src/lib/work-os-payroll-recap-approval.ts` plus existing reviewed-recap service | idempotent system review writer and cutoff cursor; 6 |
| `src/modules/work-os/admin/payroll/{api,model}.ts`, `Payroll{Overview,Review,DayDialog,Findings,Progress,Questions,ApprovalDialog,Print}.tsx`, `payroll.css` | admin UI, query adapter, print and fixture states; 16–17 |
| thin `src/app/api/work-os/admin/payroll/**/route.ts`, `src/app/work-os/admin/payroll/**/page.tsx` | HTTP/page adapters; 15–16 |
| `.github/workflows/work-os-payroll-{advance,recap-approval,retention}.yml` | bounded service invocation; 18 |
| `test/helpers/work-os-payroll-{fixture,postgres}.mts`, `test/work-os-payroll-*.test.mts` | PGlite service fixture, opt-in real PG, focused tests; each task |
| `docs/work-os-payroll-operations.md`, `scripts/verify-work-os-payroll.mts` | read-only readiness, rollout/verification runbook; 3, 8, 19 |

Migration numbers above are reserved by this plan only. If taken before execution, pick the next two free numbers, update this map, every fixture and migration assertion **once**, and record the mapping in the checkpoint. Do not renumber existing migrations.

## Shared interfaces (Task 1 defines these before consumers)

All dates are validated `YYYY-MM-DD` date keys; all instants serialize to UTC ISO. Durations internally use integer `durationMs` (safe JS integer, PostgreSQL bigint); wire totals are integer minutes. SQL bigint parsing is explicit.

```ts
type PayrollScope = { organizationId: string; personId: string };
type PayrollPeriod = { payDate: string; from: string; through: string;
  timezone: string; weeks: [{ week: 1; from: string; through: string },
                          { week: 2; from: string; through: string }] };
type Span = { startMs: number; endMs: number }; // half-open, end > start
type Category = 'payable' | 'break' | 'inactivity' | 'held' | 'manual' | 'outside';
type CaptureSemantics = { version: string; verified: boolean;
  direction: 'start' | 'end' | 'unknown'; durationMs: number };
type RevisionToken = { rowVersion: string; analysisRevision: number; sourceHash: string };
type PayrollCommand = RevisionToken & { requestKey: string };
type PayrollCitation = { type: 'interval' | 'task' | 'output' | 'day' | 'finding' |
  'brief' | 'approval'; id: string; revision: number };
type ReviewSource = 'employee' | 'admin' | 'payroll_auto';
type PayrollFeatureState = { enabled: boolean; autoApprove: boolean;
  providerReady: boolean; modelsReady: boolean };
```

Task 1 also declares the named types referenced below. Required contract fields are fixed here; optional internal implementation fields stay private. `Scoped` means `PayrollScope`, `Page<T>` means `{items:T[];total:number;nextCursor:string|null}`, and `Token` means `RevisionToken`.

| Type | Required fields / decisions |
|---|---|
| `NormalizedActivity` | `id:string`, `employeeId:string`, `capturedAt:string`, `span:Span|null`, `activity:number|null` (raw seconds 0–60), `zeroEligible:boolean`, `status:number|null`, `app/title/domain:string|null`, `productivityCode:number|null`; no signed image URL |
| `PayrollProviderInput` | `scope`, `connectionId`, `bounds:Span`, `logs:NormalizedActivity[]`, `complete:boolean`, `watermark:string`, `verifiedAt:string`, `semantics:CaptureSemantics`, `apps:PayrollAppContext` |
| `PayrollAppContext` | `items:{name:string;durationMs:number;productivityCode:number|null}[]`, `complete:boolean`, `coverage:string[]`, `enumLabels:Record<string,string>` (only verified enums; others unrated) |
| `PayrollSourceManifest` | `scope`, `period`, `asOf:string`, `sourceToken:string`, `policyVersion:string`, `days:PayrollDayInput[]`, `weekSources:[PayrollWeekSources,PayrollWeekSources]`, `hash:string`; normalized source values/citation snapshots are private persisted inputs, not public DTO extras |
| `PayrollDayInput` | `scope`, `date:string`, `week:1|2`, `timezone:string`, `sessions:{id:string;recorded:Span|null;eligible:Span|null;closed:boolean;scheduleSource:string;correctionStatus:string}[]`, `breaks:{span:Span;source:string}[]`, `pauseResidualMs:number`, `captures:NormalizedActivity[]`, `exceptions:{span:Span;kind:'meeting'|'training'|'reading'|'work';citations:PayrollCitation[]}[]`, `frameCandidates:PayrollFrameContext[]`, `blockers:string[]`, `sourceHash:string`; invalid/missing schedule or clock boundaries remain null plus a blocker, not invented spans |
| `PayrollTotals` | `recorded,eligibleTracked,outside,break,inactivity,held,manualExcluded,recommended,approved:number`; values are displayed integer minutes; unapproved `approved` is `0`, approval state is separately explicit |
| `PayrollFinding` | `id/key:string`, `scope`, `dayId/date:string`, `kind`/`status`/`effect` from spec §9.4, `span:Span|null`, `durationMs:number`, `minutes:number`, `sourceHash:string`, `blocksApproval:boolean`, `requiredAction:'decide'|'acknowledge'|'correct'|'none'`, `reason:string`, `citations:PayrollCitation[]` |
| `PayrollDayResult` | `id:string|null` (null before persistence), `scope`, `date`, `week`, `partition:{span:Span;category:Category;findingKey:string|null}[]`, `exactMs:Record<Category,number>`, `minutes:PayrollTotals`, `findings:PayrollFinding[]`, `blockers:string[]`, `sourceHash:string`, `decisionKeys:string[]`; retain original partition for replacing decisions idempotently |
| `FindingDecision` | `requestKey:string`, `findingKey:string`, `sourceHash:string`, `action:'payable'|'excluded'|'acknowledged'`, `note:string`; projection is replacement by finding key, never cumulative addition |
| `PayrollFrameContext` | `scope`, `summaryId/evidenceEventId:string`, `capturedAt:string`, `sourceHash:string`, `summary:string`, `app:string|null`, `findingKey:string`, `policyVersion:string`; private scoped loader supplies bytes, not this contract |
| `PayrollFrameResult` | `category:'work'|'meeting'|'training'|'reading'|'idle'|'nonwork'|'unclear'`, `confidence:number`, `reason:string`, `app:string|null`, `sourceHash/model/promptVersion/classificationKey:string`; no minutes |
| `PayrollWeekSources` | `scope`, `week:1|2`, `from/through/sourceHash:string`, `recaps:{id:string;revision:number;reviewVersion:number;reviewSource:ReviewSource|null;headline/detail:string;citations:PayrollCitation[]}[]`, `outcomes:{citation:PayrollCitation;text:string}[]`, `gaps:string[]` |
| `PayrollWeekBrief` | `week`, `status:'missing'|'generating'|'ready'|'failed'|'stale'`, `title/summary:string`, `summaryCitations:PayrollCitation[]`, `themes:{heading/detail:string;citations:PayrollCitation[]}[]`, `openItems:{text:string;citations:PayrollCitation[]}[]`, `gaps:string[]`, `sourceHash:string` |
| `PayrollProgress` | `phase`, `message:string`, `daysDone/days/framesClassified/framesReused/findings/remaining:number`, `status:'queued'|'running'|'done'|'failed'|'canceled'`, `nextAttemptAt:string|null`; cutoff ensure may use phase `recaps` |
| `PayrollRun` | `id/reviewId:string`, `scope`, `targetRevision:number`, `asOf:string`, `progress:PayrollProgress`, `rowVersion:string`; leases/input artifacts stay server-only |
| `PayrollReview` | `id:string`, `scope`, `period`, `token:RevisionToken`, `status` spec §9.1, `totals:PayrollTotals`, `briefs:PayrollWeekBrief[]`, `blockers:string[]`, `run:PayrollRun|null`, `approval:PayrollApproval|null`, `retentionExpiresAt:string`, `firstExportAt:string|null`, `evidenceChangedSinceApproval:boolean`, `providerVerifiedAt:string|null` |
| `PayrollApproval` | `id/reviewId:string`, `scope`, `revision:number`, `period`, `approvedAt/by:string`, `note:string|null`, `totals:PayrollTotals`, `days:{date:string;minutes:PayrollTotals;status:string}[]`, `briefs:PayrollWeekBrief[]`, `snapshotHash/schemaVersion:string`, `identity:{displayName:string}`, `findings:PayrollFinding[]`; sanitized source explanations fixed at approval |
| `PayrollRosterPage` | `Page<{personId/displayName:string;active/mapped:boolean;reviewId:string|null;status:string;totals:PayrollTotals;workdays:number}>` plus `period:PayrollPeriod`, `counts:Record<string,number>` |
| `PayrollQuestionInput` | `threadId:string`, `token:RevisionToken`, `approvalId:string|null`, `question:string`; requestKey added at command boundary |
| `PayrollQuestionTurn` | `id/threadId:string`, `analysisRevision:number`, `approvalId:string|null`, `question:string`, `blocks:{text:string;citations:PayrollCitation[]}[]`, `status:'pending'|'ready'|'failed'`, `limitations:string[]`, `createdAt:string` |
| `PayrollPurgeResult` | `reviews/artifacts/auditEntries/remaining:number`; no deleted employee identities |

Keep the task's types shared where actually crossing a boundary; e.g. `PayrollSourceManifest`, `PayrollDayInput`, `PayrollFrameContext` and provider normalized inputs are **server-internal** even if declared alongside browser-safe type-only exports. Public view DTOs are explicitly projected allowlists, not serialized whole source manifests. Never place raw DB rows, storage paths, encrypted material, provider keys, signed URLs or image data URLs in wire types. `PayrollRunDeps` is a **server-only** type defined in Task 10 that binds the exact Task 3/6/7/8/9 signatures; it is not imported by clients.

## HTTP contract (implemented in Tasks 6, 12, 15, 17–18)

Every browser route uses `requireWorkOsAdmin(orgHeader, authorizationHeader)`, authoritative membership, no-store, validated scope and payroll availability. Unsafe cookie requests require same-origin/CSRF checks. Every write carries `requestKey` and, except initial creation, `RevisionToken`. Expensive POSTs persist request state before external calls. No GET mutates payroll; export is POST because first export sets expiry and audit. All page/list reads are bounded.

| Route | Operation |
|---|---|
| `GET /api/work-os/admin/payroll?payDate=&cursor=&limit=` | 50-person roster page, full filtered counts, max 100 |
| `POST /api/work-os/admin/payroll/reviews` | `{personId,payDate,requestKey}` create/resume (or batch with explicitly selected person IDs, max 50); enqueue only, no long fetch |
| `GET /api/work-os/admin/payroll/reviews/[reviewId]` | published revision, totals, brief readiness, last provider verification, current approval |
| `GET .../[reviewId]/days?cursor=&limit=` and `GET .../[reviewId]/days/[dayId]` | period-bounded days and one day; includes scoped source references |
| `GET .../[reviewId]/findings?status=&cursor=&limit=` | 50-row queue, max 100, full count |
| `POST .../[reviewId]/decisions` | one or selected findings (max 50), action/note/token; atomic batch |
| `POST .../[reviewId]/adjustments` | bounded interval or linked residual adjustment; required reason/token |
| `GET/PATCH .../[reviewId]/context` | sanitized per-person context; PATCH invalidates drafts, not approved snapshot |
| `POST .../[reviewId]/reanalyze`, `/approve`, `/reopen` | versioned state transitions, never client totals |
| `GET /api/work-os/admin/payroll/runs/[runId]`; `POST .../[runId]/advance`, `/cancel` | read progress; one bounded fenced slice; cancel |
| `POST .../reviews/[reviewId]/questions`; `GET .../questions?cursor=` | revision/thread-pinned question and history; no raw frames/mutation tools |
| `POST .../reviews/[reviewId]/exports` | `{approvalId,kind:'summary'|'daily',requestKey}`; canonical CSV bytes, audited |
| `POST /api/work-os/admin/payroll/exports` | explicit same-pay-date approval IDs (max 100), batch manifest; no implicit latest selection |
| `POST .../reviews/[reviewId]/findings/[findingId]/preview` | `{summaryId,reason,requestKey}` restricted image bytes, or bounded 403/410; not data URL JSON |
| `POST /api/work-os/evidence/activity-intervals/auto-approve-payroll` | **service secret only**, bounded payroll cutoff settlement |
| `POST /api/work-os/admin/payroll/run-due`, `/retention` | **service secret only**, queued-run advance / expired payroll purge |

Errors: 400 invalid command, 401/403 unauthorized, 404 foreign/missing scoped object, 409 stale/conflicting command, 410 expired artifact/image, 429 retryable budget, 503 not configured/schema/provider readiness. Never expose provider bodies or query-string keys through `jsonError`.

---

### Task 1: Freeze period, policy and browser-safe contracts

**Files:** Create `src/modules/work-os/payroll/contracts.ts`, `src/modules/work-os/payroll/recap-policy.ts`, `src/lib/work-os-payroll-period.ts`; test `test/work-os-payroll-period.test.mts`.

**Interfaces:** Produces the shared types above and `resolvePayrollPeriod(payDate: string, timezone: string): PayrollPeriod`, `latestDuePayrollPeriod(at: Date, timezone: string): PayrollPeriod`, `payrollAutoApprovalDue(period: PayrollPeriod, at: Date, hour?: number): boolean`. Reuse existing date/timezone validators and `localDateForTimezone` where correct; do not use host timezone.

- [ ] **1. Write failing pure tests** with these assertions (and invalid dates, leap Feb, year end):

```ts
const p = resolvePayrollPeriod('2026-11-16', 'Atlantic/Reykjavik');
assert.deepEqual([p.from, p.through], ['2026-11-01', '2026-11-15']);
assert.deepEqual(p.weeks.map(w => [w.from, w.through]),
  [['2026-11-01', '2026-11-07'], ['2026-11-08', '2026-11-15']]);
assert.equal(resolvePayrollPeriod('2027-03-01', 'UTC').through, '2027-02-28');
assert.equal(payrollAutoApprovalDue(p, new Date('2026-11-16T05:59:59Z')), false);
assert.equal(payrollAutoApprovalDue(p, new Date('2026-11-16T06:00:00Z')), true);
assert.throws(() => resolvePayrollPeriod('2026-11-02', 'UTC'));
```

- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-period.test.mts`; expect missing implementation/assertion failure.
- [ ] **3. Implement the signatures and types.** Persist period timezone once. Pay period membership is `shift_date`, including overnight activity crossing the 1st/16th; frozen periods do not move on reopen. Hours-only contracts distinguish recorded/eligible/outside/held and exact versus display totals.
- [ ] **4. Run green:** same test plus existing `test/work-os-workday.test.mts`; all pass, no timezone-dependent snapshots.
- [ ] **5. Commit:** `feat(work-os): define payroll periods and contracts` (only files for this task).

### Task 2: Add tenant-safe payroll persistence and disposable fixtures

**Files:** Create `supabase/migrations/0074_work_payroll_review.sql`, `src/lib/work-os-payroll-store.ts`, `test/helpers/work-os-payroll-fixture.mts`, `test/helpers/work-os-payroll-postgres.mts`, `test/work-os-payroll-schema.test.mts`; modify `test/work-os-migration.test.mjs`, `package.json`.

**Interfaces:** Produces `withPayrollTransaction<T>(scope: PayrollScope, fn: (client: PoolClient) => Promise<T>): Promise<T>` and `assertPayrollOwner(client, scope, reviewId): Promise<void>`. Fixture exports `payrollFixture()` for real service SQL in PGlite and `withDisposablePayrollPostgres(fn)` for multi-client locks. No dependency on production env in ordinary tests.

- [ ] **1. Write failing SQL tests:** migrate twice; cross-org composite FKs fail; legal first/16th period checks; one active run/review; unique revision/finding/request key; update/delete of ordinary approval/decision rows fails; owner/person deletion cannot cascade away payroll receipts. Assert direct public/anon/authenticated roles cannot read new rows. These tests execute DDL, not regex assertions.

  Named test `payroll_schema_is_idempotent_scoped_and_immutable` includes:
  `assert.equal((await f.db.query("select count(*)::int as n from pg_tables where tablename='work_payroll_reviews'")).rows[0].n, 1)` after applying twice, and `await assert.rejects(f.db.query('update work_payroll_approvals set approved_minutes = 0 where id = $1', [approvalId]), /immutable/i)` with a seeded receipt.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-schema.test.mts`.
- [ ] **3. Implement additive schema** for all spec §9 entities: reviews, analysis revisions, days, findings, decisions, approvals, frame findings, week briefs, questions, context and runs. Include the exact scope/revision/version/source hash/policy/exact-duration/expiry columns, sanitized input/citation snapshots and composite ownership keys. Add append-only `work_payroll_exports` (approval/kind/schema/hash/byte payload) and `work_payroll_recap_settlements` (org/person/pay date/cutoff/cursor/status) because later tasks need canonical exports and durable cutoff continuation. Add a scoped provider rate-budget table for credential-wide limiter reservations. No migration that updates `work_activity_intervals` en masse.
- [ ] **4. Define expiry and purge authority in DDL:** approver/normal server writes cannot update/delete immutable snapshots/events; a dedicated narrowly scoped security-definer purge function checks `retention_expires_at <= clock_timestamp()`, scopes payroll children/audit events and fences parent/run rows. It is not a general override boolean that any ordinary write can set. Restrict function execution to the server maintenance path; RLS/no browser grants. Spec legal holds are accepted only from an explicit configured operator hold, not arbitrary client JSON. Add `work_payroll_settings` per org with `enabled=false`, `auto_approve_enabled=false`, cutoff 6; API availability checks fail closed until rollout.
- [ ] **5. Build fixtures:** apply actual migration with prerequisite Work OS schema and existing `0065` review ledger. In full migration replay, ensure `0065` is included before future provenance DDL (the current global list omits it). Add payroll test files to `work-os:test` or one `work-os:test:payroll` script called by that full suite; do not accidentally drop existing tests.
- [ ] **6. Run green:** focused schema tests and `node --test test/work-os-migration.test.mjs`. Opt-in concurrency helper requires both `WORK_OS_TEST_POSTGRES_URL` and `WORK_OS_TEST_POSTGRES_DISPOSABLE=1`, verifies host/disposable marker, never uses app DB URL.
- [ ] **7. Commit:** `feat(work-os): add scoped payroll storage and revision guards`.

### Task 3: Normalize Worktivity evidence without inventing coverage

**Files:** Create `src/lib/work-os-payroll-provider.ts`, `test/work-os-payroll-provider.test.mts`, `scripts/verify-work-os-payroll.mts`, `docs/work-os-payroll-operations.md`; modify `src/lib/worktivity.ts` only for a necessary narrow read primitive.

**Interfaces:** Consumes `PayrollScope`, `CaptureSemantics`, `PayrollPeriod`. Produces `fetchPayrollProviderPage(input: {scope: PayrollScope; employeeId: string; bounds: Span; cursor: string | null; connectionId: string}, deps: PayrollProviderDeps): Promise<{logs: NormalizedActivity[]; nextCursor: string | null; complete: boolean; watermark: string}>`, `normalizePayrollActivity(raw: unknown, employeeId: string, semantics: CaptureSemantics): NormalizedActivity | null`, `loadPayrollAppContext(input: {scope:PayrollScope;employeeId:string;connectionId:string;bounds:Span}, deps:PayrollProviderDeps): Promise<PayrollAppContext>`. Server-local `PayrollProviderDeps` is `{post:typeof wtPost; now:()=>Date; reserve:(connectionId:string)=>Promise<void>}`. IO injection uses existing `wtPost`, not a second API-key client.

- [ ] **1. Write failing provider tests:** pagination 101+ and 800+ items, ignored provider employee/date filter, malformed/null/negative/>60 activity, conflicting duplicates, empty complete versus failed fetch, capture start versus end direction, UTC bounds around overnight grace, AppsSummary multiple pages. Assert no signed screenshot URLs/credentials survive normalized artifacts. Unknown productivity enum remains `unrated`, never a guessed label.

```ts
assert.equal(normalizePayrollActivity({ ...log, ActivityLevel: null }, employee, semantics)?.activity, null);
assert.equal(normalizePayrollActivity({ ...log, EmployeeId: foreign }, employee, semantics), null);
assert.equal(normalizePayrollActivity(log, employee, { ...semantics, verified: false })?.zeroEligible, false);
```

- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-provider.test.mts`.
- [ ] **3. Implement exact-bound complete paging and normalization.** Resolve allowed org/provider connection before any call: deployment-global `WORKTIVITY_API_KEY` is not authorization for every org. Store a configured organization-to-connection allowlist, server-only, verified against provider/mapping before analysis. Client cannot supply employee mapping/connection. Persist page cursor/watermark; incomplete paging blocks publication. Enforce a shared DB-backed credential-scoped 5/sec, 100/min, 1000/hour limiter; all payroll provider reads, including readiness and approval refresh, use it. Inventory neighboring provider callers; conservatively reserve capacity or integrate the limiter at their shared call boundary, never claim an account-wide limit from a per-run sleep.
- [ ] **4. Add read-only readiness mode** to the script: print redacted host/connection entitlement, enums, sample field ranges, temporal semantics result and paging completeness, not payloads. Verify `CreateDate` capture direction/duration against provider docs plus known adjacent clock/activity examples. Default `CaptureSemantics.verified=false`; a guessed median cadence never enables deductions. Unknown temporal semantics leaves automatic exclusion disabled, with explicit review state. Model verification belongs to Task 8.
- [ ] **5. Run green:** focused provider tests. Document a sanitized captured fixture and a readiness report if a read-only live probe is authorized; otherwise mark the gate pending. Do not create sessions or recaps to infer provider behavior.
- [ ] **6. Commit:** `feat(work-os): normalize bounded payroll provider evidence`.

### Task 4: Implement exact disjoint hours and rounding

**Files:** Create `src/lib/work-os-payroll-intervals.ts`, `src/lib/work-os-payroll-hours.ts`, `test/work-os-payroll-intervals.test.mts`, `test/work-os-payroll-hours.test.mts`, `test/work-os-payroll-rounding.test.mts`.

**Interfaces:** Produces `unionSpans(spans: Span[]): Span[]`, `intersectSpans(a: Span[], b: Span[]): Span[]`, `subtractSpans(a: Span[], b: Span[]): Span[]`, `calculatePayrollDay(input: PayrollDayInput): PayrollDayResult`, `allocatePayrollMinutes(exactMs: Record<Category, number>): Record<Category, number>`, `applyPayrollDecisions(day: PayrollDayResult, decisions: FindingDecision[]): PayrollDayResult`. No DB/React/provider/AI dependencies.

- [ ] **1. Write failing arithmetic tests:** exact union partition, 179/180/181 seconds, zero sample followed by 15-minute gap, null splits run, 06:00/overnight day ownership, boundary exactly end+60, pre-shift exclusion, manual/provider break overlap, aggregate-only pause mismatch, meeting/training/reading exceptions, work on leave, no schedule, open boundary blockers. Exhaust permutations/duplicates and seeded generated interval cases without adding a test dependency.

  Define local test fixture builders `example370m()` (15:00–21:10, verified disjoint 20m break/45m zero non-work/10m held), `sparseZeroCapture()` (one verified one-minute zero sample followed by an uncovered 15m gap), and `payHeld10m` (a unique decision on that held span); those names below are test-local helpers, not undocumented production APIs. The 45m run includes enough verified capture coverage and context to meet §6.5, never manufactured from a frame timestamp.

```ts
const day = calculatePayrollDay(example370m());
assert.equal(day.minutes.eligibleTracked, 370);
assert.equal(day.minutes.break, 20);
assert.equal(day.minutes.inactivity, 45);
assert.equal(day.minutes.held, 10);
assert.equal(day.minutes.recommended, 295);
const paid = applyPayrollDecisions(day, [payHeld10m]);
assert.equal(paid.minutes.recommended, 305);
assert.deepEqual(applyPayrollDecisions(paid, [payHeld10m]), paid);
assert.equal(calculatePayrollDay(sparseZeroCapture()).minutes.inactivity, 0);
```

- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-intervals.test.mts test/work-os-payroll-hours.test.mts test/work-os-payroll-rounding.test.mts`.
- [ ] **3. Implement span ownership and partition.** Exact UTC milliseconds; union assigned sessions and verified captures; intersect eligible windows; outside separate. Closed schedule stamps win unless an authorized correction conflicts (block). Split-shift grace cannot fill an unrecorded gap; assign overlap by actual session ownership then earlier scheduled start/stable ID and flag contradictions. Scheduled breaks respect `worktivity_authoritative_breaks`; provider pause mirrors are not an extra break. Unlocated positive aggregate disagreement blocks for reconciliation, not a synthetic interval. Distinguish no-data acknowledgement from a held **verified zero** span: unverified gaps do not subtract from recommended. Apply the §6.5 exception/auto-exclusion table; an unknown/generic app without usable context is held, not auto-excluded.
- [ ] **4. Implement decision transfers and rounding.** One owning time-effect finding per span; acknowledge-only findings never change totals. Disputed break replaces its exclusion with held, not both. Manual residual exclusions debit only available payable budget; inclusions reverse a referenced debit only. Largest remainder across payable/break/inactivity/held/manual/outside targets half-up recorded day duration, stable ties in that order. Eligible = displayed sum of the first five categories; recorded = eligible+outside. Store `hours-v1` and `rounding-v1` versions; no independent period rounding.
- [ ] **5. Run green** and assert every test's partition union equals recorded, totals nonnegative, recommended <= eligible, repeated decision no effect, period equals sum days.
- [ ] **6. Commit:** `feat(work-os): calculate explainable payroll hours`.

### Task 5: Preserve source-aware recap provenance throughout the product

**Files:** Create `supabase/migrations/0075_work_payroll_recap_provenance.sql`, `src/modules/work-os/recap-review.ts`, `test/work-os-payroll-recap-provenance.test.mts`; modify:

- `src/lib/work-os-reviewed-recaps.ts`, `src/lib/work-os-activity-intervals.ts`, `src/lib/work-os-activity-interval-projection.ts`, `src/lib/work-os-next-steps.ts`;
- `src/modules/work-os/admin-otto/contracts.ts`, `src/lib/work-os-admin-otto-{reads,summary,chat}.ts`, `src/lib/work-os-admin-overview.ts`, `src/lib/work-os-eod.ts`, `src/lib/work-os-eod-report.ts`;
- `src/modules/work-os/employee/{model.ts,EmployeeActivityRecaps.tsx}`, `src/modules/work-os/admin/{api.ts,AdminPeople.tsx,AdminEvidence.tsx,AdminReview.tsx}`;
- `desktop/work-os-companion/src/{types.ts,ActivityIntervalCard.tsx,ActivityIntervalList.tsx,App.tsx}`, `desktop/work-os-companion/src/admin/{types.ts,data.ts,PeoplePage.tsx,ReviewPage.tsx,EvidencePage.tsx,adminPersonRecord.ts}`, `desktop/work-os-companion/src/adminOtto/{api.ts,labels.ts,AdminRecapInbox.tsx,AdminRecapView.tsx,AdminToolCards.tsx}`.

**Interfaces:** `recapReviewLabel(status, source?): string`, `isEmployeeReviewedRecap(status, source?): boolean`, `payrollRecapNotice(payDate: string): string`; add `reviewSource`, `payrollDate` and coherent `reviewVersion` to recap DTOs. Legacy payload without source reads as employee only when historically confirmed/amended; inferred remains null. Existing persisted immutable events are interpreted compatibly, not UPDATE-backfilled through the immutable trigger.

- [ ] **1. Write failing provenance tests:** label exactly `Auto-approved for payroll`, never `Confirmed`/`employee reviewed`; AI/EOD summaries carry source; voice coverage speaks the correct actor; next-step endpoint rejects payroll-auto source even if status confirmed; amendment with expected version writes employee source and a new review version. Old fixtures still render. Include reviewer/admin counters so auto approval is not counted as an employee decision.

  Named test `payroll_auto_is_not_employee_confirmation` pins `assert.equal(recapReviewLabel('confirmed', 'payroll_auto'), 'Auto-approved for payroll')` and `assert.equal(isEmployeeReviewedRecap('confirmed', 'payroll_auto'), false)`.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-recap-provenance.test.mts test/work-os-admin-otto-reviews.test.mts test/work-os-eod-report.test.mts`. From `desktop/work-os-companion/`, run `./node_modules/.bin/vitest run src/ActivityIntervalCard.render.test.ts src/adminOtto/AdminRecapView.render.test.ts`; the new provenance assertions fail before support exists.
- [ ] **3. Implement source schema/DTOs.** Migration adds interval `review_source`, `payroll_date`, reviewed-event `review_source`/`payroll_date`, constraints and defaults. Existing reviewed columns default employee and payload readers derive that source; do not rewrite immutable JSON snapshots. Include review source/pay date in **new** content/script identity, preserving exact legacy retry hashes through an explicit versioned hash policy. Update only needed select/projection lists. Existing employee writer sets employee and clears interval `payroll_date` after a new explicit review (historical auto event retains its date), keeps all optimistic-version rules; no new admin review endpoint merely because `admin` is a representable source.
- [ ] **4. Implement labels and correction availability in all consumers.** Employee auto-approved cards retain `Add or correct`/amend (current inferred-only controls otherwise make late correction impossible). Admin Otto, EOD brief provenance and counts cannot treat `confirmed` as synonymous with employee reviewed. Next-step generation re-reads `review_source` and cannot be triggered manually for payroll-auto. Shared pure helpers are browser-safe; do not import server code into the companion. The employee notice uses the next local pay date/cutoff returned by the server; add optional policy info to recap-list response, with backward-compatible absence when disabled.
- [ ] **5. Run green** all focused server/companion tests. Review rendered employee stream, compact recap and admin read/speech states. Record compatibility with older clients: do not enable cron until deployed supported clients render source labels; no quiet relabeling on old `0.5.32` clients.
- [ ] **6. Commit:** `feat(work-os): distinguish system and employee recap approval`.

### Task 6: Add bounded, idempotent payroll-morning recap approval

**Files:** Create `src/lib/work-os-payroll-recap-approval.ts`, `src/app/api/work-os/evidence/activity-intervals/auto-approve-payroll/route.ts`, `test/work-os-payroll-recap-approval.test.mts`, `test/work-os-payroll-recap-concurrency.test.mts`; modify `src/lib/work-os-reviewed-recaps.ts` only to expose a scoped system transaction/append seam.

**Interfaces:** `ensurePayrollRecapApproval(scope: PayrollScope, period: PayrollPeriod, at: Date, limit?: number): Promise<{approved: number; pending: number; skipped: number; complete: boolean}>`; `settleDuePayrollRecapApprovals(input: {at: Date; limit: number}): Promise<PayrollProgress>`. Limit default 100 recaps, maximum 200 per transaction slice; page by stable IDs. New system input is `{organizationId,personId,reason:'payroll_due',payDate}` not a fabricated `WorkOsAccess` employee.

- [ ] **1. Write failing service SQL tests:** Nov 16 only Nov 1–15, Oct 16–31 on Nov 1, shift-date overnight membership, before 06:00 cron no-op, catch-up after missed pay date, ready/inferred-only, inactive person with historical mapping, generation not ready skipped, no next steps/check-ins/cadence changes. Repeated ensure yields one system version; employee amendment versus cron respects locks and expected version; an audit failure rolls back interval+ledger+cursor.

```ts
await ensurePayrollRecapApproval(scope, period, payrollMorning, 100);
assert.deepEqual(await fixture.reviewSources(), ['payroll_auto']);
assert.equal(await fixture.nextStepsStatus(), 'skipped');
assert.deepEqual(await fixture.nonRecapState(), before);
await ensurePayrollRecapApproval(scope, period, payrollMorning, 100);
assert.equal(await fixture.reviewVersionCount(), 1);
```

- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-recap-approval.test.mts test/work-os-payroll-recap-concurrency.test.mts`; concurrent tests may skip only with explicit unavailable disposable PG, never claimed verified from PGlite.
- [ ] **3. Implement cutoff writer.** Lock existing organization clock **before** interval/source locks, use source-aware append from Task 5, `arrival_eligible=false` for automatic bulk decisions (explicit admin on-demand reads still see them); no hundreds of inbox notifications. Do not reuse `append`'s historical-version-1 deterministic ID for every non-arrival: derive a fresh automatic event identity from org/interval/pay date/version and use the unique review version + settlement request key for retry safety. Preserve ai words; source/hash/version/audit atomic, next steps skipped. Never impersonate employee or generate check-ins. Pay cutoff settlement is org/person/pay date-scoped and supports newly ready late recaps by a rescan before final approval; it cannot mark failed recaps approved. Successful ensure must drain before freezing analysis sources, so its own source writes do not invalidate its run.
- [ ] **4. Implement service-only route** with constant-time bearer validation, bounded counts, no actor/client org authority. Require org payroll and auto-approval settings and existing consent/features. Cron settlement catches up outstanding local cutoff periods, rather than checking only `today is 1st/16th`; include terminated people with period evidence. No automatic retroactive historical sweep on feature enable: activation timestamp is the lower bound; explicit admin-created older review may ensure only its selected period. This bounds authorization and avoids mass confirmation of old history.
- [ ] **5. Run green:** SQL, route auth and real PG racing-amend tests; prove `getPool` transactions execute. Record no task/check-in mutations and one immutable event per actual transition.
- [ ] **6. Commit:** `feat(work-os): settle pending recaps at payroll cutoff`.

### Task 7: Capture historical source manifests and a writer-version fence

**Files:** Create `src/lib/work-os-payroll-sources.ts`, `src/lib/work-os-payroll-freshness.ts`, `test/work-os-payroll-sources.test.mts`, `test/work-os-payroll-freshness.test.mts`; extend `0074_work_payroll_review.sql` while unshipped (otherwise next additive migration).

**Interfaces:** `loadPayrollSources(scope: PayrollScope, period: PayrollPeriod, asOf: Date): Promise<PayrollSourceManifest>`, `buildPayrollDayInputs(manifest: PayrollSourceManifest, provider: PayrollProviderInput): PayrollDayInput[]`, `hashPayrollSources(manifest): string`, `loadPayrollSourceToken(client, scope): Promise<string>`, `verifyPayrollSourceToken(client, scope, expected): Promise<void>`.

- [ ] **1. Write failing tests:** historical expired/inactive schedule with changed_shift/leave/working_day exceptions; no-session/no-activity still a row; no mapping never erases prior approval; mismatched session stamp blocks; timezone change doesn't move frozen period; every relevant source changes hash except raw-image expiry alone. Snapshot inputs must distinguish recap source revisions/review versions and preserve performed/triggered actors. Conflicting report/recap claims versus scoped activity evidence create a sourced review finding, not an assertion of misconduct or deduction. An unchanged screenshot with positive activity is an acknowledge-only anomaly, never this rule's inactivity exclusion.

  Named test `employee_amendment_invalidates_but_image_expiry_does_not_rewrite_sources` pins `assert.notEqual(hashPayrollSources(before), hashPayrollSources(afterAmendment))` and `assert.equal(hashPayrollSources(before), hashPayrollSources(afterRawExpiryOnly))` on otherwise identical manifests.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-sources.test.mts test/work-os-payroll-freshness.test.mts`; expect the missing collector/fence or specified assertion to fail.
- [ ] **3. Implement scoped bounded reads** of all scheduled dates, owned sessions/events, consent/privacy, local retained summaries/evidence, interval review snapshots, EOD/context and recorded task/outcome day events. Do not call future-only `listWorkOsScheduleExceptions` for history. Use historical resolver and validated explicit offsets; if existing resolver guesses an ambiguous DST offset, detect and block in payroll adapter. No broad person/project/global mapping fallback. Select dates and counts before paging sources into bounded payloads; immutable input artifact includes completeness/coverage/policy, never raw URLs or bytes. Retain existing available fingerprint/static-run observations only as scoped anomaly evidence; do not download/fingerprint every frame as Agent OS did, or make visual sameness override meetings/reading. Model-reported report contradictions require validated source references and human review, not a new hidden arithmetic rule.
- [ ] **4. Add DB-enforced source versioning.** `work_payroll_source_versions` keyed org/person plus an org policy version; statement/row triggers cover INSERT/UPDATE/DELETE of sessions/events, schedules/exceptions, activity intervals/review events, onboarding/consent/work profile/mappings, evidence/summaries, reports/report versions, task-day/outcome records, context, role/profile and org tracking/connection policy. Cover OLD and NEW org/person if reassigned. Schedule/org-wide writes bump org version. Lock ordering: existing org Otto clock (when used), org source row, sorted person source rows, review, children. Source triggers compare only calculation/citation-relevant fields: next_steps status, polling/updated_at timestamps, cache touches and notifications must not invalidate hours. Use deferred source-version bumps or a statement strategy whose lock semantics actually serialize with approval; do not assert race safety from an after-commit app callback. Automatic reviewed-event lazy snapshot materialization must not spuriously invalidate unchanged words. Document/execute a lock-order test for attendance+recap+approval.
- [ ] **5. Run green** with real PostgreSQL: source correction commits before/after approval lock, update/delete source, org policy changes and simultaneous employee amendment. Validate each success is a coherent historical snapshot or 409, never a mix. Full source-token trigger coverage test enumerates participating tables.
- [ ] **6. Commit:** `feat(work-os): snapshot payroll evidence and fence source edits`.

### Task 8: Add payroll-scoped OpenRouter policy and targeted vision

**Files:** Create `src/lib/work-os-payroll-ai.ts`, `src/lib/work-os-payroll-vision.ts`, `test/work-os-payroll-ai.test.mts`, `test/work-os-payroll-vision.test.mts`; modify `src/lib/work-os-ai-model.ts`, `test/work-os-ai-model.test.mts`, `scripts/verify-work-os-payroll.mts`.

**Interfaces:** `resolvePayrollAiPolicy(env: AiEnvironment): PayrollAiPolicy` (`{textModel:string;visionModel:string;effort:'high'|'max';version:string}`), `classifyPayrollFrame(scope: PayrollScope, frame: PayrollFrameContext, policy:PayrollAiPolicy, signal?: AbortSignal): Promise<PayrollFrameResult>`, `selectPayrollFrames(day: PayrollDayInput): PayrollFrameContext[]`. Export the resolver/type from the existing registry; payroll-ai is a narrow caller/validator, not independent routing/defaults.

- [ ] **1. Write failing tests:** payroll high survives `aiRequestBody` (existing helper currently overwrites reasoning); unrelated recaps/plans stay low; model switch never inherits incorrect provider pin; unsupported max rejected; missing required tool args/finish-length/timeout become unclear, never idle. Cache key includes org/person/content/summary/prompt/rubric/policy/consent. Consent revoked between cache read and image load blocks use. Point frame cannot allocate minutes.

  Named test `payroll_high_does_not_change_other_surfaces` pins `assert.equal(resolvePayrollAiPolicy({}).effort, 'high')` and `assert.deepEqual(reasoningControl(DEEPSEEK_MODEL, {}), {effort:'low'})`; classify a timed-out fixture and assert `result.category === 'unclear'` with no `minutes` property.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-ai.test.mts test/work-os-payroll-vision.test.mts test/work-os-ai-model.test.mts`; expect policy/classifier assertions to fail.
- [ ] **3. Implement registry additions:** `payroll`, `payrollVision` models, payroll-scoped effort resolution, budgets synthesis 12k/brief 6k/Q&A 6k/vision 2k; deadlines 120s/90s/90s/30s. Keep existing DeepSeek Relace pin/no fallback. High default for payroll text; verify supported high for configured vision model before setting, never silently ignore requested effort. `max` only through explicit verified capability mapping; reject unknown. Use one completion total budget including reasoning; malformed/empty output retry once, bounded transport 429/5xx with Retry-After under phase deadline.
- [ ] **4. Implement targeted classification** first/middle/last at most 3 frames per ambiguous run, explicit total cap 48 per employee analysis revision; record remaining candidates as unclassified/review (not truncation disguised as complete). Reuse consent-eligible summaries first; scoped system-image wrapper calls existing retained decryptor only after org/person/expiry/policy validation. No human raw-access grant is created for model use. Cache only sanitized typed classification and exact sources, never raw data URL/request payload. Classifier is not pay calculator.
- [ ] **5. Extend read-only/minimal model readiness script:** public capability lookup plus one minimal non-sensitive structured-output call per configured model/effort (only when run with explicit `--verify-models`). Record success/failure and usage, not keys/provider payload. Unknown behavior blocks enabling auto exclusions; can still expose metadata review.
- [ ] **6. Run green** mocked deterministic calls, existing AI tests and authorized minimal live checks. Update operations report with exact model/provider/effort verified; do not claim model names in the spec are evidence.
- [ ] **7. Commit:** `feat(work-os): add scoped payroll reasoning and vision`.

### Task 9: Generate week briefs with revision-pinned citations

**Files:** Create `src/lib/work-os-payroll-briefs.ts`, `test/work-os-payroll-briefs.test.mts`, `test/work-os-payroll-citations.test.mts`.

**Interfaces:** `selectPayrollWeekSources(manifest: PayrollSourceManifest, week: 1|2): PayrollWeekSources`, `advancePayrollWeekBrief(scope: PayrollScope, sources: PayrollWeekSources, policy:PayrollAiPolicy, checkpoint:BriefCheckpoint|null, signal?: AbortSignal): Promise<{brief:PayrollWeekBrief;checkpoint:BriefCheckpoint;complete:boolean}>`, `validatePayrollCitations(citations: unknown, sources: PayrollWeekSources): PayrollCitation[]`. Private `BriefCheckpoint` is `{sourceHash:string;nextBatch:number;drafts:PayrollWeekBrief[];phase:'batches'|'combine'|'done'}`; persisted with the run, never in public brief DTOs.

- [ ] **1. Write failing tests:** 1–7 vs 8–15 and 16–22 vs 23–month end, overnight recap assigned once by shift_date, all ready pending recaps included, payroll_auto retained as system source not employee; confirmed/amended preferred by truth not dropped other sources; missing window/gaps preserved. Unknown/cross-week/cross-org/wrong-version citations invalidate associated claims. No-source returns exact `No recaps recorded for these dates`, no model call. Task/outcome sources can appear only in distinct recorded-outcome section. Completion language cannot be generated solely from a recap or CI.

  Named test `week_one_contains_only_its_own_recap_sources` pins `assert.deepEqual(selectPayrollWeekSources(novemberManifest, 1).recaps.map(r => r.id), ['nov1','nov7'])` for a fixture containing those and `nov8`; `assert.deepEqual(validatePayrollCitations([{type:'interval',id:'nov8',revision:1}], weekOne), [])`.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-briefs.test.mts test/work-os-payroll-citations.test.mts`; expect citation/no-source assertions to fail.
- [ ] **3. Implement recap-only narrative and typed validation.** Chunk long source sets in chronological batches capped at 30 recaps and 20k source characters; split an oversized source by cited activity blocks, not lose its trailing content. One advance performs at most one model completion under its 90s deadline and saves the checkpoint; combining more than ten draft batches is itself a bounded hierarchical combine step. Preserve every source index and coverage, never silently truncate at first 200 recaps. Title, summary 2–3 sentences, max5 themes, max4 open items/gaps; each claim pins real source revision. Invalid output gets at most one retry **on a later slice** after persisting the failure/attempt; no two full 90s calls inside a120s run slice. Second failure yields failed optional brief; no model invents no-source text. Keep task/output context separate, retain GitHub/GHL relation tags. No narrative number replaces deterministic totals.
- [ ] **4. Run green** including 300-recap source fixture and failed-provider brief path. Persist source hash/readiness state rather than fail valid hours.
- [ ] **5. Commit:** `feat(work-os): compile cited semimonthly progress briefs`.

### Task 10: Orchestrate resumable analysis and atomic revision publication

**Files:** Create `src/lib/work-os-payroll-runs.ts`, `test/work-os-payroll-runs.test.mts`, `test/work-os-payroll-runs-postgres.test.mts`; modify store fixture/schema only if needed for task-defined interfaces.

**Interfaces:** `startPayrollRun(access: WorkOsAccess, input: {personId:string;payDate:string;requestKey:string}): Promise<PayrollRun>`, `advancePayrollRun(scope: PayrollScope, runId: string, deps: PayrollRunDeps, at: Date): Promise<PayrollProgress>`, `cancelPayrollRun(access:WorkOsAccess, runId:string, command: PayrollCommand): Promise<PayrollRun>`, `advanceDuePayrollRuns(at: Date, limit?: number): Promise<PayrollProgress[]>`. `PayrollRunDeps` is a server-only object with `now:()=>Date`, `ensureRecaps:typeof ensurePayrollRecapApproval`, `fetchProviderPage:typeof fetchPayrollProviderPage`, `loadSources:typeof loadPayrollSources`, `classifyFrame:typeof classifyPayrollFrame`, `calculateDay:typeof calculatePayrollDay`, `advanceBrief:typeof advancePayrollWeekBrief`; use real implementations by default. The caller injects provider/model deps and propagates one absolute slice deadline through them.

- [ ] **1. Write failing run tests:** start duplicate returns same active run; claimed lease expires; late old claimant cannot write; crash between day write/cursor update rolls both back; frozen as_of survives restart; phase resume from persisted provider pages; no external fetch in transaction; cancel while AI in flight fences write; partial prior published revision stays visible and unapprovable while rebuilding. Auto cutoff is drained before source token capture; mutation after capture makes publication stale, not mixed.

  Named test `duplicate_start_reuses_active_run` asserts `assert.equal((await startPayrollRun(admin, command)).id, (await startPayrollRun(admin, command)).id)` with one persisted active row. `expired_claimant_cannot_publish` uses two real PG clients and asserts `publishedRevision === winningRun.targetRevision` and old claimant's conditional write rowCount is `0`.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-runs.test.mts test/work-os-payroll-runs-postgres.test.mts`; real PG tests require two independent clients.
- [ ] **3. Implement phases:** `recaps → activity → evidence → classify → days → briefs → done`. Reserve target revision monotonically even when abandoned; publish review pointer only after deterministic complete hours and local source-token recheck. Per-advance deadline <=120s; 180s renewable lease; at most5 transient attempts/slice, backoff cap15min; at most2 active people advancing, one provider request/advancer. No process-local Promise map as the durability mechanism. Cursor/rows/audit atomic, all updates compare lease+revision+not canceled+not expired. Prepare only still-allowed missing evidence in existing bounded path; do not fetch all raw frames or resurrect expired ones. A failed optional app/brief stage is degraded, not automatic pay deduction.
- [ ] **4. Persist progress** as typed counts/day/phase/errorCode and nextAttemptAt. Browser GET never advances, hidden tab stops polling/advancing. Default service tick processes 2 runnable slices max within its deadline; return remaining count for catch-up. Approved review refuses new analysis until explicit reopen.
- [ ] **5. Run green** PGlite SQL and real PG leases/restart/cancel tests. Show persisted resume after reconstructing deps/process, no reliance on the original request context.
- [ ] **6. Commit:** `feat(work-os): resume payroll analysis with fenced revisions`.

### Task 11: Record finding decisions, adjustments and immutable payroll approvals

**Files:** Create `src/lib/work-os-payroll-decisions.ts`, `src/lib/work-os-payroll-approvals.ts`, `test/work-os-payroll-decisions.test.mts`, `test/work-os-payroll-approvals.test.mts`, `test/work-os-payroll-approval-postgres.test.mts`.

**Interfaces:** `resolvePayrollFindings(access:WorkOsAccess, reviewId:string, input: PayrollCommand & {findingIds:string[];action:'payable'|'excluded'|'acknowledged';note:string}): Promise<PayrollReview>`, `addPayrollAdjustment(access:WorkOsAccess, reviewId:string, command:PayrollCommand & {findingId:string;action:'include'|'exclude'|'reverse';span:Span|null;durationMs:number;priorDecisionId:string|null;reason:string}): Promise<PayrollReview>`, `approvePayrollReview(access:WorkOsAccess, reviewId:string, input: PayrollCommand & {note?:string}): Promise<PayrollApproval>`, `reopenPayrollReview(access:WorkOsAccess, reviewId:string, input: PayrollCommand & {reason:string}): Promise<PayrollReview>`.

- [ ] **1. Write failing decisions/approval tests:** held10 payable295→305 once; excluded leaves295 and held0; acknowledge gap changes no minutes; overlapping break/held reclassifies once; batch incompatible effects fails all; negative/day-overflow/boundary bypass rejected; correction-only findings cannot be acknowledged away; missing schedule/session/open boundary blocks; pending ready recaps must settle before snapshot; identical request retry same response. Snapshot includes identity, brief states, source explanation and exact/allocated totals; not raw URL/bytes or live mutable joins.

  Named test `approval_retry_preserves_the_same_receipt` asserts `assert.equal(first.id, retry.id)` and `assert.equal(first.snapshotHash, retry.snapshotHash)` after the same command; `source_edit_during_approval_conflicts` asserts no second receipt and a409 when an independently committed correction wins the source fence.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-decisions.test.mts test/work-os-payroll-approvals.test.mts test/work-os-payroll-approval-postgres.test.mts`; expect missing transaction/fence behavior to fail.
- [ ] **3. Implement transaction services.** Org clock/source locks in Task7 order, review `FOR UPDATE`, exact expected rowVersion/revision/hash; decisions append immutable events and update projection+recalculated partition+audit atomically. Provider approval preflight uses complete fresh Task3 read outside transaction; record watermark, refuse failed/incomplete refresh. Inside transaction recheck local writer versions, decisions and published revision, no active run and zero held/required acknowledgements. Auto-approval cannot approve hours. A pending generated recap after source snapshot requires ensure/re-analysis, not snapshot override.
- [ ] **4. Insert append-only approval, never UPDATE old row.** Advance pointer, status/allocated approved totals/retention deadline and audit in same commit. Reopen requires reason; keeps old pointer exportable as historical and reserves new draft before analysis; no approval is created merely by reopening. Evidence change marks approved receipt separately, never rewrites or auto-reopens it. Paid/held exclusions outside window require schedule/source correction, not free positive adjustment.
- [ ] **5. Run green** real PG two-approval race (one committed receipt or identical idempotent retry), approval vs correction/employee amendment/reopen/cancel and audit rollback. Assert no transaction spans provider/AI calls.
- [ ] **6. Commit:** `feat(work-os): approve audited payroll decisions and snapshots`.

### Task 12: Restrict payroll image review to authorized findings

**Files:** Create `src/lib/work-os-payroll-screenshots.ts`, `src/app/api/work-os/admin/payroll/reviews/[reviewId]/findings/[findingId]/preview/route.ts`, `test/work-os-payroll-screenshots.test.mts`; modify `src/lib/work-os-screenshots.ts` only to extract a validated internal byte renderer, preserving existing own-frame/EOD APIs.

**Interfaces:** `previewPayrollScreenshot(access, input: {reviewId:string;findingId:string;summaryId:string;reason:string;requestKey:string}, at: Date): Promise<{bytes:Uint8Array;contentType:string}>`. The caller never invokes `retainedScreenshotImage(summaryId)` on unvalidated client/model IDs.

- [ ] **1. Write failing tests:** own payroll employee denied (admin-only), manager denied, cross-org child/cache/citation ID denied, consent revoked at image read denied, sensitive/policy excluded denied, expired/deleted summary410, unflagged resolved finding403, valid unresolved/disputed finding succeeds and writes real provided reason **before** bytes; failed access-log insert returns no bytes. Cache never grants authorization. Existing employee own-frame preview behavior still passes.

  Named test `cross_org_summary_never_decrypts` asserts `await assert.rejects(previewPayrollScreenshot(admin, foreignSummaryCommand, now), /not found|forbidden/i)` and `assert.equal(decryptCalls, 0)`. `audit_failure_returns_no_bytes` injects a failing real access-log insert and asserts rejection, not a successful body.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-screenshots.test.mts test/work-os-screenshot-crypto.test.mts test/work-os-screenshot-gallery.test.mts`; expect missing scoped authorization/audit checks to fail.
- [ ] **3. Implement scoped wrapper and POST adapter.** Check org/person/review/revision/finding→summary linkage, flag/dispute state, consent/features/policy and retention twice around load. A reason does not itself create a dispute; explicit versioned finding decision records dispute first if needed. Do not globally set evidence `metadata.needsReview` to unlock other views. Record restricted audit context, then bytes private/no-store/nosniff; client uses revocable object URL only. No thumbnail preload on roster/questions/print. If metadata-only summary suffices, do not decrypt.
- [ ] **4. Run green**, including existing own-frame paths; exercise actual adapter with authorized fixture and log refusal cases, not just predicate mocks.
- [ ] **5. Commit:** `feat(work-os): audit restricted payroll screenshot review`.

### Task 13: Export canonical approval CSV and print snapshots

**Files:** Create `src/lib/work-os-payroll-exports.ts`, `src/modules/work-os/admin/payroll/PayrollPrint.tsx`, `src/app/work-os/admin/payroll/approvals/[approvalId]/print/page.tsx`, `test/work-os-payroll-exports.test.mts`, `test/work-os-payroll-print.test.mts`; create export route adapters listed above (or wire in Task15).

**Interfaces:** `createPayrollExport(access, input: {approvalIds:string[];kind:'summary'|'daily';requestKey:string}, at: Date): Promise<{bytes:Uint8Array;filename:string;hash:string}>`, `loadPayrollPrint(access, approvalId): Promise<PayrollApproval>`. Print receives approval snapshot, never recomputes live brief.

- [ ] **1. Write failing export tests:** bytes equal on retry/different current time/renderer upgrade, first export anchor set once, no live people/recap join dependency, no-work zero row, old approval after reopen remains explicitly old, cross-org/mixed-pay-date bulk denied, explicit subset manifest states omitted unapproved people. Formula injection ` \t=`, `+`, `-`, `@` sanitized in text only, embedded comma/quote/CRLF RFC4180, numeric columns remain numeric. Raw storage path, signed URL, sensitive title/query never appears.

  Named test `canonical_export_survives_live_changes` generates a receipt export, changes live employee/recap data and advances the clock, then pins `assert.equal(Buffer.compare(first.bytes, retry.bytes), 0)` and `assert.equal(first.hash, retry.hash)`; decoded text does not match `storage_path|x_api_key|data:image`.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-exports.test.mts test/work-os-payroll-print.test.mts`; expect snapshot-only/stable-byte assertions to fail.
- [ ] **3. Implement versioned canonical format:** UTF8 BOM/CRLF, stable employee/day ordering, minutes + derived four-decimal hours. Summary columns `approval_id,approval_revision,person_id,employee_name,period_start,period_end,pay_date,recorded_minutes,eligible_tracked_minutes,outside_minutes,break_minutes,inactivity_minutes,manual_excluded_minutes,held_minutes,recommended_minutes,approved_minutes,approved_hours,status,approved_at,snapshot_at,schema_version`. Daily adds shift_date/schedule/session-count/finding-count/reason-summary; no full raw session payload in a CSV cell. Persist canonical bytes+hash once per approval/kind/schema; duplicate concurrency uses unique key and returns stored bytes. Audit every access; fresh access times stay outside stable bytes.
- [ ] **4. Build print component** frozen two briefs, reconciliation, daily rows, provenance, approval receipt; hide shell under `@media print`, label print as payroll record and historical approval if reopened. GET print no source writes; if print is first durable export, have explicit export preparation POST establish canonical artifact/expiry before navigating print (not a mutating GET). Add download/no-store/CSP headers appropriately.
- [ ] **5. Run green**, verify downloadable CSV in common spreadsheet-compatible fixture plus browser print at A4/Letter; do not treat PDF creation as a new dependency.
- [ ] **6. Commit:** `feat(work-os): export reproducible payroll approval records`.

### Task 14: Enforce payroll-only 30-day retention and no resurrection

**Files:** Create `src/lib/work-os-payroll-retention.ts`, `src/app/api/work-os/admin/payroll/retention/route.ts`, `test/work-os-payroll-retention.test.mts`, `test/work-os-payroll-retention-postgres.test.mts`; extend operations doc and existing DDL purge function if still unshipped.

**Interfaces:** `payrollRetentionExpiry(input: {payDate:string;timezone:string;approvedAt:string|null;firstExportAt:string|null}): string`, `purgeExpiredPayroll(input: {at:Date;limit?:number}): Promise<PayrollPurgeResult>`; expiry = 30×24h after latest of local pay-date start, latest explicit approval, first export. Reopen/read/re-export/Q&A/retry does not reset; daily purge grace is operational lag, not extra permitted access.

- [ ] **1. Write failing retention tests:** no approval pay-date anchor; later approval moves anchor; first export moves once, second export never does; exact expiry denied even if purge hasn't run; questions/worker late result cannot revive expired data; purge leaves original employee recaps, review ledger, source screenshots and unrelated work_audit_log intact. Canonical exports, targeted payroll audit entries, decisions, cache consumption refs and sanitized provider artifacts removed together. Shared classification cache prunes expired unreferenced entries, never another live review's data.

  Named test `unapproved_period_expires_thirty_days_after_pay_date` pins `assert.equal(payrollRetentionExpiry({payDate:'2026-11-16',timezone:'UTC',approvedAt:null,firstExportAt:null}), '2026-12-16T00:00:00.000Z')`. After purge, `assert.deepEqual(await employeeRecapRows(), originalRecapRows)` while payroll child counts are0; helper queries target existing tables explicitly.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-retention.test.mts test/work-os-payroll-retention-postgres.test.mts`; expect expiry/purge fence assertions to fail.
- [ ] **3. Implement bounded scoped purge.** Claim expired parent lock before child operations, fence/cancel workers and deny every endpoint after expiry, then privileged purge immutable payroll children and only known payroll-specific audit actions/targets; preserve minimal non-personal aggregate purge count if operationally needed, not a shadow payroll archive. Parent includes copied identity so original person removal cannot bypass expiry. Purged historical periods cannot be regenerated by cron/read/retry; a content-free salted retention tombstone marks org/person/pay date as expired, and explicit new ingest of the expired period is forbidden. Do not replay old provider screenshots. Original recap auto-approval audit/review events remain under their original recap policy, not payroll audit copies.
- [ ] **4. Wire service-only retention route** bounded default50 reviews, max100, constant-time secret check. Legal-hold configuration must be explicit/operator-only and visible; no user-requested indefinite archive. Add UI expiry/warning data (days remaining/export reminder) to safe reads.
- [ ] **5. Run green** purge versus approval/export/advancer concurrency; no partial export after deletion, no bypass by request key or stale lease. Verify exact table counts and unaffected recap checksums.
- [ ] **6. Commit:** `feat(work-os): expire payroll artifacts after thirty days`.

### Task 15: Expose role-safe, bounded payroll APIs and read projections

**Files:** Create `src/lib/work-os-payroll-api.ts`, `src/lib/work-os-payroll-reads.ts`, the remaining route adapters in the HTTP map; test `test/work-os-payroll-routes.test.mts`, `test/work-os-payroll-reads.test.mts`; modify `test/work-os-route-contracts.test.mts`.

**Interfaces:** `requirePayrollAdmin(req: Request): Promise<{access:WorkOsAccess}|{response:Response}>`, `listPayrollRoster(access:WorkOsAccess, filters:{payDate:string;cursor:string|null;limit:number}): Promise<PayrollRosterPage>`, `loadPayrollReview(access:WorkOsAccess, reviewId:string): Promise<PayrollReview>`, `listPayrollDays(access:WorkOsAccess, reviewId:string, filters:{cursor:string|null;limit:number}):Promise<Page<PayrollDayResult>>`, `listPayrollFindings(access:WorkOsAccess, reviewId:string, filters:{status:string|null;cursor:string|null;limit:number}):Promise<Page<PayrollFinding>>`, `loadPayrollDay(access:WorkOsAccess, reviewId:string, dayId:string):Promise<PayrollDayResult>`. Public DayResult is projected without private source arrays; all others match shared contracts. Reuse Task11 commands, Task10 runs, Task12 images, Task13 exports; do not duplicate business logic in handlers.

- [ ] **1. Write failing executable route tests:** every browser/admin route forwards both org header and bearer; anonymous/manager/employee including own payroll denied; cross-org guessed IDs404; membership ambiguity selection required; cookie Origin/CSRF rejected while valid desktop bearer works under existing CORS. GETs no state mutations; create/advance not triggered by list refresh. 50 default/100 max complete counts/keyset cursor, no first-page-is-total mistake. Pending/failed run never paints partial totals as final; expired/reopened approval status honest. Sanitized503/errors never echo provider credentials.

  Named test `employee_cannot_read_own_payroll` calls the actual handler with the fixture employee session and asserts `response.status === 403`; `cross_org_review_is_not_found` asserts404 for an otherwise valid admin. Compare DB checksums before/after roster GET to prove no enqueue/auto-approval.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-routes.test.mts test/work-os-payroll-reads.test.mts test/work-os-route-contracts.test.mts`; expect absent routes or scope assertions to fail.
- [ ] **3. Implement scoped validation and DTOs** with source-aware recap projections, expiry and schema readiness. Enrollment list union active mapped people + inactive people with evidence/approval and unmapped setup rows. Period-specific contextual warnings for no timezone/schedule, partial app context, unrated productivity, pending recaps. Add per-org/admin rate limits for create/advance/approve/preview/questions, byte/context limits, no-store even on errors. Separate cron handlers from admin auth; `run-due` cannot be called with a mere admin cookie, and CRON secret cannot impersonate arbitrary browser actors.
- [ ] **4. Reuse existing selected-org and feature-policy checks.** Payroll `enabled` setting gates routes/UI; source gates still apply independently. No response stores raw image paths from existing `EvidenceRow` DTO. Add narrow context read/write with expected context revision, auditing and draft invalidation; no override of locked hours rules.
- [ ] **5. Run green** actual handlers/services against disposable fixture; schema/static guards plus executable auth/read tests, not only source regex. Lint new handlers.
- [ ] **6. Commit:** `feat(work-os): expose scoped payroll review APIs`.

### Task 16: Build the admin desk, employee review, daily decisions and print flow

**Files:** Create:

- `src/app/work-os/admin/payroll/page.tsx`, `src/app/work-os/admin/payroll/[personId]/page.tsx`;
- `src/modules/work-os/admin/payroll/api.ts`, `model.ts`, `PayrollOverview.tsx`, `PayrollReview.tsx`, `PayrollDayDialog.tsx`, `PayrollFindings.tsx`, `PayrollProgress.tsx`, `PayrollApprovalDialog.tsx`, `payroll.css`;
- `test/work-os-payroll-ui.test.mts`, `test/work-os-payroll-ui-model.test.mts`, `test/fixtures/work-os-payroll.ts`.

Modify `src/modules/work-os/admin/{AdminShell.tsx,AdminFrame.tsx,api.ts}`, `src/app/globals.css` only to import scoped print/payroll styles; `test/work-os-route-contracts.test.mts`. Agent OS-only nav addition is recorded for Task19, not copied here.

**Interfaces:** `PayrollOverview()` and `PayrollReview({personId,payDate}: {personId:string;payDate:string})` route components; pure `payrollReviewModel(review:PayrollReview): {canApprove:boolean;blockers:string[];reconciliation:{kind:keyof PayrollTotals;minutes:number;label:string;findingStatus:string|null}[];retentionLabel:string}`. Query keys contain org/person/pay date/review/revision; no on-disk admin snapshot. Date selector values are 1st/16th pay dates, evidence dates shown separately.

- [ ] **1. Write failing render/model tests:** reconciliation recorded/outside/eligible does not subtract outside twice; two weeks precise dates; pending/payroll-auto/employee provenance counts; all no-work days; stale/expired/approved/reopened states, correction-only blocker controls, selected queue amount and retry errors. One primary decision action; totals clickable only where actual records exist. Old approval after reopen shows historical and disabled current approval actions. Expiry banner says exact date and archive reminder.

  Named test `stale_review_cannot_be_approved` pins `assert.equal(payrollReviewModel(staleReview).canApprove, false)` and `assert.match(rendered, /Re-analyze/)`; `system_recaps_do_not_claim_employee_review` pins rendered `Auto-approved for payroll` and the separately reported employee-reviewed count.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-ui.test.mts test/work-os-payroll-ui-model.test.mts`; expect missing UI/model or state assertions to fail.
- [ ] **3. Implement the approved label/content layout** using existing Group/Panel/Button/Notice/Drawer patterns. Hours instrument, week briefs/source expansion, bounded daily record and findings, app distribution with exact fallback and productivity caption `Worktivity’s app classifications, not a measure of effort or quality. These labels do not determine payable hours.` Roster search/status/person filters and batch analyze explicit selected/all-needed pages (server validates max50 each), no arbitrary recent14day range. Safe state skeletons, local degraded notices and no hidden data behind dark typography.
- [ ] **4. Wire mutations** expected versions, preserved failed input, authoritative post-write read, 409 reload (not silent retry), frozen approved export selection. Day dialog traps/restores focus, all conflicting interval data visible, raw preview POST reason then revocable blob, no autoload thumbnails. Client run loop one advance at a time, progress GET2s only while visible/active; leaving/reloading resumes stored run. Refresh revalidates this section only. Context/rubric edit is audited and does not silently override schedule rules.
- [ ] **5. Add deterministic UI fixtures** complete/loading/empty/dense/provider-error/stale/approved/reopened/expiry and dark variant. Use local fixture server/route guarded dev-only, never relax production auth or mount real employee data in mockups. Read local Next docs before page params/build code.
- [ ] **6. Run green:** UI model/render tests; rendered 1440×900/1024×768/720×900/390×844 in Light/Dark, keyboard dialog/decision/CSV/print/200%/reduced motion. Record screenshots and no horizontal overflow; mockup acceptance is not production visual acceptance.
- [ ] **7. Commit:** `feat(work-os): add admin payroll evidence workspace`.

### Task 17: Add cited read-only period questions and suggestions

**Files:** Create `src/lib/work-os-payroll-questions.ts`, `src/modules/work-os/admin/payroll/PayrollQuestions.tsx`, question/history route adapters in HTTP map, `test/work-os-payroll-questions.test.mts`, `test/work-os-payroll-question-ui.test.mts`; modify PayrollReview composition.

**Interfaces:** `answerPayrollQuestion(access:WorkOsAccess, reviewId:string, input: PayrollQuestionInput & {requestKey:string}): Promise<PayrollQuestionTurn>`, `listPayrollQuestions(access:WorkOsAccess, reviewId:string, filters:{threadId:string;cursor:string|null;limit:number}):Promise<Page<PayrollQuestionTurn>>`, `suggestPayrollQuestions(access:WorkOsAccess, reviewId:string, token:RevisionToken): Promise<string[]>`. Thread is analysisRevision/optional approvalId pinned; New question creates thread ID, never deletes history.

- [ ] **1. Write failing question tests:** ask exact hours resolves authoritative totals not recap numbers; request to approve/export changes nothing; cross-org fabricated tool/citation ID rejected; approved vs reopened scope cannot mix; no raw image tools or automatic image URLs; prompt injection in URL/title/recap treated data; invalid/irrelevant citation drops claim; sample/live stream failure keeps input. Idempotency successful retry doesn't call provider twice, expired review rejects. Max8 steps/90s **total**, 6k completion ceiling per call and 18k cumulative completion budget across loop, last20 history turns and 8k user input chars.

  Named test `question_cannot_approve_hours` pins `assert.deepEqual(await approvalRowsAfter(), approvalRowsBefore)` even when the mocked model requests `approvePayroll`; the unavailable tool is returned as a bounded error and `assert.ok(answer.blocks.every(b => b.citations.length > 0))` for every retained factual answer block.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-questions.test.mts test/work-os-payroll-question-ui.test.mts`; expect tool/citation/budget assertions to fail.
- [ ] **3. Implement bounded typed read tools:** totals, days, finding, recap snapshot, brief, app/productivity, approval history. No executable arbitrary SQL/URL/remote fetch or mutation tools. Server validates schema/owner/revision of each tool and each cited statement. Structured final answer `{blocks:[{text,citations}],limitations}`; invalid blocks rejected/retried once, then bounded `Not grounded in this record` response (never unsupported fact with decorative link). Route returns JSON after bounded tool loop; client shows existing elapsed working state. Streaming is not required/new protocol. Audit question generation boundedly without storing raw model/tool payload.
- [ ] **4. Implement three optional question chips** from stored findings/themes, same scope/validation, cached by source hash; optional failure empty chips, not hardcoded unrelated questions. Persist question pending/ready/failed before external call and completion atomically with authoritative response. Sanitized markdown no raw HTML/remote media; source links open the correct day/finding/recap revision.
- [ ] **5. Run green** full no-mutation assertions against fixture; browser question opens correct citation and historical approval distinction; budget exhaustion and tool fault isolation stay usable.
- [ ] **6. Commit:** `feat(work-os): answer cited payroll analysis questions`.

### Task 18: Wire automation, retention visibility and guarded rollout settings

**Files:** Create `.github/workflows/work-os-payroll-advance.yml`, `.github/workflows/work-os-payroll-recap-approval.yml`, `.github/workflows/work-os-payroll-retention.yml`, `src/app/api/work-os/admin/payroll/run-due/route.ts`, `test/work-os-payroll-scheduling.test.mts`; modify `docs/work-os-payroll-operations.md`. Avoid a new settings editor: `scripts/verify-work-os-payroll.mts --activate-pilot --organization-id <uuid>` is the explicit operator activation path after readiness checks, with sanitized settings status available to admin reads. It never activates another org or bypasses the cutoff notice/client-readiness gate.

**Interfaces:** Service contracts already defined in Tasks6/10/14. New payroll-settings command requires admin, expected revision, activation timestamp, explicit auto-approval activation and validated cutoff hour 0–23; no secret/model key client fields. `enabled` is not a substitute for consent. A documented CLI/operator activation can be used for first pilot rather than invent an elaborate settings surface.

- [ ] **1. Write failing schedule contract tests:** advance `*/5 * * * *`, recap cutoff hourly `17 * * * *`, purge daily `41 3 * * *`, bounded curl timeouts, no concurrent overlapping workflow of same kind, no secret printing, service401 without/with wrong bearer, tenant scope from DB not body. Cron outage/delay catch-up, cutoff before/after local06:00, Nov16→Nov1 fallback, >200 pending recap batches do not starve inactive/historical employees, no backfill before activation. Purge handler is not callable as ordinary admin browser.

  Named test `recap_workflow_calls_hourly_service_without_logging_secret` pins `assert.match(workflow, /17 \* \* \* \*/)`, `assert.match(workflow, /auto-approve-payroll/)`, `assert.doesNotMatch(workflow, /set -x|echo.*CRON_SECRET/)`; execute the service handler without the secret and assert401 before any DB operation.
- [ ] **2. Run red:** `node --import tsx --test test/work-os-payroll-scheduling.test.mts`; expect missing workflow/service contracts to fail.
- [ ] **3. Implement workflows** existing `WORK_OS_BASE_URL`/`CRON_SECRET` secrets, content read only, bounded job timeout, `cancel-in-progress:false`, fail-with-body sanitized failures. Explicitly document hourly GitHub schedule may settle after06:00 (e.g.06:17); it is a cutoff guarantee not exact-minute SLA. On-demand ensure at payroll review handles missed cron. If operator requires exact06:00, use Agent OS systemd timer instead of claiming GitHub punctuality; do not add two simultaneous schedulers silently.
- [ ] **4. Wire settings/readiness gate** pilot off by default; before cron auto-approval enable require tested source-aware employee clients deployed, advance/retention secrets verified, capture/model readiness reports, consent/privacy notice. Add purge/export expiry reminders and admin error/status indicating last successful service run; do not put payloads in public health endpoint. Late amendments mark existing approved review changed (not silently auto-reopen) and stop fresh approval until re-analysis.
- [ ] **5. Run green** auth/timer/unit tests; service invocation against disposable review proves no-browser continuation. Manual dispatch/deploy is a later authorized operation, not part of writing YAML.
- [ ] **6. Commit:** `feat(work-os): schedule payroll cutoff analysis and expiry`.

### Task 19: Verify, review and prepare Work OS / Agent OS convergence

**Files:** Modify `docs/work-os-payroll-operations.md`, checkpoint, design.md where approved behavior revises provenance/retention/UI contracts; test suite/fixtures as needed. Append one genuine employee-facing auto-approval provenance outcome to `desktop/work-os-companion/release-queue.json` and `## Unreleased` after verification, not one entry per technical task. Agent OS-only `src/components/Sidebar.tsx` receives a narrow payroll nav entry in its own checkout at authorized integration time; preserve its Work OS shell.

**Interfaces:** No new behavior. Produces verification report with exact commits, feature gates, migration names, provider/model evidence, source-schema differences, release queue status and rollout/backout steps.

- [ ] **1. Verify contract coverage** against each spec section and the five Review Focus lines. Run focused tests first, then `npm run work-os:typecheck`, `npm run work-os:test` (full existing + payroll), `npx eslint <changed TS/TSX>`, `npm run build`, full companion Vitest and build when its UI/types change. Run required real disposable PG tests with explicit flags; record counts/skips and never imply skipped races passed. No new dependency installation while servers running.
- [ ] **2. Run rendered/TestSprite acceptance** against guarded fixtures using existing configured Work OS Companion/Web API projects and native Node24 TestSprite. Do not run setup or rotate login without need. Browser→API→DB→receipt→canonical CSV→reopen→expiry; verify negative manager/cross-org paths, two-admin contention, no raw path leakage, interruption/no-browser resume and source correction. Fixture auto clock must not mutate a real employee's period. Verify screenshots, key focus, dark/narrow/reduced-motion/error/loading/dense paths and strict table/totals source alignment.
- [ ] **3. Perform independent bounded review** original spec + final diff + real test evidence, focused tenant isolation, consent/raw screenshots, interval/deduction math, cutoff attribution, concurrency, purge, CSV formula defense and AI grounding. One CodeRabbit pass per completed batch using actual common base; fix still-valid findings, re-run only if changed surface warrants. Record auth/rate-limit blockers rather than fake review success. Do not redispatch a reviewer per small commit.
- [ ] **4. Record companion release status** `npm run companion:release:status`; append one verified outcome, plain-language notice. No emergency release inferred, no version bump below gate, no packaging unless policy eligible **and** user authorizes release.
- [ ] **5. Prepare additive migration/port checklist:** verify actual resolver host (`MIGRATION_DATABASE_URL` → `DATABASE_URL_UNPOOLED` → `DATABASE_URL`); apply only the new migrations at authorized rollout, never replay historical set. Compare Agent OS shared files by content; payroll-new modules portable, but screenshots/models/sidebar differ. Port narrowly, preserve its recent screenshot/arrangement features and its deploy script/layout/proxy. Auth/tenant semantics stay Work OS authoritative.
- [ ] **6. Prepare deployment runbook, do not deploy by default:** off-by-default settings, migration → source-aware server/UI/companion compatibility → readiness provider/models → cron secrets/advance+retention first → explicit auto-approval activation → fixture settlement → admin pilot. Server deploy only through Agent OS's atomic `npm run redeploy`; verify deployed commit/assets/representative live flow read-only first, smallest approved fixture writes second. Disable flags to pause new processing on rollback; keep applied additive schema/historical snapshots and expiration jobs intact. A buggy auto-approval cannot be undone by deleting review events; correction is a new audited source version.
- [ ] **7. Commit:** `docs(work-os): verify payroll review and record rollout gates`; update ledger/checkpoint truthfully. Ask for integration/deployment authorization with remaining exact blockers, not an implicit production rollout.

---

## Task dependencies and delivery checkpoints

1 → 2 → 3/4 establishes contracts/schema/source/hours. Task5 → 6 establishes honest recap policy before enabling automation. Task7 binds those sources; 8 → 9 supplies classification/briefs. Task10 orchestrates 3–9; 11 makes durable decisions/approvals. 12–14 protect images/exports/retention; 15 exposes their bounded endpoints. 16 builds the desk; 17 adds optional Q&A; 18 wires disabled-by-default automation; 19 proves rollout readiness. Execute coupled changes inline; concurrency tests are not optional before release.

- **Checkpoint A (Tasks1–7):** deterministic calculations and source-provenance validated, no production auto-approval enabled.
- **Checkpoint B (Tasks8–15):** fixture end-to-end analysis→decisions→approval→stable export→purge, auth and real PG race evidence. Optional briefs fail without invalidating valid hours.
- **Checkpoint C (Tasks16–19):** rendered admin/employee provenance, deployment-compatible clients, automation/retention gates proven, independent review complete. Only then propose merge/deploy/release separately.

## Spec coverage / planning self-review

| Spec requirement | Task owner |
|---|---|
| Product scope, roster/day/admin-only read and approved composition (§1–4) | 1, 15–16 |
| Semimonthly/weekly/local date/overnight attribution (§5) | 1, 4, 7 |
| Exact recorded/eligible/break/zero/held/adjustment/rounding (§6) | 3–4, 11 |
| Consent/secure retained evidence/source freshness (§7) | 7–8, 12 |
| OpenRouter high policy, ambiguity, cited briefs/questions (§8) | 8–9, 17 |
| Payroll morning pending recap approval (§8.6) | 5–6, 10, 18 |
| Org-scoped schema, immutable decisions/approval history (§9) | 2, 5, 7, 10–11 |
| Leases/catch-up/cancel/atomic publication (§10) | 6, 10, 18 |
| Approval/CSV/print/reopen (§11) | 11, 13, 16 |
| Responsive/a11y/state matrix (§12) | 5, 16–17, 19 |
| Auth/CSRF/no-secret-leak/30-day payroll-only purge (§13) | 2, 12–15, 18 |
| Error, race, failure and live acceptance (§14–15) | every task, 19 |
| Ordered delivery and fixed defaults (§16–19) | checkpoints/Tasks1–19 |

Self-review completed when finalizing this plan: cross-check file symbols and consumed types; confirm every task has red/green evidence and a focused commit; compare safety gates against current code rather than Agent OS historical docs. No source implementation, live writes, deployment, tests passing, or final UI acceptance is claimed merely because this plan exists.
