# Administration overview

**Use when:** Changing the operator overview, decision queue, measures, or grouped activity.

**Owns:** The overview reading order and actionable measures.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing observed-time charts: [Insights and analytical charts](../areas/insights.md).
- Changing person destinations: [Administration people and person record](people.md).

**Implementation starting points:** [OverviewPage.tsx](../../../desktop/work-os-companion/src/admin/OverviewPage.tsx).

## Overview record

**Overview** reads in the operator's order as six gutter groups: **Now**
(only the people on shift, then a quiet line for everyone else), **Decisions**
(one ranked queue with the verb inline — Review, Open queue, Open tasks,
Inspect, Fix setup), **Today** (one four-fact record: completed outcomes,
recaps, evidence, and EOD submitted), **Record** (activity grouped by person,
with a count line and an expandable list of every record), **Time** (observed
minutes per day), and **Setup** (configuration gaps beside source freshness).
The stream never repeats a dozen near-identical rows: one person's CI runs and
pushes are one line with counts, and expanding it still shows each record.
Readiness is context, never the lead.

**Overview measures.** The companion's Overview opens with one strip of five
measures: On shift now, Recaps today, Outcomes today, Awaiting review, and
Evidence today. Each is a real control that opens the record it measures —
On shift now scrolls to the Right now table and moves focus there, Recaps
opens Admin Otto on its Recaps tab, Outcomes opens Tasks, Awaiting review
opens EOD Review, and Evidence opens Evidence — so a measure is never a tile
without a destination. Recaps today counts every finished interval recap
generated that day, reviewed or not; its detail separates the recaps the
employee confirmed or corrected from the ones still waiting, so a generated
recap is never mistaken for a reviewed one. The Right now table reports each
person's generated recap count and latest recap time, not their check-in
count, and every card keeps hover and focus-visible states without shifting
its geometry.
