# Work OS premium product design blueprint

This is the canonical visual and interaction blueprint for Work OS. It applies
to the web platform, the installed companion, the in-app Otto sheet, floating
Otto chat, employee workflows, manager review, administration, and future
operational surfaces.

This blueprint sets the standard for Work OS surfaces: quiet editorial command
centers, strong typographic hierarchy, precise data layouts, generous but
purposeful whitespace, and one unmistakable action per decision area. It rejects
generic card grids, oversized status treatments, colored row rails, and
dashboards that read like decorated forms.

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

The dark variant re-materials the same roles on a neutral graphite ground so
the workspace reads as one material inside the host console (see the dark
material rule in §4.3). Reference values: ink `#e9eaed`, ink-soft `#b4b7be`,
muted `#8b909a`, faint `#6b6f78`, canvas `#17181b`, stage `#1c1d21`, paper
`#1a1b1e`, raised `#212227`, inset `#282930`, line `#34363d`, line-strong
`#41444c`, signal `#a8f15b`, signal-deep `#8fd24a`, danger `#e57b6f`,
warning `#e0a44a`, observed `#7fb3d1`. Categorical chart hues are
theme-aware (`--chart-1` … `--chart-8`) so a series keeps its colour across
themes without a light-paper hue turning sandy on graphite.

