# Phase 4 Prompt — Manager Review, Governance, and Pilot Hardening

You are implementing Phase 4 of the Work OS desktop companion pilot in `/home/maigreeks/projects/work-os`. Phases 1–3 must already provide a reliable work session, task-led daily intent, role-aware check-ins, employee-facing EOD Review reconciliation, Nifty task proposals, and explainable evidence.

The pilot remains scoped to David as a software engineer. This phase closes the daily loop and makes the pilot safe and operable; it does not expand to additional roles.

Follow the repository `AGENTS.md`, preserve all unrelated changes, create/reuse the Nifty ledger task before work, and use only the absolute WSL toolchain. Read the existing EOD/report/version/review routes and migrations before changing them.

## Objective

Extend the employee-controlled EOD Review from Phase 2 with immutable submission, authorized manager review, governance, and pilot hardening. Do not create a parallel EOD model or replace Phase 2's deterministic planned-versus-actual reconciliation. Enrich that shared record with approved evidence, review history, and unresolved uncertainty.

## Deliverables

### 1. Final-shift interaction hardening

At 5–10 minutes before scheduled shift end:

- Suppress ordinary progress prompts.
- Present the EOD interaction with text and voice options.
- Summarize the accepted daily workspace and known task state.
- Ask targeted questions only for missing outcomes, blockers, and unverified claims.
- Allow “extend shift,” “submit after clock-out,” and “clock out now.”

Do not auto-submit a report because the shift ended. Preserve a recoverable draft if the app closes.

### 2. Evidence-backed EOD enrichment

Enrich the Phase 2 reconciliation record with clearly separated sections:

- Accepted morning work.
- Completed outcomes.
- Progress on open work.
- Unplanned work.
- Blockers and external dependencies.
- Output evidence.
- Agent-verification conclusions and their source provenance.
- Activity context.
- Self-reported or insufficiently verified claims.
- Carry-over recommendations for the next workday.

Every material statement must link to its claim, task, or evidence source. Never silently convert a partial or uncertain conclusion into “completed.” Preserve Phase 2's reconciliation categories and the employee's submitted version immutably.

### 3. Nifty reconciliation

Before submission, show proposed Nifty operations grouped by task:

- Create task.
- Log progress.
- Add/resolve blocker.
- Link evidence.
- Complete task.
- Carry task to tomorrow.

Deduplicate, show before/after state, and require employee approval per operation or approved batch. Apply idempotently, surface provider failures, and preserve retry state. The report may be submitted with unresolved Nifty failures, but the report must disclose them.

### 4. Employee submission and manager review

Support:

- Employee edit and preview.
- Immutable employee submission snapshot.
- Manager review of only their assigned employee/team.
- Manager comments without rewriting the employee's original statement.
- Approve, reject with reason, or request clarification.
- Employee correction and resubmission.
- Version history and audit log.

The manager view should emphasize outcomes, blockers needing intervention, evidence confidence, and missing dependencies. Do not expose raw screenshots by default or present activity rankings.

### 5. Next-day continuity

After EOD submission or clock-out, create a proposed next-day carry-over set from incomplete tasks and explicit follow-ups. On the next clock-in, David must review it rather than having the system silently assign work.

### 6. Privacy, governance, and observability

Complete operational controls for:

- Consent withdrawal stopping future processing.
- Data export and correction.
- Evidence access logs.
- Raw audio deletion.
- Screenshot retention/deletion when enabled.
- Provider credential rotation.
- Webhook replay monitoring.
- Failed proposal and stale-evidence queues.
- Audit events for every employee/manager/provider transition.
- User-visible provider freshness and degradation.

Do not log secrets, transcripts, raw screenshots, or provider payloads into general application logs.

### 7. Pilot readiness and release

Run the strict Work OS readiness audit and close all blockers for the enabled feature flags. Build and test the Windows installer/portable artifact, updater flow, rollback path, autostart behavior, crash recovery, offline reconciliation, and no-console launch.

Use staged rollout:

1. Local development acceptance.
2. David-only signed pilot.
3. One complete workweek of observed use.
4. Review evidence quality, interruption rate, report-edit rate, failures, and privacy issues before considering another role or employee.

### 8. Pilot metrics

Measure system quality—not employee productivity:

- Plan completion capture rate.
- Prompt response and snooze rate.
- Notification interruption count.
- Voice transcript correction rate.
- Proposal acceptance/edit/rejection rate.
- Evidence abstention and dispute rate.
- EOD draft edit distance.
- Time from EOD prompt to submission.
- Nifty write failure/retry rate.
- Provider freshness and webhook failures.

Define go/no-go thresholds before expanding the pilot. Do not create a single productivity score.

## Verification

Automate tests for final-hour transition, EOD draft idempotency, immutable employee snapshots, manager/team RLS, report versioning, proposal retries, carry-over, consent withdrawal, retention deletion, provider degradation, and audit completeness.

Perform a real end-to-end pilot day for David:

```text
onboarding -> clock in -> plan -> updates -> evidence -> EOD voice/text
-> report edit -> Nifty approval -> submit -> manager review -> next-day carry-over
```

Record exact user-visible evidence for each transition. A successful subprocess, webhook response, or installer launch is not sufficient by itself.

## Definition of done

Phase 4 is complete only when:

1. David completes one full workday through the installed desktop app.
2. The EOD prompt arrives in the configured 5–10 minute window without an ordinary final-hour prompt.
3. The draft distinguishes employee claims, source evidence, Codex verifier conclusions, optional activity context, and uncertainty.
4. David edits/approves the report and each Nifty operation before submission.
5. Nifty changes are idempotent and provider failures remain visible/retryable.
6. The immutable employee report and manager review version are both preserved.
7. The manager can access only the authorized report and evidence scope.
8. Consent withdrawal, retention, correction, and audit flows are verified.
9. Signed Windows artifacts install, update, relaunch, and roll back without a terminal popup.
10. A one-week David-only pilot produces an evidence-backed go/no-go review for expansion.

## Needed to proceed that is not already available in `.env.local`

The following production/runtime secrets are not currently present:

- `CRON_SECRET` when automated evidence retention deletion is enabled.
- `WORK_OS_SCREENSHOT_ENCRYPTION_KEY` when screenshot summaries are enabled.
- `WORK_OS_GITHUB_WEBHOOK_SECRET` for GitHub evidence if Phase 3 has not already configured it.
- `WORK_OS_DESKTOP_UPDATE_MANIFEST_URL` if the updater should use an explicit non-default manifest endpoint.

The release secret store must also provide:

- `TAURI_SIGNING_PRIVATE_KEY`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `TAURI_UPDATER_PUBLIC_KEY`.
- `WINDOWS_CERTIFICATE_BASE64`.
- `WINDOWS_CERTIFICATE_PASSWORD`.

The following non-secret decisions/setup are required:

- The manager/reviewer account, team mapping, and confirmed authorization scope.
- The final EOD template and manager approval/rejection expectations.
- Data retention periods for transcripts, derived evidence, raw audio, and optional screenshots.
- The public updater/release hosting location and rollback policy.
- Pilot success thresholds and the date range for David's one-week acceptance run.
- A support/incident owner for provider failures and desktop release issues.
- A Windows code-signing certificate and access to configure GitHub Actions/release secrets.

If screenshot summaries remain disabled, `WORK_OS_SCREENSHOT_ENCRYPTION_KEY` and screenshot-retention scheduling are not blockers. No GHL setup is needed for this software-engineer pilot.
