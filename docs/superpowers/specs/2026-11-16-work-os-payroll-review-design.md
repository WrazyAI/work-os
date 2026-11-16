# Work OS payroll review — design

**Status:** Reviewed design — product-owner questions in §19
**Date:** 2026-11-16
**Audience:** Work OS administrators
**Scope:** A new admin-only payroll evidence and hours-review surface for Work OS.

## 1. Intent

Payroll currently requires someone to reconstruct a worker's period from
screenshots, recaps, session metadata, and memory, then decide which hours are
payable. This design makes that review one evidence-backed workspace:

- every working day in the pay period is analyzed;
- tracked, excluded, unresolved, recommended, and approved time are separate;
- every deduction and adjustment has a visible reason and source;
- two weekly progress briefs summarize the period's recaps;
- the administrator can ask questions about the analysis and its evidence;
- Work OS owns the approved record and exports it; Worktivity is never written.

The feature borrows the useful shape of the Agent OS Worktivity audit — a
period rollup, sampled screenshot inspection, a flag queue, a human decision,
and a report — but replaces its assumptions with Work OS's evidence pipeline:
employee-local days, encrypted retained frames, consent and sensitive-content
gates, reviewable recaps, and organization-scoped authorization.

## 2. What this is and is not

### Goals

1. Produce a defensible, per-day payroll analysis for one employee and one
   semimonthly pay period.
2. Show hours worked, hours counted as work, Worktivity's productivity signal,
   app distribution, suspicious or ambiguous evidence, and unresolved time.
3. Make every automatic exclusion explainable and every ambiguous case a human
   decision.
4. Produce Week 1 and Week 2 progress briefs from the period's recaps.
5. Answer administrator questions with citations to the stored analysis.
6. Record an immutable approval snapshot and export it as CSV and a printable
   summary.

### Non-goals

- No pay rates, currency, taxes, monetary deductions, invoices, or payroll provider
  writes.
- No employee-facing payroll view.
- No automatic pay decision. The system recommends; an administrator approves.
- No broad raw-screenshot browsing. Evidence access stays exception-based.
- No real-time monitoring or a live "productivity score".
- No replacement for EOD reports, recaps, or the existing People record.
- No Worktivity payroll or CostManagement endpoint usage.

### Anti-goals

The feature fails if it:

- deducts time because evidence is missing rather than because activity is
  confirmed zero;
- lets a model decide payable hours;
- changes an approved period silently;
- presents Worktivity's productivity labels as fact;
- turns into a wall of interchangeable KPI cards;
- exposes raw screenshots to every administrator without a reason and an audit
  entry.

## 3. Decisions already made

These came from the product conversation and are fixed for this design:

- **Audience:** administrators only.
- **Record of truth:** Work OS is the approved-hours record and export source.
  Nothing is written back to Worktivity.
- **Evidence hierarchy:** Work OS's retained screenshots, recaps, and interval
  evidence are primary. Worktivity supplies attendance, activity samples, app
  usage, and its own productivity labels as supplementary context.
- **Breaks:** unpaid. A recorded break is its own excluded period and is never
  also counted as a separate inactivity deduction.
- **Inactivity:** a continuous run of at least three minutes of confirmed 0%
  activity excludes the whole run. Meetings, work-related training, and
  work-related reading remain payable. Ambiguity goes to human review.
- **Window:** no pre-shift time. Recorded work may count up to 60 minutes after
  the scheduled shift end; later time is excluded.
- **Pay periods:** pay date on the 16th covers the 1st–15th; pay date on the 1st
  covers the previous month's 16th through month end.
- **Weeks:** Week 1 is the first seven days of the period; Week 2 is the
  remainder. Both show exact dates.
- **Weekly briefs:** each week gets one concise but detailed progress update
  compiled from that week's recaps, with source citations.
- **Questions:** administrators can ask about the analysis; answers cite the
  stored record and never mutate it.
- **Models:** OpenRouter only, using GPT-6 Luna and/or DeepSeek V4.1 Flash at
  high or max reasoning effort where supported. No Codex CLI.
- **Export:** hours only, as CSV plus a printable summary.
- **Missing data:** never assumed to be zero. It becomes a review item.
- **No schedule:** the period cannot be approved until the schedule is correct.
- **Approval:** snapshots the period; later evidence requires an explicit,
  audited reopen.
- **Screenshots:** flagged or disputed evidence only, with a recorded reason.

## 4. Product shape

### 4.1 Period overview

`/work-os/admin/payroll` is the period desk.

- A pay-date selector chooses a semimonthly period. The default is the most
  recent period that has ended.
- The masthead names the pay date, evidence dates, and timezone.
- One bounded summary record states employees reviewed, tracked hours,
  recommended hours, unresolved minutes, approved hours, and the number needing
  attention. It is a record with hairline separators, not a wall of KPI tiles.
- The roster lists every active person with a Worktivity mapping, plus inactive
  people with evidence or an approval in the selected period:
  employee, workdays, tracked, recommended, unresolved, approved, status, and
  last analyzed.
- Status vocabulary: `Not analyzed`, `Analyzing`, `Needs review`,
  `Ready to approve`, `Approved`, `Stale`, `Failed`, `No work recorded`.
- One primary action: `Analyze period`. It starts or resumes an analysis for
  every person who needs one, with bounded concurrency. `Export approved` is
  secondary until at least one review is approved.
- A person without a Worktivity mapping is listed in a setup section with a
  link to People, not silently omitted.
- A person with no workdays in the period can still be approved as
  `No work recorded` with a note.

### 4.2 Employee review

`/work-os/admin/payroll/[personId]?payDate=YYYY-MM-DD` is the working surface.
Its structure is the approved mockup:

1. **Context row.** Person, pay period, pay date, timezone, review status, and
   the two actions that matter: `Re-analyze` when stale or failed, `Approve
   hours` when ready.
2. **Hours reconciliation.** One instrument, not several cards:
    - recorded attendance (Work OS sessions plus supplementary provider samples);
    - outside the payable window;
    - eligible tracked time;
   - breaks excluded;
   - qualifying inactivity excluded;
   - unresolved minutes;
   - recommended payable;
   - approved payable, once approved.
   Each excluded or unresolved line opens its findings. The recommended total is
   the largest number in the surface, and it is text, not a ring.
3. **Progress.** Week 1 and Week 2 briefs side by side, each with its dates,
   theme, 2–4 short paragraphs or themed bullets, source count, and `Read source
   recaps`.
4. **Daily record.** One flat table of workdays: date, tracked, recommended,
   unresolved, evidence state, recap count. A row opens the day review.
5. **App context.** App distribution and Worktivity productivity labels as
   context, explicitly labeled not authoritative and not used to compute pay.
6. **Ask about this period.** Suggested questions plus a bounded thread. Every
   answer cites the day, finding, recap, or approval it relies on.
7. **Approval and export.** A single action band. Before approval it states what
   is unresolved. After approval it becomes the immutable receipt with `Export
   summary CSV`, `Export daily CSV`, `Print summary`, and `Reopen period`.

### 4.3 Day review

A dialog, not a second page. It contains:

- the effective schedule and its source (schedule, exception, or session
  snapshot);
- sessions and clock times;
- one stacked timeline of the day: payable, break, confirmed inactivity,
  outside window, unresolved, and unverified evidence gaps;
- every finding for the day, with minutes, reason, evidence references, and its
  decision control;
- the day's recaps with their review provenance;
- manual adjustment with a required reason;
- a footer stating the day's contribution to the period total.

The day dialog is keyboard reachable, traps focus, closes on Escape or backdrop,
and restores focus to its row.

### 4.4 Review queue

A filtered list of every finding across the period: kind, day, time, minutes,
status, evidence, and reason. Administrators can resolve one finding or a
selected batch with one reason. The queue is reachable from the reconciliation
and from the daily record. It is not a separate top-level destination.

### 4.5 Approval

Approval is available only when:

