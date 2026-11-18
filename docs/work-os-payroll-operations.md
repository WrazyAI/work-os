# Work OS payroll review operations

Status: implementation in progress; payroll is **off** by default. This runbook
covers readiness and enablement gates. Deployment, cron activation, auto-approval
and companion release remain separate operator decisions.

## Safety posture

- Payroll writes only to `work_payroll_*` tables. It never writes Worktivity,
  employee recaps, check-ins, task proposals, or attendance sessions.
- Work OS is the approved-hours and export authority. No rates, currency, or
  payment provider integration exists.
- The analysis is unavailable unless `work_payroll_settings.enabled` is true.
  Automatic recap approval additionally requires `auto_approve_enabled`.
- Payroll rows expire 30 days after the later of pay date, approval, or first
  export. A documented operator hold blocks the expiry purge.

## Read-only readiness

Run without a probe first. It performs no network or database write:

```bash
export PATH=/home/zahemen/.nvm/versions/node/v24.20.0/bin:$PATH
node --import tsx scripts/verify-work-os-payroll.mts
```

The default output states that live verification is pending. That is the
truthful state until the probe below is reviewed and the adapter's
`CaptureSemantics` is versioned.

A bounded probe takes one explicit organization, person and pay date:

```bash
node --import tsx scripts/verify-work-os-payroll.mts --probe \
  --org <organization-uuid> --person <person-uuid> --period 2026-11-16
```

It reads the first activity page for the payroll period only. It prints
aggregate counts: status codes, productivity codes, activity range, null and
exact-zero samples, page/watermark completeness. It does not print titles,
URLs, summaries, signed screenshot links, API keys or payloads. It reserves one
slot in the shared provider budget table, which is internal pacing, not a
payroll record.

## Provider gates

The adapter must not claim verified coverage until all of these are recorded:

1. **Capture direction and duration.** Work OS documents one-minute captures but
   has not established whether `CreateDate` marks the start or end of the
   observation. The default `worktivity-activitylog-v1` semantics keeps
   `verified=false`, `direction=unknown`, `durationMs=60000`; normalized spans
   are therefore null and `zeroEligible` stays false. No automatic inactivity
   deduction is possible in this state.
2. **Complete paging.** The adapter repeats the employee and exact half-open UTC
   bounds locally, deduplicates by provider log ID, treats conflicting duplicate
   values as a blocking source conflict, and only marks a page complete when the
   provider page count is exhausted. An inconsistent `TotalCount`/`PageCount`
   pairing throws rather than reporting partial coverage as complete.
3. **Application units.** `Insights/AppsSummary` currently follows the existing
   Work OS interpretation (`Working + Idle` as minutes). Application usage is
   context only and never payable time; malformed rows are omitted and counted
   in coverage notes.
4. **Productivity labels.** No enum label map is verified. Codes are preserved
   as numbers for context and render as `unrated`. Never guess a label.
5. **Connection entitlement.** The deployment-global `WORKTIVITY_API_KEY` does
   not authorize every organization. Payroll requires exactly one active
   `work_provider_connections` row for the organization and a person mapping in
   `work_people.worktivity_employee_id`. If `work_source_accounts` rows exist for
   that person, a verified row must match; an unverified or foreign mapping
   fails closed. The client never supplies the employee mapping or connection.

## Rate budget

The provider allows 5 requests/second, 100/minute and 1000/hour. Payroll
reserves a conservative sub-budget: 4 requests/second spacing, 80/minute and
800/hour, serialized in PostgreSQL per organization/connection. This leaves
headroom for attendance and screenshot reads, which are not retrofitted onto
the payroll limiter. If 429s still appear during payroll analysis, pause bulk
syncs or lower the payroll batch size; do not increase the sub-budget from a
single process.

## Model readiness

Payroll text defaults to `deepseek/deepseek-v4.1-flash-1017` at `high` effort; frame
classification defaults to `openai/gpt-6-luna`. The scoped policy does not change
other surfaces' low effort. `max` is rejected unless the configured text model has a
verified capability entry and `WORK_OS_PAYROLL_MAX_VERIFIED=1`; no model is currently
verified for max, so it fails loudly rather than silently downgrading.

Run one non-sensitive structured probe per configured model only when explicitly authorized:

```bash
node --import tsx scripts/verify-work-os-payroll.mts --verify-models
```

It records model/effort and success/failure, never keys or request payloads. Without a
successful probe, automatic exclusion remains blocked; metadata review can still run.
Frame classification is one point observation: malformed output, length truncation,
timeout, missing consent and missing image all become `unclear`, never `idle`, and it
cannot allocate minutes. First/middle/last frames are selected (at most three per
ambiguous run); the durable run owns the 48-frame per-person cap.

## Failure behavior

- Scheduled workflows: advance every five minutes, recap cutoff hourly at :17,
  retention daily at 03:41. They use `WORK_OS_BASE_URL` and `CRON_SECRET`, bounded
  curl timeouts, and `cancel-in-progress:false`. GitHub may run the hourly recap
  after 06:00 local (e.g. 06:17); this is a cutoff guarantee, not an exact-minute
  SLA. The on-demand ensure handles a missed cron. If exact 06:00 is required,
  use the Agent OS systemd timer instead, not two silent schedulers.
- First pilot activation is explicit and revisioned:
  `WORK_OS_PAYROLL_PILOT_CONFIRM=1 node --import tsx scripts/verify-work-os-payroll.mts --activate-pilot --confirm-readiness --organization-id <uuid> --expected-revision <n> [--enable-auto-approval] [--cutoff-hour 6]`.
  It never chooses another organization, never bypasses the cutoff notice/client
  readiness gate, and should be run only after provider/model/employee-client gates
  are recorded. Payroll remains off by default.

- Payroll artifacts expire 30 days after the latest of local pay-date start,
  explicit approval, or first durable export. Reopen/read/re-export/Q&A/retry
  never move the anchor. The purge is service-only (CRON_SECRET), bounded 50 by
  default/100 maximum, and leaves employee recaps, review ledgers, source
  screenshots and unrelated audit rows intact. A content-free tombstone blocks
  regenerating the expired period. A documented operator hold postpones purge.

- Provider fetch failure: the page is incomplete; publication and approvals
  must wait.
- Unknown capture semantics: samples remain visible, gaps remain uncovered,
  inactivity deductions do not run automatically.
- Conflicting duplicates: the run fails with a source conflict; do not choose a
  winner.
- Withdrawn tracking consent or screenshot consent: no new provider ingestion or
  frame processing; existing payroll receipts stay under retention policy.
