# Payroll review design checkpoint

Ledger: d8ccca72-8b4e-41ea-885f-1cd0cb9ef6eb

Scope: approved design and Native inline implementation authorized. Local product code and focused tests are implemented; full-suite/build/review verification is in progress. No production mutation, approval/export, deployment, push/merge or packaging has been authorized.

## Checklist
- [x] Capture initial requirements and payroll rules in conversation.
- [x] Read Agent OS WORKTIVITY.md and verify the existing audit and Work OS evidence paths against code before architecture design.
- [x] Read Work OS design.md and requested Anthropic frontend guidance.
- [x] Create dedicated origin/main worktree and ledger.
- [x] Define visual direction and critique against brief.
- [x] Serve interactive illustrative mockup and verify current-width layout and interactions.
- [ ] Capture visual screenshots and inspect narrow rendering (desktop screenshot tool reports no visible tab).
- [x] Get user feedback on visual direction: structure approved; "fine, not premium"; design polish deferred.
- [x] Resolve policy and evidence access decisions: unpaid breaks, hours-only export, reviewed-source provenance and guarded image access; approved full spec controls.
- [x] Write full design.
- [x] Independent builder check.
- [x] GPT-6.1 Sol (medium) review.
- [x] Obtain approval: rounding, 30-day retention, and payroll recap auto-approval approved.
- [x] After approval only: write implementation plan.
- [x] Main-agent planning self-review: spec coverage, steps, shared types/signatures, five risk classes and document proportion.
- [x] User reviews plan and chooses Native inline execution before implementation.
- [x] Implement all 19 plan tasks locally with focused RED/GREEN evidence; full-suite/build/review gates in progress.
- [ ] Real PostgreSQL races, rendered browser acceptance and full companion packaging; full Work OS suite, typecheck, payroll suite and production build pass.
- [ ] Independent whole-surface review and any Critical/Important fixes.
- [ ] Authorized rollout: migrations, provider/model probe, cron enablement, pilot activation, deployment.

## Confirmed requirements
Admin only; Work OS is the export source, no Worktivity payroll writes. Distinguish tracked, recommended and approved hours. Work OS screenshots/recaps/intervals primary; Worktivity attendance, app usage and productivity signals supplementary. Productivity is not authoritative pay evidence.

Payroll paid on 1st covers previous 16th–month end; paid on 16th covers 1st–15th. Week 1 = first seven days; Week 2 = remainder, exact dates visible. Each needs a concise detailed recap-based progress brief and its own evidence.

Exclude pre-shift activity and activity beyond scheduled end + 60 minutes; recorded work up to +60 minutes is eligible. Continuous 0% activity >=3 minutes excludes the whole run, except work-related meetings, training and reading count as payable. Ambiguous cases require review. Human approval only.

Breaks are unpaid and excluded as their own period; a recorded break is never also counted as a separate inactivity deduction. Missing activity data is never assumed to be zero. No schedule blocks approval. Approval snapshots the period and later evidence requires an explicit audited reopen. Export is hours-only CSV plus printable summary. Raw screenshots use flagged/disputed access with a recorded reason.

Models: OpenRouter only. Default payroll synthesis/briefs/Q&A DeepSeek V4.1 Flash at high reasoning effort; default frame classification GPT-6 Luna. Either can be overridden through the payroll model variables. No Codex CLI. Work OS already has legacy `audit_profiles`/`audit_runs` and `worktivityAudit.ts` copied from Agent OS; do not revive them (per-user, UTC, Codex-oriented). Reuse only timezone-neutral provider helpers.

Full design: `docs/superpowers/specs/2026-11-16-work-os-payroll-review-design.md`.

Final owner decisions: rounding approved (exact duration, whole-day largest remainder, half-up, payable-first ties). Retention approved as 30 days after the later of pay date, approval, or first export; raw screenshots keep their existing expiry; the exported CSV/print is the durable record. Pending recaps are auto-approved for payroll on the pay date (default 06:00 employee-local) with `payroll_auto` provenance, never employee confirmation; a missed cron is covered by the on-demand ensure. The auto-approval is an hourly `CRON_SECRET` route and records a new immutable `work_recap_reviews` version; it does not generate next steps or check-ins. Employee recap surfaces show the auto-approval notice and provenance.

