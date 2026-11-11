# Employee Task Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the employee companion Tasks page a compact icon toolbar and a polished unified all-task search/date/status finder.

**Architecture:** Keep the finder separate from the page's view queries. A bounded, authorized server query filters before pagination; a focused modal owns search, status/date state, focus and layout, and hands result activation to the existing drawer. Preserve the current list and creator.

**Tech Stack:** Existing React 19, TanStack Query, TypeScript, companion CSS/Vite, Next.js employee route and Neon Postgres SQL function.

**Spec:** `docs/superpowers/specs/2026-11-11-employee-task-finder-design.md`; operator approved direction in chat, implementation details below are builder choices.

## Global Constraints

- Search, Calendar and Add task are icon-only controls beside the view tabs; the column row contains only sort labels.
- All is default. Text, one status and inclusive task-date range intersect across all authorized active parent tasks before pagination.
- No new dependencies, fonts, models or assets. Retain the existing drawer, creator, authorization, task-date semantics and completion precedence.
- Existing semantic palette: ink #182018, muted #62685f, canvas #eef1eb, paper #fafaf6, raised #ffffff, line #d9ded5; use existing CSS tokens, not duplicated raw colours.
- One companion outcome; queue append only after verification, no version bump. No live database write without verified host and explicit tracked deployment scope.

## Review Focus

- A status/date/text match beyond the initial 50 rows must be discoverable, with truthful totals.
- Completed overdue tasks must match Completed, not Overdue; undated tasks never become overdue through fallback attribution.
- Fast typing, filter changes and close/reopen must not display old-query rows or reuse incompatible cursors.
- Modal-to-drawer focus handoff must never refocus the removed result or leave focus behind the modal.
- Short/narrow windows, native date controls and long titles must not hide close, filters or results or trap the wheel.

---

### Task 1: Complete-set server filtering and isolated finder query

**Files:**
- Modify: `src/app/api/work-os/me/tasks/route.ts`, `src/lib/work-os-tasks.ts`, `desktop/work-os-companion/src/workOsQueries.ts`
- Create: `src/modules/work-os/task-finder.ts` (shared type-only/pure contract), `supabase/migrations/0073_work_task_finder_status.sql` (verify next free number before creation)
- Test: `test/work-os-task-pagination.test.mts`, `test/work-os-task-finder.test.mts`, `desktop/work-os-companion/src/workOsQueries.test.ts`

**Interfaces:**
- Produce `TaskFinderStatus = "all" | "pending" | "in_progress" | "overdue" | "completed"` and `TaskFinderFilters = { search: string; status: TaskFinderStatus; from: string; to: string }`.
- Extend history paging with optional `status`; omitted/all preserves old behavior. Add the status to cursor scope and query identity. Existing API pages remain 50 parents.
- Produce `useTaskFinderQuery({ enabled, currentDate, filters })`, using existing task-history cache prefix so mutation invalidation reaches finder reads, passing AbortSignal and all filters. No page-view state dependency.

- [ ] Write failing tests for all statuses, completed/overdue precedence, 200-character limit, invalid status/range, no dates, inclusive endpoints and authorized organization/person scoping. Add a case whose only match lies beyond the first 50 unfiltered rows; assert correct filtered total/cursor and rejection of old cursor after status changes.
- [ ] Run focused tests and capture expected failures before implementation.
- [ ] Extend `TaskListOptions` and the route; preserve existing `view=history` semantics and capability decoration. Read current Next route docs under `node_modules/next/dist/docs/` before editing. Add the distinct SQL function `work_find_person_task_page` using the current paging function's parameters plus `p_status text`, filtering effective state before counts and pagination; route only explicit finder status calls to it. Leave the existing function signature and default calls untouched, avoiding ambiguous overloads. Preserve authorization predicates, date attribution, progress, counts and grants. Document the separate function's compatibility purpose in migration comments.
- [ ] Add isolated query hook and deterministic query-key/URL tests; stale requests must not paint another filter's results and disabled finder must not request data.
- [ ] Run focused tests directly; run disposable PostgreSQL cases only on an explicitly disposable URL. Do not migrate production just to make the feature appear tested. Commit the verified data contract.

