# Work OS performance implementation and verification

## Target

- Repository: `https://github.com/WrazyAI/work-os`
- Implementation worktree: `/home/maigreeks/projects/.worktrees/work-os-performance`
- Branch: `codex/work-os-performance`
- Baseline: `ecb61fdc7fa996a2474b28796bbef95893849f39` (fetched `origin/main`)
- Ledger task: `cdb8611d-da41-4acb-aec2-282d755ff004` (`TASKS`)
- Original report: `/home/maigreeks/projects/work-os/docs/performance-report.md`
  (left untouched; the investigation report was untracked in the original checkout)
- Agent OS fetched at `fd60b6cb`; the named backend files were content-identical
  to the Work OS baseline. Server changes in this branch are **not deployed**.
- No merge, deployment, installer release, or version bump was performed.

The tested implementation commit is recorded in the section
"Commit and tested-source identity" at the end of this document. The worktree
was the only source used for the verification commands below.

## What changed

### A. Employee/admin workspace isolation

- `planAdminOttoBootstrap` still decides role and mapping; the employee
  bootstrap gate now also requires the employee workspace. Mapped admins on
  Administration do not start compact/details day, task history/backlog,
  personal Insights, task details/options, historical day, EOD screenshots, or
  onboarding page reads.
- Admin notifications keep their own scoped reads (`outstanding EODs`, memory,
  latest recap, attendance observation). Settings loads onboarding on demand
  when the admin opens Settings or Profile.
- Employee page queries require `employeePageEnabled` (employee workspace and
  the single background monitor owner). Returning to Administration disables
  them; returning to Employee re-enables them from the cached/live query state.
  In-flight reads consume the TanStack cancellation signal, while mutations
  continue to use their own API calls and are never cancelled by logout.
- Historical Tasks dates, Review, Evidence, and task detail/carry-over data are
  gated to their visible page. The retained employee tab is no longer enough to
  keep a hidden screen loading.
- Unmapped admins remain in Administration; no personal day/onboarding read is
  started and no employee switch is offered.

### B. Cache persistence and recap-controller stability

- The persistence subscriber now reacts only to persisted-query additions,
  successful data updates, and removals. Observer-option changes, fetch-state
  timestamps, and excluded `work-os.admin` changes no longer rewrite the vault.
- Writes are debounced, fingerprint-compared (query hash + data), serialized,
  and coalesced. A failed write retains the dirty state and retries with bounded
  backoff. A sign-out barrier waits for an in-flight save, cancels reads, clears
  the query cache, then erases the account's local vault data; queued old-account
  writes are dropped.
- `openAdminOttoSurface` reads its context query through a ref, so unrelated
  renders no longer change the admin delivery callback identity. The delivery
  effect and ownership heartbeat remain independent. Idle mascot heartbeats no
  longer restart the fallback inbox poll; normal avatar ownership and the
  server-side delivery lease/fencing code are unchanged.
- A lightweight `workday` status response is used by the main window when the
  employee page is hidden, instead of reloading the full employee day.

### C. Compact day, task selection, and Today Insights

- Employee task candidates are resolved by organization, owner, status, and
  narrow personal ownership/historical event/plan ownership **before** full row
  fetches and identity hydration. There is no organization-wide 2,500-row cap.
  Parent/subtask families and historical personal evidence are retained.
- Compact day responses bound top-level tasks, nested subtasks/assignees,
  plan suggestion IDs, and each carry-over group. Carry-over groups still carry
  exact `count` and `hasMore`; the dashboard shows exact tab totals while only a
  bounded page is mounted. Full/detail day pagination remains complete.
- `GET /me/workday` now supplies the small shared status set (date, shift,
  session, plan, prompt, attendance, report status, access capabilities) without
  task/evidence/history/proposal/workspace collections.
- Today's margin widget uses `GET /me/insights?range=7d&summary=1`. The summary
  reads completed-only task families, plans, substantive updates, and a bounded
  projection for the seven displayed days. It does not build the comparison
  week, full daily projection set, evidence rollups, references, or brief. The
  full Insights route/response is unchanged.
