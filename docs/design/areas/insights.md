# Insights and analytical charts

**Use when:** Changing employee Insights or administration analytical charts.

**Owns:** Question-led chart composition, exact-value fallbacks, and surface-specific information hierarchy.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing displayed metrics, freshness, or async states: [Data truth, async states, and pagination](../patterns/data-and-state.md).
- Changing series colors or theme support: [Color, type, and surface tokens](../tokens.md).
- Working on the administration surface: [Administration shell and shared contracts](../admin/shell.md).

**Implementation starting points:** [InsightsView.tsx](../../../desktop/work-os-companion/src/InsightsView.tsx), [InsightCharts.tsx](../../../desktop/work-os-companion/src/InsightCharts.tsx), [EmployeeInsights.tsx](../../../src/modules/work-os/employee/EmployeeInsights.tsx), [InsightsPage.tsx](../../../desktop/work-os-companion/src/admin/InsightsPage.tsx).

## Employee Insights

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
  ([data truth and states](../patterns/data-and-state.md)). Charts keep their accessible exact-value fallbacks and reduced-motion
  behavior; observed activity keeps its cool treatment and never becomes a
  score.

At viewport widths under ~1120px the bands collapse to one column and the KPI
strip wraps to three then two tiles; nothing gains horizontal scroll.

## Administration Insights

**Insights** uses fixed ranges with deterministic facts first: a written
brief, one facts record whose four leading numbers sit in a bounded band and
whose three supporting facts sit on a quiet line beneath it, one labeled
daily-record chart with a legend, observed-app context, backlog pressure, and
a per-person facts table with a detail drawer. It never converts activity into
a productivity score. Chart series read as one record: ink for outcomes,
muted ink for updates, cool observation for submissions; green is state only.

## Administration chart provenance and states

The Overview and Insights day charts stack observed work time by teammate:
each segment is one employee's observed minutes for that day, sized by time
worked and named in the hover tooltip and legend, and activity context is never
completion. Every chart leaves room for its axis: the left margin is zero and
the Y-axis reserves its label width, so a tick never clips. A chart that carries
more than one series carries a legend in the same ink vocabulary as the bars.
Empty, loading, and degraded states follow [data truth and states](../patterns/data-and-state.md)'s state matrix:
skeletons reserve geometry, empty states name the next action, and errors stay
local.
