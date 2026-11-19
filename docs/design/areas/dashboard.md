# My Day and Today dashboard

**Use when:** Changing the employee command surface, task queue, workday details, or dashboard states.

**Owns:** Pre-shift, active, observed-only, and degraded dashboard composition.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing clock actions or freshness: [Attendance and provider freshness](attendance.md).
- Changing flexible-day or schedule-dependent display: [Profile, connected accounts, and work arrangements](profile-and-schedule.md).
- Changing queue rows: [Task rows, status, and selection](../patterns/task-rows.md).
- Changing clipped focus text: [Clipped text](../patterns/task-rows.md#clipped-text).
- Changing focus editing or suggested goals: [Planning, focus, and suggested goals](planning-and-focus.md).

**Implementation starting points:** [DashboardSurface.tsx](../../../desktop/work-os-companion/src/DashboardSurface.tsx), [dashboardModel.ts](../../../desktop/work-os-companion/src/dashboardModel.ts), [EmployeeToday.tsx](../../../src/modules/work-os/employee/EmployeeToday.tsx).

The dashboard is a command center, not a report of everything Work OS knows.
It changes hierarchy with the workday state. All dashboard states use the same
content axis, tokens, and action language.

## Pre-shift / not clocked in

The clocked-out dashboard uses the same command-surface composition as the
active day, so the page does not change its shape when the shift starts:

1. Command surface. The state line (Ready to begin, Off shift, or Worktivity
   status), the short state detail plus the clock-in contract, one primary Clock
   in action in the Windows Companion, and one quiet Set focus action. The
   scheduled-window instrument sits on the same row; before the window opens the
   leading reading is the time until it starts and the axis carries no now dot.
   Between 721px and 1080px the state line and its actions take one clean
   full-width row and the instrument follows as a second row, so the mascot,
   status, and controls never wrap into a ragged stack beside empty space. The
   instrument's scheduled start and end stay visible under the axis at every
   width. The four counts follow on a hairline row — planned, carried over,
   overdue, and completed — each opening the view it measures. A zero is a quiet
   fact, not a control. The focus line is the surface's last row: today's focus,
   its provenance, and the next check-in, under the shared pan contract ([task rows and readable overflow](../patterns/task-rows.md#clipped-text)).
   Otto is a restrained mark in the surface, never the reason it is tall.
2. Margin instruments. This week's completed-task chart and plan reliability,
   set as labels on hairlines rather than cards. On wide windows they sit beside
   the queue; at narrow widths they move below it. They read the same seven-day
   insights record as the web. An unavailable read leaves the queue intact and
   shows a quiet empty state in place of the chart.
3. First moves. A short open-task queue with direct completion, a full Tasks
   path, and the task-record sync state in its footer.

The readiness hero and its separate pulse, metric, and work-in-motion cards
were removed: they restated the counts and the window, and together they pushed
the queue below the fold.

When no schedule exists, say so and keep the Companion's exception-start
confirmation truthful. Planning before clock-in must state that it does not
start attendance.

## Active / clocked in

The active dashboard is organized around one command surface, the same
composition the web Today page uses:

1. Attendance row: the state line (On shift, Paused, or Worktivity status), a small
   question-mark control revealing the confirmed provider-observation time, and
   Pause/Resume and Clock out in the connected Windows Companion. Worktivity owns
   the state and confirms each change before Work OS mirrors it. The surface has
   no permanent footer: one exists only while it carries a pending activity
   check or a focus-save retry, so the normal state spends its height on the
   instrument instead of a restated status sentence.
2. Window instrument: elapsed and remaining at the ends of one bounded progress
   bar; hovering or focusing the line reveals its scheduled start and end, and
   the detailed dialog carries the full axis. The position marker carries the
   present without restating the reader's own clock. It is a calm instrument,
   not a gamified score. Whitespace, not a divider, separates it from attendance;
   the timeline yields width before either time reading loses its trailing inset.
3. Counts: completed, open today, overdue, and carried over sit on a full-width
   hairline row with their plain-language detail. Each has a single owner on the
   page and opens the view it measures; a zero is stated quietly and is not a
   control.
4. Focus line: today's focus as one line with its provenance and save state;
   a small question-mark control beside provenance reveals the next check-in on
   click. Both help controls support keyboard activation, Escape, and outside
   dismissal without opening workday details. The focus follows the shared pan
   contract ([task rows and readable overflow](../patterns/task-rows.md#clipped-text)). It is the command
   surface's last row, not a second card.
5. Task queue: Today, Yesterday, Older tabs with live counts, Add task, and a
   direct full-workspace path. The tabs are the panel's title; no eyebrow or
   heading restates the selected view. Above 900px the queue reads as a table
   with Task, Due, and Status tracks; below it, due and status fold into one
   metadata line so the title keeps its width.
6. Margin instruments: This week's completed-task chart and plan reliability,
   set as labels on hairlines rather than cards. On wide windows they sit beside
   the queue; at narrow widths they move below it. They read the same seven-day
   insights record as the web. An unavailable read leaves the command center and
   queue intact and shows a quiet empty state in place of the chart.
7. Otto chat entry: a compact launcher outside page flow. Opening it creates the
   shared bounded chat sheet and must not cover the queue.

The command surface stays deliberately compact: at 1024×768 the first task row
is visible without scrolling, because the queue is the visual anchor and the
attendance state is context, not a second hero. The 132px progress ring is a
documented deviation from the earlier composition: it and the timeline bar
encoded the same window percentage, so the bar is the one instrument and the
ring's vertical space belongs to the work. The four counts have one owner — the
command surface — rather than a flow legend and a facts row that disagreed about
which numbers the day is made of.

The command surface opens a detailed workday dialog when its non-control area
is pressed; its clock and task buttons keep their own actions. A keyboard-reachable
details button appears on focus and opens the same dialog. The dialog separates provider
status, scheduled window, task counts, and focus without inventing attendance
or task facts. It traps focus, closes on Escape, backdrop, or close, and restores
focus to the details button. Opening and closing use a brief 200ms/160ms reveal;
reduced motion skips both. On narrow screens the dialog stays within the
viewport and scrolls internally.
Hovering or keyboard-focusing the compact scheduled-window progress line reveals
its start and end times; the expanded dialog's line instead reveals the current
local time. These are time indicators, never productivity measures. Their
information is accessible without hover and the reveal respects reduced motion.

## Observed-only and degraded states

The macOS Companion keeps attendance visible but uses the Worktivity Mac app
for clock actions. Hide the Companion clock controls and state that Work OS
shows Worktivity’s confirmed status; tasks, planning, recaps, and reports keep
their shared contracts.


Observed-only mode changes the labels and available actions, not the entire
composition. Name Worktivity as the attendance source and show whether Work OS
has mirrored the session yet. A stale or unknown provider state must not be
presented as a confirmed current workday.

Loading reserves the dashboard geometry with content-shaped skeletons. Refreshing
keeps existing data visible. Empty and degraded states use one concise sentence
and one recovery path. A provider error never replaces the entire command center
with a raw error.

On the web, attendance is status-only and names the Worktivity state, observation
freshness, and any inferred clock-out boundary. It points employees to the
Windows Companion for attendance actions. In the Companion, an unconfirmed
provider action stays visibly pending and blocks another clock action until a
read-only status check resolves it; never imply success from a desktop click.
