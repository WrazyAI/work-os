# Area D — Admin Overview and readiness performance

Ledger: `cdb8611d-da41-4acb-aec2-282d755ff004`. Shared worktree/branch:
`work-os-performance` / `codex/work-os-performance`. Baseline:
`ecb61fdc7fa996a2474b28796bbef95893849f39`. No commits, live database writes,
merge, deployment, installer build, or release performed by this worker.

## Reproduction and measured result

`test/work-os-admin-overview-performance.test.mts` calls the **production**
`getAdminOverview()` and `loadWorkOsReadinessReport()` functions. The only
replacement is `globalThis.__workOsPgPool`, whose transport executes every SQL
statement in PGlite. The real query shim, relationship resolution, evaluator,
and dashboard assembly execute normally. No canned aggregate responses.

The fixture has 2,501 tasks with long completeness text, 2,501 same-day updates,
completions and evidence rows, 251 submitted reports plus 251 drafts, one team,
one active person, and foreign-organization/archived/deleted controls. It warms
Overview once to exclude cold shim metadata from the measured request. Bytes
are the sum of `Buffer.byteLength(JSON.stringify(result.rows))` at each SQL
transport return, **not** PostgreSQL wire bytes or HTTP response bytes.

| Production function | Baseline SQL queries | Fixed SQL queries | Baseline rows returned | Fixed rows returned | Baseline returned bytes | Fixed returned bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Overview, warm | 45 | 17 | 9,824 | 1,108 | 5,293,773 | 268,509 |
| Readiness, active team | 11 | 11 | 2,507 | 5 | 4,719,023 | 664 |

These are actual local fixture measurements, not source-derived estimates or
production latency claims. Initial combined setup/Overview now costs 28
queries in this fixture; each subsequent minute snapshot costs 17, not 45.
No process-global stale readiness cache was introduced.

Before production edits, the new tests failed with:

- Chart updates: **2,000**, expected **2,501**.
- Readiness open tasks: **2,503**, expected **2,501** (archived/deleted records
  incorrectly contributed completeness gaps).
- The client lifecycle test subsequently failed because a separate readiness
  query did not exist. All now pass.

## Behavior and invariants

- Overview no longer loads readiness; its compatibility `readiness` field is
  `null`. The existing, admin-authorized `/api/work-os/readiness` endpoint is
  unchanged. Both companion **and web** Overview read it independently.
- Setup is cached **in memory** for five minutes; no minute interval. Stale
  mount/focus/reconnect, explicit Overview refresh, and confirmed local setup
  writes revalidate it. External changes while the window stays continuously
  focused become visible on an explicit refresh or a later stale mount/focus;
  there is deliberately no hidden server cache or setup poll.
- The readiness key nests below the Overview prefix so the existing companion
  page-refresh control includes it without changing the shell or refresh map.
- Companion successful organization/membership/team, person, task, and
  integration fetchers invalidate setup. Failed writes do not; inactive setup
  queries are marked stale without fetching. Existing web settings/task/
  integration invalidations already cover this key; the narrower web person
  mutation now also invalidates it.
- Blocker attention derives from the separately fetched report. Resolved
  blockers disappear without waiting for a new operational snapshot. Loading
  and retryable setup failure remain local; neither blocks the dashboard.
- Completeness is one organization-qualified SQL aggregate. It excludes
  archived/deleted tasks and preserves JavaScript trim semantics (including
  non-ASCII whitespace), null/empty assignee arrays, and zero effort as present.
  The evaluator still accepts task rows and supports aggregate checks.
- Day/person SQL groups replace capped date transfers for updates, evidence and
  completions. Exact totals and per-person counts are independent of bounded
  activity lists. Reports/drafts/disputed evidence also use exact aggregates.
- Task open/overdue/source freshness and created volume share one read. Report
  exact counts/oldest pending/source freshness share one read. GitHub volume/
  freshness and attendance/plan latest instants share one statement. Session
  history supplies today, observed-time series, and outstanding-EOD windows;
  grouped completion history supplies both trends and outstanding-EOD evidence.
- Every aggregate is organization-qualified, including correction-event
  attribution. Historical bucket endpoints remain inclusive; the current
  pending-review queue and global source freshness deliberately remain current
  for historical snapshots. Source volume retains the previous `>= UTC start`
  semantics rather than silently introducing an upper date bound.
- Existing detail caps remain. Observed time still uses the canonical session
  helper, including recorded pauses and correction-status history. No employee
  day/Insights or attendance mutation code changed.