### Task 2: Finder layout, lifecycle and Tasks toolbar integration

**Files:**
- Create: `desktop/work-os-companion/src/TaskFinder.tsx`, `desktop/work-os-companion/src/task-finder.css`, `desktop/work-os-companion/src/taskFinder.ts`, `desktop/work-os-companion/src/taskFinder.test.ts`, `desktop/work-os-companion/src/TaskFinder.render.test.ts`
- Modify: `desktop/work-os-companion/src/App.tsx`, `desktop/work-os-companion/src/TasksPreview.tsx`, `desktop/work-os-companion/src/main.tsx`, `desktop/work-os-companion/src/dashboard-overhaul.css`, `desktop/work-os-companion/src/visualizations.test.ts`, `test/work-os-desktop-static.test.mts`, `design.md`

**Interfaces:**
- Consume Task 1's query and filters.
- Produce `TaskFinder({ entry: "search" | "date", currentDate: string, onClose: () => void, onOpenTask: (task: TaskRow) => void })`; it owns local filters, 250ms debounced text and date disclosure. Opening starts All and empty text/range. Parent owns a stable originating trigger ref and the drawer handoff flag.
- Pure helpers in `taskFinder.ts`: `taskFinderDatePreset(preset: "today" | "this_week" | "last_week", currentDate: string): { from: string; to: string }`, plus validated date-range state; use calendar arithmetic, not local-midnight instant conversions.

- [ ] Write failing date-helper tests across Monday/Sunday, month/year/leap boundaries and future dates. Add rendered contract tests for All selection, five pills, labelled search/date inputs, loading/error/reset/load-more controls and icon toolbar placement outside SortHeaderRow.
- [ ] Run tests to prove failure, then implement pure helpers and the modal. Use semantic result buttons with title, project, letter-month date and existing status treatment; no completion or destructive controls in search results.
- [ ] Implement one 680px paper surface: 24px desktop inset, prominent search, wrapping pill row, inline expandable date presets/fields and removable date chip, bounded scrollable results with count and Load more. Feathered halo is a pointer-inert pseudo-element behind the crisp surface. Scope styles, respect text scaling, provide solid-backdrop fallback and reduced motion. Use the approved spec's small-window treatment.
- [ ] Integrate Search/Calendar/Plus in `TasksWorkspace` header; remove old inline search/date controls and Add task column action. Keep masthead day navigation and existing onOpenTask/onAddTask. Wire modal into App overlay ownership to suppress automatic guide opening and maintain existing modal focus/scroll behavior. Keep finder query independent of task page filters and historical tab state.
- [ ] Extend `TasksPreview` with real finder rendering and deterministic network fixture responses for normal, dense, empty, no-match and error states, using the real query component rather than a visual imitation. Update superseded design.md §§6.1/6.2 and relevant static guards.
- [ ] Run helper/render/static/query tests; exercise actual click and keyboard interactions including native dates, IME, dismissal, exact trigger restoration and selected-result-to-drawer focus. Commit.

### Task 3: Rendered acceptance and release bookkeeping

**Files:**
- Modify after verification: `desktop/work-os-companion/CHANGELOG.md`, `desktop/work-os-companion/release-queue.json`
- Maintain evidence/checkpoint in this plan and ledger task `84758657-f2b8-4e3d-bdb6-5b4a23c62e92`.

**Interfaces:** Consumes the real integrated finder. Produces evidence-backed delivery, not a packaging release.

