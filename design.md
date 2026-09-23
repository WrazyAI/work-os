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
or selected records.

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

### 7.3 Floating Otter chat

The floating companion uses the same white window border/header treatment and
the same composer anatomy. The window remains inside the viewport, grows the
composer with the draft, and uses detached menus that cannot be clipped by a
scroll region. Minimize-to-orb and hide-window remain distinct and truthfully
named.

Both chat surfaces use the configured mascot head crop through
src/chat/MascotMark.tsx. Never hardcode mascot art, the mascot name, or a
generic sparkle as agent identity. Global mascot changes belong in mascot.ts.

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
page and shifting the user's scroll position.

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

The floating companion starts a bounded three-play attention sequence when an
actionable prompt needs input: five seconds of movement, one second still, then
repeat twice. A snoozed prompt replays the same sequence when it returns. The
mascot then stays still in its alert pose until the employee responds. Never
loop continuously, and remove attention motion under reduced-motion preferences.

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
pose rather than checking for one prompt kind. Play one five-second attention
gesture, rest for one second, and repeat twice; then return to the still alert
pose until the employee responds. Never loop continuously, and remove all
attention motion under reduced-motion preferences.

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

The selected-row review specifically asks:

- Is the row selected without a colored rail?
- Does its geometry remain stable?
- Can a keyboard user see focus?
- Does the same state look intentional at dense and narrow widths?
- Does it remain visually subordinate to the task title and action?

Record what was actually rendered and exercised. A build or static assertion is
not visual acceptance.

## 16. Implementation checklist

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