## Verification commands and results

Use native WSL Node:

```sh
export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH
node --import tsx --test test/work-os-admin-overview-performance.test.mts test/work-os-readiness.test.mts test/work-os-admin-overview.test.mts test/work-os-admin-time-series.test.mts
node --import tsx --test test/work-os-admin-overview-performance.test.mts test/work-os-route-contracts.test.mts
node --import tsx --test test/work-os-admin-overview-performance.test.mts test/work-os-readiness.test.mts test/work-os-admin-overview.test.mts test/work-os-admin-time-series.test.mts test/work-os-route-contracts.test.mts
npm --prefix desktop/work-os-companion test -- --run src/admin/adminReadiness.test.ts src/admin/adminCache.test.ts src/adminDataNormalizers.test.ts src/admin/adminRefresh.test.ts
npm run work-os:typecheck
npx tsc --noEmit -p desktop/work-os-companion/tsconfig.json
npx eslint src/lib/work-os-admin-overview.ts src/lib/work-os-readiness-report.ts src/lib/work-os-readiness.ts src/modules/work-os/admin-readiness.ts src/modules/work-os/admin/AdminOverview.tsx src/modules/work-os/admin/AdminPeople.tsx
git diff --check
```

- Initial focused backend run: **14 passed** (before adding two extra
  completeness/history tests).
- Performance plus route-contract run: **29 passed**. Includes real SQL tests
  for >2,000 chart rows and >detail caps, exact per-person counts, completeness
  parity, historical boundaries, foreign tenant exclusion, and foreign
  correction references.
- Final combined focused backend/contract run: **41 passed**. A review found
  and test-first corrected the empty `update_kind` fallback in the new SQL
  latest-update projection; its regression test is included.
- Companion focused run: **35 passed**. Browser-mode real QueryObservers prove
  no repeated setup read across three minute fetches, successful/failed setup
  invalidation, inactive-query behavior, stale remount, explicit refresh, and
  blocker removal. Only the API transport is mocked in this lifecycle test.
- Work OS typecheck: passed on the final shared-tree run. Companion typecheck
  passed earlier after this worker's edits, but the final shared-tree run is
  **blocked by concurrent out-of-scope changes**: `workOsQueries.ts:305` has a
  `number | boolean` `refetchInterval` (must be `number | false`), with downstream
  errors at `recapNotificationQuery.test.ts:15` and `App.tsx:1829`. Those files
  are owned by the main agent and were not edited here. A previous concurrent
  check also timed out at 120 seconds; the final run used 240 seconds and
  produced these concrete errors. An intermediate companion check
  caught a server-type alias leaking into desktop compilation; replaced with a
  small structural client contract in the shared readiness module.
- ESLint: zero errors; existing `no-explicit-any` warnings remain in untyped
  query-shim call sites. Root ESLint ignores companion sources; those sources
  are covered by the companion TypeScript check, not claimed as linted.
- `git diff --check`: passed.

## Backend port/integration paths

The existing backend files were content-identical at fetched Agent OS
`fd60b6cb` versus Work OS baseline. The web Overview/People modules were also
compared and content-identical. Port these specific files by content:

1. `src/lib/work-os-admin-overview.ts`
2. `src/lib/work-os-readiness-report.ts`
3. `src/lib/work-os-readiness.ts`
4. **New** `src/modules/work-os/admin-readiness.ts`
5. `src/modules/work-os/admin/AdminOverview.tsx`
6. `src/modules/work-os/admin/AdminPeople.tsx`

No migration, package, root shell, proxy, deployment script, or route-auth
change is required. The web client lifecycle change must ship with the backend:
old clients that rely solely on embedded readiness otherwise see setup as
unavailable. Companion changes are in `src/admin/data.ts` and
`src/admin/OverviewPage.tsx`; keep the shared readiness module with them.

## Limits / remaining main-agent gates

- PGlite proves executed SQL/result semantics, not production query plans,
  network/pool wait time, authentication latency, or native CPU/memory cost.
- Readiness still reads configuration rosters and team memberships; it no
  longer transfers task text and runs only through its own lifecycle.
- No live provider calls or live DB writes were used. Operational report/
  activity lists remain capped details, separate from exact metrics.
- Full suite, production build, CodeRabbit, rendered wide/narrow UI and
  TestSprite acceptance are integration gates owned by the main agent. A
  typecheck or QueryObserver test is not visual acceptance.
- No release-queue/changelog/version files touched; main owns combining any
  employee-facing outcome with the batch release policy.
