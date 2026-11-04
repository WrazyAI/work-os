# Admin Otto redesign implementation checkpoint

Approved in conversation: redesign every admin tool surface using the employee chat language and Beautiful UI reference; reliable confirmations; bounded multi-step requests; New chat discards the previous conversation. Mockup accepted as direction, not finished design.

Ledger: `1e70b015-5f62-4c6f-aca0-09834a93372e` under `da51dad4-119f-43f9-95a1-212615fc9211`. New chat requirement: `3ea8f69e-4738-4adb-b177-40d44875800a`.
Workspace: `/home/maigreeks/projects/.worktrees/admin-otto-redesign`, branch `codex/admin-otto-redesign`, base `ecb61fdc`.

## Constraints and rulings

- Execute inline; independent security/data-integrity review once the completed batch is ready. No push, merge, deployment or installer publication without the applicable gates/authorization.
- Preserve dirty `otto-admin-actions` worktree and all other agents' changes. Build on latest main; inspect overlapping work by content, never reset it or bulk-copy it.
- Shared server paths compared with `agentos/main`: no differences in current Otto/action paths at start.
- Existing model configuration and authorized services remain authoritative. Only explicit administrator confirmation executes stored writes. No EOD approvals, messaging, impersonation, or private employee chat.
- All actions are user/organization scoped. New chat cannot undo recorded work, revoke already-authorized in-flight writes, or silently approve later steps. It abandons old unconfirmed approvals and prevents old context from returning.
- Interpret multiple intentions as a bounded typed plan, not unconstrained model execution. Reads execute through current typed readers. Dependent changes wait for persisted prerequisites and a fresh review; never guess a task ID or apply changed consequences without approval.
- Existing employee tool visuals stay compatible. Adapt reference layout/behavior into Work OS tokens; no reference demo loops, external fonts, or whole-folder copies.

## Task 1 — Confirmation reliability

Files: admin action service, session confirm route, preview store, local task idempotency, focused tests.
- [ ] Reproduce session task-create failure with a regression test: literal `otto` must never enter UUID token fields.
- [ ] Provide session actor attribution and preview-scoped idempotent creates without fake token rows; preserve API token behavior.
- [ ] Expose authorized preview status and meaningful failure classifications; unknown outcomes reconcile before retry.
- [ ] Verify create/assign/complete/reopen plus replay, cross-user denial and failures.

## Task 2 — Durable conversations and New chat

Files: chat service/source references, additive migration only if needed, chat entry/API, App and chat header.
- [ ] Persist preview references, reload actual server status, and retain receipts across reopen.
- [ ] Add discard endpoint that fences stale thread replies and abandons unconfirmed previews under current ownership.
- [ ] Visible New chat button clears draft/turns/results, aborts old reads/sends/voice, updates parent identity and both applicable surfaces, restores composer focus.
- [ ] Test reset during loading/send, failed discard, stale completions, pending approval, same-user foreign organization and cross-window restore.

## Task 3 — Bounded multiple intentions

Files: intent contract/schema/prompt, chat orchestration, durable step references, tests.
- [ ] Schema/validator permits at most 8 ordered read/action steps; legacy single responses remain readable.
- [ ] Preserve per-step resolution and failure; execute multiple reads without broadening target rules.
- [ ] Prepare independent action previews together; keep dependent steps blocked until prerequisites are recorded and reviewed.
- [ ] Request replay must restore the same previews, not create fresh duplicates.
- [ ] Tests: two creates, mixed reads/writes, multiple reads, dependency failure, malformed/excess steps and model-invented people/IDs.

## Task 4 — Complete tool surface family

Files: shared admin view models and dedicated result/action components, CSS, fixtures and render/interaction tests.
- [ ] Inventory tasks, records/reports/EODs, recaps, workdays, people resolution, progress, changes and receipts; explicit renderer for each available tool result.
- [ ] Human labels and authorized display names; omit unchanged/null-only fields; creation is a task summary, update is meaningful differences.
- [ ] Group independent proposals, show selection/count, explicit approval, per-item outcomes and retry only safe failed work.
- [ ] Expired/stale/unknown/denied/evidence-required/empty/loading/dense/error states with preserved context and actionable recovery.
- [ ] Read pagination, proper person/source/date labels, safe record links, narrow layouts, focus and reduced motion.

## Task 5 — Acceptance and review

