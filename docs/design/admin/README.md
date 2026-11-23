# Administration design index

**Use when:** Working on the administration workspace or Admin Otto.

Read [shared foundations](../foundations.md) and the [administration shell](shell.md)
once, then choose the affected page below. This is a routing index, not a reading
list. Follow additional links only for the behavior being changed.

| Working on | Guide | Source starting point |
|---|---|---|
| Navigation, header rhythm, refresh, cache, authorization scope | [Shell and shared contracts](shell.md) | `admin/AdminWorkspace.tsx`, `admin/ui.tsx` |
| Overview measures, decision queue, grouped activity | [Overview](overview.md) | `admin/OverviewPage.tsx` |
| Roster, person drawer, schedule/arrangement review | [People](people.md) | `admin/PeoplePage.tsx` |
| Organization tasks, dates, overdue counts, sorting, actions | [Tasks](tasks.md) | `admin/TasksPage.tsx` |
| Reports, manager decisions, queue ordering, date filter | [EOD Review](eod-review.md) | `admin/ReviewPage.tsx` |
| Analytical charts and exact facts | [Insights](../areas/insights.md#administration-insights) | `admin/InsightsPage.tsx` |
| Payroll records, starting audits, and finding review (web only) | [Payroll](payroll.md) | `admin/payroll/PayrollOverview.tsx` in `src/modules/work-os/` |
| Provider evidence, restricted screenshots, account mapping | [Evidence](evidence.md) | `admin/EvidencePage.tsx` |
| Workspace configuration, personal settings, recap follows | [Settings](settings.md) | `admin/SettingsPage.tsx`, `AdminSettingsWorkspace.tsx` |
| Chat reads, task previews, confirmation, receipts | [Admin Otto](otto.md) | `adminOtto/AdminOttoChat.tsx` |

Source names above are relative to `desktop/work-os-companion/src/`. Web peers
live in `src/modules/work-os/admin/` and `src/app/work-os/admin/`; inspect the
affected adapter without copying either surface's implementation wholesale.

The employee task workspace has a different overdue predicate and grouping
contract. Keep the [admin task exception](tasks.md#task-dates-and-overdue-counts)
scoped to the organization record.

Return to the [main design index](../../../design.md) for cross-cutting patterns
or another product area.
