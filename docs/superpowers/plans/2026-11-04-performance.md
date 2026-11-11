# Work OS Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce unnecessary Work OS work across all report findings without removing behavior or truncating eligible records.
**Architecture:** Keep page data scoped to visible workspaces, shared services independently owned, and reads bounded before hydration. Separate persistence and notification lifecycles from rendering/history. Backend task and Overview workstreams are independent; the main agent owns desktop integration and whole-branch verification.
**Tech Stack:** Existing Next.js 16.2.6, React 19, TanStack Query 5, Tauri 2, Postgres compatibility query builder, node:test/Vitest.
**Spec:** User request and original `/home/maigreeks/projects/work-os/docs/performance-report.md`; canonical `design.md`.

## Global Constraints
No merge, deployment or desktop release. Preserve account/tenant fencing, historical attribution, exact counts, full pagination, Worktivity authority, workday side effects, voice/transcription/uploads, and existing UI. Compare shared sources against Agent OS per file. Transport mocks must execute real application logic; synthetic results are not native performance evidence.

## Review Focus
- Mapped admin returning from a heavy employee tab must disable hidden reads but preserve pending edits and live personal notices.
- In-flight cache writes on sign-out must never restore another account's snapshot.
- Eligible tasks beyond 2,500 unrelated organization rows must remain visible, with parent/subtask and historical ownership intact.
- Window loss/recreation must recover ownership without duplicate delivery or attendance transitions.
- Loaded recap history must remain contiguous and stable while notifications refresh.

### Task 1: Desktop page and persistence lifetimes (main agent)
Files: `desktop/work-os-companion/src/{App.tsx,workOsQueries.ts,queryClient.ts,useMascotRuntime.ts}`, adjacent tests.
- [ ] Write/run failing production-path regressions for admin cold boot/retained tabs, idle heartbeat saves/controller restarts, excluded cache updates and overlapping saves.
- [ ] Gate employee page hooks by workspace/tab; keep shared notifications and on-demand settings separate. Stabilize callback dependencies. Filter/coalesce/single-flight persisted changes.
- [ ] Rerun lifecycle regression matrix and record counts.

### Task 2: Employee backend day/Insights (bounded independent worker)
Files: `src/lib/work-os-{daily-workspace,day-view,insights}.ts`, directly necessary task/read context helpers, own tests.
- [ ] Reproduce broad candidate cap and oversized compact carry-over using production helpers/route with transport fixtures.
- [ ] Narrow candidates before hydration with no cap-based losses; bound compact collections while retaining counts/pagination; safely reuse request inputs.
- [ ] Measure equivalent fixtures, run attribution/pagination/day/Insights regressions, document backend port paths.

### Task 3: Admin Overview/readiness (bounded independent worker)
Files: `src/lib/work-os-{admin-overview,readiness-report,readiness}.ts`, relevant admin route/query/readiness invalidation files, own tests. Do not edit App/root desktop query files.
- [ ] Capture real assembly baseline reads and rows with fixture.
- [ ] Separate readiness refresh from minute operational refresh; SQL aggregates for full counts/series/completeness, consolidate equivalent reads.
- [ ] Test exact totals beyond detail caps, filtering, windows and corrections; record measured deltas.

### Task 4: Desktop pagination and shared runtime (main agent)
Files: desktop query/App/Avatar surfaces, monitoring ownership seam, native debugger module/config, `main.tsx`, admin workspace.
- [ ] Reproduce backlog drain and 3-page recap notification refetch, duplicated attendance/day ownership and eager build assets.
- [ ] Replace full backlog drain with explicit pages and counts; separate notification query/history. Implement cross-window ownership handoff/recovery using existing native/event seams; keep voice flags.
- [ ] Lazy-load window/admin roots with loading/error handling; create debugger on demand if current lifecycle supports it.
- [ ] Verify account/date changes, cancellation, notification invalidation, fallback/missing windows and build chunk graph.

### Task 5: Integration, review and handoff (main agent)
- [ ] Focused tests → `npm run work-os:typecheck` → `npm run work-os:test`; companion Vitest/build; `npm run build`; lint affected files.
- [ ] Render desktop/narrow and relevant loading/error/keyboard/reduced-motion states; TestSprite existing fixture verification. Document unavailable native/live evidence precisely.
- [ ] One CodeRabbit batch review and bounded independent review; fix valid findings and rerun affected checks.
- [ ] One append-only release outcome with actual verification reference and Unreleased note; status only.
- [ ] Commit/push scoped changes, open draft PR. Final handoff identifies exact tested implementation commit (report-only follow-up may name it), every finding disposition, commands, evidence and limitations.
