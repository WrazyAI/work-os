# Employee task workspace and finder

**Use when:** Changing employee Tasks page layout, views, sorting, pagination, or the task finder.

**Owns:** Employee task navigation and list-level behavior; the shared row and drawer have separate owners.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing finder transition timing: [Focus, finder, and workflow transitions](../patterns/workflow-dialogs.md#focus-finder-and-workflow-transitions).
- Changing row layout, selection, status, or completion: [Task rows, status, and selection](../patterns/task-rows.md).
- Changing the task drawer or attachments: [Task drawers and completion evidence](../patterns/task-details.md).
- Changing the focus strip or plan disclosure: [Planning, focus, and suggested goals](planning-and-focus.md).
- Changing finder focus, menus, or keyboard interactions: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).

**Implementation starting points:** [TaskFinder.tsx](../../../desktop/work-os-companion/src/TaskFinder.tsx), [taskWorkspace.ts](../../../desktop/work-os-companion/src/taskWorkspace.ts), [EmployeeTasks.tsx](../../../src/modules/work-os/employee/EmployeeTasks.tsx).

Tasks is the operational work surface. It must look more like a precise
workspace than a list of cards.

## Page order

1. Masthead title/date and date navigator.
2. One compact agenda strip: focus statement, save/provenance state, a truthful
   plan read (`N open of M planned` with a thin recorded-done meter), one
   open-focus control, and Review unfinished work only when relevant.
3. One flat task-list panel whose header borrows the dashboard queue's outline:
   the four views (My day, Unfinished, Completed, All tasks) are the panel title,
   and three icon-only controls — Search, Calendar, Add task — ride the trailing
   edge. They wrap below the views only when the header runs out of width.
4. The list's own header row — the quiet sortable column row for Name, Date
   Due, and Status — carries labels only; Add task belongs beside the finder
   controls above it. The date and status tracks keep the width the rows use.
   The column labels are written as words, not
   shouted labels, so the row reads as a quiet table header.
5. Shared anchored composer with reserved bottom clearance.

Do not put a permanent focus editor or oversized hero above the table. Focus
editing belongs to the shared composer/editor.

## Toolbar and task finder

The Tasks page has one date navigator in the masthead, one task-list panel, and
one task list. The panel header carries the views and compact icon-only Search,
Calendar and Add task controls on one row while width permits; controls ride the
right edge and wrap beneath the views rather than compressing them. Do not repeat a Task queue heading or
status section headers. The list begins with one quiet sortable column row for
Name, Date Due, and Status; the row aligns to the task, due, and status tracks
and carries no action. Keep the canonical default order visible through the row
sequence: due date latest-first, open work above completed work, and undated
items last.

In the employee companion, Search and Calendar open one unified task finder,
independent of the page view and selected day. Search focuses text; Calendar
expands inline date controls. Status pills (All, Pending, In progress, Overdue,
Completed) intersect with text and an inclusive task-attributed date range
before server pagination. All is default; dates use the existing workday
attribution, not a new due-date-only interpretation. Presets are Today,
Monday-based This week, Last week and Custom range, with a removable range chip.
The finder is a crisp paper surface with a feathered outer edge over a blurred
backdrop; no text or control is blurred. Results page in 50s and open the
existing task drawer after closing the finder. Escape or dismissal restores its
originating toolbar control; closing never filters or navigates the page behind
it. The native modal owns inert background and focus, the result area scrolls,
and narrow/short windows retain every control with no horizontal overflow.

## Views and ordering

My day is strictly day-scoped and leads with its work split into urgency
groups: Overdue, Due today, Later, then No date last. The group order never
changes with sorting so urgency can never be buried, and the active column sort
orders rows inside each group. The groups do not print a header row each: [task rows and readable overflow](../patterns/task-rows.md)
keeps status section headers out of the list, and a group header stacked
directly under the column row reads as a second header while only restating the
status pill every row already carries. The row sequence carries the grouping and
the view tabs carry the counts. Unfinished is
open backlog, with overdue work first; the default order applies within each
group. Completed is historical record. All tasks is the complete inspectable
set. Every view loads 50 parent
tasks at a time from the authorized server-side result set. `Load more` appends
the next cursor page and keeps prior rows in place; it is explicit rather than
automatic. Search, date filters, and sort apply before pagination and reset the
cursor to the first page. Counts describe the complete filtered result set, or
state `Showing N of M` while pages remain. This is a deliberate exception to the
streaming-list contract ([paged and streaming lists](../patterns/data-and-state.md#paged-and-streaming-lists)): the Tasks list loads only on the explicit
control, keeps every appended page mounted so the employee's full working
context stays in place, and states the complete filtered total in each view
chip while `Showing N of M` reports the loaded window. The streaming contract's
sentinel loading and mounted-row window belong to live, unbounded feeds such as
the debugger trace.

The default order is due date latest-first, with open work above completed and
undated items last. Within a My day group, tasks with the same due date (or no
due date) appear newest-created first; later updates do not move older tasks
ahead. Explicit column sorts continue to order by their selected field. My day is assembled on the client, so its list, its view
chip, and the agenda-strip counts all derive from the same day list (the
canonical default order only applies where the server pages a view; a client
view whose rows skip the active sort would make the column header lie). The
strip counts name exactly what they measure — overdue, due today, done today —
and never repeat a view chip under a different definition. The Tasks column row exposes Name, Date Due, and Status
sorting. Activating a column starts in its natural direction, toggles on the
second activation, and restores the default on the third. The choice persists
for the Tasks workspace, and paginated results must be sorted before pagination
so the visible order represents the complete filtered result set rather than
only the loaded page. The active-day dashboard keeps its own sort preference.

Overdue means an open task with a valid due date before the current workday.
Undated old work is carryover, not overdue. This is the employee and companion
Tasks predicate. The administration record is the one documented exception:
its overdue predicate includes the default due date it derives (creation plus
one day), and [Administration task dates](../admin/tasks.md#task-dates-and-overdue-counts) states that rule and its headline split.