## Visual direction
Use existing Work OS roles: canvas #eef1eb, raised #ffffff, ink #182018, muted #62685f, observed #2e617d, warning text #805611; signal #a8f15b reserved for the forward action. Local Segoe UI/system sans with tabular time readings; no remote font requests.

One employee/period context row, then a reconciled hours ledger rather than interchangeable KPI cards. Left-aligned label/content sections for period reconciliation, two week briefs, per-day evidence and app usage. Day detail is a focused review dialog; follow-up questions live beside cited evidence rather than a generic chatbot hero.

Composition: navigation | employee + period / hours reconciliation / Week 1 + Week 2 briefs / daily record + app context. Narrow: sections stack, navigation becomes compact, daily rows retain date and hours.

Critique: removed generic donut/KPI-tile dashboard and decorative confidence scores. The distinctive instrument is a transparent tracked-to-recommended reconciliation, with uncertain minutes separate and unapproved state explicit. Existing Work OS palette overrides the reference's suggestion to invent a new brand.

> 2026-11-26: This next-action record is historical. See the functional pass at the end of this file.

## Next action
Implementation tasks 1–18 are complete and merged to `origin/main` at `135204e2`. Final verification: full `work-os:test` **1,419 passed / 0 failed / 11 opt-in PostgreSQL skips**, including the previously flaky inbox and admin-overview performance tests; the payroll post-suite **117 passed / 0 failed / 5 opt-in PostgreSQL skips**; typecheck and production webpack builds pass; migration replay passes with `0078`–`0081`. CodeRabbit completed with zero findings. Production Neon migrations `0078_work_payroll_review.sql`, `0079_work_payroll_recap_provenance.sql`, `0080_work_payroll_mapping_inheritance.sql`, and `0081_work_payroll_source_token_scope.sql` are applied. The Agent OS production checkout is deployed at `6144c100` with the payroll routes present.

Production activation is live for Wrazy Default Workspace at settings revision 2 with `auto_approve_enabled=true` and cutoff 06:00. The Worktivity key was already configured in production; the earlier "not configured" note came from reading the non-secret `.env` instead of `.env.local`. A bounded live probe authenticated successfully, an active Worktivity connection plus verified source-account mappings were recorded for the workspace, and both payroll text and frame model probes returned structured responses. Kalia Bell was added to the verified mappings; a person-level trigger now creates/refreshes a verified Worktivity source account whenever a future employee receives a Worktivity employee id. Capture semantics are now verified against paired live samples: Status 0/4 rows carry the exact ClockIn/ClockOut instant, and consecutive Status 1 rows are end-stamped one-minute intervals (provider changelog: activity within the preceding 60 seconds). Automatic inactivity deductions use explicit non-work evidence. A real production analysis for David Z published 3,596 recorded / 3,315 recommended minutes. Approval is correctly blocked by 16 pending employee recaps and 140 review findings: 4 schedule corrections, 48 activity-during-break decisions, 80 unverified-gap acknowledgements, 4 low-evidence acknowledgements, 4 break-mismatch acknowledgements, and 4 inactivity decisions. The review is live at `/work-os/admin/payroll/8772f360-f816-4914-9b99-849bdc573cb5` and requires human evidence decisions; the payroll worker did not approve around them. Auto-approval was enabled after capture semantics and model probes passed; the hourly Work OS workflow was dispatched successfully. Employee-facing payroll notices were removed; only the onboarding policy now states that sampled screenshots/recaps may be used to prepare payroll hours for administrator review. Source tokens no longer bump on unrelated evidence/report/provider organization writes.

## Verification / outstanding execution gates
Focused tests, full suite, migration replay, builds, live provider/model probes, cron dispatch and pilot activation are complete. Rendered browser/TestSprite acceptance and real multi-connection PostgreSQL races remain. The post-merge hardening pass now resolves the independent review findings: the source manifest reads its token inside a `FOR SHARE` transaction before the source rows, provider consent is rechecked at ingestion/classification/calculation, provider bounds use employee-local day edges, provider pages and a canonical fingerprint are persisted through the run into `provider_watermark`/`provider_verified_at`, approval requires a complete bounded provider refresh and rejects a changed fingerprint, break sources union scheduled/session/provider/paused observations without a second deduction, unscheduled and leave-day activity is materialized and blocked, representative frames are revalidated and persisted against the current review/revision/day for restricted preview, Q&A cites only the pinned approval snapshot, daily CSV rows carry per-day schedule/session/minutes, and migration grants cover the service runtime role. These fixes now pass the full suite, build, live provider/model probes and production activation. Real multi-connection PostgreSQL races and rendered browser acceptance remain the only verification gaps.

