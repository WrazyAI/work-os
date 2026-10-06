# Work OS premium product design blueprint

This is the canonical visual and interaction blueprint for Work OS. It applies
to the web platform, the installed companion, the in-app Otto sheet, floating
Otter chat, employee workflows, manager review, administration, and future
operational surfaces.

This revision is an intentional art-direction reset. The previous specification
accumulated good state and accessibility contracts but allowed too many
competing visual patterns: generic card grids, oversized status treatments,
colored row rails, and dashboards that read like decorated forms. This blueprint
sets a more premium reference: quiet editorial command centers, strong
typographic hierarchy, precise data layouts, generous but purposeful whitespace,
and one unmistakable action per decision area.

The visual references are:

- The warm, high-contrast command center: a pale canvas, white work surfaces,
  dark ink, compact navigation, and one saturated action color.
- The polished master-detail workspace: a stable left context rail, a flexible
  work stage, clear table rhythm, and detail revealed without losing place.
- The analytical dashboard: a small set of meaningful metrics, restrained
  charts, clear comparison axes, and no decorative visualization.

These references are directional, not assets to copy. Work OS keeps its own
language, truthful data model, Otto identity, approval boundaries, and
provenance labels.

## 1. Non-negotiable product character

Work OS must feel calm, expensive, and useful before it feels expressive.

- Calm under operational pressure.
- Editorial rather than template-like.
- Dense enough for real work, never cramped.
- Soft and tactile without looking glossy.
- Clear about what is live, observed, suggested, saved, queued, or verified.
- Human through language and Otto, not through decorative illustrations.

Every screenful answers, in order:

1. Where am I?
2. What is happening?
3. What needs attention?
4. What is the next useful action?

The first visual level is the outcome or page purpose. The second is the work
surface. The third is controls and content. Metadata is quiet. If every object
is bold, green, boxed, or elevated, the hierarchy has failed.

## 2. Art direction

### 2.1 Material system

The default light surface is warm ivory, not sterile white. White is reserved
for raised work surfaces and editable fields. Ink is near-black green. Signal
lime is rare and intentional: primary actions, bounded progress, and current
state. Amber and red are semantic alerts, never decoration.

The material stack is:

1. Canvas: warm gray-green/ivory background.
2. Work surface: quiet white or paper panel.
3. Raised surface: white field, drawer, menu, or dialog.
4. Signal layer: a small action, progress segment, or semantic status.

Prefer one large surface with internal rhythm over many nested cards. Use
hairline dividers and whitespace for repeated records. A card exists because it
owns a decision, a summary, or a distinct state, not because an empty area
needs a border.

### 2.2 Premium composition

Premium does not mean more gradients, shadows, badges, or rounded corners.
Premium means that content has room to breathe and that each edge, alignment,
and number has a reason.

- Use asymmetry when it establishes a clear reading path: a wide hero beside a
  compact pulse panel; a broad table beside a detail drawer.
- Use a restrained scale contrast: one hero statement, compact labels, and
  tabular operational values.
- Keep the top of a dashboard visually quiet. Avoid stacking an eyebrow, title,
  subtitle, status banner, and duplicate hero.
- Use full-width separators in tables instead of turning every row into a card.
- Use one radius family per surface tier. Do not combine pills, 24px cards, and
  sharp rectangles in the same local composition without a reason.
- Keep decoration behind the content axis and disposable: if a gradient or
  orbit is removed, the page must still communicate perfectly.

### 2.3 Explicitly rejected treatments

The following are not acceptable in new Work OS surfaces:

- A colored vertical bar or highlighter strip beside a selected task.
- A selected row that shifts its content, changes width, or adds a neon edge.
- A rainbow or glossy gradient used as a permanent panel background.
- A dashboard made of interchangeable KPI tiles with no operational action.
- A card inside a card inside a card when a divider would communicate the same
  grouping.
- A permanently visible diagnostic wall.
- A chart without a question, comparison, unit, or exact accessible fallback.
- A generic sparkle icon used as Otto's identity.
- A successful request described as provider-confirmed without authoritative
  readback.

## 3. Canonical tokens

The desktop and web implementations may use different CSS mechanisms, but they
must map to these semantic tokens. Values are references, not a reason to
scatter raw values through files.

### 3.1 Color

| Token | Reference | Meaning |
|---|---|---|
| --color-ink | #182018 | headings, body text, dark primary controls |
| --color-ink-soft | #304033 | strong secondary text |
| --color-muted | #687267 | metadata, helper text |
| --color-faint | #939c90 | quiet labels and unavailable values |
| --color-canvas | #eef1eb | outer application background |
| --color-stage | #f5f6f1 | content stage |
| --color-paper | #fafaf6 | warm base surface |
| --color-raised | #ffffff | cards, fields, drawers, menus |
| --color-inset | #f0f3ed | grouped content and hover |
| --color-line | #d9ded5 | hairlines and default borders |
| --color-line-strong | #c5cec1 | selected/focused surface outline |
| --color-signal | #a8f15b | primary action and bounded progress |
| --color-signal-deep | #5e9d27 | signal icon, progress, current state |
| --color-danger | #c94e43 | error, destructive, overdue attention |
| --color-danger-soft | #f9e5e1 | danger surface |
| --color-warning | #c88918 | aging work and recoverable warning |
| --color-warning-soft | #fff5dc | warning surface |
| --color-observed | #2e617d | Worktivity/provider observation |
| --color-observed-soft | #edf6fb | observation surface |

Do not use signal green to mean “good” in general. It means action, progress,
current state, or an explicitly confirmed result whose label says what was
confirmed. Observation remains blue/cool-neutral even when activity is present.

### 3.2 Geometry and elevation

| Role | Value |
|---|---:|
| Compact control radius | 8px |
| Button/input radius | 10px |
| Internal notice radius | 12px |
| Standard card radius | 16px |
| Primary hero radius | 18px |
| Chip/pill radius | 999px |
| Compact control height | 34–36px |
| Standard input height | 42px |
| Row minimum height | 64px |
| Standard card shadow | 0 1px 2px rgba(20,30,18,.035), 0 10px 28px rgba(20,30,18,.045) |
| Raised shadow | 0 16px 48px rgba(20,30,18,.08) |
| Floating shadow | 0 18px 64px rgba(18,27,17,.16) |
| Product easing | cubic-bezier(.2,.8,.2,1) |

Use 1px borders for structure. A 2px edge may communicate a keyboard focus
state or danger state, but never use it as a decorative selection rail.

### 3.3 Typography

Use the existing self-hosted/local font strategy:
Manrope, Inter, Segoe UI Variable Text, Segoe UI, sans-serif.