- Current-day `getWorkday()` receives the shift context already resolved by the
  day view, so it does not repeat the employee timezone/schedule/exception
  reads. The function still performs every session/plan transition itself; the
  historical-date path deliberately does not reuse current-day context.
  No `getWorkday()` write/transition side effect was moved into a cache or
  parallel fire-and-forget path.

### D. Admin Overview and readiness

- Readiness is a separate authenticated query with a five-minute stale window,
  no poll, focus/reconnect revalidation, explicit-page-refresh support, and
  invalidation after confirmed setup/task writes. Overview keeps its 60-second
  operational snapshot poll; it no longer loads readiness every minute.
- Exact task, check-in, evidence, report, GitHub, and chart totals are SQL
  aggregates in `work-os-admin-overview.ts`. Bounded detail lists remain for
  per-person activity. Archived/deleted filtering, historical windows,
  correction attribution, tenant qualification, and capped-list/full-count
  separation are covered by SQL fixtures.
- `work-os-readiness-report.ts` computes task-completeness counts in SQL and no
  longer transfers task text or all unfinished rows.

### E. Backlog and recap pagination

- The open backlog is now a TanStack infinite query: one 50-task page on demand,
  explicit `Load more`, exact server counts, and a cursor. The automatic 40-page
  drain and legacy pending fallback were removed. The request uses
  `view=open`, `excludeToday=true`, and the workday date so counts and rows match
  the Unfinished destination.
- Optimistic add/remove/update helpers preserve loaded page boundaries, cursors,
  and exact counts.
- The bell/live notification read uses a separate **latest-page** query. It
  polls only that query; loading three history pages and refreshing the bell
  causes one API request and leaves the history `InfiniteData` object untouched.
  History polling stops once more than one page is loaded; explicit history
  invalidation still refreshes both keys.

### F. Cross-window day/attendance ownership

- A small host-owned day monitor (`src-tauri/src/day_monitor_core.rs`) arbitrates
  one owner across webviews with a 30-second lease. Electron-style module
  singletons would not share state between Tauri webviews; this state is managed
  by the Tauri process instead.
- Priority: visible Employee main page, visible avatar, then hidden main fallback.
  Main publishes an account/session-scoped, minimal day snapshot to the avatar
  (or reads it when the avatar owns monitoring). A missing/crashed owner expires;
  visibility changes re-claim. Account changes and recreated windows cannot read
  another scope's snapshot. The JS client fences late callbacks after cleanup.
- Main and avatar attendance watch runs only for the current owner. The existing
  voice/background-throttling flags remain on the main and avatar windows, and
  the debugger has no background flag because it is created on demand. Voice
  recording, transcription, uploads, reminders, and Worktivity authority code
  were not changed.

### G. Startup bundles and debugger lifecycle

- `main.tsx` keeps the employee App eager (the connect screen and workspace are
  inside it) but lazy-loads AvatarApp, dev previews, and admin previews behind
  explicit root branches with a boot fallback. Deferring the App shell itself
  only moved the same bytes behind a fallback and fragmented startup into many
  icon chunks, so it was deliberately not kept.
- `App.tsx` lazy-loads AdminWorkspace, AdminOttoChat, and AdminOttoSettings with
  local Suspense boundaries, so opening chat/settings does not blank the shell.
- The hidden debugger window was removed from packaged startup configuration.
  `open_debug_window` still creates it on demand (Rust `WebviewWindowBuilder`),
  so Scenarios/Live trace/Export behavior is unchanged when opened.
- No visual redesign was made.

## Baseline and fixed measurements

All measurements below are reproducible local fixtures. They are not production
latency, native CPU/memory, or live database plans.

### Query/cache amplification (real QueryClient in Vitest)