- the analysis is complete and fresh;
- every material finding is resolved;
- every workday has an effective schedule (a missing schedule is corrected in
  the person's schedule, not bypassed);
- no included session has `correction_status` of `needs_correction` or `invalid`,
  or an open/unresolved clock boundary;
- the administrator has reviewed the totals, including any manual adjustment.

The approval dialog repeats the period, tracked, excluded, recommended, and
approved minutes; offers an optional note; and states that the snapshot will
not change when later evidence arrives.

After approval:

- the review is read-only;
- the approved snapshot is immutable;
- exports use the snapshot, not live data;
- new evidence or a changed schedule marks the review `Evidence changed since
  approval` and offers `Reopen period` with a required reason;
- reopening creates a new revision; the old approval remains in history.

## 5. Pay periods

### 5.1 Boundaries

All period boundaries are employee-local calendar dates in the employee's
onboarding timezone.

| Pay date | Evidence period |
|---|---|
| 16th of month M | 1st of M through 15th of M |
| 1st of month M | 16th of M−1 through the last day of M−1 |

Examples:

- Pay date Nov 16, 2026 → Nov 1–15, 2026.
- Pay date Nov 1, 2026 → Oct 16–31, 2026.
- Pay date Mar 1, 2027 → Feb 16–28, 2027.

The period is a date range, not an instant range. It is resolved once and stored
on the review so a later timezone or schedule change cannot silently move it.

### 5.2 Weeks

- Week 1: the first seven days of the period.
- Week 2: the remaining days.

Examples:

- Nov 1–15 → Week 1 Nov 1–7; Week 2 Nov 8–15.
- Oct 16–31 → Week 1 Oct 16–22; Week 2 Oct 23–31.
- Feb 16–28 → Week 1 Feb 16–22; Week 2 Feb 23–28.

Both briefs display their exact dates. A period with fewer than 14 days still
uses the first-seven/remainder split.

### 5.3 Timezone changes

Each day uses the session's recorded timezone when present, otherwise the
person's onboarding timezone. The period uses the onboarding timezone at
analysis time. A timezone change inside the period raises a
`timezone_changed` review notice; it does not move already-recorded days.

Membership in a period and week is determined by the stored `shift_date` date
key, not by re-bucketing timestamps in the period timezone. Samples and frames
are attached to that shift's instant window, including the next calendar day for
overnight work. Unattached evidence uses the frozen period timezone and creates
a reconciliation finding; it cannot silently create payable attendance. A
re-analysis or reopen retains the original period dates/timezone. Display both
timezones when they differ. Never derive dates using the server's local zone.

## 6. Hours model

### 6.1 The principle

Tracked time is what the employee was clocked in for. Payable time is tracked
time minus unpaid breaks, confirmed inactivity, and time outside the pay window,
plus or minus explicit administrator adjustments. Missing evidence never
creates a deduction. The model recommends; the administrator decides.

The engine is deterministic. AI may classify an ambiguous interval and write a
narrative, but it never computes or changes a total.

### 6.2 The day's window

For each `work_sessions` row:

- `scheduled_start` is the session's `scheduled_starts_at`, falling back to the
  effective schedule for that local date.
- `scheduled_end` is the session's `scheduled_ends_at`, falling back to the
  effective schedule.
- The eligible window is half-open `[scheduled_start, scheduled_end + 60 minutes)`.
- Pre-shift time is excluded even when the employee clocked in early.
- Post-shift recorded activity inside the 60-minute grace is eligible.
- Time at or beyond `scheduled_end + 60 minutes` is outside the window.
- A scheduled working day with no effective schedule or session schedule is
  `no_schedule`; it cannot be approved until corrected.
- A scheduled working day with activity but no mirrored session is `no_session`;
  it cannot be approved until the session is reconciled.
- A scheduled working day with no session and no activity is still materialized
  as a `no_work` day. The administrator acknowledges `No work recorded`; it does
  not block the rest of the period and it does not disappear from the daily
  record.
- A leave day is materialized as `leave` with zero payable time and no approval
  block only when there is no recorded work. Work on leave or an unscheduled day
  is materialized and blocks approval until the schedule/session is corrected.

The effective schedule for a date comes from the date-effective `work_schedules` row,
overridden by a `work_schedule_exceptions` row for that date. `leave` means no
workday. `changed_shift` replaces the times. `working_day` adds a day.
Use the historical resolver, including `effective_from`, `effective_to`, weekday,
and exception semantics; the current/future-only schedule-list endpoint is not
a historical source. Closed sessions keep their recorded schedule stamps (as in
`work-os-schedules.ts`); editing today's schedule does not correct a closed
session. A conflicting stamp and historical correction is a blocking finding
until corrected through an authorized attendance/schedule correction path.

Every scheduled working day in the period gets a day row, whether or not a
session was mirrored. Split shifts and multiple sessions on one local date are
summed in the same day record. Overnight sessions are attributed to the
session's `shift_date`, not to the calendar date of each activity sample.
Overlapping session or activity intervals are unioned as exact instants so no minute is
counted twice.

Materialize the union of scheduled dates, session shift dates, and dates with
unattached evidence, not only currently active mapped employees/dates. Include
inactive people with period evidence or an existing approval; lack of a current
mapping never erases a historical record. Missing mappings block a new provider
analysis, not access/export of existing approvals.

Split shifts use explicit session schedule stamps, never a new guessed daily
window. Grace may not fill an unrecorded split-shift gap. An instant shared by
two shifts belongs once: actual session ownership first, then the earlier
scheduled start (stable session-id tie-break). Conflicting ownership is a
blocking reconciliation finding. Use UTC instants for elapsed duration. Local
DST times must resolve to explicit offsets; nonexistent or ambiguous unstamped
schedule boundaries block approval until corrected, rather than guessing an
offset. An open session uses the run's frozen `as_of` instant for preview only
and blocks approval until closed/corrected.

### 6.3 Tracked time

`recorded` is the untrimmed union of closed session attendance and validated
activity slices assigned to the shift. `tracked_minutes` is its intersection
with that shift's eligible window. The two are distinct reconciliation lines.
Eligible tracked time is the union of:

- the session interval `[clocked_in_at, clocked_out_at)` (or frozen `as_of` for an open
  session), intersected with the eligible window;
- recorded activity intervals inside the eligible window, including post-shift
  activity up to the grace boundary.

The union prevents a post-shift activity sample from being counted twice or
from being lost when the session closed at the scheduled end. A sample after
clock-out is labeled `after clock-out` in the day detail and remains eligible
inside the grace window.

A session with no activity samples is still tracked. It becomes a
`low_evidence` review item rather than an automatic deduction.

### 6.4 Breaks

Break time is unpaid and is excluded once.

Sources, in order:

1. Scheduled `break_windows` on the effective schedule.
2. Worktivity activity logs with `Status = 2` (OnBreak), grouped into continuous
   runs using the inferred cadence.
3. Manual session pauses: `work_session_events` pause/resume intervals when they
   exist. Inspect `source` and event metadata: provider-mirrored pause events and
   `paused_seconds` may describe the same provider break, not another break.
   A genuinely manual pause is a real break regardless of the authoritative-break flag.
4. The session's `provider_break_seconds` as a cross-check.

Overlapping break sources are unioned, so a scheduled break and a provider break
covering the same minutes deduct once. A derived break run becomes a `break`
finding with its time range and source. It is deducted from tracked time and
excluded from the inactivity analysis.

This is interval precedence, not adding source totals. Clip all break intervals
to tracked time. Never place an aggregate `paused_seconds` or
`provider_break_seconds` arbitrarily on the timeline or subtract it in addition
to located breaks. An unlocated residual, missing pause/resume pair, or any
positive aggregate disagreement is a blocking `break_mismatch`; the
administrator must reconcile the interval or record a bounded residual
exclusion with a reason and non-overlap attestation. Provider-authoritative
organizations do not gain synthetic scheduled breaks when their policy has
disabled them. Recorded scheduled-break work is disputed, not automatically
unpaid twice. A disputed break span is held once, rather than both excluded and
held. Unrelated missing evidence remains included.

If recorded activity appears during a scheduled break, or the derived break
total disagrees materially with the provider's break seconds, the interval is
flagged `activity_during_break` or `break_mismatch` for review instead of
silently paying or excluding it.

### 6.5 Inactivity

Activity samples are Worktivity `ActivityLogs` rows. The engine:

1. Filters by verified `EmployeeId`, validates `CreateDate` and numeric fields,
   deduplicates by provider log ID, then sorts by timestamp and ID. Conflicting
   duplicate values are a blocking source conflict; null/malformed activity is
   unknown, never coerced to zero. `ActivityLevel` is observed active seconds per
   one-minute capture (0–60), not a percent. Exact numeric zero is the zero test.
2. Records median cadence as a diagnostic only. It does not turn a sparse sample
   into several minutes of confirmed zero activity.
3. Gives each valid log no more than its verified capture duration, capped at
   the next timestamp and shift ownership/window boundary. The existing type
   documents one-minute captures, but does not establish whether `CreateDate`
   starts or ends the capture: live read-only verification must establish and
   version this adapter before automatic inactivity exclusions are enabled.
   Without verified temporal semantics, display samples but require review;
   do not interpolate deductions. Uncovered time is an unverified gap.
4. Groups touching zero slices into continuous runs. Positive, unknown, break,
   or uncovered slices split a run. Never bridge a gap using twice the cadence.
5. Measures the run's duration. A run of at least 3 minutes is a qualifying
   inactivity run. The entire run is excluded, not only the minutes after the
   third.
6. Checks the exception evidence before deducting.

Exception evidence:

- a meeting app or domain in the sample's app/title (video call, screen share,
  virtual office), or a stored neutral screenshot summary describing a meeting;
- a work-related training or reading context in the stored summary, the
  person's payroll context, or a confirmed/amended recap;
- an explicit administrator decision.

The decision table applies only to a run whose continuous zero coverage is
verified. The provider's zero samples are the inactivity evidence; a screenshot
is a point observation that can establish an exception or contradict the run,
not a requirement to cover every minute.

| Evidence on the qualifying run | Result |
|---|---|
| Continuous verified 0%, no exception signal, and app/title or frame indicates non-work | `auto_excluded` — deducted, visible, reversible in review |
| Continuous verified 0%, frame or stored summary establishes meeting, training, or work-related reading | `auto_payable` — visible, not deducted |
| Continuous verified 0%, frame classified `work` at or above the confidence floor | `auto_payable` — visible, not deducted |
| Continuous verified 0%, no frame, and app/title is unknown or generic | `needs_review` — confirmed zero span held out, never auto-deducted |
| Continuous verified 0%, frame classified `unclear` or below the confidence floor | `needs_review` — held out, never auto-deducted |
| Continuous verified 0%, contradictory exception evidence | `needs_review` — held out |
| Sparse/gapped zero samples without continuous coverage | `needs_review` — held out |
| Person context names the app as legitimate, but the frame is `idle`/`nonwork` | `needs_review` — context explains a flag, it does not override a clear non-work frame |

Auto-exclusion requires continuous verified zero coverage over the whole
candidate run and no exception or contradiction. A meeting app name or generic
role context alone is a possible exception, not proof of attendance or
work-related reading/training; if it conflicts with the zero run, review. Where
an exception occupies only part of a qualifying run, that subspan remains
payable and only its non-exempt subspans may be excluded; never count it twice.