Known gaps: `--color-faint` (2.7:1 on paper) must not carry text. `--color-danger`
(4.3:1 on paper) and `--color-warning` (3.0:1 on white) fail AA as text on light
surfaces, and the signal focus outline is 1.3:1 on paper. The conversation
surfaces resolve the focus gap with one chat focus color — `--conversation-focus`
(#4a7d22, 4.5:1 on paper), exposed to the chat Tailwind theme as `--color-focus` —
used for composer rings and every chat focus outline; the bright signal lime
stays for actions, progress, and confirmed states. `--color-muted` passes
on paper (4.8:1) and is borderline on inset (4.47:1). Until a palette decision
adds text-safe variants and a focus color, these tokens are for icons, borders,
and fills, and text uses `--color-ink-soft` or a darker muted value.

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

The two chat surfaces (the in-app sheet and the floating companion) map onto
these roles with one five-step scale — 10 eyebrow, 11 metadata, 12 control,
13 body and card strong, 14 turn and pane title — and introduce no fractional
sizes; 800 weight belongs to the 10px eyebrow alone. The active chat tab is a
quiet inset surface (§4.2); ink fills are reserved for the real decisions.

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

Navigation is a stable noun: My Day, Tasks, EOD Review, Insights, Evidence, Settings.
The active destination uses a quiet inset surface, ink/signal icon treatment,
and a visible focus ring. A narrow marker is allowed only for the primary
navigation rail itself; it is not allowed beside content rows, task rows, cards,
or selected records. The Settings destination names its shortcut in its tooltip;
§8.13 defines the shortcut inventory.

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
hidden until that surface is ready for daily use.

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
- The dark variant is a role-preserving re-material, never a hue-preserving
  inversion of the light stack. Inverting the warm ivory stack keeps its warm
  cast, so a dark workspace rendered that way reads as a warm island inside a
  cold console. The dark scope therefore takes the console's neutral graphite
  family and a clean near-white ink: same roles, one material with the host
  application. Signal green stays the single accent; the categorical chart
  family is theme-aware, because a hue tuned for ivory paper turns sandy on
  graphite.
- Each destination owns one masthead (context eyebrow, single title, compact
  utilities), one content axis, one panel family with hairline dividers, and at
  most one primary action per decision area. Task rows stay flat; task details
  open in a right-side drawer and menus are detached surfaces.
- At narrow widths, masthead utilities move below the title and wrap without
  extending the page horizontally; the primary action remains visible.
- The web surface is status-only for attendance: it names the Worktivity state
  and freshness, keeps the activity watch truthful, and points to the Windows
  Companion for Clock in, Pause/Resume, and Clock out.

A mapped administrator has two Work OS views, the way the companion does:
**Administration** and **My workspace**. The active view is a per-device
presentation preference stored in the `work-os-view` cookie and reported by
`/api/work-os/session`; it is never an authorization boundary. Administration
keeps the platform console and the administration destinations. My workspace
keeps only the employee destinations, and an administration URL redirects to
the employee home while it is active (and the reverse while Administration is
active). The switch is visible on both sides: the employee workspace band
carries `Switch to Administration`, every administration masthead carries
`Switch to my workspace`, and the platform sidebar's Work OS group follows the
active view. An administrator without a mapped person stays in Administration,
managers keep the review console, and non-admin behavior is unchanged. The
default with no stored preference is Administration, so existing administrator
bookmarks keep their meaning.

The web workspace also carries the companion's employee-facing capabilities so
the two surfaces tell the same story: the two-view Plan your day session
(input → drafted review → refine/confirm, with the Loom attachment), the
Activity Interval Review stream with confirm/amend, Work Memory management
(Needs review / Remembered), the shift-time instrument (elapsed, bounded
scheduled-window progress, remaining time), optimistic task adds with
surface/defer, per-day screenshot evidence, and the deterministic insights
record with exact-value charts. Surfaces that stay companion-only by design:
Worktivity attendance mutations, the system-wide hold-to-talk shortcut, the
window-focused Ctrl + , Settings shortcut, the
floating window and orb chat, OS notifications and sounds, the offline queue,
appearance settings, and device sessions.

### 4.4 Developer diagnostics window

The companion debugger (Scenarios, Live trace, Export) is an opt-in developer
window. It is destroyed when closed and recreated on demand, so it holds no
history and no subscriptions while closed. The Live trace tab releases its rows
and listener when another tab is selected. Its tabs follow the peer-view contract
in §8.13.

Rows are intentionally dense at 34px. This desktop-only developer surface is an
exception to touch-sized controls; every action remains keyboard accessible and
has a visible focus state.

The live trace reads the host's diagnostics history: 1,000 events in memory,
newest first, read in pages of 50 with at most 100 rows loaded at once (§9.2).
Method and path appear inline on request spans, and duration appears inline on
completed and failed spans. The category is the row's title, and the message
appears only when it adds something the category does not. The source value and
full JSON appear only in the expanded row. Spans at or above one second are
marked slow. Search, level, and source filters apply to the whole history, not
just the loaded rows. Pause freezes the view and resumes with a refresh. Clear
view sets a sequence floor for the lifetime of that debugger window: later events
remain visible, earlier events do not reappear, and disk logs remain untouched
and available to Export.

This is the one place where a dense diagnostic list is intended. The §2.3 rule
against a permanently visible diagnostic wall applies to product surfaces, not to
this opt-in developer window.

### 4.5 Insights dashboard composition

The employee Insights dashboard (companion first, replicated in the web
workspace) leads with the record itself:

- A five-tile KPI strip: label, exact value, an equal-earlier-period pill only
  when the response actually carries a comparison (never a drop against zero),
  and an optional per-day sparkline. The value is always rendered as text.
- Banded cards under it: the primary daily chart; plan reliability (recorded
  ratio rows — on-time outcomes, days with an update, days recorded — each a
  percentage, a bounded track, and the exact counts behind it); the record mix
  (tinted stage blocks sized by share of the range's recorded items, with exact
  counts in the legend — a composition, never a conversion sequence); closing
  attention (carry-over, overdue, blockers, tinted only when non-zero, plus
  next focus); work rhythm; and evidence & context beside recorded updates.
- The exact-value daily table stays behind the daily-breakdown disclosure
  (§9). Charts keep their accessible exact-value fallbacks and reduced-motion
  behavior; observed activity keeps its cool treatment and never becomes a
  score.

At viewport widths under ~1120px the bands collapse to one column and the KPI
strip wraps to three then two tiles; nothing gains horizontal scroll.

### 4.6 Workspace identity and selection

An account can belong to more than one Work OS workspace. The active workspace is
explicit and visible, never an implicit oldest or most-privileged membership:

- An account with one active membership enters it directly. An account with two
  or more and no chosen workspace lands on `/work-os/select-workspace`, which
  lists only that account's own memberships with each role, one plain POST per
  workspace. Choosing one returns to `/work-os`, where the dispatcher applies
  the role.
- The web stores the choice in the per-device `work-os-org` cookie. The server
  verifies the membership on every request; the cookie selects among verified
  memberships and is never an authorization boundary. A stale choice falls back
  to the only remaining membership, or to the chooser when more than one
  remains.
- The active workspace name sits in the administration masthead and in the
  employee workspace band, with a `Switch workspace` link whenever a second
  membership exists. The band is absent for a single-workspace employee, so the
  quiet default composition is unchanged.
- The desktop connect screen names the workspace and requires the choice before
  it authorizes the device; the resulting device session is bound to that
  workspace. A workspace without a mapped workday is not offered as a companion
  choice, and the screen says so.
- The browser round-trip hands off automatically. After approval the web screen
  keeps the authorized device on screen and attempts the companion handoff once
  as soon as the callback is issued, so the employee does not have to press
  again. Because a browser may refuse an external-protocol launch without a
  fresh press, the same `Open Work OS` action stays visible as the fallback.
  The companion keeps a visible waiting state with a `Reopen browser` action
  until the callback lands, and the page names the signed-in account and the
  chosen workspace before the decision.

## 5. Dashboard blueprint

The dashboard is a command center, not a report of everything Work OS knows.
It changes hierarchy with the workday state. All dashboard states use the same
content axis, tokens, and action language.

### 5.1 Pre-shift / not clocked in

The clocked-out dashboard uses the same three-part composition as the active
day — one workday band, one focus strip, one queue — so the page does not change
its shape when the shift starts:

1. Attendance band. The state line (Ready to begin, Off shift, or Worktivity
   status), the short state detail plus the clock-in contract, one primary Clock
   in action in the Windows Companion, and one quiet Set focus action. The web
   dashboard shows status and
   directs employees to the Companion for attendance actions. Otto is a
   restrained mark in the band, never the reason it is tall.
2. Window instrument. The time until the window opens at the band's leading edge,
   with the scheduled start and end on the axis. Before the window opens there is
   no position to mark, so the axis carries no now dot; the live fact is the time
   until it starts.
3. Counts. Planned, carried over, overdue, and completed sit in the band as four
   linked facts, each opening the view it measures. A zero is a quiet fact, not a
   control.
4. Focus strip. Today's focus on one line with its provenance, under the shared
   pan contract (§6.2).
5. First moves. A short open-task queue with direct completion, a full Tasks
   path, and the task-record sync state in its footer.

At 1024×768 the first task row is visible without scrolling, matching the active
day. The readiness hero and its separate pulse, metric, and work-in-motion cards
were removed: they restated the counts and the window, and together they pushed
the queue below the fold.

When no schedule exists, say so and keep the Companion's exception-start
confirmation truthful. Planning before clock-in must state that it does not
start attendance.

### 5.2 Active / clocked in

The active dashboard is organized around one command surface:

1. Attendance band: the state line (On shift, Paused, or Worktivity status), the
   window instrument, and Pause/Resume and Clock out in the connected Windows
   Companion. Worktivity owns the state and confirms each change before Work OS
   mirrors it. The band has no permanent footer: one exists only while it carries
   a pending activity check or a focus-save retry, so the normal state spends its
   height on the instrument instead of a restated status sentence.
2. Window instrument: elapsed and remaining at the ends of one bounded progress
   bar whose start and end label the axis. The position marker carries the
   present without restating the reader's own clock. It is a calm instrument,
   not a gamified score.
3. Counts: completed, open today, overdue, and carried over sit in the band as
   four linked facts. Each has a single owner on the page and opens the view it
   measures; a zero is stated quietly and is not a control.
4. Focus strip: today's focus as one line with its provenance and save state,
   under the shared pan contract (§6.2).
5. Task queue: Today, Yesterday, Older tabs with live counts, Add task, and a
   direct full-workspace path. The tabs are the panel's title; no eyebrow or
   heading restates the selected view.
6. Otto chat entry: a compact launcher outside page flow. Opening it creates the
   shared bounded chat sheet and must not cover the queue.

The band and the focus strip stay deliberately compact: at 1024×768 the first
task row is visible without scrolling, because the queue is the visual anchor
and the attendance state is context, not a second hero. The 132px progress ring
is a documented deviation from the earlier composition: it and the timeline bar
encoded the same window percentage, so the bar is the one instrument and the
ring's vertical space belongs to the work. The four counts have one owner — the
band — rather than a flow legend and a facts row that disagreed about which
numbers the day is made of.

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
3. One flat task-list panel whose header borrows the dashboard queue's outline:
   the four views (My day, Unfinished, Completed, All tasks) are the panel title,
   and the compact search field and the date-range filter ride the trailing
   edge. The controls wrap below the views only when the header runs out of
   width.
4. The list's own header row — the quiet sortable column row for Name, Date
   Due, and Status — carries the local Add task action at its right edge, so the
   action belongs to the list it adds to and the panel title row stays a title.
   Ordering and the action share that row without crowding: the date and status
   tracks keep the width the rows use, and the action sits in the space the
   status column leaves free. The column labels are written as words, not
   shouted labels, so the row reads as a quiet table header.
5. Shared anchored composer with reserved bottom clearance.

Do not put a permanent focus editor or oversized hero above the table. Focus
editing belongs to the shared composer/editor.

### 6.2 Table rhythm

Use a flat, readable list:

    completion | task + metadata | progress | due | status | actions

The actions column is one intrinsic menu cell at the trailing edge: a row with
an action for this actor carries a single ellipsis trigger aligned with the
status pill, and the trigger never widens the row or shifts when a menu opens.
The menu is detached (§8.3) and opens beside its trigger, so the row keeps its
height and no action is inlined as text. A row with nothing available to this
actor renders no trigger — an empty menu is never offered — and a cached
payload that predates the capability answer waits for the refresh instead of
guessing from assignees. The status items are the one place a menu states a
stored state: the option that matches the status the row displays carries the
check mark and is disabled, because choosing it would write the value the task
already holds.

The Tasks page has one date navigator in the masthead, one task-list panel, and
one task list. The panel header carries the views, a compact search, and the
date filter on one row while width permits; search and the date filter ride the
right edge, the search stays compact while the header is one row, and the
controls wrap beneath the views rather than compressing them. Once wrapped on a
small screen, the search may take the row. Do not repeat a Task queue heading or
status section headers. The list begins with one quiet sortable column row for
Name, Date Due, and Status, which also carries the Add task action at its
right edge; the row aligns to the task, due, and status tracks rather than
introducing a second boxed toolbar, and the action never crowds the status
label. Keep the canonical default order visible through the row
sequence: due date latest-first, open work above completed work, and undated
items last.

At wide widths, the title column absorbs available space. Progress, due date,
status, and menu columns remain intrinsic and aligned. At narrow widths, the
due/status columns fold into a labeled line in the row body (Overdue · date,
Due today, Due date) before anything is hidden; then the project name and
description drop, so the title, completion control, and due signal always
survive. The agenda strip stays one compact row down to 780px — the focus
statement and the carry action — and becomes a two-line stack below. The counts
live in the panel's view tabs.

The carry action reports the unfinished count as a compact amber badge in the
same language as the notifications badge: the number alone in a circle, growing
into one pill that reads "N unfinished tasks" when the action is hovered or
takes keyboard focus — never when the pointer is merely over the focus line. The badge sits outside the action's
box, so the expansion never reflows the row and never moves the action itself,
and below 481px it keeps the number alone because there is no strip space to grow
into. The count is also in the action's accessible name, so it is never
hover-only information.

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

Rows:

- Minimum 64px high, with 12–16px vertical breathing room.
- Transparent/paper surface with hairline dividers.
- One title line, one metadata line, optional one-line description.
- A single semantic status pill: Pending, In progress, Overdue, or Done. Pending
  and In progress share the quiet treatment — the label carries the difference
  — so neither competes with the Overdue and Done states, which lead.
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
- The active sort is stated once, in the column row. A day group states an order
  only when that group deviates from the view's own.
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

This treatment applies where the surface has a selection model. The task list
has none. There `aria-selected` — which is also invalid on `role="button"` —
could only restate "this task is on today's plan", and because every My day row
is on today's plan the selected chrome would cover the whole list and say
nothing. That fact is the `On today` tag, and inside My day it needs no signal
at all: every row there is on today's plan.

Hover is a smaller version of the same surface change. Keyboard focus gets a
visible 2px focus ring outside the row, with sufficient contrast. Focus and
selection must not be communicated by color alone.

### 6.4 Views and ordering

My day is strictly day-scoped and leads with its work split into urgency
groups: Overdue, Due today, Later, then No date last. The group order never
changes with sorting so urgency can never be buried, and the active column sort
orders rows inside each group. The groups do not print a header row each: §6.2
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
streaming-list contract (§9.2): the Tasks list loads only on the explicit
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
Undated old work is carryover, not overdue. All surfaces use the same selector
and predicate.

### 6.5 Task drawer

Desktop task details open as a right-side drawer, up to 540px wide, with a
stable header, scrollable body, and footer actions. The underlying list stays
in place and does not reflow. The drawer includes full title, description,
source/provenance, dates, assignees, subtasks, and lifecycle actions.

The drawer's action block carries the task's status control, the assignee
control, and its lifecycle actions — Edit task, Archive task (reversible), and
Delete task (which always asks for confirmation) — and every control renders
only when the task's capability payload allows it. A cached payload without
capabilities shows no controls rather than advertising an action the server
would refuse, and a completed task has no status path until it is reopened.

The status control states the task's current status and opens the detached
menu of §8.3, listing Pending and In progress with the current option marked
and inert. An overdue task keeps it disabled with the note "Update the due date
first": overdue is derived from the due date, so the control unlocks only once
the due date is today or later, and reopening a completed task restores the
status it held before completion (reading Overdue again if its due date has
since passed). The assignee control lists only the people this actor may
assign; when a current assignee sits outside that scope the control locks and
states why, so a client never submits a set the server would reject. Replacing
the assignees records the actor as the task's assigner.

At narrow widths it becomes a bottom sheet with a safe viewport inset and an
internal scroll region. Menus and drawers must collide with the viewport, close
on Escape/outside click where appropriate, and restore focus to their trigger.
Destructive archive/delete actions are explicit and separate.

**Completion evidence previews.** The drawer's employee-attached evidence rows
show the file before download: an image uses its real bytes as the thumbnail,
and every other supported type carries one type tile with a readable extension
badge (PDF, Word, Markdown, text, CSV, ZIP, 7Z). The row's download action stays
separate from the row itself; activating the row opens the preview dialog.

The preview matrix is explicit and never guesses:

- Images render at full size in the dialog.
- PDFs render in an embedded viewer (a blob URL in an iframe) with a persistent
  download fallback for webviews that cannot display PDF.
- Plain text, Markdown, and CSV render as readable text, capped at 200 KB with a
  truncation notice. Markdown uses the safe renderer, so raw HTML stays inert
  text; it is never injected.
- Word (`.doc`, `.docx`) and ZIP/7Z keep a metadata preview — name, type, size,
  attachment time, provenance, and note — with a primary Download action. The
  companion does not extract Word or archive contents, and `.docx` is not given
  a partial text preview.
- HTML and SVG are not supported types and are never inlined.

Both thumbnails and previews read through the authenticated bearer fetch and
hand a short-lived object URL to the renderer; a token never appears in an
`<img>`, `<iframe>`, or other URL. Object URLs are revoked when the row closes,
the dialog closes, or the selection changes. A thumbnail reserves its geometry
while loading, and a corrupt or missing file falls back to a clearly unavailable
type tile; the dialog states Preview unavailable and keeps Download available.

The dialog is labelled by the file name, described by the provenance sentence,
opens with focus on its close control, traps Tab within the dialog, closes on
Escape or a backdrop press, and restores focus to the evidence row. At 720px
and below it takes the full viewport with a single internal scroll region; the
footer action becomes full-width at 560px. Evidence remains employee-attached
output evidence: the preview and its provenance line never call the file a
provider confirmation or proof of completion.

### 6.6 Completion evidence

A completion may carry one explicit employee upload: one file plus an optional
short note. The task row's completion control and the drawer's `Mark complete`
open the same completion step, so the two paths cannot tell different stories.
The step states whether the task records an expected outcome (where the
attachment is required before completion) or is a simple task (where evidence is
optional), and it keeps the honest no-evidence path wherever the task allows it.

The step moves only through persisted states: idle, saving the file, saved but
not complete with `Retry completion`, and confirmed completion. A failed upload
keeps the selected file and note for retry and never marks the task done. A
completion failure keeps the saved evidence and says the task is not complete
yet. The same step can attach evidence to an already completed task without
changing its state.

The record is `manual`, employee-attached output evidence with the employee,
task, timestamp, file name, size, and note. It is never provider confirmation,
never a Worktivity screenshot, and never a completion claim by itself. The
drawer lists it under `Completion evidence` with `Employee-attached` provenance
and a download action. Administration and EOD reads receive the same row as
output evidence. The raw-screenshot restriction (§16.4) does not apply because
these are explicit employee uploads, while the file is served only from an
authenticated, person-scoped route and raw storage paths never reach a client.

One file: PNG, JPEG, WebP, PDF, text, Markdown, or CSV up to 8 MB; the note is
1,000 characters or fewer.

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

The live working card is the shared frame for every wait in both chats. Its
header carries the 34px status tile, the 10px `Working now` eyebrow, the 14px
active label, the tabular elapsed time, and one disclosure; the body shows the
current step at 13px with the shared spinner, and the steps already done
underneath at 12px with muted checks. The same card carries the request itself
(`Sending your update`), the interpretation (`Thinking`, `Reviewing your
agenda`), and task loading (`Loading tasks`), and it settles into the collapsed
`Completed` receipt. The card owns the full assistant turn — no separate mascot
mark beside it — and the full trace remains available through the disclosure.

Tool surfaces must preserve:

- explicit approval before mutations;
- truthful queued/recorded/failed/skipped states;
- per-item results for batches;
- internal scroll for long task lists;
- clipped task and subtask titles that reveal on the row's hover or focus (§6.2);
- keyboard reachability and visible focus;
- reduced-motion behavior;
- copy controls that do not crowd the message bubble.

An approval batch is reviewed one action at a time. The card's top edge carries
the batch progress rule, the header names the action with its position (`N of
M`), and the footer keeps the quiet step arrows beside the two decisions on one
compact row at every width — content-sized decisions that wrap beneath the
arrows only when the card is genuinely too narrow — so nothing in the card
reads heavier than the action being decided.

### 7.2 In-app launcher and sheet

The closed in-app state is a compact Otto launcher fixed to the lower-right
viewport corner and outside page flow. It never leaves an empty input shell
behind or consumes task-list space.

The open state is a bounded white sheet, approximately 480px wide and 680px
tall at desktop, with safe insets on narrow screens. Header, thread, and
auto-growing composer are one coherent surface. The composer row carries only
the add menu, the field, and the send/record control; the day's goal lives in
the Focus tab rather than as a third control in the row, and the placeholder
fits on one line at the sheet's width. The thread is the only scrolling
region on the chat tab. The sheet closes on Escape and returns focus to the
launcher.

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

### 7.3 Floating Otto chat

The floating companion uses the same white window border/header treatment and
the same composer anatomy. The window remains inside the viewport, grows the
composer with the draft, and uses detached menus that cannot be clipped by a
scroll region. Minimize-to-orb and hide-window remain distinct and truthfully
named.

The thread owns scrolling, but its bottom dissolve belongs to the fixed
composer edge, not the scroll content: keep the thread fully opaque, disable
scroll anchoring while an inline task card expands, and place the short fade
outside the scroller at the composer’s top border. Task-card selection and
confirmation actions remain clear above that edge. The Tasks view is a reading
list, not a thread: entering it starts at the top, and nothing that arrives —
a recap decision, a new recap, or an appended page — moves the reader. The
chat tab alone follows the thread scroll contract.

Both chat surfaces use the configured mascot head crop through
src/chat/MascotMark.tsx. Never hardcode mascot art, the mascot name, or a
generic sparkle as agent identity. Global mascot changes belong in mascot.ts.

Prompt reminders — the plan question, a due check-in, the EOD nudge — are
scaffolding for the prompt they announce. The companion may show one in the
thread, but it is removed as soon as that prompt is answered or replaced, is
never written to the vault or sent as conversation history, and never replays
in the agent's stored context. A scheduled check-in appears only once its
prompt time arrives: confirming the plan never triggers an immediate check-in
demand. A due check-in leads with the day's overdue count (`N tasks are
overdue`) when open work is past its due date — the one task fact that belongs
in the ask itself, because it is the day's outstanding state — and then the
check-in ask.

Both chat surfaces carry the same voice input contract (§8.8): the record
control takes the send slot only while the draft is empty, and a transcript
lands in the draft for review.

### 7.4 Message times and session dividers

Both chat surfaces state when a reply arrived. Hovering or focusing an agent
turn reveals its local 12-hour clock time at the right edge of the reveal row,
after `Copy` and any destination action, so the row reads `Copy`, action, time.
Employee bubbles reveal no hover time; their sent time is the session divider's
job. A turn with no recorded timestamp shows no time and is never assigned one.

A centered divider labels the conversation's opening employee message and every
employee message that follows the previous turn by more than twenty minutes.
The label is the relative day plus the local 12-hour time — `Today 5:48 PM`,
`Yesterday 9:03 AM`, `Wednesday 9:03 PM`, `September 30, 5:48 PM` — derived
from the same recorded timestamps the turns persist. Dividers live in the
thread (not hover- or motion-driven) and stay for the life of the conversation;
clearing the chat clears them. Both surfaces render the shared conversation, so
the dock and the floating window always agree.

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

The task record's header owns the name and its one-line detail on the left and
the primary Add task action at the trailing edge. Beneath it, one compact
controls row carries the views, the always-visible search, and the
person/project selects in reading order; search leads into the record filters,
and Add task never sits in that row. Below the compact desktop class the views
take the first row and search plus filters follow; at the small class the name
and Add task share the first line, the summary drops to the next, and the
action keeps a 40px target (`.admin-controls`, grouped by
`.admin-controls-group`). Date range stays a peer control or popover, with
clear/reset behavior and a result count when active. Filtered empty says No
tasks match these filters, never No tasks.

### 8.3 Menus and detached surfaces

Menus open near their trigger, float above content, and never change row height.
They close on Escape/outside click and remain within the viewport. Use a
detached card for contextual details rather than inserting a panel into the
page and shifting the user's scroll position. The outside-click boundary is the
trigger plus the menu itself, including when the menu renders through a portal
at the document body; a press inside the menu never dismisses it before the
item's action runs.

The task status control behaves as one menu wherever it appears: in the drawer
it is a trigger that states the current status, and in a row or administration
menu it is the same item list inside that row's action menu. Opening it focuses
the first enabled item, and Escape, an outside press, or running an item closes
it and returns focus to the trigger. Its items are Pending and In progress;
whichever matches the status the row displays is marked and disabled, because
choosing it would write the value the task already holds. An overdue task's
options are all disabled with the due-date note. It is never a segmented
control, a native select, or an inline panel, and it never changes the row's
height.

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
  `Keep` and `Discard`, and an honest empty state. The chosen action stays
  pending until the server confirms it; a confirmed row exits and the remaining
  rows move into place. Reduced motion removes the movement, and errors leave
  the proposal available to retry.
- **Remembered** — kept facts as flat rows on hairlines, each with the verified
  glyph, `Kept <month day>`, and `Forget`; beneath a divider, the Recent
  activity feed with its kind label, summary, calendar day, `Forget`, the
  eight-row cap with `Show all N`, and the provenance line.

Tab switching follows the shared peer-view contract (click or ←/→/Home/End,
with roving tabindex and the count as part of each tab's accessible name).
The modal body is the only scroll region and uses the shared edge dissolve;
Escape, backdrop press, and the close control all dismiss it, and focus returns
to `View`. Below 720px the summary stacks with its counts and action in one row
beneath the copy, and below 560px the modal takes the viewport inset. Keep,
reject, and forget keep their exact existing behavior and states; nothing is
remembered without a keep.

### 8.6 Appearance settings: text and mascot size

Reading & display sits with the Settings groups and holds exactly two
preferences. Both are per-device, apply instantly in every window, and are
remembered locally rather than synced to the workspace:

- **Text size** — `Small` (default) or `Medium`,
  which scales text 15% through one root custom property (`--text-scale`).
  Every px `font-size`, `font` shorthand size, and fixed `line-height` is
  compiled to `calc(px * var(--text-scale))` by the companion's build seam, so
  text scales without moving layout, icons, or spacing.
- **Mascot size** — `Large` (default) or `Small`
  (62% of current). One scale rule over the shared art class follows
  `--mascot-scale`, so every surface — chat marks, the thinking trace, hero
  and EOD art, the connect screen, the dashboard, the memory tile, and the
  floating companion orb — changes together. Only the art scales; labels,
  progress rings, and status text keep their size and legibility.

Both preferences render as a two-option segmented radio group
(`role="radiogroup"` with `role="radio"`, roving tabindex, and arrow keys),
state the current value, and normalize unknown or missing stored values back to
the default — never to the larger setting. The main window applies
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
  two windows polling together never stampede the provider. The cache belongs to
  the background cadence, never to an explicit request: a page load, the refresh
  control, the day's attendance sync, and the companion's first check after
  launch all ask Worktivity immediately (`?refresh=1`), so a clock-out made in
  Worktivity lands on that refresh instead of the next poll.
- A transition observed in Worktivity alone is only as fresh as the last
  provider read. The desktop webview may reach the API cross-origin, so the
  preflight allow-list names every header the companion sends — including the
  desktop control marker and the machine cadence overrides. A missing header
  fails the preflight and surfaces as `Failed to fetch` before any route runs.

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
- **Loom source** — a recording link, a pasted transcript, or both. A pasted
  link is read automatically when Build is used, so reading it is never a
  separate prerequisite; if Loom says the recording is not usable for the day,
  the build stops on that verdict. A transcript pasted without a link is still
  the employee's own copy of the recording's words: the draft may use it, but
  the surface never claims a verified date, title, or length.
- **Drafted view** — the review document with its own in-place actions (edit,
  delete), starting at the top of the body with no inherited scroll position.
  Focus follows into the view so keyboard and screen-reader users land on what
  changed.
- **Plan summary** — the drafted summary states the day's focus in one or two
  sentences, written as the goal. It never describes the source or the
  analysis: no Loom/transcript provenance, no recording date, no missing task
  IDs or linking notes, and no "completion is not assumed" caveat. Source
  limits shape how confidently the commitments are linked, not the summary
  copy.
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
  known. Dismissing it through `Got it`, close, backdrop, or Escape marks it
  seen for the account (`work_org_members.ui_state` through
  `/api/work-os/me/guides`), so it never auto-opens again on any device. A
  visit that is skipped because another
  overlay owns the screen, because onboarding is incomplete, or because flags
  could not be loaded is not marked seen and is re-evaluated on the next visit.
- **Any time** — one icon-only `?` control in the masthead (accessible name
  `How <page> works`) reopens the guide for the page on screen. Reopening by
  hand does not consume an unseen guide; acknowledgement happens on dismissal.
- **The film** — the modal's illustration is film of the real companion: one clip
  per numbered step, shot by `scripts/shoot-guide-films.mjs`. The gates and the
  shape are the contract:
  - Clips are recorded against the offline fixture boot and never against a live
    account. Nothing is written, and no footage shows a state an employee cannot
    reach.
  - Every click in a clip is a real click on a real control, and what the
    interface did about it is what lands in the film. No state is staged and no
    behaviour is mocked.
  - One clip per page per step, encoded H.264 MP4 at 1000×500 with a still
    beside it. H.264 because every runtime this ships to plays it; MP4 rather
    than WebM because the packaged webviews are the constraint, not the browser.
  - The camera and the pointer are the shooter's, not the product's. Neither is
    a feature of the interface and neither appears outside a guide.
  - `src/guideFilms.ts` is generated from the encoded files, and a test asserts
    one clip per step, both files on disk, and each chapter label matching its
    step title. A guide whose steps changed without a re-shoot fails the build.
- **The modal** — `role="dialog"` with `aria-modal`, labelled by its title and
  described by its promise. Its header names the speaker once, with the
  configured companion mark for sighted readers and the configured name for
  assistive technology, so a guide reads as the same companion the employee met
  in setup. It plays straight through on open: step one's clip runs and its end
  hands over to step two. The numbered steps are the film's chapters — choosing
  one jumps the film there and it carries on from there. It has at most three
  numbered steps as an ordered list, each showing its clip's length, and one
  primary `Got it`. There is no seek and no transport control beyond choosing a
  chapter, so no clip depends on range requests. While automatic guides are on
  it also offers one quiet `Don't show these automatically`; once off, the footer
  states that automatic guides are off and points at the `?` instead.
  - Hovering a step does not start it. Hover is how you read a list, not how you
    ask to watch six seconds of film.
  - The film is `aria-hidden`: the step copy states everything the clip shows, in
    words, and that is the accessible path. No meaning is film-only.
- **The tour** — `GuideTour` plays all five films as one pass, started either by
  the first guide a new workspace shows (`Show me the whole workspace`) or by
  `Replay the full tour` in Settings. Choosing a page in its rail navigates the
  real application to that page, so the walk is through the product rather than a
  carousel laid over it, and closing it leaves the employee on the last page it
  showed. It never changes page on its own; within a page its chapters advance as
  the page guide's do.
- **Dismissal** — Escape, backdrop press, and the close control dismiss it; the
  body is the only scroll region; focus lands inside on open and returns to the
  `?` after. Below 560px the modal takes the viewport inset, and on the tour the
  progress track is dropped before any page name is truncated.
- **Reduced motion** — nothing plays. The still frame stands in for the clip,
  every chapter stays selectable, and one control plays a chapter on request.
  Labels, order, and copy are unchanged.
- **Opt-out** — Settings → Page guides switches automatic guides; the modal's
  quiet action writes the same account flag. The `?` keeps working either way,
  and the tour stays available from Settings whatever the flag says.
- **Administration** — the seven administration sections carry the same guide
  contract with their own keys (`admin_overview` … `admin_settings`): one
  first-visit pass per section, the masthead `?` replays it, and the first
  administration guide offers the workspace tour, which walks the seven
  sections in order and moves the real workspace. Every administration page is
  filmed like the employee pages — shot through the admin-shell fixtures boot —
  so all twelve guides play film; the modal, flags, and opt-out are shared,
  never a second copy, and the administration Settings page carries the same
  Page guides group — the automatic-guides switch and `Replay the full tour`,
  which walks the administration workspace.

### 8.12 Review notifications, the notifications panel, and suggestion review

The masthead bell is the notifications panel: one detached surface (§8.3) that
lists what needs the employee right now, and the badge counts all of it —
memories awaiting review, one recap slot, overdue tasks, and outstanding EOD
days — in the amber recoverable-attention tone.

- **Rows** — agent-authored reminders wear the configured mascot mark, the
  same identity the chat window uses, never a generic tone glyph. The memory
  row reads `This is what Otto remembers about you so far` with its proposed
  fact count and opens the memory modal (§8.5) on its review tab; the recap row
  reads `Your recap is ready` with the interval label and opens the dock's
  Focus tab where the recap is confirmed or corrected. The outstanding EOD
  section keeps its day rows, observed-time meta, and status pills. An overdue
  row under `Needs attention` reads `N tasks are overdue` (`1 task is overdue`
  in the singular) with a danger-tinted alert tile, one line of unfinished-work
  meta, and a `Review` action that opens the Tasks workspace's Unfinished view
  with the current workday and filters restored, where the overdue section
  leads. The count covers exactly what that destination shows — work day-scoped
  to My day stays there and is what the check-in mention surfaces — so the row
  never counts work its action cannot show, and it disappears the moment the
  work is done.
- **Arrival** — a new memory candidate, a ready undecided recap, or a task that
  newly goes overdue announces itself exactly once per item: an in-app flyout
  carrying the mascot mark and one `Review` action, a standing panel row until
  it is resolved, and a system notification when the window is hidden. The
  floating companion keeps owning recap system delivery so one recap never
  fires two system toasts. An overdue announcement is keyed to the task and its
  due date, so moving a due date may announce again while the same overdue
  state never repeats. The seen registries are best-effort local memory: losing
  them may re-announce once, never lose a reminder, and the panel always
  reflects live data.
- **States** — loading reserves geometry with skeleton rows; an error keeps the
  last list and offers an inline retry; the empty state says the employee is
  caught up. Escape, outside press, and the close control dismiss the panel,
  focus lands on the first row (or the close control) on open and returns to
  the bell, and arrow keys move between rows.
- **Suggestions waiting for review** — a second settings band below What Otto
  remembers, with `Waiting` and `Need attention` counts and one `Review`
  action. It opens the decision modal: `Waiting for your decision` items offer
  `Approve` and `Reject`; `Couldn't be applied` items keep their failure reason
  and offer `Try again` and `Dismiss`; outdated items dismiss only because the
  task moved on. Approving or dismissing refreshes the task surfaces the change
  could touch. Recap-sourced next steps never appear here — they belong to the
  mascot chat moment (§9.1) or its compact bubble — and nothing is written back
  until an approval.

### 8.13 Keyboard and focus

Shortcut inventory:

| Shortcut | Action | Scope |
|---|---|---|
| `Ctrl + ,` (`Cmd + ,` on macOS) | Open Settings — the administration workspace's own Settings section while that workspace is on screen | Either companion window while it is focused; never system-wide |
| Hold `Ctrl + M` | Hold-to-talk | System-wide in the companion; in the browser while the page has focus (§8.8) |
| `Escape` | Dismiss the topmost menu, drawer, sheet, or modal and return focus to its trigger | Every detached surface (§8.3) |

Peer views (tabs, the memory modal's tabs, the debugger's tabs) share one
contract. The tablist is reachable through its selected tab. ←/→ move and
activate, Home and End jump to the ends, and each tab's accessible name includes
its count when it has one. Lists of rows use ↑/↓ and Home/End to move focus
between rows, and Enter expands. Radio groups use ←/→ with roving tabindex (§8.6).

Focus is visible on every interactive element. A focus outline must reach 3:1
against its surroundings; the current signal-lime outline does not (§3.1).
Dismissal never leaves focus on removed content.

### 8.14 First run: the welcome, the setup, and the hand-off

The employee has not met the product yet, so first run is the one surface where
the companion carries the experience instead of annotating it. Otto is on stage
from the first frame to the last, and the panel beside him stays in the quiet
product language: personality on the stage, discipline in the panel.

- **The connect screen.** The stage's first frame, before any session exists:
  one statement, Otto's line carrying the secure browser sign-in in his own
  voice, and one `Connect workspace` action with a short `About a minute.`
  note. The advanced server override stays a quiet disclosure in the bubble,
  beside the action it changes, and the screen carries no journey rail; the
  sign-in round-trip returns to the same world setup opens on.
- **The welcome.** A full-width stage holding one statement, Otto, and his
  spoken line, with one `Start setup` action and a short `Six short steps.`
  note. It appears only for a draft that has never been written
  (`draft.updatedAt` is null and the draft is on the first step). Any other
  entry — a resumed draft, a returning employee — lands directly on the step
  the draft holds, and no welcome is shown or replayed.
- **The step screen.** A split view. The stage carries the step's purpose as
  one eyebrow and one statement, then what Otto says; the panel carries exactly
  one heading, which is the concrete instruction, and the work itself. Neither
  column repeats the other: the reasoning lives in the spoken line, the
  instruction lives in the panel, and the truth-bearing copy (the consent
  sentence, the schedule precedence note, the attendance status) stays where it
  can be read in full.
- **The journey rail.** Six stops under the stage: completed, current (wider,
  in signal), and upcoming. It is absent from the welcome, since nothing has
  started. Its accessible name states the position and the step
  (`Setup progress: step N of M, <label>`), and one polite live region
  announces the same sentence once per step rather than reading the stage aloud.
- **What Otto says.** The spoken line is the only place the step's reasoning
  lives, and it is spoken in his voice, not explained in the interface's. The
  full sentence is exposed to assistive technology once, prefixed with the
  configured name; the resolving words are `aria-hidden`. Nothing in a line
  may overstate what the step does.
- **Poses.** Attending while the employee answers, working while the workspace
  is really being prepared, and celebrating at the completion. Each recipe
  names a genuine agent/workday pair through the shared state layer; the stage
  opts out of the application runtime because there is no workspace state for
  it to mirror yet.
- **The hand-off.** The completion states the truthful attendance status and
  offers one `Enter My Day`. Choosing it puts Otto in his working pose and
  shows the inline wait, and that state lasts exactly as long as the transition
  takes — never a fixed or invented delay.
- **Leaving.** Session controls sit in the same top-right corner on the welcome
  and on the step masthead, so `Sign out` is reachable from the first screen and
  never moves between them. A first run that cannot complete is never a dead
  end. Session controls appear once: the stage owns them, and the step panel's
  masthead carries only its label.
- **The controls.** The panel is the instrument to the stage's personality, so
  its craft is depth and state rather than decoration. One raised field tier
  (white, 12px radius, a top highlight, a hairline) and one inset tier for the
  values the workspace supplied, so a supplied fact never looks like an empty
  field waiting for input. Field labels are sentence case 11–12px: an uppercase
  tracked label is an eyebrow, not a label. Selection is a real control —
  archetype cards, specialty chips, and the weekday track carry `aria-pressed`
  and a selected treatment that reads without colour. Validation is inline: the
  unanswered control takes `aria-invalid` and a message beside it in a live
  region, and `Continue` moves focus to it; an answer that is a set rather than
  a field (the archetype cards, the weekday track) puts the message in the flow
  and takes focus itself. The save state names the state and never an internal
  revision number.
- **Narrow setup actions.** At 720px and below the stage and setup content may
  scroll as one page, but Back, save state, and Continue remain anchored to the
  viewport bottom before any scrolling. Reserve the bar's height and safe-area
  inset beneath the content so the last field remains reachable. The narrow
  panel skips its container-transform entrance (which would capture the fixed
  bar); step-content entrances remain, with the existing reduced-motion rule.

### 8.15 Profile signals and connected accounts

The companion's Profile settings modal keeps two authorities apart and never
blurs them.

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

### 8.16 EOD drafts before clock-out, and deleting a draft

An end-of-day report describes the day, not a closed session. Today's report
opens in the final ten minutes before the scheduled clock-out — and stays open
after it — even while the shift is still running, so the employee can finish and
submit the report without clocking out first.

- **The gate.** A shift is open while the mirrored session is still running or
  a fresh Worktivity observation says the employee is active or paused. One
  predicate (`shiftStillOpen`) decides this for the server, the web workspace,
  and the companion; a second (`eodDraftBlocked`) adds the ten-minute window.
  Today is blocked only before that window. An earlier day — whose shift already
  ended — stays draftable so a backlog is never stranded. The window is anchored
  to the day's scheduled end (`scheduled_ends_at` on the mirrored session, with
  the day's schedule as a fallback); a day with no scheduled clock-out has no
  early window and stays blocked until the shift closes.
- **The server refuses it too.** Creating a report, and asking the assistant
  for a fresh narrative, both answer `409` with the reason `shift_open` before
  the window. Refining a draft that already exists stays available: that day is
  already recorded.
- **The prompt.** Before the window, the surface names the ten-minute opening
  and offers clock-out for employees who are finishing early. The clock-out is
  inline text, underlined, and behaves like the action it names: in the
  companion it returns to the dashboard, where the Clock out button closes the
  shift; on the web it returns to Today, which names the Windows Companion as
  the surface that closes a shift. The prompt replaces the draft action rather
  than sitting beside it; once the window opens, the draft action replaces the
  prompt without a refresh.
- **Deleting a draft.** The EOD composer carries one destructive action
  beside its draft-building controls: `Delete draft`, in red, with a trash
  glyph. It is offered only for an unsubmitted draft, it asks for confirmation
  in the shared removal dialog, and it is refused by the server for a report
  that is already with a manager. A deletion is written to the audit log; the
  report's versions go with it.

### 8.17 Settings groups: one label column, one content column

Every group on the Settings page is a two-column pair: a narrow label column
holding the group's name, and a wide content column holding everything that
group offers. The group is one grid, and a group's content is **one** child of
it — never two. A group that offered a note and its choices as separate
children would have the second child pushed into the label column and the
third stranded in an empty one, which is how Otto's voice came to list four
voices in a 164px rail.

- **The content column** holds the group's own controls in reading order: the
  group's note first, then its choices. A group with several controls keeps
  them in one wrapper, so they travel together and the label column stays a
  label column. The employee and administration surfaces render the same
  groups from the one shared component, so the rule holds on both.
- **Choices that belong together** read as peers across the content column,
  not stacked into a narrow rail: the four voices sit side by side, each one
  surface carrying its sample control and its name, with the chosen voice
  marked by the current-state outline the rest of the product uses for a
  selected row and the other three left quiet.
- **The guide films follow the page, not a pixel.** A guide that films this
  page aims its camera at the group it names by that group's own heading, so
  a group that moves, or a group that arrives, cannot leave the film showing
  the wrong band or filming empty canvas.

### 8.17 The goal question and the suggested goal

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

## 9. Data truth, provenance, and state
The visual system must keep these evidence classes distinct:

- Work OS session state.
- Worktivity provider state and provider-confirmed attendance actions.
- Inferred Worktivity boundaries, explicitly labeled with their observation
  time and inference provenance.
- Employee-authored progress or claims.
- Explicit employee-attached completion evidence: an upload and note, labeled
  as such and never provider-confirmed.
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
| More available | a load control on the open edge, `Showing N of M`, and contiguous pages (§9.2) |

Dates, instants, timezone identifiers, durations, and range endpoints are
validated before formatting. Invalid values render —, Unavailable, or specific
fallback copy; they never throw.

**Date display.** Dates render in letter months, never as raw ISO timestamps
or numerals-only strings. Full dates read "Oct 16, 2026"
(`formatWorkOsFullDate`) in headers, table cells, records, and schedule lines;
dense rows may keep the contextual "October 16" (`formatWorkOsDate`) or
compact `shortDate` form. Relative forms ("2h ago") stay relative where the
interface reads a freshness interval. Recorded date columns can arrive
serialized as instants at UTC midnight; they keep their recorded calendar day
and never shift with the viewer's timezone, and timezone-aware times use
`formatWorkOsDateTime`. Native `<input type="date">` controls keep the
operating system's display format, so when a range filter matters the surface
states the applied range in letter-month form beside the control instead of
restyling the picker.

### 9.1 Activity Interval Reviews

A progress prompt may arrive as an Activity Interval Review: a grounded recap
of the interval since the last update, built from the existing secure
Worktivity screenshot pipeline. The interval is the server-resolved prompt slot
(session + due time), never a clock hour, so pauses, manual updates, and cadence
drift cannot split or repeat the same window.

The recap is descriptive and evidence-bounded. It may describe visible apps,
tools, artifacts, and an apparent work sequence, and it must keep what the
evidence does not establish available without crowding the summary. It may not
claim productivity, effort, pay eligibility, completion, deployment, or
quality; the synthesizer always receives the ordered per-frame observations and
only a bounded representative subset of raw frames.

Read the recap, don't wade through it. It presents as one short lead sentence,
then short activity bullets (one observable activity each, with its clock time
when known, set as a quiet time pill), an ordered `Flow` track of phase chips
only when the evidence supports a sequence, and a bottom row of two buttons:
`Extra notes` (holding at most three short, interval-specific gaps the employee
could clarify) and an evidence button whose label is its screenshot and GitHub
event counts as icon metrics — never the word "Evidence". Nothing is expanded
by default, so the row reads as buttons rather than an accordion; toggling a
button animates its panel open beneath the row, only one panel is open at a
time, and the evidence button's hover label reads the same counts in words.
Analysis coverage (frames analyzed of frames recorded) is a quiet line inside
the evidence panel, never in the summary, and the recap never restates generic
caveats such as screenshots not establishing completion. A dense multi-sentence
paragraph is a contract violation, never a rendering fallback for new
intervals.

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
stay inside the recap's evidence panel: its button shows the screenshot and
GitHub counts as icon metrics, and opening it reveals separate `Screenshots`
and `GitHub activity` sections; each GitHub item retains its `You` / `Your
work` tag and artifact link. The model's structured `recorded_activity` output
is kept only when it matches the recorded list, so it cannot fabricate an item.
A GitHub read failure degrades silently to a Worktivity-only recap, and
coverage records whether GitHub context was used.

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
for the same task and operation. The companion's EOD Review page renders only
the end-of-day flow: suggestions are never collected into a review queue
there, and no dashboard metric, sidebar badge, or stage count advertises one. The moment is part of the shared workday
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
detail, and the same bottom row of two buttons — `Extra notes`, which holds the
inferred provenance line and any gaps, and the evidence button, whose label is
its screenshot and GitHub counts as icon metrics. Opening the evidence panel
reveals separate `Screenshots` and `GitHub activity` sections: screenshots show
the exact analyzed frames with capture time and neutral frame summary, while
GitHub shows provider-recorded events with their relation tags and links. The
floating stream's header carries a dark `View in app` action on the right that
opens the dock's Focus tab in the main window, where the same stream sits
beneath the daily goal. Expired images say
so honestly without deleting the recap; there are no charts, scores, or hours
totals.

The Tasks tab leads with the day's open work, then the stream. The `Open tasks`
card sits at the very top — the overdue/pending list is the first thing the
employee sees, not something below a month of recaps — and it collapses whole
from its far-right disclosure: collapsed it keeps a one-line account of the
open work (`N pending · M overdue`, or the current selection), and the choice
is remembered on the device (best-effort local storage, default expanded).

The stream itself pages on demand rather than loading the range up front. One
request returns at most twelve recaps (the cards are tall; a page is a
screenful or two), and the open edge carries one explicit `Load more` control
with a `Showing N of M` line while more history exists; appended pages stay
mounted and the count chip states the complete range. This follows the Tasks
list's deliberate exception to the streaming-list contract (§9.2 / §6.4):
paging is never automatic, so opening the tab, approving a recap, or appending
a page never yanks the reader's position.

The chat bubble for a due recap is a short conversational card: the interval
label (the window itself already says it covers the last hour, so no lead-in
line repeats it), the headline and the evidence-bounded detail (tall enough to
carry the brief summary of the observed window). It asks `Sounds good?` with
two round icon actions: the check confirms the recap in place (accessible name
`Looks good`, with the ask line reading `Saving…` while the decision files),
and the pencil (`Edit`) hands editing to the composer, which switches to
recap-edit mode (an `Editing your recap` strip with `Cancel` and an
`Update recap` send label) so the employee writes the correction themselves.
The inferred provenance line — `Inferred from your screenshots — add or correct
anything missing.` — lives inside the `Extra notes` panel, never on the card
face. Sending that note records it as the employee amendment.
Neither action mutates anything other than the recap, and the Tasks-tab stream
keeps its inline review as the same round check (`Looks right`) and pencil
(`Add or correct`) actions.

**Next steps after approval.** Confirming a recap hands the same compact bubble
to the suggestions the confirmation generated; the panel never opens on its
own. While generation runs the bubble says `Working out what could come next`,
carries the reason (`Otto is reading your recap for anything worth doing.`), and
Otto keeps his working pose. The ready bubble leads with `Next steps` and the
source line (`From your … recap`), then one decision row per suggestion: its
kind (`Mark done`, `New task`, `Subtask`), the title, the evidence-bounded
reason, and that item's own accept, edit, and skip controls. Nothing is applied
in bulk and nothing is applied by opening the bubble; each control decides only
its row, and a failed row keeps its reason and a retry. Titles that can be
edited are edited in the bubble.

The compact window grows upward with the list, keeping Otto and the elapsed pill
in place; three rows fit, and a longer list scrolls inside the bubble rather
than moving the companion off screen. The scrolling edge is frosted — a soft
blur plus the bubble's own tint fading out — and appears only where more
content continues; the read prompter uses the same frost, and its top edge
waits until the track has travelled so the first spoken line is never under it.
The bubble eases in over a quarter-second, and reduced motion removes the
entrance, the frost transitions, and the slide. `Listen` reads the lead and each row's
title and reason with the same voice and one-audio-owner rule as the recap, and
the row being spoken is marked in place — the controls stay available while it
reads. The empty state says nothing needs action; a failed generation keeps its
reason and `Try again`. After the last row is settled the bubble shows the
result (`N changes applied · N skipped`), then Otto returns to the orb and the
success beat plays. A row that failed suppresses the success and stays
retryable. `Not now` hides the bubble but keeps the moment in the chat; the
chat card remains the durable record, and the bubble is only its front door.

The collapsed companion's prompt bubble carries the day's current demand
(check-in, agenda, or EOD). Tapping the copy opens the chat; when the demand
has an obvious destination, a full-width action at the bottom of the bubble
goes straight there instead of making the employee type first: the EOD prompt
offers `Open EOD review` (the main window's EOD review page) and the agenda
prompt offers `Set today's goal` (the SOD `Plan your day` modal). Check-in
prompts keep the tap-to-expand behavior alone. The action never replaces the
tap target — both are one click away.

The EOD alert opens ten minutes before the scheduled shift end and outranks a
ready recap in the compact bubble: the mandatory wrap-up never hides behind an
undecided recap, which stays reachable in the chat and the notifications
panel. It stays live through clock-out — the mascot keeps its wrap-up state
instead of resting — until the report is submitted or one hour past the
scheduled end, when the mascot rests again and the day stays in the outstanding
EOD list. While the session is still open the alert never takes the composer:
the employee can keep sending updates and editing a recap through the lead
window, and clock-out hands the composer's moment to the EOD page; the final
ten-minute window opens the EOD draft without taking that composer away. A day
without a scheduled end follows the server's EOD signal alone.

The EOD uses a confirmed, amended, or inferred recap as activity context for
the hours it covers, labeled with its provenance, and falls back to the hourly
rollups elsewhere. A confirmed recap is still activity context: it never proves
task completion. Recap text outlives raw images under the report-retention
policy, and raw preview access keeps its existing own-frame or flagged/dispute
rule and audit.

### 9.2 Paged and streaming lists

A list that can grow in either direction loads contiguous pages on demand.

- Pages are 50 rows. A list keeps at most 100 rows mounted. Overflow is dropped
  from the edge away from the viewport, and that edge gets a load control.
- Loading is driven by a sentinel near the viewport, with a visible button as the
  fallback. Every page is contiguous with the rows already loaded, so the list
  never shows a gap.
- Arrivals at the top of a list that is already at the top appear in place. When
  the viewer is scrolled away, arrivals never move the view. One polite status
  line and one jump control report the count instead.
- Changing a filter or sort discards pages already in flight, so stale rows
  cannot land in the new result.
- The count states what is rendered. Use `Showing N of M` whenever more history
  exists.
- Counts are announced through one polite status region, never row by row.
- The Tasks list (§6.4) and the chat surfaces' recap streams (§9.1) are the
  deliberate exceptions: they page at their own sizes (50 tasks, 12 recaps)
  behind one explicit load control and never a sentinel, so appending a page
  can never move the reader's position.

### 9.3 The local vault gate

The companion keeps this device's session, queued updates, and cached workday in
an encrypted local vault, and the vault's key lives in the OS credential store.
That read can wait on a system dialog — on macOS an in-place update changes the
app's ad-hoc signature, so the saved Keychain item no longer matches the new
build — so the gate that holds every screen until the vault opens always settles:

| Gate state | Surface |
|---|---|
| Opening | Loading screen: the companion in his working pose, heading, the real stage line, the bench pulse, no recovery controls |
| Opened | The workspace, or whatever screen the workspace itself requires next |
| Failed | Failure screen: the bounded reason as its explanation, `Retry`, and `Start fresh on this device` for an unreadable stored key, a confirmed `BadFileKey` decryption failure, or a host-reported lost open |

The opening screen is one persistent overlay across the vault and day-read
phases — only the stage line changes between them. It exits through the
Morning Rise choreography (§10) once the next surface holds real content,
never on a timer.

The gate never offers an action it cannot honor. An offline bypass appears only
on surfaces that can actually run offline; `Start fresh` arms on the first click
and runs on the second, because it discards this device's local data, and its
hint names what is replaced and what stays. A retry retires the previous attempt,
so an answer that arrives late — a system dialog the employee finally allowed —
can never jump past the screen in front of them. A failed gate is a boot phase of
its own (`boot:vault_failed`), so a launch that stopped before the workspace is
never reported as a crash, and the packaged-Mac startup gate asserts the app
reaches a phase past its loading screen.

A `BadFileKey` verdict means the available key did not decrypt the local copy,
not that the cause of the mismatch is known or that a Keychain dialog is still
pending. Its explanation names sign-out and loss of unsent queued updates;
unknown, timed-out, and transient startup errors never gain this reset option
from their generic messages. No error classification itself replaces data.

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

First run adds exactly one entrance per step and nothing else: the step
statement and the spoken bubble each arrive over at most 260ms with a 6px
translation, and the spoken line resolves word by word at 26ms per word, capped
at 48 words, then stops. The reveal is CSS with no timer, so it cannot outlive
its line, replay on its own, or compete with anything else animating. Reduced
motion renders every one of those states flat. A step change moves in the
direction the employee moved (forward or back) so the panel's arrival explains
what changed.

The companion's boot overlay (First Light) carries the launch wait: the bench
pulse crossing every 3.4s with a ~600ms rest, and the glow breathing at low
amplitude — the surface's two purposeful loops, the loading-wait exception to
the no-ambient-loops rule. When the next surface holds real content, the
handoff plays once: the pulse lands within 300ms (skipped under reduced
motion), then the night lifts 8px and fades over 640ms with the product
easing while the workspace rises 8px and fades in; reduced motion gets a
single 150ms opacity fade. The exit starts only when the data is really
ready — never a fixed delay.

Respect prefers-reduced-motion. Remove transforms, shimmer, and nonessential
animation while preserving state, labels, and final geometry.

The guide film answers to the same rule, which for video means not playing it at
all: under reduced motion the still frame stands in, every chapter stays
selectable, and one control plays a chapter on request. Film never autoplays on
its own outside a guide the employee opened, and no clip ever loops.

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
- Touch targets are at least 40px. Compact desktop-only controls may be 34–36px
  when the surface is keyboard accessible and has visible focus; this exception
  does not apply to touch surfaces.
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
- a restrained full figure in a ready hero;
- a full figure on the first-run stage — the connect screen, the welcome, and
  the setup steps — and on the pre-app loading screen and its failure state,
  where he is honestly working at his bench of light or recovering; the
  launch loader is his bench, never a generic widget;
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

The one place raster art is required is the page-guide film (§8.11), and it is
allowed there for the opposite of decorative reasons: it is footage of this
product's own interface rather than an illustration of it, so a guide can show
where a control is instead of describing it. It is generated, never drawn, and it
is bound by the version test in §14.1 — a film that no longer matches the
interface it depicts fails the build rather than quietly going stale.

The compact companion's drag handle is a visible, subtle dark capsule centered
above the mascot with a generous grab area. The ordinary handle is 72×30px and
the due-prompt handle is 78×30px, without covering the separate hide control.
The due-prompt mascot starts below the handle, including during its 6px attention
gesture.

A recap or due-prompt bubble floats in the strip above the figure. The mascot and
the elapsed-time pill keep their default positions whether or not a bubble is
showing: a bubble never pushes the figure down, so the pill can never land on
it. The bubble's copy clamps to the space above the head — headline and
supporting line stay legible, the action stays reachable — so a tall bubble may
temporarily cover the drag handle and progress marker until it is resolved.

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

### 14.1 Performance budgets

Each surface states its budgets, and visual QA checks them.

- Bounded history: the developer trace holds 1,000 events in the host and at most
  100 rows in the DOM.
- Page size: one request returns at most 100 rows.
- A closed debugger window holds no subscriptions and no rows. Selecting another
  tab releases the trace rows and its event listener.
- Diagnostic change notices target only the debugger window, never the main or
  avatar windows. Bursts coalesce to the latest sequence at most every 250ms; the
  trace pulls the rows it shows instead of receiving whole events.
- Polling cadence follows §8.7. No surface polls faster than its contract states.
- Guide film: 1,000×500 H.264 at 30fps, and the whole twelve-page set stays
  under 8 MB. Each clip is encoded for its own length only — nothing loops,
  nothing auto-repeats — and the generated manifest records the exact encoded
  length, so the module can never claim a duration the file does not have.
- Guide film is loaded per chapter on demand, not all at once. Opening a guide
  fetches one clip and one still, and a chapter that is never chosen is never
  downloaded.
- The film list is checked against the interface it depicts: one clip per step,
  every clip and still present on disk, and every chapter label equal to its
  step's title. A step that changed without a re-shoot fails that check.

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
themes where a dark variant exists (§3.1), and under reduced motion.

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
`Switch to my workspace` on the masthead (the employee home is
`/work-os/today`). Legacy `?surface=admin&tab=…` links redirect to the closest
new destination instead of rendering a dead tab.

The workspace owns its navigation: a horizontal section nav in the masthead,
not a second sidebar. The host shell keeps its chrome, and the Work OS surface
paints its own `.work-os-surface` token scope (the §3.1 palette in light and
dark) so the workspace reads as one material even inside a host application.

**Notifications.** The masthead carries the same notifications bell and panel
as the employee workspace (§8.12), reading the signed-in administrator's own
notifications: the memory row opens the memory modal in place, while recap and
outstanding EOD rows switch to the employee view first and then open the exact
surface they name. While the panel is open it owns the layer above the receipt
stack, whose cards keep their position underneath. Administration also uses
the shared in-app flyouts: every confirmed write leaves one transient receipt
naming the persisted outcome, failures keep the page's own inline notice and
offer retry there, and the fired-and-forgotten Nifty sync is the one write that
also raises a failure flyout. Nothing fires for a queued or uncertain write.
Two standing conditions hold persistent cards under stable keys: an overview
snapshot older than ten minutes, and a workspace status reporting a missing
migration or an unusable Nifty connection. The flyout stack keeps the shared
viewport position here: a receipt lands in the window's top-right corner with
the same insets as the employee view, at every width.

**Page refresh.** The masthead carries the employee workspace's page refresh
control in the same place, between the notifications bell and the profile
avatar: one icon button that refreshes the data backing the open section, never
a blanket app refresh. It revalidates only that section's reads — the overview
snapshot, the roster, the task record, reports and their evidence, insights, or
the evidence and provider reads — including the shared reads a page actually
uses and the detail records of its open drawers. Because the control tracks the
live query cache, the same state serves every refresh source: the Overview
poll, an invalidation after a confirmed write, focus revalidation, and the
button's own click all spin it and disable it while the section's reads are in
flight. Settings is the one exemption — its decision areas edit the records
they show — so it renders no page refresh.

### 16.2 Page contracts

Every section keeps one header rhythm: the card's name and its one-line detail
own the first row, and the card's filters and toolbar controls sit in grouped
rows beneath it (`.admin-controls`, design.md §8.2). The task record is the
exception: its primary Add task action trails the name and detail on the title
row, while segmented views, search, and selects share one compact controls row
beneath it and wrap deliberately at narrow widths. Overview stays quiet meta
only; Settings keeps each field group inside its own card instead of the
header.

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
- **Tasks** is the organization task record with the primary Add task action in
  the card title row, bounded filters on one compact controls row beneath it,
  and the local add-task flow: one flat list, never grouped or ordered by
  project, which stays a small per-task detail beside the task's priority and
  labels. Each row shows the task's description on its own line
  beneath the title — clipped with the shared fade and never a pan — and the
  assignee cell resolves the recorded assignee ids through the roster, so a task
  with a real assignee is never displayed as Unassigned.
  Each row carries the same trailing ellipsis action menu as the companion task
  lists (§6.2): its status actions, Edit task, Assign, Archive (reversible), and
  Delete permanently, each present only when the task's capability payload
  allows it. The task drawer carries the status control, the assignee control,
  and the lifecycle buttons — Mark complete or Reopen task, Edit task, Archive
  task, Delete task — under the same gate, and archiving or deleting waits for
  an explicit confirmation.
  **Settings** leads with the account's own settings — the same groups the
  employee Settings page carries (profile, this device, page guides, reading
  & display, workday, sync & session, memory, suggestions, diagnostics, and
  reset), rendered by the one shared component so the two surfaces can never
  drift — then groups the workspace's system status, features, memberships,
  teams, provider connections, field mappings, and blueprints into sections
  with one action per decision area. The record-dependent groups appear only
  for accounts with a personal workday; the device, display, guides, and
  diagnostics half always shows.

**Recap follows.** The account's own settings include one shared two-column
Recap follows group even when no personal workday is mapped. All active
employees is the default and includes later hires; Selected saves exactly the
ticked ids, and an explicitly empty selection means no recap alerts and never
falls back to All. Saved inactive choices remain visible, named, checked, and
disabled because delivery excludes them; the active count, not the retained id
count, drives the no-alerts summary. The group saves only on Save with the
loaded revision, keeps a failed draft and a revision conflict visible until an
explicit successful reload, and disables choice controls while a save is in
flight. A successful save re-reads the authoritative settings, invalidates the
scoped inbox reads, and wakes the existing delivery/inbox feed in both windows
through an ids-and-context-only signal; it never shares a settings object or
narrows named on-demand queries. Following changes recap alerts, never record
access.

**EOD Review order and range.** The review queue reads newest submission
first: a report's submission time is its clock, a row that was never submitted
falls back to its report date so a draft keeps its day's place rather than
jumping the queue, rows missing both keys stay last, and ties break by report
date then id. There are no click-to-sort headers here — newest first is the
queue's one deliberate order. The date range is one compact control: an
icon-only filter-cone button on the queue's controls row, beside the status
views and ahead of the person filter, that expands a small popup holding the
native From/To pickers and a Done action. The popup opens anchored under the
button, closes on Escape, an outside press, or Done, returns focus to the
button, and is clamped to the viewport. The button names the applied range to
assistive technology and keeps a quiet applied state — a small accent dot —
while a range other than the 30-day default is applied; because the range
text lives in the popup's inputs, the card's detail line carries the counts
only.

**Task dates.** Every task row shows when the task was created — the provider's
own creation stamp when recorded, then the local record's — in the same
letter-month form as its due date and immediately ahead of it, so the two dates
read together. A task with no recorded due date reads against the default it
implies: one day after it was created. The derived value is the row's effective
due date everywhere the row is read — the Due cell, the overdue warning and the
Overdue/Pending/Done pill, the Due column's sorting, and the status lock —
exactly as a recorded date would, and it renders plainly with no "default"
marker. Only a task whose created date is also missing shows a dash and claims
no overdue state, so a task past its derived date does read Overdue.

The effective due date drives both the Overdue pill and the status lock in this
record: an open task past its effective date cannot change workflow status
until the date is today or later, even when no due date was ever recorded. The
workday that rule compares against is the acting administrator's shift-local
date; only an administrator with no person mapping falls back to UTC. The
edit form still seeds and writes the recorded date, so saving it never turns
the derived default into a recorded one; a task with no recorded date opens
the editor empty, and the date the operator types becomes the real due date.

**Cached state.** Administration reads through the shared in-memory TanStack
Query cache, not a fetch per visit: list and summary reads revalidate after 45
seconds, record/detail reads after 60 seconds, and the two live queues (Tasks
and EOD Review) plus the Overview snapshot keep a deliberate shorter 30-second
TTL. Moving between sections inside that window paints the cached record
immediately; returning to a stale section keeps the cached record on screen
while it revalidates in the background, so a refresh never replaces content
with a loading skeleton. Administration reads are deliberately excluded from
the on-disk query cache: they are the workspace's shared record, not this
device's employee session, so a snapshot saved on one device can never
masquerade as the organization's live state. Stale reads still revalidate on
window focus and reconnect, the Overview snapshot is the one deliberate poll
(60 seconds, paused while the window is hidden), and the masthead refresh
control is the explicit force-fresh path for the current section.

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

### 16.3 Data and provenance

Administration endpoints are admin- or manager-scoped and organization-scoped
on every query, with bounded limits and no raw storage paths. Observed activity
keeps its cool observation treatment and its labels; employee-authored updates,
task records, provider evidence, and review state remain visually distinct.
The Overview and Insights day charts stack observed work time by teammate:
each segment is one employee's observed minutes for that day, sized by time
worked and named in the hover tooltip and legend, and activity context is never
completion. Empty, loading, and degraded states follow §9's state matrix:
skeletons reserve geometry, empty states name the next action, and errors stay
local.

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
- Review screenshots, not only DOM assertions.
- Follow the verification and review steps in `AGENTS.md`.
- Report branch/commit, rendered states, interaction checks, and anything not
  deployed.

This blueprint is the default for new Work OS work. A deviation is allowed
only when it solves a real product or accessibility need and is documented in
the implementation and the next blueprint revision.