| Scenario | Baseline | Fixed |
| --- | ---: | ---: |
| 5 observer-option changes + 1 excluded admin write | 6 vault saves | 0 vault saves |
| 3 data changes during a slow save | 3 overlapping saves | 1 in-flight + 1 coalesced serialized save |
| Sign-out during an in-flight save | old data could be cleared while saving | clear waits for save; queued old write dropped |
| Failed vault write | change could be lost | dirty state retained and retried with backoff |

Command: `npx vitest run src/queryPersistence.test.ts`.

### Real App/browser lifecycle

The harness loads the real App, hooks, QueryClient, API client, delivery
controller, and UI in Chromium. Only HTTP transport is synthetic; requests are
intercepted with realistic payloads. It is a development browser lifecycle
test, not production StrictMode startup measurement.

| Scenario | Baseline | Fixed |
| --- | ---: | ---: |
| Mapped Admin cold start, hidden employee page requests | 8 full-page HTTP reads (day, onboarding, history, backlog, 7d Insights, screenshots, duplicate direct day/onboarding) | 0 full-page reads; 1 one-row exact open/overdue count for the bell |
| Two valid idle mascot heartbeats, main fallback owner | +2 inbox POST/GET requests | +0 requests |
| Return to Admin after Tasks/Review/Insights/historical date | retained employee queries could remain enabled | 0 hidden page requests in the 3s observation |
| Unmapped Admin cold start | personal day reads could be started | 0 personal day/onboarding/Insights/task reads; no employee switch |
| Employee startup assets | eager App/Avatar/admin module graph | no AvatarApp or admin page module request before the hidden branch opens |

Command:
`node --import tsx --test test/work-os-performance-browser.mts`.
Five scenarios pass. The fixture is synthetic; Tauri window ownership,
visibility, and native webview startup still require packaged verification.

### Compact day (PGlite executes production SQL builder and helpers)

Fixture: 2,500 overdue personal tasks with ~1 KB descriptions.

| Metric | Before | After |
| --- | ---: | ---: |
| Full serialized day response | 4,699,379 bytes | unchanged for full/detail path |
| Compact serialized day response | 4,699,379 bytes | 15,217 bytes |
| Carry-over rows embedded in compact response | 2,500 | 24 |
| Exact overdue count | 2,500 (derived after full transfer) | 2,500 |
| Eligible newer task after 2,600 unrelated org rows | invisible beyond the 2,500 cap | returned and hydrated |
| SQL statements, direct helper fixture | 14 cumulative in the old full+compact fixture run | 16 current full / 16 current compact; fixtures are not directly comparable. The report's 29-statement day-route trace was not independently rerun. |
| Compact response task description/raw fields | present | absent |

The test also walks 50-task pages across all 2,500 tasks and verifies no gaps or
duplicates. Command:
`node --import tsx --test test/work-os-performance-employee-backend.test.mts`.

### Today Insights summary

Same production functions and PGlite fixture with 2,600 open tasks plus eight
completed outcomes:

| Metric | Full 7-day Insights | `summary=1` |
| --- | ---: | ---: |
| SQL queries | 24 | 8 |
| Rows returned to the application | 5,230 | 28 |
| Serialized response bytes | full report | 1,104 |
| Comparison week / 14 projections | yes | no |
| Full brief/references/evidence | yes | no |

The regression compares `tasksCompleted`, `updates`, `consistency`, and each
day's task-completion count against the full production report for the same
fixture. Command:
`node --import tsx --test --test-name-pattern "dashboard summary" test/work-os-performance-employee-backend.test.mts`.

### Admin Overview/readiness

PGlite executes every production SQL statement; bytes are the sum of JSON-encoded
rows returned by the transport, not HTTP or PostgreSQL wire bytes.

| Function | Baseline queries | Fixed queries | Baseline rows | Fixed rows | Baseline bytes | Fixed bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Overview, warm | 45 | 17 | 9,824 | 1,108 | 5,293,773 | 268,509 |
| Readiness, active team | 11 | 11 | 2,507 | 5 | 4,719,023 | 664 |