A consent-withdrawn or image-expired employee can still reach a ready review,
but a run whose app/title is unknown and has no usable frame is held for
administrator resolution rather than silently deducted.

A single one-minute 0% capture cannot qualify, even if the next sample arrives
15 minutes later. Contiguous verified zero slices qualify at 180 elapsed seconds;
the entire verified run is considered, not just its tail. A run adjacent to a
data gap never extends into that gap.

### 6.6 Unverified gaps and low evidence

A span of tracked time without valid capture coverage, including leading and
trailing spans and sessions with no samples, is an `unverified_gap`. It is not assumed to be zero. It stays
in tracked time and is flagged if it is at least 5 minutes. The day detail shows
the gap, its duration, and the nearest evidence on each side.

A session with more than 20% of its tracked time unverified, or more than 30
continuous unverified minutes, becomes a `low_evidence` finding. The
recommended total still includes the time; the administrator must acknowledge
or adjust it before approval. This is deliberately employee-fair: absence of
evidence is not proof of inactivity.

### 6.7 Outside the window

- `outside_window_pre`: recorded time before the scheduled start.
- `outside_window_post`: recorded time at or after the scheduled end plus 60
  minutes.
- Both are excluded, shown as separate reconciliation lines, and never mixed
  into the inactivity total.
- A day with no schedule cannot produce a trustworthy window; it is blocked
  rather than guessed.

### 6.8 Calculations

Compute and retain exact elapsed milliseconds/seconds with half-open intervals;
do not round each sample/run. The three-minute threshold is exactly 180 seconds.
Partition each day's recorded intervals into disjoint spans before summing.
No finding is an additive deduction merely because it has a `minutes` field.

```
recorded         = union(owned session intervals, verified activity slices)
tracked          = recorded ∩ eligible windows
outside          = recorded − tracked
tracked          = payable ∪ excluded_break ∪ excluded_inactivity ∪ held
                   ∪ excluded_manual       (all five sets disjoint)
recommended      = duration(payable) + signed_unlocated_adjustments
                   (before display rounding; apply each adjustment once)
approved         = recommended at the moment of approval
```

Every finding carries an `effect` so a decision moves the total exactly once:

| Finding | Effect | What a decision does |
|---|---|---|
| `break` | `exclude` | Already deducted; no further change |
| `inactivity` with `auto_excluded` | `exclude` | Resolving payable moves its span from excluded to payable |
| `inactivity` with `auto_payable` | `payable` | Already included; visible only |
| `inactivity` with `needs_review` | `hold` | Payable resolution moves held to payable; excluded resolution moves held to excluded |
| `activity_during_break` | `hold` | Replaces the overlapping break exclusion; resolution moves the span once |
| `unverified_gap` | `acknowledge` | Minutes remain in recommended; a manual exclusion subtracts them |
| `low_evidence` | `acknowledge` | Minutes remain in recommended; a manual exclusion subtracts them |
| `break_mismatch` | `acknowledge` | No automatic total change; the administrator may adjust |
| `manual_adjustment` | `include_adjustment` or `exclude_adjustment` | Applies the signed adjustment once |
| `outside_window` | `exclude` | Outside tracked time; correction requires correcting the schedule/source, not adding it back |
| schedule/session/timezone/source conflict | `acknowledge` | Blocking correction required; an acknowledgement cannot bypass it |
| `no_work` | `acknowledge` | Zero total, explicit acknowledgement required |

`held` always means currently unresolved spans, never historical holds. Resolution
changes the partition; there is no separate `resolved_payable` additive counter.
Priority is outside window, then disputed breaks/confirmed breaks, then
inactivity, then ordinary payable; overlapping observations can share citations
but only one owning time-effect finding. Gap/low-evidence acknowledgements have
no monetary or time effect. Batch resolution is atomic and rejects mixed
incompatible effects rather than guessing. A second resolution is a versioned
replacement with an audit, not another addition.

Manual interval adjustments reclassify eligible tracked spans, never stack on
another decision. Unlocated signed adjustments require a reason, unique request
key, source finding, and a demonstrated non-overlapping residual; they cannot
bypass missing schedules/sessions, create pre-shift/late payable time, make a day
negative, or exceed its eligible recorded duration. Adding missing attendance
requires source correction, not free-form positive hours. Removing an adjustment
is a compensating audited event, not deletion of history.

An unlocated exclusion debits only the remaining payable-duration budget and
credits the manual-exclusion duration budget; an unlocated inclusion may only
reverse that same referenced debit, never release break/inactivity/held time
without resolving its owning finding. It cannot exceed that debit. Apply these
transfers before rounding and display them as `unlocated adjustment`, never as
invented timeline coordinates. Thus the reviewed duration categories still sum
to tracked time, while the geometric interval partition remains the raw
calculation. Round the reviewed categories, not an independently adjusted total.

For display/export use integer minutes: apportion each day's exact durations to
whole minutes by largest remainder (floor categories, then allocate residual
minutes to largest fractional remainders; stable ties: payable, break,
inactivity, held, manual exclusion, outside). The target is the day's recorded duration
rounded to nearest minute, half up; outside is another category in the same
allocation. Period values sum displayed day values, never independently round
the period. Thresholds use exact duration, not rounded display minutes. Store
exact durations and the allocation-policy version in every snapshot. Decimal
hours are derived only from exported integer minutes, to four decimal places.
This is the explicit proposed v1 rounding policy, subject to owner confirmation
in §19; do not choose a different rounding policy silently in implementation.

"Material finding" in the approval rules means any finding whose effect is
`hold` or `acknowledge`, plus any `low_evidence` finding. Structural blockers
require correction, not acknowledgement. `auto_payable` and
`auto_excluded` findings are visible but do not block approval.

The review displays both the calculated total and the reviewed total so an
administrator can see exactly what changed.

### 6.9 Worked example

Scheduled 15:00–21:00. Tracked 15:00–21:10 = 370 minutes. Disjoint spans: a
20-minute break, a 45-minute verified continuous 0% run with positive non-work
evidence and no exception, and a separate 10-minute qualifying run held for review.

```
tracked      370m
break        −20m
inactivity   −45m
held         −10m (out of the recommended total, not deducted)
recommended  295m = 4h 55m
```

Time at 22:01 would be outside the window and excluded. A 22-minute meeting at
0% activity inside the day would be payable, not deducted.
The boundary itself, 22:00, is already outside. Resolving the held 10 minutes
payable gives 305m; resolving it excluded leaves 295m with held 0m and inactivity
55m. Repeating either request changes nothing. A 10-minute disputed span within
the 20-minute break would replace that part of the break, not subtract another
10 minutes.

## 7. Evidence model

### 7.1 Sources and precedence

| Source | Use | Never becomes |
|---|---|---|
| `work_sessions`, schedule, exceptions | attendance and payable window | proof of work by itself |
| Worktivity `ActivityLogs` | activity, status, breaks, apps, productivity | a pay verdict by itself |
| `work_screenshot_summaries` | neutral per-frame description, sensitive-content exclusion | completion or quality proof |
| `work_activity_intervals` + evidence | recap narrative and reviewed context | completion or pay proof |
| `work_reports` | day/period context and fallback narrative | pay evidence |
| completed tasks / output evidence | recorded outcomes for week briefs | recap claims |
| Worktivity `Insights/AppsSummary` | app distribution | pay verdict |
| administrator decisions | final payable decision | an automatic rule |

The recap and screenshot layers keep their existing provenance language:
`inferred`, `confirmed`, `amended`, `provider-recorded`, `employee-attached`.
Payroll adds `auto-payable`, `auto-excluded`, `needs-review`,
`resolved-payable`, `resolved-excluded`, and `manual-adjustment`.

### 7.2 Consent and sensitive content

Payroll analysis respects the existing `screenshot_summaries` feature flag and
employee tracking consent. Missing/withdrawn general tracking consent blocks new
provider evidence ingestion; do not treat screenshot consent as the only gate.
Existing immutable payroll receipts remain accessible under payroll retention
policy, without authorizing new processing of withdrawn evidence. If only
screenshot consent is absent or withdrawn:

- no screenshot is decrypted or classified;
- activity and session metadata still produce a review;
- the surface states `Screenshot evidence unavailable by consent`;
- missing screenshots are not treated as suspicious or as zero activity.

Recheck current consent and policy at cache reuse, classification, and raw-byte
access, not only at run creation. A cached classification is not a consent
bypass. New AI use of a retained summary must honor its current policy/consent
eligibility; the fact that a summary exists is not authorization to send it.

The existing sensitive-app/domain policy and sensitive-content detector run
before payroll classification. An excluded frame is never sent to the model. Its
absence is `excluded_by_policy`, not evidence of idleness.

### 7.3 Raw screenshot access

Payroll does not grant broad screenshot browsing. A frame is reviewable only
when linked server-side to a flagged or explicitly disputed finding in the
selected person's review/revision, and only for an administrator. A currently
auto-excluded finding may be disputed with a required reason; merely naming a
summary ID or opening a resolved unflagged finding grants no access.

- Opening it requires a reason.
- The reason and access are written to `work_screenshot_access_log`.
- The existing preview route remains the only byte path.
- The review dialog shows the neutral summary and metadata without opening the
  image; `View flagged frame` is the explicit, audited action.
- Expired images say `Image evidence expired`; the text summary remains.
- The Q&A links to the evidence record; it never renders an image inline.

