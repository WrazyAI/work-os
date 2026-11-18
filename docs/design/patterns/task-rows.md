# Task rows, status, and selection

**Use when:** Changing employee ledger rows or shared task behavior in chat and administration.

**Owns:** Employee ledger geometry; shared action menus, readable overflow, status, selection, and completion cascades.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the action menu or focus behavior: [Actions, forms, menus, and keyboard behavior](controls.md).
- Changing employee ordering or paging: [Employee task workspace and finder](../areas/tasks.md).
- Changing administration dates or sort rules: [Administration task record](../admin/tasks.md).
- Changing the drawer or evidence actions: [Task drawers and completion evidence](task-details.md).

**Implementation starting points:** [taskSurfaces.tsx](../../../desktop/work-os-companion/src/taskSurfaces.tsx), [styles.css](../../../desktop/work-os-companion/src/styles.css), [selection.ts](../../../desktop/work-os-companion/src/chat/selection.ts).

## Scope

The employee ledger sections own employee task-list geometry and its agenda
strip. [Chat cards](../areas/chat.md) and [administration tables](../admin/tasks.md)
keep their own columns and layout. Clipped text, task actions, status vocabulary,
selection where supported, and completion cascades are shared. Use the affected
area guide for its overdue-date predicate and available actions.

## Employee ledger layout

Use a flat, readable list with these columns in order: completion,
task and metadata, progress, due date, status, and actions.

## Shared task actions