The baseline Overview test failed before the fix: chart updates stopped at
2,000 instead of 2,501, and readiness counted 2,503 open tasks because archived/
deleted rows were included. Fixed tests cover 2,501 chart rows, exact counts
beyond 200-row lists, foreign-tenant exclusion, historical edges, correction
attribution, whitespace/null completeness parity, and independent readiness
lifecycle. Commands:

```sh
node --import tsx --test test/work-os-admin-overview-performance.test.mts \
  test/work-os-readiness.test.mts test/work-os-admin-overview.test.mts \
  test/work-os-admin-time-series.test.mts
npx vitest run src/admin/adminReadiness.test.ts src/admin/adminCache.test.ts \
  src/adminDataNormalizers.test.ts src/admin/adminRefresh.test.ts
```

Focused results: 41 backend/contract tests and 35 companion tests passed in the
area-D workstream; the complete final runs are recorded below.

### Backlog and recap pagination

- 120-task loader: baseline **3** serial HTTP calls; fixed **1** call, exact
  counts, cursor retained (`src/backlogPagination.test.ts`).
- Optimistic page update: page boundaries and counts preserved.
- Three loaded recap history pages: baseline refetch made **3** API calls; fixed
  bell refresh made **1** latest-page call and left history pages untouched
  (`src/recapNotificationQuery.test.ts`).
- History polling stops after a second page; notification polling remains on its
  own contract.

### Startup assets

Baseline production frontend build (Vite, uncompressed module sizes):
`main` 1,279.68 kB JS + `styles` 257.77 kB JS, `main` 589.40 kB CSS +
`styles` 107.43 kB CSS. Fixed build splits the graph:

| Asset | Fixed size |
| --- | ---: |
| `main-*.js` (employee shell) | 1,066.18 kB |
| `AvatarApp-*.js` (lazy branch) | 90.03 kB |
| `AdminWorkspace-*.js` (lazy) | 119.42 kB |
| shared `styles-*.js` | 257.78 kB |
| `main-*.css` | 555.96 kB |
| shared `styles-*.css` | 107.43 kB |

A Chromium production-preview measurement of the actual startup network graph
recorded **301,075 bytes JS / 111,177 bytes CSS** for the fixed main employee
window vs **357,947 bytes JS / 116,187 bytes CSS** for the baseline build. That
is a **15.9% reduction in startup JavaScript transfer** and **13.0% less total
startup transfer**; it uses one JS request rather than fragmenting the employee
graph into many icon chunks. Uncompressed emitted assets are **1,323.96 kB JS /
663.39 kB CSS** vs the baseline build's 1,537.45 kB JS / 696.83 kB CSS. These are
local Vite production preview transfers, not native Tauri memory or CPU.

### Cross-window native arbitration

- `day_monitor_core.rs` Rust unit tests pass (`rustc --test`): one owner, visibility
  priority, expiry after a crashed owner, scope/account isolation, late-publish
  rejection, and recreated-window recovery.
- JS client tests pass (`src/dayMonitor.test.ts`): independent clients share the
  host verdict, scope snapshots are bounded, late snapshots after cleanup are
  ignored, and stop releases the listener.

Native Tauri `cargo test --lib` could not complete in this Linux environment:
`libsoup-3.0` and `javascriptcoregtk-4.1` development packages are absent. No
claim is made that the packaged Windows/macOS app was built or profiled here.

## Finding dispositions

1. **Employee data continues in Admin — confirmed, fixed.** Cold Admin had 8
   hidden employee page requests; fixed has zero full-page reads. The bell keeps
   one server-side exact open/overdue count (`limit=1`, no backlog page), and
   settings/memory/recap/EOD notification reads remain available. Mapped admin switching to Employee and back
   preserves cached state and stops hidden reads; unmapped admin has no personal
   reads or employee switch.
2. **Today Insights on startup — confirmed, fixed.** It is gated to the visible
   employee Today screen after compact day settles and now uses the bounded
   summary query.
