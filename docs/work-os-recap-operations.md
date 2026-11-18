# Activity recap operations

## Contract

The user timer `work-os-activity-recap.timer` POSTs the authenticated scheduled
endpoint every five minutes. It is a **user systemd unit** on the deployed host;
checking the system unit with the same name can incorrectly report it missing.
Do not invoke the POST as a read-only health check: it can process screenshots,
call a model, write a recap, and advance the notification schedule.

Recaps and check-ins are different records. Generation never writes an employee
check-in or advances the employee's substantive-update timestamp. A due slot is
identified by the authorized organization/person, work session and exact due
instant. The same receipt must survive generation through cadence advancement.

## Evidence settlement

- A usable evidence selection can generate immediately.
- Otherwise keep the row hidden and retry at most once every five minutes.
- Stop waiting 15 minutes after the later of the original row creation time and
  frozen evidence window end. Retries and process restarts do not extend it.
- A successfully read empty/excluded-only window settles as `no_usable_frames`.
  An unresolved provider or analysis failure settles as `evidence_timeout`, not
  empty. Both allow the cadence to continue without an employee-facing card.
- Synthesis failures remain non-advancing with the existing 15-minute backoff.
- Publishing a recap, its selected evidence and its generation audit is one
  transaction. A persistence failure cannot leave a consumable ready row.
- Pending retries keep their original window even if a plan is confirmed while
  they wait. Eligible, never-generated old empty rows retain the existing bounded
  overdue recovery; a processed or employee-reviewed recap is not rebased.
- A pending or failed eligible row cannot be consumed by an installed companion's
  legacy empty prompt-delivery payload. Deterministically disabled recap paths
  retain generic prompts; the notification endpoint does no model work.
- Latest reads are scoped by both organization and person and checked against
  the authoritative response identity. A sign-in change clears the previous
  account's active recap and stops its playback; a transport timeout is not an
  excuse for a new client to send an unbound delivery request.

## Coverage, not just a successful timer

The cron response contains aggregate observations, not names, person IDs, raw
provider errors, screenshot content, or credentials. `scanned` counts distinct
candidates inspected in a run, `eligible` counts those that pass the gates, and
`dueSlotsObserved` counts authoritative due observations before retry backoff.
An ineligible candidate does not belong in the due-slot denominator.

Outcomes distinguish `nothing_due`, `ineligible`, `awaiting_evidence`, `empty`,
`generated`, `already_ready`, `failed`, and `slot_changed`. One slot can be
observed in several ticks while waiting: **summing ticks is not counting unique
due slots**. A ready recap found from a companion request is not a new cron
generation. `readyLatencyMs` is sampled from new cron-owned ready transitions,
using stored generation time minus stored due time; count/sum/max are not a p95.

For a coverage investigation, use read-only, organization-scoped aggregates of
distinct interval IDs and generation audit targets, separated by system/user
actor. Include the period, flags, mappings and consent eligibility; reconcile
known due slots with ready/empty/expired/unsettled states. Never infer a success
rate by dividing generated recaps by timer runs. Redact identifiers from the
shared evidence record. No production database write is needed for diagnosis.

## Acceptance checklist (results are not yet recorded)

Use a designated fixture with current consent and a known mapping. Record the
build/commit, organization-scoped slot, due time, evidence readiness, baseline
interval/check-in count, and `last_substantive_update_at` in the private ledger.

1. Quit both companion windows/the app **before** the due instant; leave
   Worktivity running. Observe the normal timer, not a manual POST.
2. Verify one ready row and one null-actor generation audit for the exact slot
   before reopening. Measure due-to-ready time. With usable evidence already
   available, allow the next tick plus one extra processing tick; investigate
   any missed deadline before calling this accepted.
3. Reopen: mascot owns one system toast, main window owns one in-app flyout,
   both point to the same latest recap, and neither auto-opens chat. Older
   pending recaps remain accessible through Recent activity.
4. Approve the newest, confirm the remaining pending count and `View recaps`
   destination, then quit/relaunch: no older pending recap auto-surfaces.
5. In an isolated fixture, exercise empty, excluded-only, delayed frames and a
   provider outage. No blank card appears; recoverable evidence produces one
   recap; an expired failure is counted as failed evidence rather than empty.
6. Verify generation did not change check-in count/substantive-update time.
   Confirm/amend is a separate user action, not evidence of generation alone.

Use desktop/narrow sizes, loading/error/empty/dense states, keyboard focus, and
reduced motion for both notice surfaces. Record actual screenshots, interaction
results and TestSprite test IDs—not just successful builds or source assertions.

## Rollout and rollback

Only roll out with operator authorization. Compare shared paths by content with
Agent OS; preserve its platform layout/proxy/deploy tooling. Deploy server fixes
through Agent OS's atomic `npm run redeploy`; never build into an active `.next`.
Check the deployed commit/assets, user timer state and read-only aggregate
outcomes before repeating the smallest authorized fixture acceptance.

Server safety does not depend on a companion update. Companion packaging follows
the five-outcome release policy; there is no recap-specific early-release bypass.
If cadence stalls, an account switch displays another scope's recap, or an
announced success has no matching row/audit, stop rollout and use the existing
atomic rollback to the previous server build. Roll back companion independently
if needed. No migration, data rewrite or destructive cleanup is required.