Where a surface offers a task actions menu, its actions column is one intrinsic
menu cell at the trailing edge: a row with
an action for this actor carries a single ellipsis trigger aligned with the
status pill, and the trigger never widens the row or shifts when a menu opens.
The menu is detached ([menus and detached surfaces](controls.md#menus-and-detached-surfaces)) and opens beside its trigger, so the row keeps its
height and no action is inlined as text. A row with nothing available to this
actor renders no trigger — an empty menu is never offered — and a cached
payload that predates the capability answer waits for the refresh instead of
guessing from assignees. The status items are the one place a menu states a
stored state: the option that matches the status the row displays carries the
check mark and is disabled, because choosing it would write the value the task
already holds.

## Employee ledger responsiveness

At wide widths, the title column absorbs available space. Progress, due date,
status, and menu columns remain intrinsic and aligned. At narrow widths, the
due/status columns fold into a labeled line in the row body (Overdue · date,
Due today, Due date) before anything is hidden; then the project name and
description drop, so the title, completion control, and due signal always
survive. The agenda strip stays one compact row down to 780px — the focus
statement and the carry action — and becomes a two-line stack below. The counts
live in the panel's view tabs.

### Carry-over badge

The carry action reports the unfinished count as a compact amber badge in the
same language as the notifications badge: the number alone in a circle, growing
into one pill that reads "N unfinished tasks" when the action is hovered or
takes keyboard focus — never when the pointer is merely over the focus line. The badge sits outside the action's
box, so the expansion never reflows the row and never moves the action itself,
and below 481px it keeps the number alone because there is no strip space to grow
into. The count is also in the action's accessible name, so it is never
hover-only information.

## Clipped text

The focus statement keeps a fixed readable measure rather than filling the
strip. A longer goal is clipped there and fades at the edge it clips at: the
right edge at rest, the left edge once it has panned. Hovering the line pans it
to its end at a steady reading pace — the duration scales with the distance, so a
long goal takes longer than a short one — and stops there. Leaving returns it to
the start at once; the transition lives only in the hover state, so the return
never animates. Reduced
motion reaches the same end without the animation, so no text is unreachable.
The same line carries every clipped task title — and the subtask titles in the
chat cards — in the chat task cards and the inline task lists: the employee
ledger's title and the administration record's title. The row is the hover and
focus target, so the title reveals wherever the pointer rests on the task.
A clipped task description uses the line's fade-only mode: it fades at the edge
it clips at and never moves, because a title and its description sliding at once
compete for the reader's attention. Reading the whole description belongs in the
task drawer, not in the list. A surface without hover (below 481px) wraps the
goal instead of clipping it, because a pointer-only reveal is not a reveal on a
touch screen.

## Employee ledger row anatomy

- The title is the row's one open control. The completion control, progress,
  due, status, and action menu are siblings, never nested inside a button role;
  the row body may open on a pointer press for convenience, while keyboard
  activation stays on the title.
- Minimum 64px high, with 12–16px vertical breathing room.
- Transparent/paper surface with hairline dividers.
- One title line, one metadata line, optional one-line description.
- The project line renders only when the view actually mixes projects, and the
  On today tag appears only where it discriminates (not inside My day).
- The description renders only when it adds something beyond the title; it is
  dropped at narrow widths along with the project line.
- No per-row border box unless a row is a temporary pending/error state.
- The row's trailing columns — progress, due, status, actions — centre
  vertically against the row, not against its title line. Pinned to the top
  they leave dead space beneath themselves on any row that carries a
  description, which reads as a stack of half-empty cards.
- Type sits on the administration tables' steps: a 13px title, 11px metadata
  and status pill, an 11.5px description, and a 10px tracked column header.
  Readable type is the constraint; chrome yields to it rather than the reverse.
- The description carries `--dash-muted`, the same step as the metadata line.
  `--dash-faint` does not clear AA on the row surface, and the description is
  content the employee is meant to read.
- The active sort is stated once, in the column row. A day group states an order
  only when that group deviates from the view's own.
- No raw provider IDs, object stringification, or invalid date output.

## Shared task status

- A single semantic status pill: Pending, In progress, Overdue, or Done. Pending
  and In progress share the quiet treatment — the label carries the difference
  — so neither competes with the Overdue and Done states, which lead.
- The failing state is stated once, by the pill. The due date does not repeat it
  in red alongside.
- The status vocabulary is Pending, In progress, Overdue, Done, and its tints
  are defined once in `styles.css`. Precedence is Done → Overdue → In progress
  → Pending: a completed task reads Done even when its due date has passed, an
  open task past its due date reads Overdue whatever its stored workflow
  status, and Pending is the default a new task starts in. Overdue is derived
  from the due date, never stored, so no status write can fake or clear it.
  Open remains the collective noun for incomplete work in counts and copy, and
  provider sync keeps its own chip instead of adding a fifth task status. A
  theme layer places the pill; it does not restate its colour, size, or weight.

## Selection, hover, and focus

Selected rows must look deliberate without looking highlighted by a marker.

The selected treatment is:

- a quiet paper/inset surface;
- a 1px neutral or muted-green outline around the row content;
- a soft, low-opacity shadow or inner ring;
- stable geometry: no width change, no left rail, no extra padding;
- the existing task title and status remain the strongest signals.

Use aria-selected="true" as the source of truth. Do not add a separate
selected class that can drift. The visual may be implemented with an inset
1px line plus a subtle surface change, but it must never use a colored
vertical bar or a neon highlighter.

This treatment applies where the surface has a selection model. The task list
has none. There `aria-selected` — which is also invalid on `role="button"` —
could only restate "this task is on today's plan", and because every My day row
is on today's plan the selected chrome would cover the whole list and say
nothing. That fact is the `On today` tag, and inside My day it needs no signal
at all: every row there is on today's plan.

Hover is a smaller version of the same surface change. Keyboard focus gets a
visible 2px focus ring outside the row, with sufficient contrast. Focus and
selection must not be communicated by color alone.

## Parent and subtask completion

**Completing a task completes its open subtasks.** A finished task never shows
open work underneath it, on every surface that can mark a task done: the chat
selection card, the companion's task list and task drawer, the web app's
employee list and drawer, and the administration task record. The subtasks
close first, so a subtask that cannot close leaves the task above it open and
the failure names the subtask, rather than leaving a completed task sitting
above open work. Reopening a task never reopens its subtasks, a subtask that is
already done is never closed again, and each cascaded subtask keeps its own
completion record, day event, audit entry, and plan-item state, recorded as
`employee_explicit`: the employee's own act is the source, never an inference.
In the chat selection card a task and its subtasks are one selection unit:
checking the task checks its open subtasks, unticking either clears the other,
and the review lists each subtask the approval will close, so nothing closes
behind the employee's back.
