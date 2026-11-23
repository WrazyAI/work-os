# Payroll

**Requires:** [Administration shell](shell.md), [controls](../patterns/controls.md), and [data and state](../patterns/data-and-state.md).

Payroll is an admin-only workspace at `/work-os/admin/payroll`.

- **Records** opens by default. It shows the selected pay period’s review records, with recommended and approved hours separated. Approved records link to their frozen print receipt.
- **Audits** shows the analysis status for each record. **New audit** selects an eligible mapped employee and a pay date, then opens the queued audit. Starting an audit is not approval.
- An audit shows reconciliation, weekly work themes, open items, evidence gaps, citations, daily evidence, and explicit finding decisions. A structural problem requires source correction and re-analysis; it is not dismissible. Approved receipts stay immutable and reopening requires a reason.
- Worktivity is an evidence source, not a separate user-facing destination. Legacy activity links go to **Insights**; legacy audit links go to **Payroll → Audits**. Old reports are not imported as payroll decisions. Do not expose raw activity URLs or bypass the guarded screenshot route.