3. **Compact day not bounded / broad cap — confirmed, fixed.** Response bytes
   4.67 MB → 15.2 KB, carry-over exact count + 24-row page, >2,500 eligible task
   proof, historical attribution proof, complete pagination retained.
4. **Observer/excluded renders save cache and restart controller — confirmed,
   fixed.** Six saves → zero; idle heartbeats add zero inbox requests; fallback
   ownership tested separately from normal avatar ownership tests.
5. **Admin Overview/readiness expensive per minute — confirmed, fixed.**
   Overview 45 → 17 queries and 5.29 MB → 268 KB returned rows; readiness
   separate 5-minute lifecycle, 2,507 → 5 rows; exact SQL aggregates tested.
6. **Backlog auto-drain and shared recap history refetch — confirmed, fixed.**
   40-page loader replaced by demand pages; 3 history pages untouched by a
   one-call bell refresh; exact counts preserved.
7. **Multiple windows/startup bundle/debugger — confirmed, addressed within
   scope.** Host ownership, lazy roots/admin chunks, debugger removed from
   startup and created on demand. Native release profile remains unmeasured.

## Verification commands and results

Use the repository-pinned native WSL Node toolchain:

```sh
export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH
```

Run from the implementation worktree:

```sh
npm run work-os:typecheck
npm run work-os:test
node --import tsx --test test/work-os-performance-employee-backend.test.mts
node --import tsx --test test/work-os-performance-browser.mts
node --import tsx --test test/work-os-admin-overview-performance.test.mts \
  test/work-os-readiness.test.mts test/work-os-admin-overview.test.mts \
  test/work-os-admin-time-series.test.mts test/work-os-insights.test.mts \
  test/work-os-task-pagination.test.mts test/work-os-task-attribution.test.mts
npm run work-os:test:site
npx next build --webpack
cd desktop/work-os-companion
npx vitest run
npm run build
cd src-tauri
rustc --edition=2021 --test src/day_monitor_core.rs -o /tmp/day-monitor-core-test && /tmp/day-monitor-core-test
```

Observed results in this environment:

- `work-os:typecheck`: passed after the final code changes.
- Focused new employee backend suite: 4/4 passed; compact 4,699,379 →
  15,217 bytes; summary 8 queries / 28 rows / 1,104 bytes vs full 24 queries /
  5,230 rows. A combined final backend/targeted gate (employee performance,
  Admin Overview/readiness, Admin Otto context, desktop static, packaged-window
  config) passed 26/26.
- Focused browser lifecycle: 5/5 passed in the final run (Admin cold start,
  Admin return, unmapped Admin, employee startup, idle heartbeats). The first
  run was cold-Vite flaky and one assertion expected the retained Tasks page
  heading after returning; the test was corrected, not the production behavior.
- Desktop Vitest: **1,644/1,644 passed** (182 files) after the lazy/import,
  ownership, persistence-retry, carry-over-count, lightweight-count, and
  review-hardening changes.
- Desktop production build: passed (`tsc --noEmit && vite build`); employee
  main chunk 1,066.18 kB, AdminWorkspace 119.42 kB lazy, AvatarApp 90.03 kB
  lazy; startup preview 301,075 bytes JS / 111,177 bytes CSS.
- Web focused route/surface/insights/pagination/attribution/static after the
  review fixes and Agent OS reconciliation: **97 passed / 0 failed**.
- `work-os:test:site`: 59/59 passed.
- CodeRabbit review was re-run successfully after authentication was restored:
  **7 findings (1 major, 6 minor)**, all addressed or verified:
  initial-monitor claim failures now fall back; dashboard insights keys nest
  under the shared invalidation prefix; the unsafe reused shift context was
  reverted; avatar ownership changes reload immediately; owners no longer
  re-read their own snapshot; raw `pg` dates are cast to text; and legacy
  plain-backlog cache entries no longer throw.
