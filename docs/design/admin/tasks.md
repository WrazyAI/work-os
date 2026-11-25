# Administration task record

**Use when:** Changing the organization task list, actions, dates, sort, counts, or task evidence indicator.

**Owns:** Admin task layout and the explicit admin-only effective-due-date rules.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing shared row/menu/status behavior: [Task rows, status, and selection](../patterns/task-rows.md).
- Changing drawer evidence: [Task drawers and completion evidence](../patterns/task-details.md).
- Changing filters or menus: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).

**Implementation starting points:** [TasksPage.tsx](../../../desktop/work-os-companion/src/admin/TasksPage.tsx), [TaskAttachmentIndicator.tsx](../../../desktop/work-os-companion/src/admin/TaskAttachmentIndicator.tsx).

## Task record

**Tasks** is the organization task record with the primary Add task action in
the card title row, bounded filters on one compact controls row beneath it,
and the local add-task flow: one flat table, never grouped or ordered by
project, which stays a small per-task detail beside the task's priority and
labels. Columns carry the record's sort (Task, Assignees, Created, Due,
Status), the first activation applies the natural order, rows missing a value
stay last in both directions. The required paging contract is 100 rows at a
time with an explicit Show more control. Each row shows the task's description on its own line
beneath the title — clipped with the shared fade and never a pan — and the
assignee cell resolves the recorded assignee ids through the roster, so a task
with a real assignee is never displayed as Unassigned. A row with
employee-attached completion evidence carries a small stack of slanted file
and image cards beside its status pill; hover or focus lifts the cards and
reveals one sentence naming the file and image counts. The task drawer lists
the actual files under Completion evidence with preview and download. A task
without evidence shows no indicator, and the indicator never substitutes for
the employee-attached provenance in the drawer.
Each row carries the same trailing ellipsis action menu as the companion task
lists ([task rows and readable overflow](../patterns/task-rows.md)): its status actions, Edit task, Assign, Archive (reversible), and
Delete permanently, each present only when the task's capability payload
allows it. The task drawer carries the status control, the assignee control,
and the lifecycle buttons — Mark complete or Reopen task, Edit task, Archive
task, Delete task — under the same gate, and archiving or deleting waits for
an explicit confirmation.

**Desktop paging.** The companion requests 100 rows at a time and appends
each page with **Show more**, without replacing rows already loaded. Search
and column sorting apply to the loaded rows. A failed continuation keeps those
rows visible and provides a retry.

**Remaining web paging gap.** [AdminTasks](../../../src/modules/work-os/admin/AdminTasks.tsx)
increases the requested limit with Load more, but does not advance an offset;
the [list endpoint](../../../src/app/api/work-os/tasks/route.ts) caps that limit
at 200.

## Task dates and overdue counts

**Task dates.** Every task row shows when the task was created — the provider's
own creation stamp when recorded, then the local record's — in the same
letter-month form as its due date and immediately ahead of it, so the two dates
read together. A task with no recorded due date reads against the default it
implies: one day after it was created. The derived value is the row's effective
due date everywhere the row is read — the overdue warning and the
Overdue/Pending/Done pill, the Due column's sorting, and the status lock —
exactly as a recorded date would; the Due cell itself says `No due date` rather
than printing the derived date as if someone had chosen it. Only a task whose
created date is also missing shows a dash and claims no overdue state, so a
task past its derived date does read Overdue.

The effective due date drives both the Overdue pill and the status lock in this
record: an open task past its effective date cannot change workflow status
until the date is today or later, even when no due date was ever recorded. The
workday that rule compares against is the acting administrator's shift-local
date; only an administrator with no person mapping falls back to UTC. The
edit form still seeds and writes the recorded date, so saving it never turns
the derived default into a recorded one; a task with no recorded date opens
the editor empty, and the date the operator types becomes the real due date.

**Existing comparison-day gap.** The companion's
[TasksPage](../../../desktop/work-os-companion/src/admin/TasksPage.tsx) uses the
device-local `todayIso()` from [data.ts](../../../desktop/work-os-companion/src/admin/data.ts)
for every administrator and sends that day to the list endpoint. It does not
yet resolve the administrator's shift-local day or the unmapped administrator's
UTC fallback. Around calendar boundaries, row warnings, status locks, and list
counts can disagree with the required rule above. Device-local time does not
replace that approved rule.

**Recorded versus default overdue.** The task summary separates the two counts.
The headline says how many tasks are past a **recorded** due date; a quiet second
line names how many more are past the default (creation plus one day) with no
date recorded. Both stay in the record and both still read Overdue on the row:
the distinction is honesty about the number, not a change to its meaning. The
shared `countAdminTaskRecord` returns `overdue`, `overdueRecorded`, `open`, and
`completedWeek`; the admin table uses the recorded count in its headline and
keeps `overdue` available to the agent reads that already rely on it.

## Sortable tables

**Sortable tables.** The administration task record opens newest-created first
— the created date the row shows, the provider's stamp before the local record
— with the most recently updated row as the tiebreak, then the effective due
date; a row missing a value in any step stays after the rows that record one.
Every labeled column header is a button: the first activation applies
that column's natural order — A→Z for Task and Assignees, newest first for
Created, earliest first for Due (which orders by the row's effective due date,
the derived default included), attention order (Overdue → Pending/In progress →
Done) for Status — a second activation reverses it, and another column switches
to its own natural order. Rows missing the sorted value stay last in both
directions, and ties break by title then id so the list never jitters. The
sorted column's `th` carries `aria-sort` with an always-visible direction
indicator, inactive columns reveal a quiet affordance on hover or keyboard
focus, and the empty actions column is never sortable.

The task record's title column takes the remaining measure: the card keeps its
outer inset while the middle gutters tighten, the header rule alone separates
the column labels, and the body dividers stay faint so the row content — not
the rules — carries the structure.
