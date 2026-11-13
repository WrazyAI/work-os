# Flexible contractor onboarding

## Purpose

Allow a person who works on fixed days but chooses when and how long to work to complete Work OS onboarding without inventing a shift or an hours target. Kalia is the motivating example; this is a general capability, not an account-specific change.

## Agreed behavior

- Onboarding offers a contractor / flexible-hours option alongside the existing scheduled-hours experience.
- The person selects at least one fixed workday and their timezone. They do not choose start or end times, scheduled breaks, or daily or weekly hours targets.
- An administrator reviews the submitted arrangement. Actual time worked remains visible; do not label the person late or short of required hours.
- Existing scheduled workers retain their current experience and behavior.

## Design decisions

### Arrangement and onboarding

Represent the work pattern explicitly as either `scheduled` or `flexible`, separate from employment classification. The onboarding label may say “Contractor / flexible hours”; selecting it describes how the person works and must not itself establish their legal or payroll classification.

Keep the existing day selector and timezone control. For flexible hours, hide shift start, shift end and scheduled break controls, and explain that work can happen at any time on the selected days. Do not expose any hours-target field. Switching patterns in a draft must not silently submit hidden shift times as a flexible arrangement. Preserve any unsent scheduled draft values when switching back if practical, but never interpret them as part of a flexible proposal.

Draft saves, reloads and submission preserve the arrangement, selected days and timezone. Validate on the server: a recognized arrangement, at least one valid distinct weekday and a valid timezone are required. Flexible submissions do not require or create start/end times or break windows. Existing clients and historical proposals without an arrangement discriminator retain scheduled semantics; they must not suddenly become flexible.

### Proposal, review and official state

Store a flexible proposal distinctly from a scheduled proposal in the existing onboarding flow. Admin review clearly displays “Flexible hours,” selected workdays and timezone, with no fabricated times or hours target. Keep proposal and official arrangement distinct: an employee submission alone must not silently overwrite an existing official schedule. Approval makes the chosen arrangement official; rejection or a pending proposal leaves the existing official arrangement intact. An administrator must be able to correct the selected days and timezone through the supported review or management flow.

Persist an approved flexible arrangement as an explicit, organization- and person-scoped record with its workdays, timezone, effective period and arrangement type. Do not manufacture a midnight-to-midnight shift. Ensure at most one applicable official arrangement is chosen for a person and date; transitioning between scheduled and flexible arrangements must not erase past schedule history. The implementation plan will select an additive schema and migration after checking existing review, exceptions and effective-date constraints. Existing employee schedules and historical records are not rewritten.

Until an initial flexible proposal is approved, display it as pending rather than as an official schedule. The person's ability to start a work session must not depend on inventing a shift. Do not infer manager approval from submission.

### Workdays, sessions and reporting

Resolve expected workdays from the approved arrangement in its timezone, using applicable exceptions where the product supports them. An approved flexible arrangement must not fall through to the current no-schedule behavior that treats every day as eligible. Preserve existing behavior for people who have no arrangement at all.

Flexible workers can start and stop at any time and have multiple sessions. Calculate actual worked time using existing session and authoritative break rules; do not create check-ins or alter substantive-update timestamps merely from activity inference. Keep existing check-in cadence tied to actual work, and avoid scheduled-shift start/end reminders or automatic late, missed-shift, overtime or insufficient-hours judgments for flexible arrangements. Do not create an hours target implicitly.

Show actual recorded time and the selected workdays in employee and admin views, labelled as flexible; do not display a shift interval or progress against a target. Work outside the selected days remains recordable and must not be automatically described as a violation. Existing attendance evidence remains intact.

For sessions crossing a local midnight, preserve the current session attribution behavior rather than silently changing historical accounting. Test and document exactly how current behavior presents such sessions before shipping; any new splitting or allocation policy requires separate approval.

### Access and safety

Only the employee can submit their own proposal; existing authorized administrators manage review and official arrangements within the correct organization. Client-provided person and organization identifiers must not bypass server authorization. Switching arrangement types must not delete attendance, sessions, check-ins or prior schedules. No change to Kalia's production account or existing data is authorized by this design.

## Acceptance criteria

1. A new flexible worker can save, resume and submit onboarding with chosen days and timezone, without entering a shift or hours target.
2. The administrator sees and can review the actual proposed flexible arrangement; pending or rejected changes do not overwrite an official schedule.
3. After approval, selected days resolve correctly in the worker's timezone, and unselected days are not falsely treated as scheduled days; work can still be recorded on them.
4. Multiple sessions and existing break policy produce actual worked time without a fabricated interval, target or late/short-hours warning.
5. Existing scheduled workers, old clients, historical proposals and users without an arrangement retain their existing behavior.
6. Arrangement changes preserve history and enforce tenant isolation. Invalid days, timezone, arrangement and unauthorized review fail safely.
7. Desktop and narrow layouts, loading, validation, keyboard/focus and reduced-motion states are checked, with focused tests, typecheck, full suite, and applicable live and TestSprite verification.

## Delivery and release

Implement through a separately reviewed plan, additive migration if needed, and the repository's Work OS / Agent OS convergence process. A companion outcome requires an Unreleased changelog entry and release-queue record. A companion installer or updater release is subject to the five-outcome policy; merging this feature alone does not imply immediate publication. Verify the queue at release time and do not assume an exception.

## Builder decisions and review points

- Choose the smallest compatible schema for official arrangements after tracing admin review, schedule exceptions and reports; do not overload mandatory shift times with placeholders.
- Identify all schedule-dependent reminders, attendance projections and desktop/web surfaces before implementation. Where existing behavior is ambiguous, preserve it unless it conflicts with the acceptance criteria.
- Confirm how review and effective dates interact with existing official schedules and drafts; document any choice that changes user-visible behavior before implementation.
- No compensation, payroll, legal classification, hour quota, new time-allocation policy or Worktivity provisioning is in scope.