- [ ] Verify screenshots and real wheel/keyboard actions at 1440×900, 1024×768, 720×900 and 390×844, 200% equivalent width, reduced motion and medium text. Inspect long titles, full pill/date rows, loading, no-match, error/retry, pagination, plus-to-creator and finder-to-drawer handoff. At a nested list edge, wheel must keep moving the intended reading surface without scrolling the page behind a modal.
- [ ] Add/run a reusable TestSprite frontend plan for Search→text/status/date→result→drawer, Calendar→range and Plus→creator, including keyboard dismissal. Load testsprite-verify skill first. Record actual terminal verdict; do not call a lint-only backend harness an executed integration.
- [ ] Run focused tests, `npm run work-os:typecheck`, companion `npm test` and `npm run build`, full `npm run work-os:test`, changed-file lint and CodeRabbit once for the completed batch. Fix valid findings, inspect diff and preserve other work. Security review targets migration authorization/cursor isolation.
- [ ] Append one release-queue outcome with actual verification and one plain Unreleased note; run `npm run companion:release:status`. Do not release below the threshold without operator authorization. Record any unapplied migration/API deployment as a delivery blocker rather than claiming the installed app changed.
- [ ] Update ledger and this checkpoint with commit, checks and next action; present status accurately and seek authorization if deployment/release is needed.

## Checkpoint

- Dedicated worktree: `/home/maigreeks/projects/.worktrees/employee-task-finder`, branch `codex/employee-task-finder`, base `215468da`.
- Read design.md completely, current companion changelog, recent main and shared-path Agent OS content diff.
- Baseline: `node --import tsx --test test/work-os-task-pagination.test.mts` — 5 passed, 0 failed (44 seconds).
- [x] Task 1 complete: `f6b25cf5`, validated all-task finder API, cursor scope, SQL and isolated query. Direct route/PGlite tests exercise validation and tenant isolation.
- [x] Task 2 complete: `45bbb0d9`, toolbar, finder, dates, focus/drawer handoff and responsive preview; `7b532123` fixes review findings around optimistic cache membership and mutable local/preview records.
- [ ] Task 3: final verification/bookkeeping. Companion 208 files / 1863 tests pass. Root typecheck passes. One full Work OS run passed 1311 tests / 1300 pass / 0 fail / 11 skipped before the final cache safeguards; post-review full rerun and build are running. Earlier build passed; concurrent final build hit a timeout while the full suite saturated CPU, so its fresh background run must finish before claiming final-build success.
- Visual evidence: `/tmp/opencode/finder-wide.png`, `finder-390.png`, `finder-toolbar-ready.png`, `finder-short-reduced.png`, `finder-medium-text.png`; Playwright checks in `finder-interactions2.log`, `finder-extra.log`, `finder-fixture-green2.log` cover text/status/dates, load-more and beyond-page matches, keyboard/backdrop/focus, IME, wheel, short viewport and creation. axe: 0 violations.
- TestSprite test `86fb1f04-4350-4257-b322-c817dd6dc9df`, run `5adad21a-e809-48f8-ac07-4a39d3bb9d7d`: passed interaction journey. Its trace asserted drawer presence; exact result/count/geometry were additionally checked directly rather than inferred from that generic assertion.
- Independent whole-branch review found no issues; CodeRabbit first returned five minor findings, four valid cache/preview findings fixed and regression-tested. Its focus suggestion would not change native close behavior; the stable-origin-to-drawer handoff is deliberately retained. CodeRabbit rerun: 0 findings.
- Release bookkeeping: one appended outcome `employee-unified-task-finder`; queue status 4 of 5 pending, no bump/release. Migration 0073 and server API remain unapplied/undeployed; installed WebView behavior is not established by browser fixtures. Request separate deployment/release authorization before external writes.
- Rulings: optional scope/source adapters isolate identity and supply real preview queries; native dialog owns inertness/focus with CSS imported by its component; cheap mutable local sources retire their cache on close rather than tracking revisions; native close briefly restores a stable origin before the drawer takes focus. Costs: adapter plumbing, Chromium dialog compatibility, one local read per reopen, transient toolbar focus respectively. No deferred minors.
- Self-review: implementation covers the approved unified finder; no client-only pagination filtering, new state vocabulary, page-filter mutation or separate modal for dates. The distinct finder SQL function must preserve existing callers and grants, tested before migration application.
