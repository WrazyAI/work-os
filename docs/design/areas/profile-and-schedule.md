# Profile, connected accounts, and work arrangements

**Use when:** Changing profile signals, account mappings, scheduled hours, or flexible arrangements.

**Owns:** Companion profile controls and account mappings; the shared work-arrangement contract across setup, Settings, and People.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the profile destination: [Settings categories and layout](settings.md).
- Changing clock actions: [Attendance and provider freshness](attendance.md).
- Changing flexible EOD availability: [Employee EOD review](eod-review.md).
- Changing arrangement review: [Administration people and person record](../admin/people.md).

**Implementation starting points:** [ProfileSettings.tsx](../../../desktop/work-os-companion/src/ProfileSettings.tsx), [PersonalSettings.tsx](../../../desktop/work-os-companion/src/PersonalSettings.tsx), [EmployeeSettings.tsx](../../../src/modules/work-os/employee/EmployeeSettings.tsx).

## Profile signals and connected accounts

The companion's shared Profile settings form keeps work profile signals and
workspace-mapped evidence accounts separate. Its normal home is inline
Settings → Profile, which the companion masthead avatar opens. These content
and control rules also apply when that form is hosted in an existing modal.
The web Settings page keeps its own grouped layout; the work-arrangement
contract below applies across surfaces.

- **Work profile signals.** Responsibilities, Outputs, and Evidence sources are
  picked, never typed. Each group lists its picked signals as solid green pills
  with one remove control, the selected work scope's remaining suggestions as
  dashed add chips, and one quiet `Add your own` control that opens a single
  bounded input. A catalog pick keeps its catalog id and `suggested` source,
  your own addition becomes a bounded `user` item, and a label is never kept
  twice within its kind. Nothing is written until `Save changes`, and the group
  is disabled while a save is in flight.
- **Connected accounts.** The evidence accounts the workspace has mapped to the
  person — Worktivity with its Worktivity email, each GitHub account by login,
  Nifty with its Nifty email — are read-only pills on a hairline band: paper
  surface, cool-neutral marks, no inputs and no controls, with the note
  `Mapped to you by your workspace. Their activity appears in your recaps and
  reports.` An unverified account is marked `Pending` instead of connected,
  real accounts lead and a shared automation account such as an Actions bot
  trails, and a person without mappings reads `No evidence accounts are mapped
  to you yet.` The group renders only when the profile payload carries the
  mapping block, so an older API can never produce an invented account.
- **Empty, dense, and degraded states.** An empty group says
  `Nothing picked yet.` and still offers its suggestions; long labels wrap the
  pill row instead of truncating the label; an account identifier may truncate
  with an ellipsis while the provider name stays readable; a missing mapping
  block hides the group rather than guessing.
- **Accessibility.** Each group is a fieldset named by its legend, a pick's
  remove control carries `Remove <label>`, an offered label carries
  `Add <label>`, the custom input is labelled for its group (Enter adds,
  Escape closes), and account pills are static text so nothing offers a control
  the employee cannot honor.

## Work arrangements and fixed-day flexible hours

Onboarding, Settings, and the administrator person record share one arrangement control. **Scheduled hours** keeps the existing weekday, start/end, break, and prompt contracts. **Flexible hours** keeps the chosen workdays and timezone but has no shift interval, break window, or daily/weekly hours target; it is not a leave day and it is not an all-day shift.

A flexible submission is a proposal until an administrator approves it. The current official arrangement remains in effect while a proposal is pending, a request for changes, or unapproved. Approval writes an effective-dated official row, ends the prior row the day before its effective date, and never rewrites recorded sessions or attendance. A replacement starts the next local day; a first arrangement may start today. When the timezone changes, the seam uses the later local date of the old and new timezones, so neither row loses coverage at the boundary. Approval is refused while the person has an open work session, so a running day keeps the boundaries it started with. Request changes preserves the official row and requires a note.

On flexible days, the dashboard and time surfaces never show a scheduled window, countdown, late state, missed-shift state, or required-hours progress. Clock-in needs no late or exception acknowledgement on an approved flexible workday, and clock-out needs no extended-shift acknowledgement. Starting on a non-working or leave day still requires the normal exception acknowledgement. Prompts follow the recorded session and the normal check-in cadence: one update at the first follow-up, then the configured interval; they are never anchored to invented wall-clock boundaries. Actual observed time and the selected days remain visible as facts, and work recorded outside the selected days remains recordable without being labelled a violation. Exceptions still apply: leave removes the day; a working-day or changed-shift exception makes it a working day, but a changed-shift exception on a flexible day does not create a shift window.

Today's EOD opens for a flexible worker once a work session has started or the day has closed; before any work it stays closed, so an early click cannot describe a day that has not happened. There is no scheduled clock-out to wait for.

Administration displays **Flexible hours** wherever it would otherwise print a time range, and carries the pending proposal in the person record with its days, timezone, submission time, and note. Legacy proposals without an arrangement remain scheduled. The timed schedule editor refuses overlapping official periods, and a flexible row is changed through its review rather than the timed editor.
