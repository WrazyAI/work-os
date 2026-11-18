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
- Full companion suite after the PR review fixes: **2,008 passed, 0 failed**
  (226 files, two workers). An earlier unbounded
  attempt timed out two existing vault-persistence tests at five seconds under
  host load; the same tests pass in the bounded run.
- Companion production build after rebase: `tsc --noEmit && vite build`
  completed.
- Web production build with the documented Webpack fallback completed; the
  default Turbopack path cannot follow the cross-worktree dependency symlink.
- Work OS typecheck and full suite after the PR review fixes: **1,399 passed,
  0 failed, 11 skipped** (1,410 tests). The 11 skipped tests are the opt-in
  PostgreSQL suites, which require a disposable database and were not enabled.
  An earlier full attempt had one native V8/WASM crash; the isolated suite
  passed all 12 tests.
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

## Pull request review (PR #178)

CI passed (site tests, production build, companion, Rust, release policy,
CodeQL) and CodeRabbit completed a fresh review of the rebased branch.

| Finding | Disposition and regression evidence |
| --- | --- |
| Previous account's session can still supply the recap scope during sign-in | Fixed: a new sign-in removes the session and latest-recap query data before the session read; covered by “drops the previous account's session and recap scope on a new sign-in.” |
| Delivery CAS rounds stored instants to milliseconds | Fixed: compared session instants travel with exact stored text; covered by “delivery CAS keeps the stored microsecond precision of session instants” (observed RED, then GREEN). |
| Failed synthesis can demote a recap another worker published | Fixed: the failure UPDATE repeats the attempt ownership, review and generation conditions and reloads the winner without a failure audit; covered by “a failed synthesis cannot demote a recap another worker published” (observed RED, then GREEN). |
| Re-sign-in leaves the recap watermark, so the card cannot return | Fixed: the session-change handler retires the watermark and account marker with the card; covered by the account-boundary source check. |
| Person boundary leaves next-step playback running | Fixed: the account reset stops next-step playback too; covered by the account-boundary source check. |
| Delivery failure after generation loses coverage | Fixed: the scheduler records `delivery_failed` and returns the earned counters; covered by “a delivery failure after generation keeps its coverage” (observed RED, then GREEN). |
| Overdue empty row can be recovered between inspection and delivery | Deferred: closing this atomically needs the session update and the interval state in one database transaction or a new SQL function. The race needs a concurrent recovery in the seconds between inspection and delivery, the recovery path already refuses processed or reviewed rows, and the employee still receives the one prompt the inspection allowed. The current code does not claim atomic protection it lacks; the cost of deferring is a rare late recap for an already-notified slot. |

## Acceptance and rollout limits

TestSprite run `a15daf21-e993-449c-8cf3-d6f1520fe9fc` was refused before
execution with `FEATURE_GATED` / `billing_hold`. No billing changes were made.
Default Turbopack rejects the cross-worktree dependency symlink; the isolated
Webpack build completed without changing production configuration.

No push, merge, deployment, installer release or production fixture mutation
has been performed. Closed-companion/provider/timer acceptance in
`docs/work-os-recap-operations.md` requires an authorized controlled fixture.
Local regression and rendered evidence do not replace that acceptance.
