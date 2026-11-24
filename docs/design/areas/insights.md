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

**Insights** is the Control room: one instrument, not a card wall. A range and
person toolbar scopes the payload server-side; the masthead keeps the page
title. The instrument leads with the selected range and four range facts
(outcomes, commitments landed, people with recorded work, EOD submitted), then
the people × days/weeks matrix.

- **Matrix measures.** Session time (default), outcomes, updates, and evidence.
  A cell is the selected measure for one teammate in one day (7d) or one
  Monday-based week (30/90d). Session time is clock-in to clock-out minus
  pauses; it is not app/site tracking and never a productivity score. Outcomes
  are completed task outcomes, updates are recorded check-ins, and evidence
  counts output + activity evidence rows.
- **Exact facts.** The row header keeps the teammate's range outcomes and
  commitment rate; the right total is the selected measure's total over the
  displayed buckets. Hovering or focusing a cell always shows the full record
  for that bucket — session time, outcomes, updates, EOD reports, and evidence —
  regardless of the active measure. The tooltip sits beside the cell, stays
  inside the viewport, and follows the material. Keyboard focus gets the same
  readout through the cell's accessible name.
- **Range fidelity.** 7d renders the range's workdays; 30/90d group the same
  workdays into Monday-based weeks. The matrix never shows a fixed 14-day slice
  unrelated to the selected range. Person/team scoping follows the server
  filter; the person drawer carries the day-level record, commitment, and the
  session/app-site/evidence distinction.
- **Supporting record.** The attention rail, update mix, observed session-time
  chart, plan reliability, person record (including app/site tracked minutes),
  and app/site context share the instrument. Green is progress and state only;
  session time and activity context stay cool observation ink. Evidence counts
  rows, not minutes, and tracked context is app/site minutes, distinct from
  session time.
- **States.** Loading reserves the instrument's geometry; empty ranges name the
  missing record and the next action; errors stay local. Empty, loading, and
  degraded states follow the data-truth matrix.

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