This extends the current `canAccessRawScreenshot` predicate with an explicit
payroll-review context. That predicate change is security-sensitive and must be
covered by tests for own-frame, flagged, disputed, expired, consent-withdrawn,
non-admin, and cross-organization cases.

This is required new authorization, not an existing guarantee:
`retainedScreenshotImage(summaryId)` currently looks up by ID only and checks
retention, not organization, person, consent, or sensitive policy. It must only
be invoked behind a scoped, current-policy-checked payroll wrapper; never with a
client/model-supplied ID. `previewWorkOsScreenshot` currently records a generic
preview reason and uses evidence-level flags, not payroll findings. Extend its
server-side context with the validated review/finding and the administrator's
reason; do not globally set `metadata.needsReview` to unlock other surfaces.
Authenticate and validate scope before decrypting, durably audit before sending
bytes, fail closed if audit fails, and use private no-store/nosniff responses.
Never return storage paths, encryption metadata, data URLs in general JSON,
provider signed URLs, or thumbnails in roster/Q&A/export payloads. Payroll's
restriction does not remove existing employee own-frame EOD permissions elsewhere.

### 7.4 Evidence freshness

Each review stores a `source_hash` over:

- the person's effective schedules and exceptions in the period;
- session ids, states, scheduled times, clock times, break seconds, and
  correction status;
- the selected activity log sample ids and their source fields;
- the screenshot summary ids, prompt versions, and processing statuses;
- the activity interval ids, revisions, and review statuses;
- the payroll context revision.

Also hash the verified provider identity/connection scope, normalized source
values (not IDs alone), pause events, consent/policy versions, timezone resolver,
hours/rubric/rounding versions, model/classification keys, and all selected brief
sources. Preserve a canonical input manifest and fetch watermark, including
pagination completeness and UTC query bounds. Raw-image expiry/availability is
tracked separately from durable text evidence: expiry removes access but does
not erase a completed classification or automatically change approved hours.
Consent/policy changes invalidate reuse in new analysis without rewriting an
approval. Provider corrections require a new complete read; a hash over the old
cached IDs cannot detect a remote edit. Display the last provider verification
time and require a successful bounded provider refresh before approval; a failed
or incomplete refresh blocks approval. Recheck local source versions in the
approval transaction. Remote evidence is authoritative only as of that refresh,
not claimed to be transactionally locked at the provider.

If the hash changes after analysis, the review is `stale`. Approval is blocked
and `Re-analyze` is offered. If it changes after approval, the approval stays
frozen and `Reopen period` is offered.

## 8. AI analysis

### 8.1 Where AI is allowed

AI is used for four jobs:

1. Classifying a small set of ambiguous frames against the payroll rubric.
2. Writing the Week 1 and Week 2 progress briefs from selected recaps.
3. Answering administrator questions with citations.
4. Suggesting three contextual questions.

AI never:

- computes tracked, excluded, recommended, or approved minutes;
- chooses a pay rate or a currency;
- decides an exclusion without a deterministic rule or a human resolution;
- sees a frame that policy or consent excluded;
- writes an approval, export, or Worktivity change.

### 8.2 Models

All calls use the policy map, `aiRequestBody`, and usage logging in
`src/lib/work-os-ai-model.ts`; that module is a policy/body helper, not an HTTP
transport. Payroll must not create a competing model/provider policy.

- **Payroll synthesis, briefs, Q&A:** `deepseek/deepseek-v4.1-flash-1017`
  by default, reasoning effort `high`, via the existing Relace pin.
  `WORK_OS_PAYROLL_MODEL` can switch this to `openai/gpt-6-luna`.
- **Payroll frame classification:** `openai/gpt-6-luna` by default.
  `WORK_OS_PAYROLL_VISION_MODEL` can override it.
- **Reasoning effort:** `WORK_OS_PAYROLL_REASONING_EFFORT=high` by default.
  `max` is accepted only after the selected model/provider is verified to
  support it; an unsupported level fails loudly rather than degrading silently.
- **Budgets:** payroll synthesis 12,000 tokens; payroll brief 6,000; payroll
  Q&A 6,000; payroll vision 2,000.
- **Timeouts:** payroll synthesis 120s; brief 90s; Q&A 90s; vision 30s.
- **Usage:** every call records `[ai-usage]` with the payroll surface name.

The model map gains `payroll` and `payrollVision` surfaces. No second
OpenRouter client and no Codex CLI.
The existing helper defaults synthesis reasoning to `low`, recognizes effort
only for DeepSeek, and accepts up to `high` (unknown levels fall back to low).
Implement explicit payroll-scoped high reasoning and validated overrides without
changing other surfaces or relying on a body field that `aiRequestBody` overwrites.
`max` is not currently supported by this helper. Verify configured model IDs,
vision/tool capability, reasoning support, and provider routing with a minimal
live request before enabling analysis; deployment configuration is not evidence
that a provider accepts them. Persist the resolved policy per run/cache key.

### 8.3 Frame classification

The engine first uses what Work OS already knows:

- the stored neutral summary and `visible_context`;
- the app, title, URL, activity level, and status from the activity log;
- the finding's interval and recap citations.

Only ambiguous frames are sent to vision:

- frames inside a qualifying 0% run where the text evidence does not establish a
  meeting, training, reading, or clear non-work context;
- one representative frame at the start, middle, and end of a long ambiguous
  run, capped at three;
- a representative frame for a `low_evidence` or `unverified_gap` finding when
  one exists.

The classifier returns a forced tool call:

```json
{
  "category": "work | meeting | training | reading | idle | nonwork | unclear",
  "confidence": 0.0,
  "reason": "one sentence grounded in what is visible",
  "app": "visible app name"
}
```

Rules:

- `meeting`, `training`, and work-related `reading` are payable.
- `idle` and `nonwork` are evidence only; the deterministic rule in §6.5 alone
  may yield `auto_excluded`. A sparse/conflicting classification or `unclear`
  creates a human-review finding. Classification outside a confirmed qualifying
  0% run never deducts time.
- A classification below the confidence floor (0.6) is `unclear`.
- A provider failure is `unclear`, never `idle`.
- The classifier never sees a frame excluded by policy, consent, or sensitive
  content.
- The frame is decrypted through the existing `retainedScreenshotImage` path and
  sent as a data URL; no pre-signed Worktivity URL is stored or relied on.

Classifications are cached in `work_payroll_frame_findings`, keyed by
organization, screenshot summary, model, prompt version, and rubric hash. A
rerun reuses a matching classification and only reclassifies when the frame,
model, prompt, or rubric changes. A cache failure never fails the review.
Include person, frame content/summary source hash, resolved model policy and
consent/policy eligibility version in the key. Reuse is scoped and attached to
the consuming analysis revision separately from the cache row's original run.
Do not cache authorization or persist raw image bytes/model request data URLs.

### 8.4 Weekly briefs

Each brief is generated from that week's recaps, not from the whole period.

Source selection:

- `work_activity_intervals` with `generation_status = 'ready'`, assigned to the
  week by their session `shift_date` (otherwise their stored `local_date`);
  never duplicate an overnight/cross-week recap into both briefs;
- prefer `confirmed` and `amended` recaps; include `inferred` recaps with their
  provenance;
- include the recap's headline, detail, activity bullets, uncertainties, app
  context, and recorded GitHub activity when present;
- include separately recorded outcomes (completed tasks, output evidence) only
  in a distinct `Recorded outcomes` section, never as recap claims;
- if the week has no recaps, the brief states `No recaps recorded for these
  dates` and has no invented progress narrative. EOD/outcome records may be
  linked separately as context, never substituted for the locked recap brief.

Output schema:

```json
{
  "title": "short theme",
  "summary": "2-3 sentences",
  "summary_citations": [{ "type": "interval", "id": "uuid", "revision": 1 }],
  "themes": [
    {
      "heading": "short theme",
      "detail": "2-4 sentences",
      "citations": [{ "type": "interval", "id": "uuid", "revision": 1 }]
    }
  ],
  "open_items": [
    { "text": "unresolved or carried work", "citations": [{ "type": "interval", "id": "uuid", "revision": 1 }] }
  ],
  "gaps": ["what the week's evidence does not cover"]
}
```

Validation:

- Every citation must name a real, scoped, revision-pinned source in the selected
  week/source set. `interval` is the brief's primary type; `task`/`output` are
  permitted only for separately labeled recorded outcomes. Invalid citations
  are dropped; unsupported claims, including summary/open-item claims, are
  dropped or the output rejected, not left attached to an unrelated valid link.
- No completion claim unless a completed task or output evidence is cited.
- No productivity, effort, quality, or pay-eligibility claim.
- No decimal hours in prose; use `4h 55m`.
- The brief is retried once on invalid JSON. A second failure marks the brief
  `failed`; the review can still be approved from the daily record, but the
  failure is visible.
- The brief stores its source hash. If a source recap is amended or added, the
  brief becomes `stale` and can be regenerated.

The brief is concise: a title, 2–3 sentence summary, up to 5 themes (normally
2–5; fewer when sources do not support more), and at most 4 open items or gaps.
No-source states are deterministic text, not a model invention. It is not a second EOD.

### 8.5 Questions

`Ask about this period` is a bounded, read-only tool loop.

Available reads:

- period totals and status;
- day totals, sessions, schedule, and findings;
- one finding with its reason and evidence references;
- one recap with its provenance and evidence counts;
- week briefs and their sources;
- app distribution and productivity labels;
- approval and reopen history.

Constraints:

- maximum 8 model steps and 90 seconds;
- no mutation tools;
- no raw image calls; the model receives stored summaries and metadata only;
- every quantitative or specific claim carries a citation to a real record;
- the server validates citation ids and renders them as links;
- an answer with no valid citation is labeled `Not grounded in this record` and
  is not presented as fact;
- if the administrator asks to approve, export, or change hours, the answer
  points to the control and does not perform it.

Each turn is stored in `work_payroll_questions` with the question, answer,
citations, model, and actor. The UI loads the latest 20 turns for the review. A
`New question` control starts a clean thread without deleting the record.

Suggested questions are generated from the current findings and themes, capped
at three, and validated against the record before display.

Pin each thread/turn to an analysis revision and, for approved-record questions,
an `approval_id`. State explicitly whether answers describe the historical
approval or current reopened draft; never mix live totals with a frozen receipt.
Every read tool revalidates organization/person/revision ownership, even for
model-returned IDs. Render untrusted source/model text as sanitized text/markdown
with no arbitrary HTML, remote images, tool instructions, or executable links.
Source titles/URLs/recaps are untrusted data, never system instructions. Apply
per-admin/organization rate limits, input/context limits, and a total call/token
budget across the tool loop (not eight independent 90-second calls). Suggested
questions are optional; failure does not block analysis or approval.

## 9. Data model

All new tables are organization-scoped and use `organization_id` on every row.
They are written through the server's admin client; access is enforced at the
API boundary with `requireWorkOsAdmin`. No table is exposed directly to the
browser.

Enable RLS and deny direct browser-role access on every new table; server-side
credentials bypass RLS, so API checks alone do not make unscoped joins safe.
Use non-null scope columns, organization-qualified lookups, and composite foreign
keys that enforce `(organization_id, review_id, person_id)` ownership to reviews
and `(organization_id, review_id, person_id, analysis_revision)` ownership to
revision manifests, plus `(organization_id, person_id)` to people. Referenced
parents need matching unique keys. Scope screenshot/evidence relations the same
way; never trust JSON evidence IDs without validating their ownership. All
timestamps below are `timestamptz`; enums/checks enforce allowed statuses, week
1/2, nonnegative durations, confidence 0–1, valid pay dates and exact period
boundaries, and ordered interval endpoints. Do not cascade-delete approvals or
their audit trail when operational rows, users, or people are removed; preserve
minimal identity snapshots under the payroll retention policy.

### 9.1 `work_payroll_reviews`

One row per person per pay date.

| Column | Purpose |
|---|---|
| `id uuid pk` | |
| `organization_id uuid` | tenant scope |
| `person_id uuid` | employee |
| `period_start date`, `period_end date`, `pay_date date` | resolved period |
| `timezone text` | period timezone snapshot |
| `status text` | `draft`, `analyzing`, `ready`, `needs_review`, `approved`, `reopened`, `failed`, `stale` |
| `analysis_revision int` | increments on each completed analysis |
| `row_version bigint` | optimistic concurrency token; increments for every mutation |
| `source_hash text` | evidence freshness |
| `model text`, `prompt_version text` | synthesis provenance |
| `totals jsonb` | tracked, break, inactivity, outside, held, recommended, approved; raw and reviewed |
| `current_approval_id uuid` | points at the latest immutable approval row |
| `approved_minutes int`, `approved_by uuid`, `approved_at timestamptz`, `approval_note text` | current approval quick read |
| `evidence_changed_since_approval boolean` | derived marker; set when the approved snapshot hash no longer matches current sources |
| `last_analyzed_at`, `last_exported_at` | freshness |
| `created_at`, `updated_at` | |

Constraints: unique `(organization_id, person_id, pay_date)`; index
`(organization_id, pay_date, status)`; check `period_start <= period_end`.

### 9.2 `work_payroll_approvals`

Append-only approval history. A review can be approved more than once after a
reopen; every approval remains addressable and exportable.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id uuid`, `review_id uuid` | scope |
| `revision int` | approval sequence for this review |
| `snapshot jsonb` | immutable totals, days, findings, decisions, adjustments, sources |
| `approved_minutes int` | approved total at this revision |
| `approved_by uuid`, `approved_at timestamptz`, `note text` | decision |
| `prior_approval_id uuid` | immutable link to prior approval; supersession is derived, not an update to the old receipt |
| `snapshot_hash text`, `export_schema_version text` | canonical snapshot integrity and renderer identity |
| `created_at` | |

Unique `(review_id, revision)`; index `(organization_id, review_id, approved_at desc)`.
Exports name an `approval_id`, so re-exporting an older approval is possible and
produces the same bytes.
Enforce append-only approval/decision/audit writes using database privileges or
guards as well as application code: ordinary payroll write credentials cannot
update/delete an approval snapshot. Mutable projection fields are not the receipt.

### 9.3 `work_payroll_days`

One row per workday in a review.
Calculated rows are revision-scoped, not destructively overwritten across runs.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `person_id` | scope |
| `local_date date` | the scheduled workday or session `shift_date` |
| `analysis_revision int` | owning immutable analysis input/output revision |
| `week smallint` | 1 or 2 |
| `session_ids jsonb` | sessions included; empty for a no-work day |
| `schedule_snapshot jsonb` | effective start/end, exception, source |
| `status text` | `calculated`, `needs_review`, `resolved`, `no_schedule`, `no_session`, `no_work`, `leave` |
| `tracked_minutes`, `break_minutes`, `inactivity_minutes`, `outside_minutes`, `held_minutes`, `recommended_minutes`, `approved_minutes int` | totals |
| `activity_summary jsonb` | compact runs, apps, statuses, productivity, cadence |
| `findings_summary jsonb` | counts and kinds |
| `source_hash text` | day-level freshness |
| `created_at`, `updated_at` | |

Unique `(organization_id, review_id, analysis_revision, local_date)`; index
`(organization_id, person_id, local_date)`. Store recorded/eligible exact durations,
the disjoint allocation and rounding version in addition to displayed minutes.

### 9.4 `work_payroll_findings`

The review queue.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `day_id`, `person_id` | scope |
| `kind text` | `inactivity`, `break`, `outside_window`, `unverified_gap`, `low_evidence`, `activity_during_break`, `break_mismatch`, `possible_work`, `manual_adjustment`, `no_work`, `no_schedule`, `no_session`, `timezone_changed`, `source_conflict` |
| `analysis_revision int`, `finding_key text` | revision and deterministic identity from kind, owned span, and normalized source IDs |
| `blocks_approval boolean`, `required_action text` | distinguishes acknowledgement from mandatory source correction |
| `start_at`, `end_at timestamptz`, `minutes int` | interval |
| `status text` | `auto_payable`, `auto_excluded`, `needs_review`, `needs_correction`, `acknowledged`, `resolved_payable`, `resolved_excluded` |
| `effect text` | `exclude`, `payable`, `hold`, `acknowledge`, `include_adjustment`, `exclude_adjustment` |
| `reason text` | human-readable explanation |
| `evidence jsonb` | activity log ids, screenshot summary ids, interval ids, app/title, classification |
| `resolution_note text`, `resolved_by uuid`, `resolved_at timestamptz` | decision |
| `source_hash text` | freshness |
| `created_at`, `updated_at` | |

Index `(review_id, status)`, `(day_id)`, `(organization_id, person_id)`.
Unique `(organization_id, review_id, analysis_revision, finding_key)`; include
`no_work`, `no_schedule`, `no_session`, `timezone_changed`, and `source_conflict`
in the validated kind vocabulary. `possible_work` is acknowledge-only until
linked to a specific owned disputed span; it never adds minutes on its own.
Acknowledgements need an `acknowledged` resolution state, not a fictitious
`resolved_payable` time effect. Structural conflicts require source correction.

Human changes append durable decision events (`work_payroll_decisions`) with
scope, analysis revision, finding key/source hash, before/after state, actor,
required reason, timestamp, expected row version, and unique idempotency key.
Store a prior-decision link for replacements/removals. A finding's resolution
columns are only the current projection. Reanalysis never deletes the prior
decision history or silently applies a decision to changed evidence. Structured
audit entries are written atomically with the mutation; a log after an otherwise
committed write is not sufficient.

A finding is the unit of human decision. A 0% run, a break, an outside-window
stretch, a gap, or a manual adjustment is one finding. Per-minute rows are not
created.

#### Decision events

`work_payroll_decisions` is an append-only event log for every human decision.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `person_id` | scope |
| `analysis_revision int`, `finding_key text` | the finding version decided |
| `decision text` | `payable`, `excluded`, `acknowledged`, `corrected`, `adjusted` |
| `before_state jsonb`, `after_state jsonb` | projection change |
| `reason text`, `actor_user_id uuid`, `created_at timestamptz` | who and why |
| `expected_row_version bigint` | optimistic concurrency |
| `prior_decision_id uuid` | replacement/removal chain |
| `idempotency_key text` | retry-safe |

Unique `(organization_id, idempotency_key)`; index
`(organization_id, review_id, person_id, created_at desc)`. The finding's
resolution columns are only the current projection. A re-analysis never deletes
this history or applies a decision to changed evidence without a new event.

### 9.5 `work_payroll_frame_findings`

Targeted vision cache.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `day_id`, `person_id` | scope |
| `screenshot_summary_id uuid`, `evidence_event_id uuid` | frame |
| `captured_at timestamptz`, `app text`, `activity_level int` | source |
| `category text` | `work`, `meeting`, `training`, `reading`, `idle`, `nonwork`, `unclear` |
| `confidence numeric`, `reason text` | classifier output |
| `model text`, `prompt_version text`, `rubric_hash text`, `classification_key text` | cache identity |
| `created_at` | |

Unique `(organization_id, person_id, screenshot_summary_id, classification_key)`;
index `(review_id, day_id)`.
The review/day fields identify origin only, not exclusive cache ownership.
Consuming revision manifests store their validated cache-row references. Include
the source/policy hashes described in §8.3; cache rows must never be reassigned
to a different review/day during reuse.

### 9.6 `work_payroll_week_briefs`

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `week smallint` | scope |
| `analysis_revision int` | brief belongs to one analysis revision |
| `period_start date`, `period_end date` | exact dates |
| `status text` | `missing`, `generating`, `ready`, `failed`, `stale` |
| `title text`, `summary_markdown text` | brief |
| `themes jsonb`, `open_items jsonb`, `gaps jsonb` | structured body |
| `source_interval_ids jsonb` | citations |
| `sources jsonb` | typed revision-pinned citation snapshots, including distinct recorded outcomes |
| `source_hash text`, `model text`, `prompt_version text` | provenance |
| `error text`, `generated_at timestamptz` | |
| `created_at`, `updated_at` | |

Unique `(organization_id, review_id, analysis_revision, week)`.

### 9.7 `work_payroll_questions`

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id` | scope |
| `actor_user_id uuid` | administrator |
| `thread_id uuid`, `analysis_revision int`, `approval_id uuid null` | immutable question scope |
| `request_key text`, `status text`, `source_hash text` | idempotent pending/ready/failed turn and grounding version |
| `question text`, `answer text` | turn |
| `citations jsonb` | validated record links |
| `model text`, `created_at` | provenance |