| Role | Size | Weight | Notes |
|---|---:|---:|---|
| Display outcome | 32–52px | 700–780 | one per hero, tight leading |
| Page title | 24–34px | 700–760 | short and specific |
| Surface title | 16–20px | 650–720 | one per panel |
| Task title | 12–14px | 650–730 | single-line in dense rows |
| Body | 13–15px | 400–560 | comfortable line height |
| Control label | 11–12px | 650–750 | sentence case |
| Metadata | 10–11px | 450–600 | never the only state cue |
| Eyebrow | 9–10px | 750–820 | uppercase, sparse |

Use tabular numerals for elapsed time, counts, due dates, and values that
change in place. Use negative tracking only for display/page statements.

## 4. Shell and navigation

### 4.1 Desktop shell

The companion opens with a collapsed 68px icon rail so the task stage gets the
room it needs. The employee can expand it to the 208px labeled reference rail
without leaving the shell; the workspace grid moves with the rail instead of
letting navigation cover the stage. The web shell may use the same 208px labeled
rail at wide widths, and both surfaces use the same content axis and destination
order.

At wide desktop:

    ┌──────── rail ────────┬──────────────────── stage ────────────────────┐
    │ mark                  │ context/date eyebrow       utility actions   │
    │ primary destinations  │ page title                                  │
    │                       │ one aligned content stage                   │
    │ quiet footer          │ dashboard, table, detail, or review          │
    └───────────────────────┴───────────────────────────────────────────────┘

Reference geometry:

- Wide web rail: 208px.
- Companion rail: 68px collapsed, 208px expanded.
- Stage padding: 24–64px, responsive.
- Masthead: 78–104px depending on shell.
- Content maximum: 1200–1320px.
- Bottom breathing room: at least 56px plus any floating surface clearance.

The masthead is context, not a second hero. The title appears once. Utility
actions (sync, notifications, refresh, identity) stay compact and aligned to
the title baseline.

### 4.2 Navigation states

Navigation is a stable noun: Today, Tasks, Review, Insights, Evidence, Settings.
The active destination uses a quiet inset surface, ink/signal icon treatment,
and a visible focus ring. A narrow marker is allowed only for the primary
navigation rail itself; it is not allowed beside content rows, task rows, cards,
or selected records. Settings opens from either window with `Ctrl + ,`
(`Cmd + ,` on macOS) — a window-focused shortcut, never a system-wide capture —
and the Settings destination names it in its tooltip.

The companion sidebar intentionally does not render a persistent Chats section
or an empty recent-chat placeholder. Chat remains available through New chat and
the shared launcher; a future history surface must use real conversation data
and earn its space without weakening the work-navigation hierarchy.

Icon-only destinations require an accessible name and tooltip. The companion
also owns a workspace identity control, New chat, and a chat-entry affordance;
any production chat rows must be backed by real conversation history rather than
invented threads or workspace actions. Settings lives in a quiet footer
separated by a rule; connection/session status is intentionally not repeated in
the sidebar. Evidence remains a routed view but its sidebar destination is
temporarily hidden until that surface is ready for daily use.

When the companion sidebar is collapsed, the workspace mark is the expand
control. Hovering the mark or any non-navigation surface reveals the expand
affordance, and clicking empty sidebar space expands it; navigation rows remain
clickable without expanding the rail. The icon column uses one shared slot so
the mark, rows, and footer remain aligned in both states.

### 4.3 Web employee workspace

The deployed web console hosts the employee workspace on nested routes, so each
destination is a real, deep-linkable, role-guarded page instead of one stacked
page:

    /work-os/today      command center: status band, focus, check-in, first moves
    /work-os/tasks      task workspace: My day · Unfinished · Completed · All tasks
    /work-os/review     EOD reports, proposed changes, and recorded evidence
    /work-os/insights   range brief and per-day records
    /work-os/settings   profile, working hours, consent, and companion connect

- Employees and mapped administrators use the workspace; managers keep the
  review console and unmapped administrators keep the administration console.
  `/work-os` dispatches by role and redirects employees to their workspace.
  Legacy `?tab=` links map onto the destinations (reports/evidence → Review,
  people/schedules/blueprints → Today) so old sidebar links and bookmarks keep
  working.
- Work OS navigation is role-aware in the console sidebar: the workspace
  destinations for employees, Team review for managers, and the administration
  destinations for administrators, with the active state resolved on the real
  route.
- The workspace carries the Work OS material system inside the console shell:
  warm canvas, white work surfaces, near-black green ink, and signal green for
  actions, progress, and current state. The tokens are scoped to the workspace
  routes; the shell keeps its own palette around them. The dark variant keeps
  the same roles — the blueprint defines the light stack only.
- Each destination owns one masthead (context eyebrow, single title, compact
  utilities), one content axis, one panel family with hairline dividers, and at
  most one primary action per decision area. Task rows stay flat; task details
  open in a right-side drawer and menus are detached surfaces.
- The web surface is status-only for attendance: it names the Worktivity state
  and freshness, keeps the activity watch truthful, and points to the Windows
  Companion for Clock in, Pause/Resume, and Clock out.

The web workspace also carries the companion's employee-facing capabilities so
the two surfaces tell the same story: the two-view Plan your day session
(input → drafted review → refine/confirm, with the Loom attachment), the
Activity Interval Review stream with confirm/amend, Work Memory management
(Needs review / Remembered), the shift-time instrument (elapsed, bounded
scheduled-window progress, remaining time), optimistic task adds with
surface/defer, per-day screenshot evidence, and the deterministic insights
record with exact-value charts. Surfaces that stay companion-only by design:
Worktivity attendance mutations, the system-wide hold-to-talk shortcut, the
floating window and orb chat, OS notifications and sounds, the offline queue,
appearance settings, and device sessions.

## 5. Dashboard blueprint

The dashboard is a command center, not a report of everything Work OS knows.
It changes hierarchy with the workday state. All dashboard states use the same
content axis, tokens, and action language.

### 5.1 Pre-shift / not clocked in

The wide composition is a 7/5 split:

1. Readiness hero. One strong outcome statement, short state detail, one
   primary Clock in action in the Windows Companion, one quiet Set focus
   action, scheduled window, and one provenance sentence. The web dashboard
   shows status and directs employees to the Companion for attendance actions.
   Otto is a restrained visual anchor, never the reason the hero is tall.
2. Workday pulse. A compact schedule/timeline surface with time-until-shift,
   scheduled window, and one observation disclaimer. It does not repeat task
   counts, reviews, or a six-fact provider diagnostic.
3. Metric strip. Four compact questions, not four decorative tiles:
   Planned today, Carryover, Completed today, Reviews pending. Each metric has
   an action path when it has work behind it.
4. Work in motion. One visual summary of completed/open/carryover work and
   today's focus.
5. First moves. A short open-task queue with direct completion and a full Tasks
   path.

The readiness hero should feel like a composed editorial panel: large type,
simple facts, a single ink action, and a small signal accent. Do not use a
full-bleed green gradient, large decorative robot, or multiple calls to action.