At execution: verify Worktivity capture start/end semantics and complete paging read-only; verify selected OpenRouter model/provider/high effort using minimal non-sensitive calls; exercise multi-connection PostgreSQL locks; render desktop/narrow/Light/Dark states and TestSprite flows. Do not enable payroll auto-approval until supported employee clients show system provenance and notice. Export/retention changes never erase the employee recap ledger. Installed companion release cadence remains mandatory.

## 2026-11-26 functional pass

Commit `c2201ad2` makes the review usable rather than observational:

- **Root cause of missing frames:** every `work_screenshot_summaries.person_id`
  was null, so the payroll source query, guarded preview and vision checks could
  never match a review. `0085_work_payroll_screenshot_person_scope.sql`
  backfills from the evidence event and keeps the owner consistent on write;
  screenshot analysis writes now include the person explicitly. Live evidence
  has 571 processed, unexpired frames across the Nov 1–15 period.
- **Analysis windows:** `0086_work_payroll_analysis_windows.sql` adds a derived
  `window_key` and replaces the fixed-period uniqueness/checks. Runs and reads
  use the stored `period_start`/`period_end`; the pay date remains the anchor.
  The workspace defaults to the current window through today (Nov 16–26, pay
  date Dec 1 on the live date), prior pay dates stay selectable, and any 1–31
  day window ending today or earlier can be analyzed. Partial/current windows
  are analysis-only; approval requires the ended standard period, enforced in
  the server transaction as well as the UI.
- **Immediate analysis:** start schedules a bounded drain via `after()`, the run
  endpoint and admin poll drain in bounded batches, and the five-minute cron
  resumes long runs. A provider page that cannot advance fails honestly instead
  of looping. A failed re-analysis leaves the last published revision reviewable
  and approvable when its source token is unchanged. Cancellation fences
  publication by locking the run row before the final transaction; a finished
  run cannot be cancelled over its receipt.
- **Actions and evidence:** attention findings expose Keep payable/Exclude/
  Acknowledge whenever the published revision is mutable (including after a
  failed re-analysis), excluded inactivity exposes guarded frames, breaks stay
  “No frames by policy,” and missing/policy-denied frames are distinct. The
  lower report now reads Hours → Needs attention → Excluded by rule → Evidence
  frames → Daily evidence → Weekly briefs → Apps (context only).
- **Companion parity:** window-aware candidate rosters and request identities,
  the same action availability, cancel, guarded frames, and the reordered
  surface. Release queue: one pending outcome; not eligible for a release.

Verification:

- Payroll suite: **145 tests / 140 passed / 0 failed / 5 opt-in PostgreSQL
  skips**. Typecheck, web production build, Companion build and Companion suite
  **247 files / 2,152 tests** pass. The preview harness rendered at 1558px and
  375px with actionable findings, frame buttons, the partial-window default,
  and the reordered surface.
- Final full Work OS suite: **1,696 tests / 1,680 passed / 0 failed / 16
  opt-in PostgreSQL skips**. Work OS PR **#233** carries the batch.
- CodeRabbit review completed with 14 findings. Fixed: window-aware candidate
  rosters and request keys, unmatched review IDs, explicit custom windows with
  no stored review, missing-vs-policy frame labels, cancel/publication fencing,
  failed-run copy, and a single-day run test. Refuted with evidence: the 0085
  backfill for historical frame ownership, two-week coverage for 1–31 day
  windows, and the server partial-window approval guard.

Pending production gates: apply `0085`/`0086`, deploy the code, reset the
in-flight revision 8 to `activity` (or cancel and re-analyze) so it rebuilds
its manifest with the newly linked frames, and verify a signed-in finding,
frame, immediate run, partial window and prior window.
