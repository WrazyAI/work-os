# Work OS payroll review — design

**Status:** Draft for approval
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

- No pay rates, currency, taxes, deductions, invoices, or payroll provider
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
- The roster lists every active person with a Worktivity mapping:
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
   - tracked by Worktivity;
   - breaks excluded;
   - qualifying inactivity excluded;
   - outside the payable window;
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
- no session is in `needs_correction` or `invalid`;
- the administrator has reviewed the totals, including any manual adjustment.

The approval dialog repeats the period, tracked, excluded, recommended, and
approved minutes; requires an optional note; and states that the snapshot will
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
- The eligible window is `[scheduled_start, scheduled_end + 60 minutes]`.
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
  block.

The effective schedule for a date comes from the active `work_schedules` row,
overridden by a `work_schedule_exceptions` row for that date. `leave` means no
workday. `changed_shift` replaces the times. `working_day` adds a day.

Every scheduled working day in the period gets a day row, whether or not a
session was mirrored. Split shifts and multiple sessions on one local date are
summed in the same day record. Overnight sessions are attributed to the
session's `shift_date`, not to the calendar date of each activity sample.
Overlapping session or activity intervals are unioned by minute so no minute is
counted twice.

### 6.3 Tracked time

`tracked_minutes` is the union of:

- the session interval `[clocked_in_at, clocked_out_at]` (or now for an open
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
   exist; otherwise the session's accumulated `paused_seconds` as a day-level
   break total. Manual pause is a real break whether or not Worktivity's
   authoritative-break flag is enabled.
4. The session's `provider_break_seconds` as a cross-check.

Overlapping break sources are unioned, so a scheduled break and a provider break
covering the same minutes deduct once. A derived break run becomes a `break`
finding with its time range and source. It is deducted from tracked time and
excluded from the inactivity analysis.

If recorded activity appears during a scheduled break, or the derived break
total disagrees materially with the provider's break seconds, the interval is
flagged `activity_during_break` or `break_mismatch` for review instead of
silently paying or excluding it.

### 6.5 Inactivity

Activity samples are Worktivity `ActivityLogs` rows. The engine:

1. Sorts and deduplicates them by log ID.
2. Infers the cadence from the median gap inside a session, ignoring gaps over
   30 minutes and non-positive gaps; clamps it to 1–15 minutes.
3. Gives each log a time slice from its timestamp to the next log, capped at
   twice the cadence and at the session/window boundary.
4. Groups adjacent logs whose `ActivityLevel` is exactly 0 into a continuous
   run. A run also requires the gap between samples to be no more than twice the
   cadence, so a long provider gap is not mistaken for continuous zero activity.
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

The decision table is deliberately conservative:

| Evidence on the qualifying run | Result |
|---|---|
| Frame or stored summary establishes meeting, training, or work-related reading | `auto_payable` — visible, not deducted |
| Frame classified `work` at or above the confidence floor | `auto_payable` — visible, not deducted |
| Frame classified `idle` or `nonwork` at or above the confidence floor, and no exception evidence | `auto_excluded` — deducted, visible, reversible in review |
| No frame, summary expired, consent withdrawn, policy-excluded frame, or vision failure | `needs_review` — held out of the recommended total, never auto-deducted |
| Frame classified `unclear`, or confidence below the floor | `needs_review` — held out, never auto-deducted |
| Person context names the app as legitimate, but the frame is `idle`/`nonwork` | `needs_review` — context explains a flag, it does not override a clear non-work frame |

`auto_excluded` is therefore available only when the provider confirms 0%
activity and an available, non-excluded frame positively shows idleness or
non-work. Every other missing or ambiguous case is a human decision. A
consent-withdrawn or image-expired employee can still reach a ready review, but
their qualifying runs are held and must be resolved by the administrator rather
than silently deducted.

A single 0% sample whose slice is at least 3 minutes can qualify. A series of
short 0% slices qualifies only when their combined continuous duration reaches
3 minutes. A run adjacent to a data gap never extends into that gap.

### 6.6 Unverified gaps and low evidence

A gap in activity logs longer than twice the inferred cadence inside the
eligible window is an `unverified_gap`. It is not assumed to be zero. It stays
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

All values are integer minutes.

```
tracked          = union(session intervals, activity intervals) ∩ eligible window
break            = union(break intervals) ∩ tracked
inactivity       = confirmed 0% runs ∩ tracked ∩ not break ∩ no exception
outside          = union(recorded time) − eligible window
held             = findings whose effect is "hold"
recommended      = tracked − break − inactivity − held
                   + resolved_payable + manual_inclusions − manual_exclusions
approved         = recommended at the moment of approval
```

Every finding carries an `effect` so a decision moves the total exactly once:

| Finding | Effect | What a decision does |
|---|---|---|
| `break` | `exclude` | Already deducted; no further change |
| `inactivity` with `auto_excluded` | `exclude` | Already deducted; resolving payable adds the run back |
| `inactivity` with `auto_payable` | `payable` | Already included; visible only |
| `inactivity` with `needs_review` | `hold` | Held out; payable resolution adds it, exclusion resolution leaves it out |
| `activity_during_break` | `hold` | The break is already deducted; paying the disputed work adds those minutes back |
| `unverified_gap` | `acknowledge` | Minutes remain in recommended; a manual exclusion subtracts them |
| `low_evidence` | `acknowledge` | Minutes remain in recommended; a manual exclusion subtracts them |
| `break_mismatch` | `acknowledge` | No automatic total change; the administrator may adjust |
| `manual_adjustment` | `include_adjustment` or `exclude_adjustment` | Applies the signed adjustment once |

`resolved_payable` is the sum of held findings the administrator counted as
work. A held finding resolved as excluded simply leaves `held` and is not added
back; it is not subtracted a second time. Manual exclusions are subtracted
separately and always carry a reason.

"Material finding" in the approval rules means any finding whose effect is
`hold` or `acknowledge`, plus any `low_evidence` finding. `auto_payable` and
`auto_excluded` findings are visible but do not block approval.

The review displays both the calculated total and the reviewed total so an
administrator can see exactly what changed.

### 6.9 Worked example

Scheduled 15:00–21:00. Tracked 15:00–21:10 = 370 minutes. A 20-minute break, a
45-minute confirmed 0% run with no meeting/training/reading evidence, and 10
minutes held for review.

```
tracked      370m
break        −20m
inactivity   −45m
held         −10m (out of the recommended total, not deducted)
recommended  295m = 4h 55m
```

Time at 22:01 would be outside the window and excluded. A 22-minute meeting at
0% activity inside the day would be payable, not deducted.

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
employee tracking consent. If screenshot consent is absent or withdrawn:

- no screenshot is decrypted or classified;
- activity and session metadata still produce a review;
- the surface states `Screenshot evidence unavailable by consent`;
- missing screenshots are not treated as suspicious or as zero activity.

The existing sensitive-app/domain policy and sensitive-content detector run
before payroll classification. An excluded frame is never sent to the model. Its
absence is `excluded_by_policy`, not evidence of idleness.

### 7.3 Raw screenshot access

Payroll does not grant broad screenshot browsing. A frame is reviewable only
when it is attached to a payroll finding that is `needs_review`, and only for an
administrator.

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

### 7.4 Evidence freshness

Each review stores a `source_hash` over:

- the person's effective schedules and exceptions in the period;
- session ids, states, scheduled times, clock times, break seconds, and
  correction status;
- the selected activity log sample ids and their source fields;
- the screenshot summary ids, prompt versions, and processing statuses;
- the activity interval ids, revisions, and review statuses;
- the payroll context revision.

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

All calls go through the single `src/lib/work-os-ai-model.ts` transport.

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
- `idle`, `nonwork`, and `unclear` never auto-deduct; they create or update a
  finding for human review.
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

### 8.4 Weekly briefs

Each brief is generated from that week's recaps, not from the whole period.

Source selection:

- ready `work_activity_intervals` whose windows fall in the week;
- prefer `confirmed` and `amended` recaps; include `inferred` recaps with their
  provenance;
- include the recap's headline, detail, activity bullets, uncertainties, app
  context, and recorded GitHub activity when present;
- include separately recorded outcomes (completed tasks, output evidence) only
  in a distinct `Recorded outcomes` section, never as recap claims;
- if the week has no recaps, the brief states that and falls back to the week's
  EOD summaries and recorded outcomes, clearly labeled `No recaps recorded;
  compiled from EOD summaries and recorded outcomes.` It never invents a recap.

Output schema:

```json
{
  "title": "short theme",
  "summary": "2-3 sentences",
  "themes": [
    {
      "heading": "short theme",
      "detail": "2-4 sentences",
      "source_interval_ids": ["uuid"]
    }
  ],
  "open_items": [
    { "text": "unresolved or carried work", "source_interval_ids": ["uuid"] }
  ],
  "gaps": ["what the week's evidence does not cover"]
}
```

Validation:

- Every `source_interval_ids` entry must be a real interval in that week and in
  the source set. Invalid citations are dropped; if fewer than one valid source
  remains for a theme, the theme is dropped.
- No completion claim unless a completed task or output evidence is cited.
- No productivity, effort, quality, or pay-eligibility claim.
- No decimal hours in prose; use `4h 55m`.
- The brief is retried once on invalid JSON. A second failure marks the brief
  `failed`; the review can still be approved from the daily record, but the
  failure is visible.
- The brief stores its source hash. If a source recap is amended or added, the
  brief becomes `stale` and can be regenerated.

The brief is concise: a title, 2–3 sentence summary, 2–5 themes, and at most 4
open items or gaps. It is not a second EOD.

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

## 9. Data model

All new tables are organization-scoped and use `organization_id` on every row.
They are written through the server's admin client; access is enforced at the
API boundary with `requireWorkOsAdmin`. No table is exposed directly to the
browser.

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
| `source_hash text` | evidence freshness |
| `model text`, `prompt_version text` | synthesis provenance |
| `totals jsonb` | tracked, break, inactivity, outside, held, recommended, approved; raw and reviewed |
| `current_approval_id uuid` | points at the latest immutable approval row |
| `approved_minutes int`, `approved_by uuid`, `approved_at timestamptz`, `approval_note text` | current approval quick read |
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
| `superseded_at timestamptz` | set when a later approval exists |
| `export_hash text` | stable hash of the snapshot used by exports |
| `created_at` | |

Unique `(review_id, revision)`; index `(organization_id, review_id, approved_at desc)`.
Exports name an `approval_id`, so re-exporting an older approval is possible and
produces the same bytes.

### 9.3 `work_payroll_days`

One row per workday in a review.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `person_id` | scope |
| `local_date date` | the scheduled workday or session `shift_date` |
| `week smallint` | 1 or 2 |
| `session_ids jsonb` | sessions included; empty for a no-work day |
| `schedule_snapshot jsonb` | effective start/end, exception, source |
| `status text` | `calculated`, `needs_review`, `resolved`, `no_schedule`, `no_session`, `no_work`, `leave` |
| `tracked_minutes`, `break_minutes`, `inactivity_minutes`, `outside_minutes`, `held_minutes`, `recommended_minutes`, `approved_minutes int` | totals |
| `activity_summary jsonb` | compact runs, apps, statuses, productivity, cadence |
| `findings_summary jsonb` | counts and kinds |
| `source_hash text` | day-level freshness |
| `created_at`, `updated_at` | |

Unique `(review_id, local_date)`; index `(organization_id, person_id, local_date)`.

### 9.4 `work_payroll_findings`

The review queue.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `day_id`, `person_id` | scope |
| `kind text` | `inactivity`, `break`, `outside_window`, `unverified_gap`, `low_evidence`, `activity_during_break`, `break_mismatch`, `possible_work`, `manual_adjustment` |
| `start_at`, `end_at timestamptz`, `minutes int` | interval |
| `status text` | `auto_payable`, `auto_excluded`, `needs_review`, `resolved_payable`, `resolved_excluded` |
| `effect text` | `exclude`, `payable`, `hold`, `acknowledge`, `include_adjustment`, `exclude_adjustment` |
| `reason text` | human-readable explanation |
| `evidence jsonb` | activity log ids, screenshot summary ids, interval ids, app/title, classification |
| `resolution_note text`, `resolved_by uuid`, `resolved_at timestamptz` | decision |
| `source_hash text` | freshness |
| `created_at`, `updated_at` | |

Index `(review_id, status)`, `(day_id)`, `(organization_id, person_id)`.

A finding is the unit of human decision. A 0% run, a break, an outside-window
stretch, a gap, or a manual adjustment is one finding. Per-minute rows are not
created.

### 9.5 `work_payroll_frame_findings`

Targeted vision cache.

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `day_id` | scope |
| `screenshot_summary_id uuid`, `evidence_event_id uuid` | frame |
| `captured_at timestamptz`, `app text`, `activity_level int` | source |
| `category text` | `work`, `meeting`, `training`, `reading`, `idle`, `nonwork`, `unclear` |
| `confidence numeric`, `reason text` | classifier output |
| `model text`, `prompt_version text`, `rubric_hash text`, `classification_key text` | cache identity |
| `created_at` | |

Unique `(organization_id, screenshot_summary_id, classification_key)`; index
`(review_id, day_id)`.

### 9.6 `work_payroll_week_briefs`

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id`, `week smallint` | scope |
| `period_start date`, `period_end date` | exact dates |
| `status text` | `missing`, `generating`, `ready`, `failed`, `stale` |
| `title text`, `summary_markdown text` | brief |
| `themes jsonb`, `open_items jsonb`, `gaps jsonb` | structured body |
| `source_interval_ids jsonb` | citations |
| `source_hash text`, `model text`, `prompt_version text` | provenance |
| `error text`, `generated_at timestamptz` | |
| `created_at`, `updated_at` | |

Unique `(review_id, week)`.

### 9.7 `work_payroll_questions`

| Column | Purpose |
|---|---|
| `id uuid pk`, `organization_id`, `review_id` | scope |
| `actor_user_id uuid` | administrator |
| `question text`, `answer text` | turn |
| `citations jsonb` | validated record links |
| `model text`, `created_at` | provenance |

Index `(review_id, created_at desc)`.

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
| `started_at`, `finished_at`, `created_at`, `updated_at` | |

Unique partial index on `review_id` where `status in ('queued','running')`;
index on `(status, lease_until)`.

### 9.10 Legacy tables

The repository contains an unused Agent OS-era `audit_profiles` /
`audit_runs` pair and `worktivityAudit.ts`. Payroll does **not** revive them:
they are per-user rather than per-organization, assume a Codex runner, and use
UTC day boundaries. The new engine may reuse timezone-neutral provider helpers
(`wtPost`, `WtActivityLog`, `WtScreenshot`, `fetchAppsSummary`, fingerprinting),
but not the legacy run model or its UI.

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

The admin UI polls every 2 seconds while the run is active. A
`CRON_SECRET` route `POST /api/work-os/admin/payroll/run-due` advances due runs
when no browser is open. A GitHub Actions workflow runs it every five minutes,
modeled on the existing screenshot retention workflow. The route is also safe to
call from the UI.

A run that loses its lease is resumed by the next advance. A run that exceeds
its attempt limit is marked `failed` with a bounded error; the review keeps
partial day rows but is not approvable until a successful rerun.

### 10.3 Phases

1. **Activity.** Fetch Worktivity `ActivityLogs` for the period once per person,
   padded by one day and filtered to the person. Fetch `Insights/AppsSummary`.
   Cache the result on the run until the phase completes.
2. **Evidence.** For each day, find processed screenshot summaries and recaps.
   Trigger the existing bounded screenshot preparation for frames that are
   missing but still within retention; do not block on every frame. Record
   `screenshots_pending`, `frames_available`, and `evidence_expired`.
3. **Classify.** For each day, build candidate intervals and classify only the
   ambiguous frames. Reuse `work_payroll_frame_findings`.
4. **Days.** Compute deterministic totals and findings; upsert days and findings;
   compute the period totals.
5. **Briefs.** Generate Week 1 and Week 2 briefs from the selected recaps. A
   brief failure does not fail the day analysis.
6. **Done.** Set `ready` or `needs_review`, update `source_hash` and
   `analysis_revision`, and clear the run.

Phases are idempotent. Re-running a completed phase replaces its rows by natural
key rather than duplicating them.

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
new `analysis_revision` and replaces the calculated days/findings, preserving
resolved decisions when their source hash matches and moving changed ones back
to `needs_review`.

## 11. Approval and export

### 11.1 Approval rules

Approval is refused unless:

- the review is `ready` or `needs_review` with every material finding resolved;
- `source_hash` matches;
- every scheduled working day has an effective schedule (a missing schedule is
  corrected in the person's schedule, not bypassed);
- every scheduled working day with no session and no activity has been
  acknowledged as `No work recorded`;
- no session is `needs_correction` or `invalid`;
- the administrator confirms the totals.

The server recomputes the totals before writing the approval; it does not trust
the client's numbers.

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

The snapshot is immutable and addressable by `approval_id`. A reopen creates a
new revision and a new approval row; the old approval remains viewable and
exportable under its original `approval_id`. `work_payroll_reviews.current_approval_id`
points at the latest one.

### 11.3 Export

Two CSV exports and one print view:

- **Period summary CSV:** one row per employee, with period dates, pay date,
  tracked, excluded, unresolved, recommended, approved minutes, status, approval
  metadata, and export timestamp.
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
- Export uses the approved snapshot, not live data.
- Every export writes a `work_audit_log` row with the review id, snapshot hash,
  row count, actor, and timestamp.
- Re-exporting the same snapshot is allowed and produces the same bytes; the
  hash is stable.

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
- Every API: `requireWorkOsAdmin` with the selected organization.
- Every person read: verify the person belongs to the organization.
- No manager or employee access, even to their own payroll review.
- No cross-organization IDs in URLs without an org-scoped lookup.

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

- Screenshot bytes: existing 30-day retention; no payroll-specific extension.
- Screenshot summaries, recaps, findings, briefs, approvals, Q&A turns, and
  exports metadata: retained as payroll records; no automatic deletion in v1.
- The UI states when image evidence has expired and relies on the stored text.
- A future retention policy must preserve approval snapshots and audit history.

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
| DST/timezone change | Local-day helpers and recorded session timezone; `timezone_changed` notice. |
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
- Findings: auto vs review vs resolved, manual adjustments.
- Approval: blocked conditions, snapshot immutability, reopen versioning.
- Export: stable headers, minutes/hours, snapshot-only, sanitization.
- Staleness: each source change flips the hash.

### 15.2 API tests

- Admin-only and org-scoped for every route.
- Person lookup cannot cross organizations.
- Period validation and pay-date resolution.
- Run claim/lease/idempotency/resume.
- Finding resolution and bulk resolution.
- Approval refusal and success.
- Reopen and revision history.
- CSV content type, disposition, row counts, no raw paths.
- Q&A citations validated; no mutation tools.
- Screenshot access requires a reason, logs it, and respects consent/expiry.

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

## 17. Open decisions for the builder

These are intentionally left to the implementation plan unless the product
owner objects:

- exact CSV column order and whether a UTF-8 BOM is needed for Excel;
- whether the print view is browser print or a generated HTML download;
- whether payroll context is seeded automatically from `work_profile` or starts
  empty;
- whether a zero-work employee needs an explicit `No work recorded` approval
  rather than an empty period;
- whether re-analysis preserves resolved findings by source hash or resets all
  decisions (the design requires preservation when the source is unchanged);
- whether the cron workflow lives in Work OS or the Agent OS deployment repo.

## 18. What would make this a failure

- A recommended total that cannot be traced to minutes and sources.
- A deduction caused by absent evidence.
- An approval that changes after new evidence without a reopen.
- A model-written number that the engine did not compute.
- A broad screenshot browser.
- A period that cannot be exported without manual reconstruction.
- A week brief that reads like generic filler or claims work that the recaps do
  not support.