- `npx next build --webpack`: passed; `/work-os/today`, admin routes, and API
  routes compiled. Default `npm run build` (Turbopack) is blocked by the
  environment's Next 16.2.6 installation requesting the nonexistent
  `@vercel/turbopack/postcss`; the same failure occurs on the untouched baseline.
- `npm run work-os:test` full run: **1,244 passed / 0 failed / 11 skipped**
  (1,255 tests; exit 0). An earlier aggregate run under concurrent local agent
  load had 12 time-sensitive failures (11 preview-expiry assertions and one
  stale source-shape assertion); the preview file passes alone and the final
  full run above is green. The final Work OS aggregate run completed in 435
  seconds (1,255 tests); the separate 27-test release-gate prework also passed.
- Companion release gate: `npm run companion:release:status` fails on the
  untouched baseline with `Release queue is append-only; published outcome
  admin-overview-measures-open-records is immutable`. The published 0.5.20
  snapshot references an outcome absent from the checked-out queue. This is a
  pre-existing repository/history inconsistency, not caused by this branch.
  The new admin-observability queue entry is append-only and does not bump a
  version or dispatch a release.

## Backend deployment

The backend was ported to Agent OS by content, preserving Agent OS-only recap
and schedule-exception behavior, then merged and deployed through the required
atomic path:

- Agent OS PR: https://github.com/WrazyAI/agent-os/pull/78
- Merged commit: `420f6786dd31e1f35286d878f7fb0124f66e228f`
- VPS checkout: `/home/dev/agent-os`, deployed marker `420f6786d`
- `scripts/redeploy.sh` preflight passed, production build completed, asset
  checks passed, and the build swapped into place.
- `agentos-web.service`: active; `agentos-runner.service`: active and restarted
  with the new code after confirming no child job was in flight.
- Live read-only probes: `GET https://app.wrazyos.com/work-os` returned 200 with
  its static JS/CSS assets served successfully; unauthenticated Work OS API
  probes returned the expected auth redirect rather than a server error.
- The deployed server bundle contains the new `load insight summary` and
  `summary=1` path, and `.deployed-commit` matches `420f6786d`.
- Agent OS's existing recap and schedule-exception measures add three exact
  reads to Admin Overview: the deployed version measures **20** statements
  versus the report's **45**. The Work OS-only baseline (without those newer
  Agent OS features) measures 17.

The `workday` response and the web Overview/People readiness client shipped in
the same Agent OS deployment, so there is no old-client/`readiness: null`
mismatch on the production host. A rollback must revert the whole Agent OS
commit; do not roll back only one route or client.

## Remaining risks and native verification

- Cross-window ownership needs packaged Windows/macOS verification with real
  window visibility, sleep/resume, avatar destruction/recreation, and system
  notifications. Rust code compiles only as a standalone core test here; Tauri
  native build is blocked by missing Linux WebKit/GTK dev libraries.
- PGlite proves SQL semantics and row/byte counts, not PostgreSQL query plans,
  pool wait, provider timing, or production CPU/memory. No native release
  profile was produced.
- TestSprite was not run for this backend/desktop performance change; the
  existing browser checks are synthetic transport fixtures. If the release gate
  requires it, run the stored Companion plan against `https://app.wrazyos.com`
  now that the Agent OS backend is deployed.
- The companion release cadence remains below five pending outcomes; no version
  files were changed. The pre-existing release-gate history failure must be
  resolved by the release owner before any future release.

## Commit and tested-source identity

- Implementation commit: `51de0bddfce6a1142c2ca5646cd814dffb4add84`
  (`fix(work-os): harden performance lifecycles after review`). The main
  implementation commit before review hardening was
  `6b385ab2bd69586334c8a8667acd65192fbd54d7`.
- Branch: `codex/work-os-performance`, based on
  `ecb61fdc7fa996a2474b28796bbef95893849f39`.
- Every final check below was run in
  `/home/maigreeks/projects/.worktrees/work-os-performance` against this
  implementation commit (or the docs-only follow-up commit that records these
  results). No test was run against a different checkout.