When no schedule exists, say so and keep the Companion's exception-start
confirmation truthful. Planning before clock-in must state that it does not
start attendance.

### 5.2 Active / clocked in

The active dashboard is organized around one command surface:

1. Status header: On shift, Paused, or Worktivity status; elapsed time and
   next update. Pause/Resume and Clock out appear in the connected Windows
   Companion; Worktivity owns the state and confirms each change before Work OS
   mirrors it. The web dashboard remains status-only.
2. Time band: elapsed, a bounded progress orb/ring, remaining time, and
   schedule. It is a calm instrument, not a gamified score.
3. Focus and flow: today's focus, provenance/save state, and a completed /
   carryover / open flow bar.
4. Task queue: Today, Yesterday, Older tabs with live counts, Add task, and a
   direct full-workspace path.
5. Otto chat entry: a compact launcher outside page flow. Opening it creates
   the shared bounded chat sheet and must not cover the queue.

The active dashboard may use a two-column focus/summary row above the queue, but
it must not create several competing hero cards. The user's work queue is the
visual anchor.

### 5.3 Observed-only and degraded states

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

## 6. Task workspace blueprint

Tasks is the operational work surface. It must look more like a precise
workspace than a list of cards.

### 6.1 Page order

1. Masthead title/date and date navigator.
2. One compact agenda strip: focus statement, save/provenance state, live count
   shortcuts, and Review unfinished work only when relevant.
3. Four views: My day, Unfinished, Completed, All tasks.
4. Search/date/filter toolbar with the local Add task action.
5. One flat task-list panel.
6. Shared anchored composer with reserved bottom clearance.

Do not put a permanent focus editor or oversized hero above the table. Focus
editing belongs to the shared composer/editor.

### 6.2 Table rhythm

Use a flat, readable list:

    completion | task + metadata | progress | due | status | actions

The Tasks page has one date navigator in the masthead, one search/filter
toolbar, and one task list. Do not repeat a Task queue heading or status section
headers. The list begins with one quiet sortable column row for Name, Date due,
and Status; it aligns to the task, due, and status tracks rather than introducing
a second boxed toolbar. Keep the canonical default order visible through the row
sequence: due date latest-first, open work above completed work, and undated
items last.

At wide widths, the title column absorbs available space. Progress, due date,
status, and menu columns remain intrinsic and aligned. At narrow widths, hide
description, progress, due, and redundant status before hiding the title or
completion control.

Rows:

- Minimum 64px high, with 12–16px vertical breathing room.
- Transparent/paper surface with hairline dividers.
- One title line, one metadata line, optional one-line description.
- A single semantic status pill: Open, Overdue, Done, or Sync issue.
- No per-row border box unless a row is a temporary pending/error state.
- No raw provider IDs, object stringification, or invalid date output.

### 6.3 Selection, hover, and focus

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

Hover is a smaller version of the same surface change. Keyboard focus gets a
visible 2px focus ring outside the row, with sufficient contrast. Focus and
selection must not be communicated by color alone.

### 6.4 Views and ordering

My day is strictly day-scoped. Unfinished is open backlog, with overdue work
first. Completed is historical record. All tasks is the complete inspectable
set. Counts describe the rendered list, or state Showing N of M when
pagination is involved.

The default order is due date latest-first, with open work above completed and
undated items last. The Tasks column row exposes Name, Date due, and Status
sorting. Activating a column starts in its natural direction, toggles on the
second activation, and restores the default on the third. The choice persists
for the Tasks workspace, and paginated All tasks / Completed results must be
sorted before pagination so the visible order represents the complete result
set rather than only the loaded page. The active-day dashboard keeps its own
sort preference.

Overdue means an open task with a valid due date before the current workday.
Undated old work is carryover, not overdue. All surfaces use the same selector
and predicate.

### 6.5 Task drawer

Desktop task details open as a right-side drawer, up to 540px wide, with a
stable header, scrollable body, and footer actions. The underlying list stays
in place and does not reflow. The drawer includes full title, description,
source/provenance, dates, assignees, subtasks, and lifecycle actions.

At narrow widths it becomes a bottom sheet with a safe viewport inset and an
internal scroll region. Menus and drawers must collide with the viewport, close
on Escape/outside click where appropriate, and restore focus to their trigger.
Destructive archive/delete actions are explicit and separate.

## 7. Shared tool and chat surfaces

Tool artifacts and chat are one language in the in-app and floating surfaces.
The latest bounded launcher/sheet implementation on main is the authority for
chat geometry; dashboard work must not regress it.

### 7.1 Tool-call surface frame

Every tool surface uses one warm-paper frame:

1. clear header and lifecycle marker;
2. one content region;
3. one action or receipt region.

Do not nest a bordered card for every row. Task selection, approval, action
results, batch review, navigation, thinking, and tool-call variants share the
same spacing, border, focus, and receipt language while keeping their distinct
approval contracts.

Tool surfaces must preserve:

- explicit approval before mutations;
- truthful queued/recorded/failed/skipped states;
- per-item results for batches;
- internal scroll for long task lists;
- keyboard reachability and visible focus;
- reduced-motion behavior;
- copy controls that do not crowd the message bubble.

### 7.2 In-app launcher and sheet

The closed in-app state is a compact Otto launcher fixed to the lower-right
viewport corner and outside page flow. It never leaves an empty input shell
behind or consumes task-list space.

The open state is a bounded white sheet, approximately 480px wide and 680px
tall at desktop, with safe insets on narrow screens. Header, thread, and
auto-growing composer are one coherent surface. The thread is the only scrolling
region. The sheet closes on Escape and returns focus to the launcher.

#### 7.2.1 Focus panel goal card

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
stream as the floating Tasks tab — recaps newest first, each with one evidence
disclosure that reports screenshot and GitHub event counts, then separate
Screenshots and GitHub activity disclosures, plus confirm/amend actions — so the
day's goal and its interval check-ins read as one record. The stream is
separated by a hairline and scrolls with the rest of the sheet.

### 7.3 Floating Otter chat

The floating companion uses the same white window border/header treatment and
the same composer anatomy. The window remains inside the viewport, grows the
composer with the draft, and uses detached menus that cannot be clipped by a
scroll region. Minimize-to-orb and hide-window remain distinct and truthfully
named.

The thread owns scrolling, but its bottom dissolve belongs to the fixed
composer edge, not the scroll content: keep the thread fully opaque, disable
scroll anchoring while an inline task card expands, and place the short fade
outside the scroller at the composer’s top border. Task-card selection and
confirmation actions remain clear above that edge.

Both chat surfaces use the configured mascot head crop through
src/chat/MascotMark.tsx. Never hardcode mascot art, the mascot name, or a
generic sparkle as agent identity. Global mascot changes belong in mascot.ts.

