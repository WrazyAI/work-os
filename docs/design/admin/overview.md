# Administration overview

**Use when:** Changing the operator signal board, workday pulse, trend, live
coverage, people, decisions, observed time, or source freshness.

**Owns:** The overview's reading order, chart contracts, and actionable
measures.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing observed-time charts: [Insights and analytical charts](../areas/insights.md).
- Changing person destinations: [Administration people and person record](people.md).

**Implementation starting points:** [OverviewPage.tsx](../../../desktop/work-os-companion/src/admin/OverviewPage.tsx), [OverviewSignal.tsx](../../../desktop/work-os-companion/src/admin/OverviewSignal.tsx), [AdminOverview.tsx](../../../src/modules/work-os/admin/AdminOverview.tsx), [AdminOverviewSignal.tsx](../../../src/modules/work-os/admin/AdminOverviewSignal.tsx).

## The signal board

**Overview** is one instrument, not a card wall. The masthead keeps the page
title; the board opens with **Last seven workdays against the seven before**, one
sentence naming the highest-consequence condition, and the snapshot time. The
reading order is Pulse, Daily shape, Right now, Observed time, People, Decisions,
and Sources.

**Pulse.** Four controls: **Outcomes**, **Updates**, **Recaps**, and
**Evidence**. Each is the seven-workday total, a fourteen-workday sparkline
whose midpoint rule separates the two weeks, the change against the prior seven
(never a drop against zero), and the per-day mean. Every control opens its
destination: Outcomes opens Tasks, Updates opens People, Recaps opens Admin Otto
recaps, and Evidence opens Evidence. The values are counts, never a score.

**Daily shape.** One trend with a four-way measure switch (Outcomes, Updates,
Recaps, Evidence). Bars are the workday values, and the prior and current
seven-day means are reference lines. The strip beneath states the best day, the
fourteen-day mean, days above the mean, and the prior seven-day total. Hover or
focus gives the full day regardless of the selected measure — outcomes,
updates, recaps, evidence, and observed minutes — with exact values in the
visually hidden table. Arrow keys walk the workdays; `Home` and `End` jump to
the edges.

**Right now.** The live coverage bar (on shift, paused, off shift, not observed),
the oldest waiting report in hours or days, and the day-close record: EOD
submitted, recaps reviewed, and disputed evidence. The icon action opens People.
Coverage is provider-confirmed attendance context, never a productivity signal.

**Observed time.** The stacked bar chart of session minutes per workday by
teammate: clock-in to clock-out minus pauses. It is the workspace's observed-time
chart, placed once here in the board. The total is the last seven workdays.
Observed time is distinct from app/site tracking and evidence row counts, and it
is never a score.

**Today, by person.** The six most active records with status, role, and today's
outcomes, updates, and evidence. Every row opens the person record. The section
action is **Open People**.

**Needs a decision.** The ranked attention queue with the verb inline (Review,
Open review, Open tasks, Inspect, Fix setup). Readiness blockers join the queue
here with their local checking/retry state; readiness is context, never the lead.
Every row opens the record that can resolve it.

**Sources and freshness.** A closed disclosure lists Tasks, Worktivity, GitHub,
Plans, and EOD freshness with the day's counts. The snapshot time stays in the
header; the disclosure carries the source detail without becoming a card.

**Web parity.** The web administration renders the same composition from the
same read model. Its pulse controls link to the web records, person rows
deep-link to the roster's person drawer, and the **Setup and sources**
disclosure carries readiness and freshness together so the web surface does not
lose the setup detail the desktop keeps behind its decision queue.

**States.** Loading reserves the board's geometry. Empty names the absence of a
record and never invents activity. The stale snapshot remains a standing
notification under a stable key. Errors stay local with a retry. Dark, narrow,
zoom, keyboard focus, exact-value fallbacks, and reduced motion follow the
shared contracts. The board is quiet meta only at the masthead: no filter row or
toolbar lives above the instrument.