Index `(review_id, created_at desc)`.
Unique `(organization_id, actor_user_id, request_key)`; a question retry may not
create duplicate turns or incur repeated successful generation.

### 9.8 `work_payroll_person_context`

Optional per-person rubric, seeded from the person's role profile and work
profile signals.

| Column | Purpose |
|---|---|
| `organization_id`, `person_id` | scope |
| `context text` | what counts as work, legitimate lookalikes, off-limits, schedule notes |
| `revision int` | freshness |
| `updated_by uuid`, `updated_at` | |

Unique `(organization_id, person_id)`.

If empty, the analysis still runs but routes more ambiguous intervals to review;
it never assumes a role.

### 9.9 `work_payroll_runs`

Durable analysis state.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id` | scope |
| `status text` | `queued`, `running`, `done`, `failed`, `canceled` |
| `phase text` | `activity`, `evidence`, `classify`, `days`, `briefs`, `done` |
| `cursor jsonb` | day index, finding offset, week |
| `progress jsonb` | human-readable progress and counts |
| `lease_token text`, `lease_until timestamptz` | one active advancer |
| `attempt int`, `error text` | retry |
| `model text`, `prompt_version text` | provenance |
| `source_hash text` | run input |
| `target_revision int`, `as_of timestamptz`, `input_manifest jsonb` | frozen run identity, bounds and source revisions |
| `input_artifact jsonb`, `fetch_cursor jsonb`, `next_attempt_at timestamptz` | durable normalized provider pages/results, pagination and bounded retry scheduling |
| `resolved_policy jsonb`, `request_key text`, `cancel_requested_at timestamptz` | immutable policy, request idempotency and cancellation fence |
| `started_at`, `finished_at`, `created_at`, `updated_at` | |

Unique partial index on `review_id` where `status in ('queued','running')`;
index on `(status, lease_until)`.

### 9.10 Legacy tables

The repository contains an unused Agent OS-era `audit_profiles` /
`audit_runs` pair and `worktivityAudit.ts`. Payroll does **not** revive them:
they are per-user rather than per-organization, assume a Codex runner, and use
UTC day boundaries. The new engine may reuse provider primitives (`wtPost`,
`WtActivityLog`, `WtScreenshot`, fingerprinting), but not the legacy run model or
its UI. `fetchAllLogs` and `fetchAppsSummary` use UTC-date query assumptions;
they are not employee-timezone-neutral as written. Adapt their boundaries and
pagination explicitly as required in §10.3 rather than importing legacy rollups.

### 9.11 Analysis revision manifest

Add `work_payroll_analysis_revisions` with organization/review/person scope,
unique `(organization_id, review_id, revision)`, originating run, frozen `as_of`,
status (`building`, `published`, `abandoned`), canonical source/policy manifests,
exact and allocated totals, selected citation/classification references, and
published timestamp. Reserve a target revision when creating a run; publish it
and swap the review pointer atomically only after all deterministic phases
succeed. Never expose mixed revisions as a final record. Brief failure is an
explicit degraded output, not a failed hours calculation. Prior revisions remain
addressable; partial building revisions cannot be approved/exported.
Provide the composite unique ownership key including `person_id` for child FKs.
Use manifest `revision` consistently as the children's `analysis_revision`.

## 10. Analysis lifecycle

### 10.1 Create

`POST /api/work-os/admin/payroll/reviews` resolves the pay date and period,
validates the person and mapping, creates or loads the review, and creates a
`work_payroll_runs` row. A second request returns the active run rather than
starting a duplicate.

### 10.2 Advance

`POST /api/work-os/admin/payroll/runs/[runId]/advance` is a bounded,
resumable step. It:

- claims the run with a lease (`lease_token`, `lease_until`);
- executes one phase slice (one day, one classification batch, or one brief);
- writes idempotent day/finding/brief rows;
- updates `cursor` and `progress`;
- releases the lease;
- returns `{ status, phase, progress }`.

The admin UI reads progress every 2 seconds while the run is active and requests
at most one bounded advance at a time (progress GETs do not mutate). A
`CRON_SECRET` route `POST /api/work-os/admin/payroll/run-due` advances due runs
when no browser is open. A GitHub Actions workflow runs it every five minutes,
modeled on the existing screenshot retention workflow. Browser and scheduler
use the same fenced advancer, but never share the service secret with the UI.
`run-due` itself is service-only, not an admin browser endpoint: validate a
constant-time service bearer secret, derive tenant/person from each queued run,
and audit a system actor. The workflow belongs in Work OS alongside retention;
deployment wiring/secrets target the Agent OS-hosted app. GitHub schedules are
best-effort, not a durable worker or a five-minute completion SLA. Show stalled
progress and support authorized resume when the browser/scheduler is absent.
There is no existing general durable payroll worker to invoke.

A run that loses its lease is resumed by the next advance. A run that exceeds
its attempt limit is marked `failed` with a bounded error; the review keeps
partial day rows but is not approvable until a successful rerun.

Lease acquisition is one conditional DB write. Each commit/cursor advance
requires the same unexpired lease token and target revision; a timed-out old
advancer cannot publish after another claims the run. Renew before long calls,
abort on lease loss, and discard late results. Cursor and corresponding rows
commit atomically. Use a 180-second lease with renewal and a <=120-second phase
deadline; split paginated fetches/classification into bounded slices. Persist
retry state with at most five transient attempts per slice and exponential
backoff capped at 15 minutes; schema/auth/configuration failures fail immediately.
Cancellation fences all future writes and preserves published revisions. A new
run never mutates an approved review: require audited reopen first.

### 10.3 Phases

1. **Activity.** Fetch complete Worktivity `ActivityLogs` once per run/person,
   using exact UTC bounds covering all owned shifts/grace plus provider padding,
   then filter locally by verified EmployeeId and bounds. Persist each page and
   completeness watermark in the run input artifact; an in-memory cache is not
   resumability. Detect inconsistent pagination/conflicting duplicates, retry
   with a bounded failure, and never publish truncated data as complete. Fetch
   app context separately; its failure is visible but does not invalidate hours.
   Existing `fetchAppsSummary` fetches only page 1 and uses UTC-date bounds, so
   adapt/paginate it or explicitly label the result partial/UTC context. Do not
   present that helper's result as complete employee-local distribution. Bound
   concurrency to two active person runs and one provider request per advancer,
   with a shared credential-scoped limiter honoring 5/sec, 100/min, 1000/hour
   across browser/cron runs; per-request sleep is not a global limiter.
2. **Evidence.** For each day, find processed screenshot summaries and recaps.
   Trigger the existing bounded screenshot preparation only for frames allowed
   by its existing consent, feature, date and exclusion policy; payroll does not
   authorize historical backfill or re-retention of expired frames. Do not block
   on every frame. Record
   `screenshots_pending`, `frames_available`, and `evidence_expired`.
3. **Classify.** For each day, build candidate intervals and classify only the
   ambiguous frames. Reuse `work_payroll_frame_findings`.
4. **Days.** Compute deterministic totals and findings; upsert days and findings;
   compute the period totals.
5. **Briefs.** Generate Week 1 and Week 2 briefs from the selected recaps. A
   brief failure does not fail the day analysis.
6. **Done.** Set `ready` or `needs_review`, update `source_hash` and
   `analysis_revision`, and mark the run done (retain its provenance).

Phases are idempotent within the run's target revision. Upsert by the natural
keys defined in §9, never replace a published revision. Missing/late evidence
causes staleness after publication, not silent filling-in of published totals.

### 10.4 Progress and failure

The run's `progress` carries:

```json
{
  "phase": "classify",
  "day": 4,
  "days": 15,
  "message": "Day 4 of 15 — classifying 6 ambiguous frames",
  "daysDone": 3,
  "framesClassified": 18,
  "framesReused": 40,
  "findings": 7
}
```

The UI shows one progress line and a segmented day bar. A failure states the
phase and the bounded error; it never replaces the page with a raw stack trace.

### 10.5 Staleness and reruns

After a successful run, `source_hash` is stored. The review endpoint recomputes
the hash from the same inputs. A mismatch marks the review `stale` and lists the
changed inputs (schedule, sessions, recaps, screenshots). Re-analysis creates a
new `analysis_revision` and publishes new calculated days/findings, preserving
resolved decisions when their source hash matches and moving changed ones back
to `needs_review`.
Preservation also requires the same owned span, rule/policy version and decision
semantics, with a link to the old decision; preserve unlocated adjustments only
if their residual/overlap proof still holds, otherwise require review. Approval
and resolution requests require the expected row version, published analysis
revision and source hash; mismatches return 409 without partial writes.

Review states are separate from run and approval history: `draft` → `analyzing`
→ `needs_review` or `ready`; all required resolutions/corrections yield `ready`.
Failures yield `failed`, changed inputs yield `stale`, and only fresh `ready`
can become `approved`. `No work recorded` is a day/result label, not an alternate
approval state. Approved reviews retain that status with a separate
`evidence_changed_since_approval` marker. Audited reopen moves to `reopened`,
retains the prior approval pointer, and requires new analysis before readiness.
Exporting that pointer remains explicitly an old approval, not a new approval.

## 11. Approval and export

### 11.1 Approval rules

Approval is refused unless:

- the review is fresh `ready`, with every material finding resolved and no active run;
- `source_hash` matches;
- every scheduled working day has an effective schedule (a missing schedule is
  corrected in the person's schedule, not bypassed);
- every scheduled working day with no session and no activity has been
  acknowledged as `No work recorded`;
- no included session has `correction_status` of `needs_correction` or `invalid`,
  and all clock/pause boundaries are closed and valid;
- the administrator confirms the totals.

The server recomputes the totals before writing the approval; it does not trust
the client's numbers.
Approval locks the scoped review and verifies the expected row version,
published revision, fresh source manifest, and decision versions in a single DB
transaction; the snapshot insert, current pointer/totals/status, and audit commit
atomically. Source writers must participate in a per-person evidence-version
fence (or equivalent serializable conflict detection), so a correction committed
during approval cannot pass an earlier freshness check. The successful provider
refresh is persisted before this transaction; never hold a DB transaction open
while waiting for the provider/model. Unique request keys make retries return
the same approval. Reopen is likewise an atomic required-reason state change
with an append-only audit, not creation of an approval before new approval occurs.

### 11.2 Snapshot

Each approval writes one append-only `work_payroll_approvals` row. Its snapshot
contains:

- review id, person id, organization id, period, pay date, timezone;
- analysis revision, model, prompt version, source hash;
- period totals (tracked, break, inactivity, outside, held, recommended,
  approved);
- every day's approved minutes and status;
- every resolved finding with its decision, effect, reason, actor, and timestamp;
- every manual adjustment with its reason;
- the approver, approval timestamp, and note.

Also freeze employee display identity (no unnecessary email), per-day schedule
and session snapshots, exact duration/allocation version, every automatic finding
as well as resolved findings, source citation text/provenance needed to explain
the numbers, the two briefs and their readiness/failure states, typed source
snapshots, and export schema version. Store no raw frames, signed URLs, full
browser titles/URLs, or unrelated sensitive recap content. Snapshot availability
must not depend on future joins to mutable people, recaps, or briefs.

The snapshot is immutable and addressable by `approval_id`. A reopen creates a
new draft revision; a subsequent explicit approval creates a new approval row.
The old approval remains viewable and
exportable under its original `approval_id`. `work_payroll_reviews.current_approval_id`
points at the latest one.

### 11.3 Export

Two CSV exports and one print view:

- **Period summary CSV:** one row per employee, with period dates, pay date,
  tracked, excluded, unresolved, recommended, approved minutes, status, approval
  metadata, approval id/revision, and fixed snapshot timestamp.
- **Daily detail CSV:** one row per employee per workday, with date, schedule,
  sessions, tracked, break, inactivity, outside, unresolved, recommended,
  approved minutes, findings count, and a reason summary.
- **Print summary:** a print-friendly page with the period totals, the two week
  briefs, the daily record, and the approval receipt. No raw screenshots.

CSV requirements:

- `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control:
  private, no-store`, `X-Content-Type-Options: nosniff`.
- Stable headers; ISO dates; minutes and decimal hours; no embedded newlines in
  reason fields (sanitize).
- RFC 4180 quoting; neutralize spreadsheet formulas in every user/model-controlled
  text cell (including leading whitespace/control characters before `=`, `+`,
  `-`, or `@`); do not alter machine-generated numeric columns. Use safe filenames,
  no storage paths or raw sensitive evidence, and sanitized print markup.
- Export uses the approved snapshot, not live data.
- Every export writes a `work_audit_log` row with the review id, snapshot hash,
  row count, actor, and timestamp.
- Re-exporting the same snapshot is allowed and produces the same bytes; the
  hash is stable.

Fresh generation/access timestamps live in the audit or response metadata, not
inside stable CSV bytes. Pin encoding/BOM, newline, ordering, decimal formatting
and renderer version; store each canonical export payload/hash at approval or
first export so later renderer releases cannot change historical bytes. Bulk
export requires explicit approval IDs from one selected org/pay date, stable
employee ordering, and a manifest of included/excluded people; never silently
include a reopened draft or mix latest-live records into an old approval.
`excluded` on summary CSV includes outside time only when reconciled against
`recorded`; show `eligible_tracked`, `excluded_within_window`, `outside`, and
`held` separately to avoid implying `tracked − outside` is done twice. Approval
has zero held minutes; no-work approvals export a real zero row, not omission.

## 12. UI and interaction

### 12.1 Design direction

Use the existing Work OS material system. The local design constraint is
accuracy under pressure, not decoration.

- Warm canvas, paper/white work surfaces, near-black green ink.
- Signal green only for the forward action, current state, or a confirmed
  result. Observation stays cool blue. Warning text uses the text-safe amber.
- One hero statement per page; the reconciliation is the distinctive
  instrument.
- Flat records on hairlines, not a card grid.
- One radius family; controls 8–10px; panels 12–16px.
- Tables use tabular numerals; time readings never shift.
- No gradient washes, no donut charts as the primary instrument, no colored
  row rails, no decorative confidence scores.

The approved mockup's structure is the baseline. The visual polish pass may
refine type scale, spacing, and the reconciliation's representation, but it must
not add generic KPI tiles or a second navigation.

### 12.2 States

Every surface defines:

- **Loading:** content-shaped skeletons for the summary, reconciliation, and
  table; no blank page.
- **Refreshing:** current data stays visible with a local refresh mark.
- **Empty:** no workdays, no employees mapped, no recaps, no findings; each says
  what to do next.
- **Dense:** long names, 16 days, many findings; the table wraps without
  horizontal overflow.
- **Degraded:** stale analysis, failed run, expired images, consent withdrawn,
  Worktivity unavailable, missing schedule; each is named with a recovery path.
- **Error:** local inline error with retry; the page keeps the last record.
- **Approved:** read-only receipt with export and reopen.
- **Reopened:** a new revision with the old approval still visible.

### 12.3 Responsive behavior

Review at 1440×900, 1024×768, 720×900, and 390×844.

- At 1100px the week briefs remain two columns but tighten; at 760px they stack.
- At 760px the reconciliation lines wrap their amount beneath the label; the
  daily table drops the recap column before the date or hours.
- At 560px the day review becomes a bottom sheet with a viewport inset.
- Primary actions keep 40px targets on touch surfaces.
- No horizontal scroll at 390px.
- The print view is a separate layout, not the app chrome shrunk.

### 12.4 Accessibility

- Semantic headings, tables, lists, dialogs, and buttons.
- One accessible name per control; icon-only controls have labels and tooltips.
- Visible focus at 3:1; no focus lost on removed content.
- Dialog focus trap and restoration.
- Status is text plus shape/icon, never color alone.
- Charts have exact-value tables or accessible summaries.
- Reduced motion removes entrances, progress interpolation, and the timeline
  animation while preserving state.
- Text zoom to 200% does not clip the reconciliation or the table.

## 13. Permissions, privacy, and retention

### 13.1 Authorization

- Every page: admin-only via the existing admin layout.
- Every browser/admin API: `requireWorkOsAdmin` with the selected organization;
  the service-only `run-due` endpoint uses the separate §10.2 service contract.
- Every person read: verify the person belongs to the organization.
- No manager or employee access, even to their own payroll review.
- No cross-organization IDs in URLs without an org-scoped lookup.
- Pass the existing `x-work-os-organization-id` selection and authorization
  bearer to `requireWorkOsAdmin`; ambiguous membership must fail rather than
  choose a tenant. Authorize downloads/print/Q&A/history and each advance too,
  not just the page. Never accept a client actor or organization as authority.
- Cookie-authenticated mutations require same-origin/CSRF protection; use POST
  for approval, decisions, reopen, context, advance and screenshot reason grants.
  Rate-limit expensive endpoints and deny shared/public caching of all payroll
  responses, including errors. Authorization precedes any provider/model call.
- Worktivity's existing helper uses a deployment-global `WORKTIVITY_API_KEY`,
  not a proven organization-specific credential. Before ingestion verify the
  selected organization is entitled to that provider connection and the mapping
  belongs to it; fail closed for any other tenant. Filter provider EmployeeId
  locally; UserId or a client mapping is not interchangeable. Only allowlisted
  read endpoints may be called (Worktivity reads themselves use HTTP POST).
- Minimize model payloads to selected sanitized evidence; omit email, credentials,
  full URLs/query strings and unrelated personal content. Do not log model
  payloads, provider URLs containing `x_api_key`, raw images, or stack traces
  containing secrets. Record usage and bounded errors only.

### 13.2 Audit events

Write `work_audit_log` rows for:

- payroll review created;
- analysis started, completed, failed, canceled;
- finding resolved, reopened, or bulk-resolved;
- manual adjustment added or removed;
- review approved, reopened;
- export generated;
- flagged screenshot accessed, with reason;
- payroll context changed.

### 13.3 Retention

- Screenshot bytes: existing per-row `expires_at`/`deleted_at` retention; no
  payroll-specific extension or re-fetch of expired evidence. Current ingestion
  sets expiry 30 days after processing, not necessarily capture time. The
  retention job removes bytes and old hourly rollups, not retained per-frame
  summary/recap text. Payroll must respect actual row availability and not
  promise a new 30 days at each pay-period analysis.
- Screenshot summaries, recaps, findings, briefs, approvals, Q&A turns, and
  exports metadata: retained as payroll records; no automatic deletion in v1.
- The UI states when image evidence has expired and relies on the stored text.
- A future retention policy must preserve approval snapshots and audit history.

Do not disable existing source-retention jobs to retain payroll evidence. Freeze
only the minimal sanitized explanation/citations required by a receipt, and keep
provider input artifacts access-restricted (no signed URLs) until the review is
superseded and its provenance requirements are met. Indefinite payroll retention
and processing purpose require operator/legal sign-off before production (§19);
withdrawal of screenshot consent is not blanket permission to copy sensitive
content indefinitely. Legal deletion/correction procedures must be explicit and
must never silently rewrite a receipt; preserve an audited tombstone where lawful.

## 14. Failure modes

| Failure | Behavior |
|---|---|
| Worktivity unavailable or rate-limited | Run retries with backoff; review stays `analyzing` or `failed`; no partial total is shown as final. |
| No schedule | Day is `no_schedule`; approval blocked; link to fix the schedule. |
| No session | Scheduled day is `no_work` (acknowledged) when there is no activity; `no_session` and blocking when activity exists but the session is missing. |
| Missing screenshots | Time stays tracked; `low_evidence` or `unverified_gap` finding; never auto-deducted. |
| Consent withdrawn | No image analysis; metadata-only review; explicit notice. |
| Sensitive-content exclusion | Frame never sent to the model; absence is not idleness. |
| Vision failure | `unclear`; `needs_review`; never auto-deducted. |
| Invalid model JSON | Retry once; then mark the brief/answer failed; keep the record usable. |
| Expired images | Text evidence remains; image-dependent findings say so; approval still possible after resolution. |
| Stale evidence | Approval blocked; re-analyze or reopen. |
| Concurrent review | Optimistic revision check; 409 conflict; reload. |
| Duplicate run | Unique active-run index; return the existing run. |
| Server restart | Lease expires; next advance/cron resumes; partial rows are idempotent. |
| DST/timezone change | UTC elapsed durations, explicit offsets; ambiguous/nonexistent unstamped boundaries block; `timezone_changed` notice. |
| Overnight shift | Attributed to `shift_date`; window crosses midnight correctly. |
| Split shift | Multiple sessions summed; overlaps deduped. |
| Period crossing year | Date arithmetic, not string slicing; tests cover year end. |

## 15. Testing and acceptance

### 15.1 Unit tests

- Period resolver: 1st/16th, February, leap year, year end, month end, exact
  date inclusivity.
- Week split: 13-, 14-, 15-, and 16-day periods.
- Timezone and DST: local day bounds, overnight shifts, timezone change.
- Window: pre-shift, post-shift grace, beyond grace, no schedule.
- Breaks: scheduled windows, provider status runs, provider break seconds,
  overlap with inactivity, mismatch.
- Inactivity: 3-minute threshold, whole-run exclusion, short runs, gaps,
  meetings/training/reading exceptions, 0% at cadence boundaries.
- Tracked time: session union, post-shift activity, overlapping sessions,
  duplicate logs.
- Missing evidence: unverified gap, low evidence, never zero.
- Totals: integer minutes, no double counting, rounding.
- Property tests: exact partition union equals recorded, nonnegative categories,
  eligible plus outside equals recorded, no overlap, day sums equal period,
  permutation/duplicate invariance, decision retry invariance; largest-remainder
  ties/subminute slices, 179/180/181 seconds, sparse samples and leading/trailing gaps.
- Findings: auto vs review vs resolved, manual adjustments.
- Approval: blocked conditions, snapshot immutability, reopen versioning.
- Export: stable headers, minutes/hours, snapshot-only, sanitization.
- Staleness: each source change flips the hash.

### 15.2 API tests

- Admin-only and org-scoped for every route.
- Person lookup cannot cross organizations.
- Period validation and pay-date resolution.
- Run claim/lease/idempotency/resume.
- Exercise real disposable PostgreSQL transactions/constraints: two concurrent
  approvals, approval vs correction/reopen/advance, expired advancer writes,
  crash between row write/cursor update, and out-of-order retries. A mocked
  in-memory lease or static SQL match is not concurrency evidence.
- Finding resolution and bulk resolution.
- Approval refusal and success.
- Reopen and revision history.
- CSV content type, disposition, row counts, no raw paths.
- Q&A citations validated; no mutation tools.
- Screenshot access requires a reason, logs it, and respects consent/expiry.
- Cross-org child/FK/citation/cache injection, screenshot reason-grant replay,
  consent withdrawn between classification/cache reuse/preview, audit-write
  failure, global-provider credential scope mismatch, CSRF, formula injection,
  prompt injection, and body/cache/log secret leakage.

### 15.3 UI and static tests

- Admin route list includes Payroll and the page uses the label/content
  structure.
- No raw screenshot path or storage key reaches the client.
- No second OpenRouter client.
- The admin page is `data-work-os-workspace` scoped.
- Design tokens only; no new palette.
- Accessibility and responsive checks at the four reference widths.
- Empty/loading/dense/error/stale/approved/reopened states rendered.
- TestSprite when a reusable fixture exists or is needed.

### 15.4 Live acceptance

- Use a disposable fixture account for writes and approvals.
- Read-only live probe of one real period to confirm period resolution, evidence
  counts, and totals.
- Verify one full flow: analyze → review a finding → approve → export → reopen.
- Verify the cron advance route with a queued run.
- Stop the browser, expire a worker lease/restart the app, resume via service
  scheduler, and prove old fenced writes cannot publish. Verify provider pagination,
  capture direction/duration, person filtering and rate limits read-only before
  enabling automatic deductions; unknown provider semantics are an enablement block.
- Verify no Worktivity write occurred.
- Record the rendered screenshots and interactions; a build or static assertion
  is not visual acceptance.

## 16. Delivery phases

The full feature is one product outcome, but implementation should land in
reviewable slices:

1. **Deterministic core.** Migrations, period resolver, activity ingestion, day
   totals, admin period/employee read surfaces, no AI. This is useful on its own
   and proves the hours rules.
2. **Findings and approval.** Breaks, inactivity, outside window, gaps, review
   queue, manual adjustments, approval snapshot, CSV/print export.
3. **Weekly briefs.** Recap selection, synthesis, citations, stale handling.
4. **Targeted vision and Q&A.** Ambiguous-frame classification, frame cache,
   question loop, suggested questions.

Phases 3 and 4 can ship independently after phase 2. The UI surfaces can be
built in phase 1 with honest `Not analyzed`/`Brief not generated` states.

## 17. Implementation choices and fixed defaults

The implementation plan may choose internal module boundaries, but must not
reinterpret the time/state/security rules above. To avoid contradictory options:

- CSV column order is fixed/versioned by the plan; UTF-8 BOM, CRLF, deterministic
  ordering and four-decimal hours are the v1 defaults.
- Print is a browser print layout, not a PDF service or new HTML-download pipeline.
- Payroll context starts empty; an administrator may explicitly seed sanitized
  role/profile context with an audited edit. It never overrides locked rules.
- Zero-work scheduled dates and zero-work approvals require explicit notes/
  acknowledgements as defined above; an empty data fetch is not proof of zero.
- Re-analysis preserves only source/span/rule-identical decisions with provenance.
- The Work OS cron workflow invokes the Agent OS-hosted service; verify secrets
  and scheduler wiring in deployment, not a new durable-worker platform.

## 18. What would make this a failure

- A recommended total that cannot be traced to minutes and sources.
- A deduction caused by absent evidence.
- An approval that changes after new evidence without a reopen.
- A model-written number that the engine did not compute.
- A broad screenshot browser.
- A period that cannot be exported without manual reconstruction.
- A week brief that reads like generic filler or claims work that the recaps do
  not support.

## 19. Remaining product-owner questions

1. **Rounding:** approve the proposed exact-duration/whole-day largest-remainder
   minute allocation in §6.8, including half-up day rounding and employee-fair
   payable-first ties, or specify the required payroll rounding policy. This can
   change an exported minute and must not be chosen implicitly by a builder.
2. **Retention and lawful processing:** approve the v1 indefinite retention of
   minimal sanitized payroll receipts, decisions, Q&A and audit metadata, and
   confirm the payroll-processing purpose/consent and deletion obligations with
   the operator's legal/privacy owner. If indefinite retention is not permitted,
   provide the retention period and lawful exception rules before production.
   Existing 30-day raw-image retention must not be extended either way.

Provider capture semantics/capabilities, historical correction paths and cron
wiring are engineering verification gates, not product questions. Until proven,
the implementation must fail closed or expose explicit review/degraded states,
not invent evidence or a worker guarantee. All other previously open behavioral
choices are fixed above; no locked product decision has been intentionally changed.