Prompt reminders — the plan question, a due check-in, the EOD nudge — are
scaffolding for the prompt they announce. The companion may show one in the
thread, but it is removed as soon as that prompt is answered or replaced, is
never written to the vault or sent as conversation history, and never replays
in the agent's stored context. A scheduled check-in appears only once its
prompt time arrives: confirming the plan never triggers an immediate check-in
demand.

Both chat surfaces carry the same voice input contract (§8.8): the record
control takes the send slot only while the draft is empty, and a transcript
lands in the draft for review.

## 8. Controls and interaction contracts

### 8.1 Actions

Use one primary action per local decision area. Primary actions use signal lime
or ink according to the surface, not both in competition. Secondary actions use
paper/white with a neutral border. Tertiary actions are quiet but retain a
visible hover/focus target.

Button labels name the result: Add task, Clock in, Save focus, Review change,
Archive task. Every icon-only button has a plain-language aria-label and title.

### 8.2 Inputs, search, and filters

Inputs have persistent labels where the field is not self-evident, visible
focus, inline validation, and deliberate disabled/loading states. Placeholder
text is not the only label.

Tasks search is always visible. Date range is a compact peer control or
popover, with clear/reset behavior and a result count when active. Filtered
empty says No tasks match these filters, never No tasks.

### 8.3 Menus and detached surfaces

Menus open near their trigger, float above content, and never change row height.
They close on Escape/outside click and remain within the viewport. Use a
detached card for contextual details rather than inserting a panel into the
page and shifting the user's scroll position. The outside-click boundary is the
trigger plus the menu itself, including when the menu renders through a portal
at the document body; a press inside the menu never dismisses it before the
item's action runs.

### 8.4 Worktivity attendance controls

The Windows Companion is the only Work OS surface that can initiate attendance
changes. Clock in, clock out, pause, and resume follow this sequence:

1. Read fresh Worktivity status and check whether the requested state is already
   reached or whether the action is allowed.
2. Preserve required late-start, exception-start, and extended-shift
   confirmations. Explain when Worktivity is unavailable, unconfigured, or
   cannot be controlled.
3. Open Worktivity when it is closed. If it is already running without a
   controllable page, restart it through the approved graceful-close and
   bounded force-close path, and show that Worktivity is being restarted.
4. Make one desktop action through Worktivity's own interface, then read fresh
   provider status. Do not queue attendance actions offline or repeat a click
   after an ambiguous result.
5. Show a pending state with a read-only status retry when Worktivity has not
   confirmed the result. Disable the other attendance controls while pending.
   A provider-confirmed result is the receipt; a click or successful process
   launch is not.

Worktivity owns attendance state and timestamps. Work OS mirrors fresh provider
state into its session ledger while retaining its work planning and review
state. Provider state wins a conflicting session state. If the provider reports
clock-out without an exact time, use the first fresh off-shift observation as
the boundary and label the time as inferred in both the attendance observation
and its audit event. Keep closed sessions as history. Web surfaces may display
provider status and freshness but must not initiate attendance mutations.

### 8.5 Settings memory summary and management modal

Work memory stays off the settings table. Settings renders one flat split band
on the page surface — never a card and never the settings row grid: on the
left, the configured mascot mark in a quiet framed tile, the heading
`What Otto remembers`, and the one-line model statement; on the right, the
counts (`Remembered`, `Need review`, the latter amber only while candidates
exist) and one dark `View` action. The band never lists facts.

`View` opens a centered management modal (`role="dialog"`, `aria-modal`) that
owns the facts. It carries the same title and model statement, one close
control, and two peer tabs:

- **Needs review** — proposed facts newest first, each a bordered card with
  `Keep` and `Not true`, and an honest empty state.
- **Remembered** — kept facts as flat rows on hairlines, each with the verified
  glyph, `Kept <month day>`, and `Forget`; beneath a divider, the Recent
  activity feed with its kind label, summary, calendar day, `Forget`, the
  eight-row cap with `Show all N`, and the provenance line.

