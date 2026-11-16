# Payroll review design checkpoint

Ledger: d8ccca72-8b4e-41ea-885f-1cd0cb9ef6eb

Scope: visual brainstorming only. No product code, payroll approval, export, or deployment authorized yet.

## Checklist
- [x] Capture initial requirements and payroll rules in conversation.
- [x] Read Agent OS WORKTIVITY.md (historical implementation account; code verification still needed before architecture design).
- [x] Read Work OS design.md and requested Anthropic frontend guidance.
- [x] Create dedicated origin/main worktree and ledger.
- [x] Define visual direction and critique against brief.
- [x] Serve interactive illustrative mockup and verify current-width layout and interactions.
- [ ] Capture visual screenshots and inspect narrow rendering (desktop screenshot tool reports no visible tab).
- [x] Get user feedback on visual direction: structure approved; "fine, not premium"; design polish deferred.
- [x] Resolve remaining policy and evidence access questions: breaks unpaid; other defaults pending doc review.
- [x] Write full design.
- [x] Independent builder check.
- [x] GPT-6.1 Sol (medium) review.
- [x] Obtain approval: rounding, 30-day retention, and payroll recap auto-approval approved.
- [ ] After approval only: write implementation plan.

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
Await user feedback on the first illustrative payroll mockup.

Preview: `.superpowers/brainstorm/117148-1794847490/content/payroll-review.html`.
Server port 51957; keyed connection details in that session's `state/server-info` (do not commit session keys).
Browser tab: tab_736ef65a-880a-4245-8e11-f4e008934f4b.
Browser accessibility snapshot confirms page loaded. At current 1000px viewport, document content width 985px (no horizontal overflow). Review dialog opens/closes and sample question renders its explicitly labelled sample answer. Screenshot capture blocked by browser visibility even after focus. Attempted iframe-based responsive check was unavailable (null frame document); temporary iframe removed. No claim of complete visual/responsive acceptance.

## Open questions for later
Paid breaks; missing activity samples versus confirmed zero; schedule exceptions/no schedule/overnight cutoff attribution; payroll timezone; permission to expand raw admin screenshot access beyond currently flagged/disputed evidence; approval revision/invalidation policy; currency/pay rates versus hours-only export; analysis timing and reruns.
