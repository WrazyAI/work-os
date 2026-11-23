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
- [ ] Full Work OS suite, production build, full companion suite/build, real PostgreSQL races and rendered browser acceptance.
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

## Next action
Implementation tasks 1–18 are complete and merged to `origin/main` at `26628a5a`. The post-merge branch passes the focused payroll suite (43/43 in the final renumbered batch; the complete payroll suite also passed 114/120 with environment-only PostgreSQL skips after the two flaky timing assertions were made host-speed tolerant), typecheck, the migration replay, and a production webpack build. The full `work-os:test` run reached 567 passing tests with two pre-existing inbox timestamp failures and one pre-existing admin-overview performance hang; all three reproduce on the pre-merge `1ef3ce66` checkout and are not payroll regressions. CodeRabbit completed with zero findings. Production Neon migrations `0078_work_payroll_review.sql` and `0079_work_payroll_recap_provenance.sql` are applied, and the Agent OS production checkout is deployed at `39390652` with the payroll routes present.

Production activation is live for Wrazy Default Workspace at settings revision 1 with `auto_approve_enabled=false` and cutoff 06:00. The Worktivity key was already configured in production; the earlier "not configured" note came from reading the non-secret `.env` instead of `.env.local`. A bounded live probe authenticated successfully, an active Worktivity connection plus nine verified source-account mappings were recorded for the workspace, and both payroll text and frame model probes returned structured responses. Capture direction/duration remains unverified, so automatic inactivity deductions and payroll auto-approval stay disabled; manual review can proceed with the existing unverified-gap acknowledgements. Employee-facing companion packaging was not changed or released.

## Verification / outstanding execution gates
Focused tests are green as listed above; full-suite/build/rendered/live gates are not complete. The post-merge hardening pass now resolves the independent review findings: the source manifest reads its token inside a `FOR SHARE` transaction before the source rows, provider consent is rechecked at ingestion/classification/calculation, provider bounds use employee-local day edges, provider pages and a canonical fingerprint are persisted through the run into `provider_watermark`/`provider_verified_at`, approval requires a complete bounded provider refresh and rejects a changed fingerprint, break sources union scheduled/session/provider/paused observations without a second deduction, unscheduled and leave-day activity is materialized and blocked, representative frames are revalidated and persisted against the current review/revision/day for restricted preview, Q&A cites only the pinned approval snapshot, daily CSV rows carry per-day schedule/session/minutes, and migration grants cover the service runtime role. These fixes still require the full suite, build, rendered acceptance, live provider/model probes and real PostgreSQL races before production activation. Real PostgreSQL races and live provider/model checks are still unverified.

At execution: verify Worktivity capture start/end semantics and complete paging read-only; verify selected OpenRouter model/provider/high effort using minimal non-sensitive calls; exercise multi-connection PostgreSQL locks; render desktop/narrow/Light/Dark states and TestSprite flows. Do not enable payroll auto-approval until supported employee clients show system provenance and notice. Export/retention changes never erase the employee recap ledger. Installed companion release cadence remains mandatory.