Tab switching follows the shared peer-view contract (click or ←/→/Home/End,
with roving tabindex and the count as part of each tab's accessible name).
The modal body is the only scroll region and uses the shared edge dissolve;
Escape, backdrop press, and the close control all dismiss it, and focus returns
to `View`. Below 720px the summary stacks with its counts and action in one row
beneath the copy, and below 640px the modal takes the viewport inset. Keep,
reject, and forget keep their exact existing behavior and states; nothing is
remembered without a keep.

### 8.6 Appearance settings: text and mascot size

Reading & display sits with the Settings groups and holds exactly two
preferences. Both are per-device, apply instantly in every window, and are
remembered locally rather than synced to the workspace:

- **Text size** — `Small` (default, the historical rendering) or `Medium`,
  which scales text 15% through one root custom property (`--text-scale`).
  Every px `font-size`, `font` shorthand size, and fixed `line-height` is
  compiled to `calc(px * var(--text-scale))` by the companion's build seam, so
  text scales without moving layout, icons, or spacing.
- **Mascot size** — `Large` (default, the historical rendering) or `Small`
  (62% of current). One scale rule over the shared art class follows
  `--mascot-scale`, so every surface — chat marks, the thinking trace, hero
  and EOD art, the connect screen, the dashboard, the memory tile, and the
  floating companion orb — changes together. Only the art scales; labels,
  progress rings, and status text keep their size and legibility.

Both preferences render as a two-option segmented radio group
(`role="radiogroup"` with `role="radio"`, roving tabindex, and arrow keys),
state the current value, and normalize unknown or missing stored values back to
the historical default — never to the larger setting. The main window applies
and persists a change (rolling the visible state back if the save fails) and
broadcasts it with `work-os://appearance-changed`; the floating companion
window reads the stored value on boot and follows the broadcast live.

### 8.7 Attendance freshness: activity-driven clock-in and clock-out

Worktivity owns attendance: activity alone can start or close a workday. Work OS
must reflect a provider-observed transition without waiting for a manual
refresh.

- Clients poll `POST /api/work-os/attendance/observe` every **30 seconds while
  a transition is expected** — from two minutes before a startable shift with
  no mirrored session, and while an active session runs past its scheduled end
  or the provider has already observed the close — and every **60 seconds once
  the state is steady**. The five-minute background reconciliation remains for
  devices with no window open.
- The endpoint converges the active session from fresh provider activity (the
  same path a full day refresh takes) and returns whether the tracked
  attendance-and-session signature actually moved. Only a real transition
  refreshes the workspace; the main window relays it so the floating companion
  and every workspace view converge together.
- While a transition is pending, the dashboard shows one quiet line
  (`Checking your activity…`) beside the state copy. The manual Clock in,
  Pause/Resume, and Clock out controls stay available the whole time, and
  manual clock actions keep their existing Worktivity confirmation flow.
- Provider reads are cached for 25 seconds and single-flight per employee, so
  two windows polling together never stampede the provider.

### 8.8 Voice input: record → transcribe → review

Voice input is one interaction with two entry points: a record control in the
composer and a hold-to-talk shortcut. It is never ambient — the microphone
opens only for an explicit press or hold, and nothing is captured on mount, on
focus, on render, or on page load.

**Composer control.** On an empty draft the send control becomes the record
control in the same 36px slot and the same radius, so the composer never
changes shape between drafting and recording. The moment the draft holds text,
the control is the send again and recording is not offered from that slot: two
competing input methods in one slot would make the primary action ambiguous.
Text is never cleared or disabled to reveal the recorder. The web check-in
composer carries the same rule in its labeled-action language
(`Record update` ⇄ `Send update`).

**Capture state.** Recording replaces the composer's field row with a capture
row in the same grid: cancel (tertiary) on the left, a live level meter and the
elapsed clock in the center, and stop (the primary action) on the right. The
meter reads the real microphone signal — it is data, not an ambient loop — and
under reduced motion it stops easing while staying visible. The capture row is
the state, not the shell's chrome: the owning conversation surface strips the
composer's own border and fill, so a recording cue must live in the row, the
control, and the live region rather than in a shell treatment that does not
render. Transcribing shows the shared inline spinner and a `Transcribing…`
label. Escape cancels a capture and discards it without transcribing.

**Bounds and honesty.** A capture auto-stops at two minutes; a hold released
before the microphone opens still ends the capture rather than leaving it
running; leaving the window stops and keeps whatever was spoken; and a clip too
short to hold an utterance is discarded quietly instead of raising a "no
speech" error. Every failure names what failed and what to do — blocked
permission, no device, no speech, an oversized clip, an unavailable provider,
an unreachable workspace — and never exposes a provider payload, a credential,
or a stack trace. A deployment without transcription configured never renders a
record control that cannot work.

**Transcript and receipt.** A transcript is inserted into the draft, never
sent. It is the employee's text to review: nothing is filed, proposed, or
recorded until they send it themselves. A brief `Transcribed — review it, then
send` receipt acknowledges the conversion, the text stays fully editable, and a
failed transcription preserves the existing draft untouched.

**Hold-to-talk.** `Ctrl + M` is registered system-wide in the companion, so a
hold reaches the app from any application; in the browser it applies while the
page has focus. The press focuses the owning surface, opens it when collapsed,
and starts recording; the release ends the capture. The press binds the capture
to the window that received it, so the release can never land on the other
window. Registration is per device, toggleable in Settings, and Settings
reports the real registration state — a shortcut another application already
owns is never shown as live.

**Privacy.** Audio streams to the transcription provider through the server
proxy, is never written to disk or to the database, and is dropped as soon as
text comes back. The record control has an accessible name that states the
action, the capture row states that recording is live in text as well as
color, and the transcript is the only artifact that survives. The
hold-to-talk shortcut is named in the composer so it is never discovered by
accident.

### 8.9 Two-view workflow modals: input view and drafted view

A workflow modal that produces a reviewable draft keeps the input and the draft
apart. The modal opens on the input view; the moment the draft is ready it opens
its own view, so the drafted document never stacks under the input and never
forces a scroll to reach it. The planning session (`Plan your day`) is the
reference implementation.

- **Input view** — the intent field, any attached source (such as a Loom
  recording), and the one primary action that produces the draft (`Build my
  plan`).
- **Drafted view** — the review document with its own in-place actions (edit,
  delete), starting at the top of the body with no inherited scroll position.
  Focus follows into the view so keyboard and screen-reader users land on what
  changed.
- **Back** — the drafted view carries one quiet Back control in the dialog
  header's top-left corner. It returns to the input view and keeps the draft;
  nothing is discarded, and the primary action then reads `Review draft` so the
  way back to the reviewed document is always one click.
- **Delete** — deleting the draft (the double-confirm trash) returns to the
  input view and clears the draft.
- **Footer** — exactly one primary forward action per view: `Build` on the
  input view without a draft, `Review draft` on the input view with a kept
  draft, and `Confirm`/`Save` on the drafted view. Close and the secondary
  actions stay available in both views.
- **Copy** — the modal ships only copy the surface cannot carry itself. Helper
  lines that explain mechanics ("your words stay attached", "nothing is filed
  until…") are omitted; the input, the readback card, and the review document
  state the contract through their own structure.

### 8.10 Submission confirmations: plan and EOD

A submitted plan or EOD ends with one honest confirmation, never a receipt line
that scrolls away:

- The start-of-day plan replaces its workspace the instant the write lands: the
  plan modal closes and a compact confirmation dialog takes the moment, holding
  the checked animation on its completed frame, one line of outcome copy, and a
  single `OK`. There is no close glyph, no second action, and no auto-dismiss;
  `OK`, Escape, or a press outside the card dismisses it.
- The EOD keeps the page. The submitted state embeds the same animation where
  the report was, with the outcome copy and `All EODs` at the top-left returning
  to the EOD list; it stays until the employee leaves it.
- The animation plays exactly once and parks on the completed check. The source
  art fades its check out over the final frames, so the completed state is the
  held frame — never the faded tail. Under reduced motion the completed frame
  renders statically, and the art stays decorative (`aria-hidden`); the heading
  and copy carry the meaning.
- Player and renderer stay local: the bundled wasm and the `.lottie` asset ship
  with each app, and static assets are never auth-gated into a redirect.

### 8.11 First-visit page guides

Every primary workspace page carries exactly one guide: My Day, Tasks, EOD
Review, Insights, and Settings. A hidden destination (Evidence) has none, and
there is never more than one guide per page.

- **First visit** — the guide opens once after a short beat, once flags are
  known. Opening it — automatically or by hand — marks it seen for the account
  (`work_org_members.ui_state` through `/api/work-os/me/guides`), so it never
  auto-opens again on any device. A visit that is skipped because another
  overlay owns the screen, because onboarding is incomplete, or because flags
  could not be loaded is not marked seen and is re-evaluated on the next visit.
- **Any time** — one icon-only `?` control in the masthead (accessible name
  `How <page> works`) reopens the guide for the page on screen. Opening by hand
  also counts as seen.
- **The modal** — `role="dialog"` with `aria-modal`, labelled by its title and
  described by its promise. It holds one custom inline-SVG scene drawn on the
  workspace palette (`aria-hidden`; no raster art), at most three numbered
  steps as an ordered list, and one primary `Got it`. While automatic guides are
  on it also offers one quiet `Don't show these automatically`; once off, the
  footer states that automatic guides are off and points at the `?` instead.
- **Dismissal** — Escape, backdrop press, and the close control dismiss it; the
  body is the only scroll region; focus lands inside on open and returns to the
  `?` after. Below 560px the modal takes the viewport inset. Under reduced
  motion nothing in the scene animates.
- **Opt-out** — Settings → Page guides switches automatic guides; the modal's
  quiet action writes the same account flag. The `?` keeps working either way.

## 9. Data truth, provenance, and state

The visual system must keep these evidence classes distinct:

- Work OS session state.
- Worktivity provider state and provider-confirmed attendance actions.
- Inferred Worktivity boundaries, explicitly labeled with their observation
  time and inference provenance.
- Employee-authored progress or claims.
- AI-suggested interpretation.
- Work OS task state.
- Historical provider/Nifty state.
- Output evidence.
- Review/approval state.

Activity observation is not effort, productivity, completion, or quality.
Fresh Worktivity attendance status is the attendance source of truth; an
activity event alone is not a provider-confirmed clock action. Provider
credentials are not a verified connection. A successful browser request is not
a provider-confirmed mutation. Use labels, placement, and source/freshness copy
to keep meanings separate.

Every asynchronous surface defines:

| State | Required treatment |
|---|---|
| Initial loading | reserved geometry or content-shaped skeleton |
| Refreshing | current data remains visible with local refresh state |
| Empty | specific explanation and next useful action |
| Filtered empty | no-match copy and clear/reset |
| Dense | long titles, counts, and metadata remain aligned |
| Partial/degraded | last-known data plus source/freshness notice |
| Offline/queued | says queued locally, never confirmed remotely |
| Recoverable error | local error, retry, preserved input |
| Blocking error | bounded explanation and recovery route |
| Optimistic mutation | pending until authoritative confirmation |
| Confirmed success | receipt naming the persisted outcome |
| Read-only history | mutation controls removed, provenance retained |

Dates, instants, timezone identifiers, durations, and range endpoints are
validated before formatting. Invalid values render —, Unavailable, or specific
fallback copy; they never throw.

### 9.1 Activity Interval Reviews

A progress prompt may arrive as an Activity Interval Review: a grounded recap
of the interval since the last update, built from the existing secure
Worktivity screenshot pipeline. The interval is the server-resolved prompt slot
(session + due time), never a clock hour, so pauses, manual updates, and cadence
drift cannot split or repeat the same window.

The recap is descriptive and evidence-bounded. It may describe visible apps,
tools, artifacts, and an apparent work sequence, and it must state what the
evidence does not establish. It may not claim productivity, effort, pay
eligibility, completion, deployment, or quality; the synthesizer always
receives the ordered per-frame observations and only a bounded representative
subset of raw frames.

Read the recap, don't wade through it. It presents as one short lead sentence,
then short activity bullets (one observable activity each, with its clock time
when known), an ordered `Flow:` line only when the evidence supports a sequence,
and an explicit `Not established:` line for the evidence gaps. A dense
multi-sentence paragraph is a contract violation, never a rendering fallback
for new intervals.

A recap summary delivered as a chat turn is still a conversation message:
hovering it offers `Copy` plus one short destination action — `All recaps` —
that opens the stream where every recap lives (the floating companion's Tasks
tab). The action never replaces Copy and never appears on turns that are not
recaps.

When Work Memory is enabled for the person, the synthesizer also receives a
bounded additional-context block: the live day snapshot (focus, agenda,
completed and deferred items, recent substantive updates, shift state) and a
recalled-history block retrieved for the interval's own work (the day's stated
focus plus the observed apps and possible task references). That context exists
only so the recap understands what the employee is currently working on. It is
labeled informational, is never screenshot evidence, can never add completion,
progress, or activity claims, and can never contradict the frames. It is
treated as data, never as instructions, and a structured activity or workflow
phase that cites no frame is dropped, so every retained claim stays traceable
to the interval's observations. A memory recall failure degrades silently to an
evidence-only recap, and interval coverage records whether memory context was
used.

When the GitHub evidence integration is enabled and the employee has verified
GitHub accounts, the synthesizer also receives a bounded recorded-activity
block for the interval window. It separates two relationships: `performed`
(the employee's own accounts pushed, opened pull requests, reviewed, or opened
issues) and `triggered by their work` (CI runs linked to a commit they pushed
in the same window, deployments they created, and reviews or closures on their
pull requests). Recorded activity is provider fact, so the recap may state it
exactly as recorded and leads with it when present — but a merged pull request,
a passing workflow, or a deployment is never Nifty task completion, and
triggered items are never described as the employee's own action. GitHub events
stay inside the recap's collapsed `Evidence` disclosure beside the screenshot
count. Expanding it reveals separate `Screenshots` and `GitHub activity`
disclosures; each GitHub item retains its `You` / `Your work` tag and artifact
link. The model's structured `recorded_activity` output is kept only when it
matches the recorded list, so it cannot fabricate an item. A GitHub read
failure degrades silently to a Worktivity-only recap, and coverage records
whether GitHub context was used.

Review adds provenance without creating employee-authored truth:

- `inferred` — the AI recap as generated; silence leaves it here, and it still
  never advances the employee's substantive-update cadence.
- `confirmed` — the employee said “Looks right”.
- `amended` — the employee added or corrected context; the original AI text is
  preserved and a reviewed recap is frozen against later evidence.

An approved recap (confirmed or amended) may also produce **next-step
suggestions** through the existing proposal pipeline — a reviewed recap is the
one recap state trusted to drive task actions. One bounded generation pass per
recap revision considers the approved recap (headline, detail, activity
bullets, recorded GitHub activity, uncertainties), the interval's evidence
snapshots, and the employee's open tasks and subtasks, and proposes at most
three suggestions of exactly two kinds: `complete_task` for an open
task/subtask the evidence shows as finished, and `create_task`/`add_subtask`
for a concrete deliverable the evidence shows that is not tracked yet. Every
suggestion must cite the recap activities it is based on and clear the
confidence floor; suggestions must be grounded in the recap's own activities,
so a failed or successful CI run by itself never becomes a task. A proposed
target must be a real open task/subtask from the list the model was given, and
a subtask suggestion carries the parent's current state, so fabricated ids
cannot file and approvals apply instead of going stale.

The moment lives in the **mascot chat**, not in a queue. After the employee
approves a recap, the panel lingers instead of returning to the orb: it shows
the receipt and a `Next steps` card (`From your <interval> recap`) with each
suggestion as an actionable row — `Mark done` / `Add task` / `Add subtask`,
plus `Edit` (inline title edit) and `Skip` for new work. Each decision files
through the same owner-scoped proposal endpoint as any other review card;
nothing is ever auto-applied, and a skipped suggestion is never re-proposed
for the same task and operation. The moment is part of the shared workday
conversation: it persists across reloads and renders in both the floating
companion and the in-app chat, and a cross-window sync can never drop a card
mid-decision (the local card wins when the incoming turn predates it). A turn
whose card was lost to an older build re-attaches from the server on load —
its entry id carries the interval — so pending suggestions are never stranded.
Once a moment has nothing left to decide — every item decided, or nothing
actionable — the panel settles back to the orb after about three seconds,
whether the moment was fresh or recovered; items still awaiting a decision
keep it open. The recap confirmation's success animation is staggered: it
plays on the orb only after the panel has closed (by the settle or a manual
close), so the celebration is actually seen instead of finishing behind the
next-steps card. If nothing is actionable the card says so quietly before it
closes. Ending the moment with items undecided dismisses them, and a 24-hour
sweep expires anything the client never closed, so suggestions never pile up.
Generation never blocks the recap decision, never writes check-ins or cadence,
and its outcome (`next_steps_status`) is recorded on the interval.

The floating companion's Tasks tab renders these as a Recent activity stream in
the chat card language, newest interval first: interval label, quiet provenance
chip (`Not reviewed`, `Confirmed`, `Updated by you`), a concise headline, the
detail, and a collapsed `Evidence · N screenshots · M GitHub events`
disclosure. Expanding it reveals separate screenshot and GitHub activity
disclosures: screenshots show the exact analyzed frames with capture time and
neutral frame summary, while GitHub shows provider-recorded events with their
relation tags and links. The floating
stream's header carries a dark `View in app` action on the right that opens the
dock's Focus tab in the main window, where the same stream sits beneath the
daily goal. Expired images say
so honestly without deleting the recap; there are no charts, scores, or hours
totals.

The chat bubble for a due recap is a short conversational card: a `This is what
we got from your last hour` lead-in, the interval label, the headline and the
evidence-bounded detail (tall enough to carry the brief summary of the observed
window), and the inferred provenance line. It asks `Sounds good?` with two
actions: `Looks good` confirms the recap in place, and `Edit` hands editing to
the composer, which switches to recap-edit mode (an `Editing your recap` strip
with `Cancel` and an `Update recap` send label) so the employee writes the
correction themselves. Sending that note records it as the employee amendment.
Neither action mutates anything other than the recap, and the Tasks-tab stream
keeps its inline `Looks right` / `Add or correct` review.

The collapsed companion's prompt bubble carries the day's current demand
(check-in, agenda, or EOD). Tapping the copy opens the chat; when the demand
has an obvious destination, a full-width action at the bottom of the bubble
goes straight there instead of making the employee type first: the EOD prompt
offers `Open EOD review` (the main window's EOD review page) and the agenda
prompt offers `Set today's goal` (the SOD `Plan your day` modal). Check-in
prompts keep the tap-to-expand behavior alone. The action never replaces the
tap target — both are one click away.

The EOD uses a confirmed, amended, or inferred recap as activity context for
the hours it covers, labeled with its provenance, and falls back to the hourly
rollups elsewhere. A confirmed recap is still activity context: it never proves
task completion. Recap text outlives raw images under the report-retention
policy, and raw preview access keeps its existing own-frame or flagged/dispute
rule and audit.

## 10. Motion

Motion explains a state change:

- Hover/focus: 120–180ms.
- Button/row state: 150–220ms.
- Drawer/popover: 160–240ms.
- Progress interpolation: 300–420ms.
- Row completion exit: short and layout-true.

Use small transforms only: a 1px hover lift, 4–9px entry translation, or
approximately .985 press scale. No ambient loops, bouncing, overshoot, or
theatrical dashboard animation.

The Plan your day session hands off between its input, drafted review, and
recorded confirmation without replacing the modal backdrop. Compose/review
content enters over 210ms with a 7px translation; recorded confirmation enters
over 240ms with a 9px translation, using the product easing. Review focus and
the confirmation state persist when motion is reduced, with nonessential
animation removed.

The floating companion starts a bounded three-play attention sequence when an
actionable prompt needs input: repeat the familiar quick movement during each
five-second active window, hold still for one second, then repeat twice. A
snoozed prompt replays the same sequence when it returns. The mascot then stays
still in its alert pose until the employee responds. Never loop continuously,
and remove attention motion under reduced-motion preferences.

Respect prefers-reduced-motion. Remove transforms, shimmer, and nonessential
animation while preserving state, labels, and final geometry.

## 11. Responsive matrix

Every changed surface is reviewed at these classes:

| Class | Reference | Required behavior |
|---|---|---|
| Wide desktop | 1440×900 | side-by-side hero/pulse, complete metadata |
| Compact desktop | 1024×768 | compact rail, usable table, contained overlays |
| Narrow/tablet | 720×900 | intentional stack, wrapped controls, no collisions |
| Small | 390×844 | one column, touch targets ≥40px, no horizontal scroll |

Rules:

- Collapse rail labels before compressing task titles.
- At 900px, stack dashboard columns and search/filter controls deliberately.
- At 720px, hide redundant task metadata before title/completion.
- At 560px, use a bottom-sheet drawer, full-width local actions, and compact
  tab controls.
- Reserve content clearance for the floating launcher/sheet and composer; never
  rely on translucency to make covered work usable.
- Test at 200% zoom or equivalent narrow content width.

## 12. Accessibility

Accessibility is part of each module's interface:

- Prefer semantic buttons, links, headings, lists, tables, and dialogs.
- Keyboard access and visible focus for every action.
- Correct tab, dialog, menu, disclosure, and status semantics.
- Focus management and restoration for drawers, sheets, and menus.
- Minimum WCAG AA contrast for text and essential controls.
- State communicated with text/icon/shape in addition to color.
- Touch targets generally at least 40px.
- Meaningful async receipts announced without raw payloads.
- No essential information available only on hover.
- Text zoom and narrow-width resilience.
- Appearance preferences scale text and mascot art without shrinking labels or
  status text (see §8.6).

## 13. Mascot and custom assets

Otto is configured once in
desktop/work-os-companion/src/mascot.ts: name, poses, art, and crop. Render
the configured identity through Otto or MascotMark according to surface.

The mascot is a quiet guide, not a dashboard card and not a status replacement.
It may appear as:

- a small head mark beside agent speech;
- a restrained full figure in a connect/ready hero;
- a compact orb in the floating companion;
- a thinking/recovering/celebrating state when the corresponding event is real.

The compact floating companion has no circular halo or backdrop behind the
mascot. Keep elapsed session time visible while a shift is open, including while
paused; subtract completed breaks and freeze the timer at the current pause. A
small orange corner marker remains: it shows alerts when input is needed and
fills clockwise against the scheduled shift window when progress is available.
The companion's accessible name gives the numeric percentage. The marker
describes time only, never productivity or quality.

When an actionable update needs the employee's input, use the shared `alert`
pose rather than checking for one prompt kind. Repeat the familiar quick
attention gesture during a five-second active window, rest for one second, and
repeat twice; then return to the still alert pose until the employee responds.
Never loop continuously, and remove all attention motion under reduced-motion
preferences.

Art uses the existing ink/paper/signal palette and never becomes a generic stock
illustration. Do not create a new raster asset where the configured original
asset can be referenced. Mascot motion is removed under reduced motion.

The compact companion's drag handle is a visible, subtle dark capsule centered
above the mascot with a generous grab area. Keep it about 50% larger than the
previous 48×20px ordinary handle (72×30px) and 52×20px due-prompt handle
(78×30px), without covering the separate hide control. The due-prompt mascot
starts below the handle, including during its 6px attention gesture.

## 14. Deep module and seam rules

UI modules should be deep: a small interface should own the behavior,
accessibility, visual states, and test surface behind it.

- Dashboard state selection belongs in dashboardModel.ts, not repeated in
  dashboard renderers.
- Dashboard rendering belongs in the shared DashboardSurface seam so pre-shift
  and active surfaces share tokens and state behavior.
- Task row selection, sorting, grouping, and provenance belong in the task
  workspace seam, not in each page.
- Chat/tool frame behavior belongs in shared chat modules; dashboard code must
  only open the launcher and pass truthful context.
- Accept dependencies and return state/results; do not create hidden providers
  inside renderers.
- Keep local seams private unless two real adapters require a public seam.

The interface includes semantic contracts, focus behavior, responsive behavior,
error modes, provenance, and performance expectations, not just TypeScript
props.

## 15. Visual QA and release acceptance

A UI change is incomplete until the rendered result is inspected. The required
evidence for a dashboard/task change is:

1. Wide normal state at 1440px or equivalent.
2. Compact desktop state around 1024px.
3. Narrow/mobile state around 390px.
4. Pre-shift, active, observed/degraded, empty, and dense task states.
5. Selected, hovered, keyboard-focused, menu-open, and drawer-open states.
6. A completion/add-task flight with the rest of the list still usable.
7. Reduced-motion render.
8. A check for horizontal overflow, covered controls, clipped labels, and
   asynchronous layout shift.

A voice input change adds the capture states to that list: idle with an empty
draft (the record control in the send slot), idle with text (the send back),
requesting, recording, transcribing, the transcribed receipt, and the
permission-denied and no-speech failures — at wide and narrow widths, in both
themes, and under reduced motion.

The selected-row review specifically asks:

- Is the row selected without a colored rail?
- Does its geometry remain stable?
- Can a keyboard user see focus?
- Does the same state look intentional at dense and narrow widths?
- Does it remain visually subordinate to the task title and action?

Record what was actually rendered and exercised. A build or static assertion is
not visual acceptance.

## 16. Administration workspace

The web administration surface is a first-class Work OS workspace, not a
diagnostic form. It follows the same material system, typography, and
provenance language as the employee and manager surfaces, and it answers the
operator's questions in order: who is working, what needs a decision, what the
record shows, and what the next useful action is.

### 16.1 Shell and navigation

The workspace lives at `/work-os/admin` with real routes: Overview, People,
Tasks, EOD Review, Insights, Evidence, and Settings. The server route gates the
whole subtree to Work OS admins; employees and managers keep their own
surfaces, and a mapped administrator reaches their employee workspace through
`/work-os/me`. Legacy `?surface=admin&tab=…` links redirect to the closest new
destination instead of rendering a dead tab.

The workspace owns its navigation: a horizontal section nav in the masthead,
not a second sidebar. The host shell keeps its chrome, and the Work OS surface
paints its own `.work-os-surface` token scope (the §3.1 palette in light and
dark) so the workspace reads as one material even inside a host application.

### 16.2 Page contracts

- **Overview** is the command center: a needs-attention list (reviews pending,
  outstanding EODs, overdue tasks, disputed evidence, configuration blockers),
  a right-now roster with attendance state and observation freshness, a recent
  activity stream (updates, interval recaps, completed tasks, evidence,
  submissions), today's counts, and a quiet workspace-health panel. Readiness
  is context, never the lead.
- **EOD Review** renders the report as a structured document — meta lines,
  sections, and the activity-context disclaimer — beside its sourced evidence
  and interval recaps. The decision record keeps manager notes and an optional
  manager version, and the raw markdown stays available behind a disclosure.
- **Insights** uses fixed ranges with deterministic facts first: a written
  brief, a metric strip with equal-earlier-period comparisons, one daily-record
  chart, observed-app context, backlog pressure, and a per-person facts table
  with a detail drawer. It never converts activity into a productivity score.
- **Evidence** separates evidence from activity recaps, filters by date range,
  person, source, and disputed state, and groups rows by day. The detail drawer
  exposes provenance and, for flagged or disputed items only, restricted
  screenshot access with a recorded reason and audit entry.
- **People** is a roster with a person drawer: mappings, schedule and
  exceptions, recent workdays, reports, updates and recaps, and a seven-day
  evidence summary.
- **Tasks** is the organization task record with bounded filters and the local
  add-task flow; **Settings** groups system status, features, memberships,
  teams, provider connections, field mappings, and blueprints into sections
  with one action per decision area.

### 16.3 Data and provenance

Administration endpoints are admin- or manager-scoped and organization-scoped
on every query, with bounded limits and no raw storage paths. Observed activity
keeps its cool observation treatment and its labels; employee-authored updates,
task records, provider evidence, and review state remain visually distinct.
Empty, loading, and degraded states follow §9's state matrix: skeletons reserve
geometry, empty states name the next action, and errors stay local.

### 16.4 Evidence integrations

Provider integrations surface as one band at the top of the Evidence page: a
live provider card (connection state, workspace, mapped accounts, last event,
and the repository-management action) beside future providers rendered blurred
with a `Coming soon` pill and no controls. Unmapped provider accounts appear as
a queue — account, event count, last activity, a person selector seeded from
the employee's own provider username — with one `Map & backfill` action that
verifies the account and attributes its earlier events. A repository drawer
lists the organization's repositories with their webhook state; without a
repository-management token it shows the manual setup instead. Provider tokens
and webhook secrets never reach the client. Ingested GitHub events are default
branch pushes, pull-request open/close, submitted reviews, completed workflow
runs, deployment status changes, and issue open/close; every event carries its
repository and actor so a row can always name where it came from.

## 17. Implementation checklist

Before editing:

- Read this document.
- Inspect the current implementation and the latest reviewed preview.
- Check the shared chat seam and mascot source before touching adjacent surfaces.
- Inventory existing tokens, task-row behavior, drawer behavior, and preview
  fixtures.
- Write down any intentional deviation.

During editing:

- Use semantic tokens and shared seams.
- Keep selection driven by aria-selected.
- Never add a colored content-row rail.
- Preserve approval/provenance contracts.
- Add deterministic model/render coverage for new visual states.
- Keep the changelog entry employee-readable.

Before handoff:

- Run build, typecheck, and relevant tests.
- Run the existing TestSprite smoke test against a local preview.
- Review screenshots, not only DOM assertions.
- Run one CodeRabbit pass for the completed batch when required by the repo
  workflow.
- Report branch/commit, rendered states, interaction checks, and anything not
  deployed.

This blueprint is the default for new Work OS work. A deviation is allowed
only when it solves a real product or accessibility need and is documented in
the implementation and the next blueprint revision.
