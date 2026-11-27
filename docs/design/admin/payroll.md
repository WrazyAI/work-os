# Payroll

**Requires:** [Administration shell](shell.md), [controls](../patterns/controls.md), and [data and state](../patterns/data-and-state.md).

Payroll is an admin-only workspace at `/work-os/admin/payroll` on the web and in
the installed Companion's administration mode. The two surfaces share the same
Work OS records and API; the Companion renders them natively with its own rail,
material tokens, and controls.

- **Records** opens by default. It shows the selected pay period’s review records, with recommended and approved hours separated. Approved records link to their frozen print receipt.
- **Audits** shows the analysis status for each record. **New audit** selects an eligible mapped employee and a pay date, then opens the queued audit. Starting an audit is not approval.
- An audit opens with payable hours and a per-day chart, Worktivity app distribution, and flags. **Excluded by rule** lists every interval removed from pay with its rule, date, time, minutes and evidence: continuous inactivity of 3 minutes or more, unpaid breaks, and outside-window time. Empty rules stay compact with a **None** count instead of repeating empty messages. Inactivity frames are viewable through the guarded evidence route. A structural problem requires source correction and re-analysis; it is not dismissible. Approved receipts stay immutable and reopening requires a reason.
- **Weekly briefs** are structured memos, not raw paragraphs: each week shows its date range, grounding state, summary, observed work, open items, limits and per-claim sources. A brief without cited sources says so; a failed or stale brief names that state instead of presenting an unsupported summary.
- Worktivity is an evidence source, not a separate user-facing destination. Legacy activity links go to **Insights**; legacy audit links go to **Payroll → Audits**. Old reports are not imported as payroll decisions. Do not expose raw activity URLs or bypass the guarded screenshot route.
- The Companion exposes Payroll only to administrators in administration mode. It adds no employee destination, secondary navigation, or payroll cache outside the administration query scope. It keeps the same revision token, reasons, and approval confirmation as the web.
