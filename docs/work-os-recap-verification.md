# Recap reliability verification

Implementation (rebased onto `origin/main`): `3c02d690`, `d7a8e118`, `f3d34681`,
`4f82a923`. Review fixes: `7639811a`; operational contract: `abe708d3`.
Tracking task: `30f3e792-1975-474d-b6ec-5d96542b03c7`.

## Observed checks

- Backend focused regression suite: **110 passed, 0 failed** (`node --import
  tsx --test test/work-os-workday.test.mts
  test/work-os-activity-intervals.test.mts
  test/work-os-activity-recap-schedule.test.mts
  test/work-os-route-contracts.test.mts`).
- Final client scope/delivery regressions: **37 passed, 0 failed**
  (`npm --prefix desktop/work-os-companion test --
  src/workOsQueries.test.ts src/notificationsLogic.test.ts
  src/recapNotificationQuery.test.ts --maxWorkers=1`).
- Work OS typecheck completed successfully before the final full-suite run.
- Changed-file ESLint: **0 errors, 75 warnings**.
- Six rendered fixtures: desktop and narrow main window, ready recap, pending
  queue, preparing and empty mascot. No page errors or horizontal overflow;
  keyboard-focused “View recaps” opened the recap queue.
- Full companion suite after rebasing onto the guide split-view change:
  **2,005 passed, 0 failed** (225 files, two workers). An earlier unbounded
  attempt timed out two existing vault-persistence tests at five seconds under
  host load; the same tests pass in the bounded run.
- Companion production build after rebase: `tsc --noEmit && vite build`
  completed.
- Web production build with the documented Webpack fallback completed; the
  default Turbopack path cannot follow the cross-worktree dependency symlink.
- Work OS typecheck and full suite: **1,396 passed, 0 failed, 11 skipped**
  (1,407 tests). The 11 skipped tests are the opt-in PostgreSQL suites, which
  require a disposable database and were not enabled. An earlier full attempt
  had one native V8/WASM crash; the isolated suite passed all 12 tests.
- Companion release queue now carries this pending outcome alongside the
  guide split-view entry; the published version remains 0.5.36, so three more
  verified outcomes are needed before a companion release.

## Review disposition

One independent review and one completed CodeRabbit batch were used.
The independent findings overlap the account-state and overdue-recovery rows.

| Finding | Disposition and regression evidence |
| --- | --- |
| Retained previous account's recap | Fixed: scoped pending recap, account-bound reset and playback stop. |
| Avatar scope lags same-organization account switch | Fixed: authoritative response identity checked before cache admission. |
| Old nudge can deliver a new due slot | Fixed: delivery receipt must match the original nudge's due instant. |
| Awaiting evidence has no retry on unchanged day facts | No new timer: existing five-minute server job retries; latest polling surfaces the ready result. Live timer acceptance remains pending. |
| Database timestamp loses microseconds | Fixed: exact timestamp text used for attempt ownership; database-backed retry regression. |
| Terminal-empty shortcut bypasses overdue recovery | Fixed: eligible empty intervals reach bounded recovery guards. |
| Plan confirmation discards a pending frozen window | Fixed: “an existing awaiting slot keeps its frozen window after plan confirmation.” |
| Stale ready response advances a preparing replacement | Fixed: “a stale ready response cannot authorize a preparing replacement row.” |
| Transport timeout sends unbound delivery | Fixed: null result refuses delivery; covered by client delivery regression. |
| Latest response admitted under another person's key | Fixed: same-organization switch and same-person refresh query regressions. |
| Ready row visible before evidence/audit commit | Fixed: “readiness is published atomically with evidence and its system audit,” including rollback on persistence failure. |
| Terminal outcome suffers a second scheduler backoff | Existing terminal fast path retained, with overdue-recovery exception; focused backend suite passes. |
| Legacy route drops inspected slot | Refuted by route handoff: `deliverWorkdayPrompt(auth.access, at, inspected.slot)` retains the inspected receipt. |
| Correction races delivery CAS | Fixed: correction status participates in “expected recap delivery uses a session-scoped database CAS.” |

## Acceptance and rollout limits

TestSprite run `a15daf21-e993-449c-8cf3-d6f1520fe9fc` was refused before
execution with `FEATURE_GATED` / `billing_hold`. No billing changes were made.
Default Turbopack rejects the cross-worktree dependency symlink; the isolated
Webpack build completed without changing production configuration.

No push, merge, deployment, installer release or production fixture mutation
has been performed. Closed-companion/provider/timer acceptance in
`docs/work-os-recap-operations.md` requires an authorized controlled fixture.
Local regression and rendered evidence do not replace that acceptance.
