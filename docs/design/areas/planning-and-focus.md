# Planning, focus, and suggested goals

**Use when:** Changing the daily focus strip, Focus tab, plan details, or goal prompt.

**Owns:** Focus presentation, plan hierarchy, provenance, and suggested-goal precedence.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing focus-strip or dialog motion: [Focus, finder, and workflow transitions](../patterns/workflow-dialogs.md#focus-finder-and-workflow-transitions).
- Changing plan your day input, review, or confirmation: [Workflow dialogs and submission confirmations](../patterns/workflow-dialogs.md).
- Changing task rows: [Task rows, status, and selection](../patterns/task-rows.md).
- Changing clipped focus text: [Clipped text](../patterns/task-rows.md#clipped-text).
- Changing the first recap after the goal prompt: [Activity interval reviews](recaps.md).

**Implementation starting points:** [TaskFocusDetails.tsx](../../../desktop/work-os-companion/src/TaskFocusDetails.tsx), [PlanningSession.tsx](../../../desktop/work-os-companion/src/PlanningSession.tsx), [EmployeePlanBuilder.tsx](../../../src/modules/work-os/employee/EmployeePlanBuilder.tsx).

## Focus strip details

The focus strip opens a centered, labelled dialog containing the selected day's
full focus and its provenance, followed by the selected plan's parent items and
their subtasks when a plan exists. Each parent is a disclosure: its subtasks sit
nested beneath it, the parent is collapsed by default, and it states its recorded
plan state plus progress through its subtasks. When the current task page does
not carry a plan-linked task row (the plan can exceed the day page), the plan
item's recorded success criteria stand in as its subtasks and are labelled
"Planned"; loaded task children always win over that fallback, so an edited
task never shows a stale criteria list. The plan heading states how many
items are recorded done. The plan's parent rows form one grouped surface — a
single boundary with no per-row rules — so a long plan reads as a record rather
than a stack of lines; each row keeps its disclosure and focus state. The dialog
body is the scroll region: it spans the dialog's full width, the header and
footer stay fixed, and its thin themed scrollbar sits at the dialog's edge
rather than inside the content column. The strip's existing review and retry
buttons retain their own actions; a visible details trigger supports keyboard
access and the focus sentence remains a convenience press target. Current-day focus offers Edit
focus, while historical focus is read-only. Escape, the close control, and a
backdrop press dismiss the dialog and restore focus; long text wraps, the body
scrolls within the viewport, and the header and footer stay put. The dialog
arrives and leaves with the shared small translation and fade, and disclosures
expand with a height-and-opacity transition; reduced motion removes both.

## Focus panel goal card

The sheet's Focus tab is the day's goal editor. With no goal set it is the
editor: the goal field, the "tasks remain the source of work intent" note, and
an optional suggestion from today's tasks. Typing never saves; one `Apply goal`
action commits the text, and `Use suggestion` only fills the field for review.

Applying the first goal of the day hands off to the plan builder with the text
seeded, so it follows the same build → review/refine → confirm flow as shift
start and can create the day's tasks and subtasks. Once a goal is set, the tab
shows a goal card — the goal text with a single pen action in its top-right
corner. The pen reveals the same editor with `Apply` and `Cancel`; editing an
existing goal only changes its wording and never creates tasks or subtasks.
The card keeps the provenance and save-state line, with an inline retry when a
save is queued offline or conflicted.

Beneath the goal, the Focus tab carries the same Recent activity interval
stream as the floating Tasks tab — recaps newest first, each with the same
bottom row of two buttons that animate open the notes panel (which holds the
inferred provenance line and any gaps) or the evidence panel (its button
reporting screenshot and GitHub event counts as icon metrics, revealing
separate Screenshots and GitHub activity sections) — plus confirm/amend
actions, so the day's goal and its interval check-ins read as one record. The
stream is separated by a hairline. Each sheet tab scrolls as its own region.

The goal sits in a collapsible section: a `Today's focus` eyebrow with one
far-right disclosure. Collapsed, the section hides its own body — the goal card
or the editor — so the stream beneath it is reachable without scrolling past a
tall editor the employee is not using. The collapsed row is the eyebrow and the
disclosure only: it never repeats the goal as a subtitle above the body it was
supposed to hide, and the body's own display rule never outranks `[hidden]`. The choice is remembered on the device (best-effort
local storage, default expanded) and only the employee's own disclosure
changes it; applying a goal never re-collapses the section. The recap stream
below pages on demand: a small contiguous page with the same explicit
`Load more` edge and `Showing N of M` line as the floating Tasks tab, so the
Focus tab never loads the whole 30-day history to show the day's recaps.

## The goal question and the suggested goal

The day opens by asking what the employee is working on. That question is the
day's first prompt — the crown bubble's agenda ask in the companion and the
plan notice on the web — and it is **required** while the day carries no goal.
A due check-in never preempts it: the question holds the day's prompt until a
goal exists, and its hold instant is the first follow-up.

When the hold expires and the day still has no goal, the first recap writes
one:

- **Source.** One short sentence from three bounded sources: unfinished work
  carried from earlier days, work created or due today, and the interval's
  recorded activity. The write is a small, tool-free model call; a failure
  leaves the recap goal-less rather than blocking it.
- **Provenance.** The goal is saved with `goal_provenance = suggested` and is
  labelled as a suggestion everywhere — `Suggested by Otto` on the companion's
  focus line, `suggested by Otto` in the web workspace, `Suggested goal` in the
  EOD. It is never presented as the employee's own words.
- **Precedence.** An employee goal always wins: the write is conditional on the
  goal still being empty, so a goal typed while the model was running survives.
- **The recap follows.** The interval synthesizes against that goal, so the
  day, its recaps, and its EOD describe the same focus. The companion requests
  the held recap once the hold instant passes, deduped per slot.