- [ ] Focused server and companion tests, typechecks, lint and builds.
- [ ] Full `npm run work-os:test` before any merge/deploy; distinguish opt-in PostgreSQL skips.
- [ ] Rendered wide/narrow/light/dark/keyboard/reduced-motion checks and TestSprite with reusable fixtures.
- [ ] Independent bounded security/data/state review and one CodeRabbit batch pass; resolve valid findings.
- [ ] Plain-language Unreleased note and append-only release-queue outcome with actual evidence; run release status, no automatic version bump below threshold.
- [ ] Record verification and next deployment/release steps honestly. No live write probes until resolved host and authorization are verified.

## Evidence and next action

- Latest main baseline: `ecb61fdc`. Dependencies linked from canonical checkout, no installation.
- Root-cause trace: session confirm passes `tokenId: "otto"`; create action forwards it to `createWorkOsEmployeeTask`, which writes `agent_token_id uuid`. Prior live verification exercised assignment, not session creation.
- Existing entry controller has reset/late-response protection but header has no New chat control; server thread reload omits pending actions.
- Next: write failing confirmation-create regression and establish focused baseline before implementation.

## Execution log

- Task 1 complete: failing session-create regression RED→GREEN; actor token nullable; real service reconciles preview key before retry and after any throw; additive UUID-safe session index migration. Focused action suite 37/37.
- Task 2 complete (server/controller): durable preview references reload authoritative status; DELETE discards thread, request fences, workflow previews and legacy single previews; request-only reset resolves late-committed first thread inside same transaction; controller `newChat` clears only after durable discard; header New chat icon/button plus App/Preview wiring. Chat service discard tests and controller tests pass.
- Task 3 complete (server): strict max-8 ordered steps, backward-compatible legacy response, multi-read/multi-write workflow with stored references and per-step failure isolation; dependency only accepts a recorded server task ID and produces a new preview; concurrent prepare CAS and refresh-vs-claim race guarded. Workflows 5/5, validator 8/8.
- Task 4 integrated: dedicated read cards, grouped action batch, workflow card, human labels/no IDs/unchanged diffs, selection and partial receipts, unknown/stale/expired/in-flight recovery, narrow/dark/focus/reduced motion styles. Admin companion folder 252/252.
- Independent review: 4 Important found; stale-state apply fixed, late-committed first-thread discard fixed, refresh/claim replacement guarded, uncertain-create reconciliation added; retention function added. Minor retention noted and partially addressed; no further minors deferred yet.
- Full Work OS suite in background; server + desktop typechecks running after integration.
- Next: inspect actual outputs/typecheck, render real cards through Vite preview (wide/narrow/dark), run TestSprite, then full gate/review and record verification. No deployment/push/release yet.

## Verification log

- Focused server suites: admin actions 37, Otto intent 8, workflows 5, confirm route 2, all passed.
- Admin companion: `src/adminOtto` + `src/admin` = 41 files / 314 tests passed after integration; root typecheck and companion typecheck clean at that point.
- Rendered browser QA (Playwright against Vite `?preview-admin&otto=cards`): wide 1440 and narrow 449; two creates grouped, selection updates from 2 to 1, per-item recorded receipt, no raw IDs/unchanged fields, New chat clears old cards and returns welcome; no page errors or horizontal overflow. Read-only task card checked at 1280. Screenshots: `/tmp/opencode/admin-otto-cards-wide-v3.png`, `...-narrow-v3.png`, `admin-otto-read-v3.png`.
- UI polish after screenshots: removed repeated per-row action labels and pending receipts, changed footer to selection count, shortened header subtitle, fixed New chat header geometry.
- Rebased onto `7dbb8be4` (0.5.21/0.5.22 line) after upstream moved; resolved `AdminPreview` state conflict. Re-ran typechecks and 319 admin companion tests; re-ran Playwright checks.
- Sidebar New chat now awaits the same durable discard as the sheet header; a failed discard preserves the old chat and shows an error instead of claiming a fresh one.
- Release queue: added `admin-otto-multi-step-tool-cards` (pending 2/5 after 0.5.22 published), with plain-language Unreleased notes. No version bump or packaging.
- Final rebase `80701bff`; full Work OS gate: 1,274 tests, 1,263 passed, 0 failed, 11 opt-in PostgreSQL skips. Typechecks and production build passed; admin companion 319 tests passed. Full companion suite running before merge.

- Full suite first run exposed 11 failures only in `test/work-os-admin-action-previews.test.mts`: all `preview_expired` because the test's 60-second expiry elapsed under the loaded suite. Focused run passes fast. This is a test-clock fragility, not an apply failure; the explicit expiry test remains. Adjust the non-expiry fixture to a ten-minute window before rerunning.
- `companion:release:status` currently fails because origin moved to 0.5.21 while this branch is based on 0.5.20; rebase onto latest main before queueing the outcome, then rerun status.
