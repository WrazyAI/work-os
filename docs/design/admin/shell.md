# Administration shell and shared contracts

**Use when:** Any administration UI change; read once with the affected admin page guide.

**Owns:** Admin routing, label/content composition, header rhythm, refresh, cache, and authorization scope.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing admin bell or receipts: [Notifications and review reminders](../areas/notifications.md).
- Changing admin charts: [Insights and analytical charts](../areas/insights.md).
- Changing the employee/admin view switch: [Web employee workspace](../areas/web-workspace.md).

**Implementation starting points:** [AdminWorkspace.tsx](../../../desktop/work-os-companion/src/admin/AdminWorkspace.tsx), [ui.tsx](../../../desktop/work-os-companion/src/admin/ui.tsx), [layout.tsx](../../../src/app/work-os/admin/layout.tsx).

The web administration surface is a first-class Work OS workspace, not a
diagnostic form. It follows the same material system, typography, and
provenance language as the employee and manager surfaces, and it answers the
operator's questions in order: who is working, what needs a decision, what the
record shows, and what the next useful action is.

## Shell and navigation

The workspace lives at `/work-os/admin` with real routes: Overview, People,
Tasks, EOD Review, Payroll, Insights, Evidence, and Settings. The server route gates the
whole subtree to Work OS admins; employees and managers keep their own
surfaces, and a mapped administrator reaches their employee workspace through
`Switch to my workspace` on the masthead (the employee home is
`/work-os/today`). Legacy `?surface=admin&tab=…` links redirect to the closest
new destination instead of rendering a dead tab.

The host console's Work OS sidebar owns section navigation. The masthead does
not repeat it: it is one title, one purpose line, and one quiet meta line
(date, workspace, schema state) with the view switch and page refresh on the
right. The old `Work OS` eyebrow is gone, and the page leads. This is a
deliberate revision of the earlier horizontal-in-masthead nav: the sidebar
already lists those destinations, and a second nav only duplicated them.
The Work OS surface paints its own `.work-os-surface` token scope (the [color tokens](../tokens.md#color)
palette in light and dark) so the workspace reads as one material even inside a
host application.

**Surface and rhythm.** Administration is a ledger, not a dashboard of cards.
Every page is a quiet sequence of label/content groups: a 190px label column
and a wide content column, separated by a hairline rule, with the page title at
34px and no eyebrow. The label column is the workspace's index — the same
device the employee Settings page uses — so the reader scans section names down
the left edge instead of counting boxes. Cards survive only where the content
needs a paper ground: charts, bounded tables, and the KPI record. There is one
KPI record per page at most, a single bounded band with hairline separators,
never a wall of equal-weight tiles. Radius tops out at 16px on those grounds;
controls use 8–9px; there is no resting shadow. Signal green stays on state and
the one forward action. **Overview is the deliberate instrument exception:** one
board with internal hairlines carries the pulse, trend, live shape, observed
time, people, and decisions; it keeps the masthead quiet and never becomes a
card wall.

## Page refresh

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

## Page header rhythm

Every section keeps one header rhythm: the section's name and its one-line
detail own the first row, and its filters and toolbar controls sit in grouped
rows beneath it (`.admin-controls`, [inputs, search, and filters](../patterns/controls.md#inputs-search-and-filters)). The task record keeps
segmented views, search, selects, and the primary Add task on one compact
controls row that wraps deliberately at narrow widths. Overview stays quiet meta
only; Settings gives each field group its own gutter section instead of a
header. Insights is the deliberate exception to the card title row: its range
and person controls sit in one toolbar above the instrument, and the matrix
owns its measure strip; the masthead still owns the page title and purpose.

## Cached state

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

On a cold read, the companion uses the employee workspace's shared skeleton
and shimmer. Placeholders follow the incoming rows, metrics, or charts; row
groups offset the beam slightly so they don't all brighten at once. Reduced
motion keeps the same layout with a static fill.

## Data and authorization

Administration endpoints are admin- or manager-scoped and organization-scoped
on every query, with bounded limits and no raw storage paths. Observed activity
keeps its cool observation treatment and its labels; employee-authored updates,
task records, provider evidence, and review state remain visually distinct.
