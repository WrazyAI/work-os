# Legacy design section lookup

**Use when:** An existing source comment, task, or plan refers to numbered
sections of the former root blueprint. This lookup is not part of normal
task reading.

The baseline is [design.md at 804bc8e3](https://github.com/WrazyAI/work-os/blob/804bc8e3b940713a443add29a8f1b2da39d97ec0/design.md).
The current guide set preserves its requirements under named topics. New links
should target the owning guide and a named heading, not reuse these numbers.

The old blueprint used **8.17 twice**. Resolve that reference by its title:
Settings groups and the goal question are different contracts. References such
as §19.9 or §25.10.2 predate this baseline; look up the referring change in Git
history instead of guessing a current number. Dated reports retain their
original citations and verification results.

## Section destinations

| Former section | Topic | Current owner or routing entry |
|---|---|---|
| 1 | Non-negotiable product character | [Shared design foundations](foundations.md) |
| 2 | Art direction | [Shared design foundations](foundations.md) |
| 2.1 | Material system | [Shared design foundations](foundations.md) |
| 2.2 | Premium composition | [Shared design foundations](foundations.md) |
| 2.3 | Explicitly rejected treatments | [Shared design foundations](foundations.md) |
| 3 | Canonical tokens | [Color, type, and surface tokens](tokens.md) |
| 3.1 | Color | [Color, type, and surface tokens](tokens.md) |
| 3.2 | Geometry and elevation | [Color, type, and surface tokens](tokens.md) |
| 3.3 | Typography | [Color, type, and surface tokens](tokens.md) |
| 4 | Shell and navigation | [Design index](../../design.md#choose-an-app-area) |
| 4.1 | Desktop shell | [Desktop shell and navigation](areas/desktop-shell.md) |
| 4.2 | Navigation states | [Desktop shell and navigation](areas/desktop-shell.md) |
| 4.3 | Web employee workspace | [Public site, downloads, and tutorials](areas/public-site.md); [Web employee workspace](areas/web-workspace.md) |
| 4.4 | Developer diagnostics window | [Developer diagnostics](areas/diagnostics.md) |
| 4.5 | Insights dashboard composition | [Insights and analytical charts](areas/insights.md) |
| 4.6 | Workspace identity and selection | [Workspace identity and device connection](areas/workspace-identity.md) |
| 5 | Dashboard blueprint | [My Day and Today dashboard](areas/dashboard.md) |
| 5.1 | Pre-shift / not clocked in | [My Day and Today dashboard](areas/dashboard.md) |
| 5.2 | Active / clocked in | [My Day and Today dashboard](areas/dashboard.md) |
| 5.3 | Observed-only and degraded states | [My Day and Today dashboard](areas/dashboard.md) |
| 6 | Task workspace blueprint | [Employee task workspace and finder](areas/tasks.md); [Task rows, status, and selection](patterns/task-rows.md); [Task drawers and completion evidence](patterns/task-details.md); [Planning, focus, and suggested goals](areas/planning-and-focus.md) |
| 6.1 | Page order | [Employee task workspace and finder](areas/tasks.md) |
| 6.2 | Table rhythm | [Employee task workspace and finder](areas/tasks.md); [Task rows, status, and selection](patterns/task-rows.md); [Planning, focus, and suggested goals](areas/planning-and-focus.md) |
| 6.3 | Selection, hover, and focus | [Task rows, status, and selection](patterns/task-rows.md) |
| 6.4 | Views and ordering | [Employee task workspace and finder](areas/tasks.md) |
| 6.5 | Task drawer | [Task drawers and completion evidence](patterns/task-details.md) |
| 6.6 | Completion evidence | [Task drawers and completion evidence](patterns/task-details.md) |
| 7 | Shared tool and chat surfaces | [In-app chat and shared tool cards](areas/chat.md); [Planning, focus, and suggested goals](areas/planning-and-focus.md); [Floating companion, Otto, and assets](areas/floating-companion.md) |
| 7.1 | Tool-call surface frame | [In-app chat and shared tool cards](areas/chat.md) |
| 7.2 | In-app launcher and sheet | [In-app chat and shared tool cards](areas/chat.md); [Planning, focus, and suggested goals](areas/planning-and-focus.md) |
| 7.2.1 | Focus panel goal card | [Planning, focus, and suggested goals](areas/planning-and-focus.md) |
| 7.3 | Floating Otto chat | [Floating companion, Otto, and assets](areas/floating-companion.md) |
| 7.4 | Message times and session dividers | [In-app chat and shared tool cards](areas/chat.md) |
| 8 | Controls and interaction contracts | [Design index](../../design.md#add-shared-guidance-only-when-relevant) |
| 8.1 | Actions | [Actions, forms, menus, and keyboard behavior](patterns/controls.md) |
| 8.2 | Inputs, search, and filters | [Actions, forms, menus, and keyboard behavior](patterns/controls.md) |
| 8.3 | Menus and detached surfaces | [Actions, forms, menus, and keyboard behavior](patterns/controls.md) |
| 8.4 | Worktivity attendance controls | [Attendance and provider freshness](areas/attendance.md) |
| 8.5 | Settings memory summary and management modal | [Work Memory](areas/memory.md) |
| 8.6 | Appearance settings: theme, text, and mascot size | [Appearance and first-login theme choice](areas/appearance.md) |
| 8.6.1 | First-login theme choice | [Appearance and first-login theme choice](areas/appearance.md) |
| 8.7 | Attendance freshness: activity-driven clock-in and clock-out | [Attendance and provider freshness](areas/attendance.md) |
| 8.8 | Voice input: record → transcribe → review | [Voice input](areas/voice.md) |
| 8.9 | Two-view workflow modals: input view and drafted view | [Workflow dialogs and submission confirmations](patterns/workflow-dialogs.md) |
| 8.10 | Submission confirmations: plan and EOD | [Workflow dialogs and submission confirmations](patterns/workflow-dialogs.md) |
| 8.11 | First-visit page guides | [Page guides and workspace tour](areas/page-guides.md) |
| 8.12 | Review notifications, the notifications panel, and suggestion review | [Notifications and review reminders](areas/notifications.md) |
| 8.13 | Keyboard and focus | [Actions, forms, menus, and keyboard behavior](patterns/controls.md) |
| 8.14 | First run: the welcome, the setup, and the hand-off | [First run and setup](areas/onboarding.md) |
| 8.15 | Profile signals and connected accounts | [Profile, connected accounts, and work arrangements](areas/profile-and-schedule.md) |
| 8.15.1 | Work arrangements and fixed-day flexible hours | [Profile, connected accounts, and work arrangements](areas/profile-and-schedule.md) |
| 8.16 | EOD drafts before clock-out, and deleting a draft | [Employee EOD review](areas/eod-review.md) |
| 8.16.1 | The EOD document: a brief, then the full record | [Employee EOD review](areas/eod-review.md) |
| 8.17 | Settings groups: one label column, one content column | [Settings categories and layout](areas/settings.md) |
| 8.18 | Settings as a category workspace | [Settings categories and layout](areas/settings.md) |
| 8.17 | The goal question and the suggested goal | [Planning, focus, and suggested goals](areas/planning-and-focus.md) |
| 9 | Data truth, provenance, and state | [Task rows, status, and selection](patterns/task-rows.md); [Floating companion, Otto, and assets](areas/floating-companion.md); [Employee EOD review](areas/eod-review.md); [Data truth, async states, and pagination](patterns/data-and-state.md); [Activity interval reviews](areas/recaps.md); [Next-step suggestions after recap approval](areas/next-steps.md); [Startup and the local vault gate](areas/startup.md) |
| 9.1 | Activity Interval Reviews | [Floating companion, Otto, and assets](areas/floating-companion.md); [Employee EOD review](areas/eod-review.md); [Activity interval reviews](areas/recaps.md); [Next-step suggestions after recap approval](areas/next-steps.md) |
| 9.2 | Paged and streaming lists | [Data truth, async states, and pagination](patterns/data-and-state.md) |
| 9.3 | The local vault gate | [Startup and the local vault gate](areas/startup.md) |
| 10 | Motion | [Motion and timing owners](patterns/motion.md) |
| 11 | Responsive matrix | [Responsive layouts and viewport matrix](patterns/responsive.md) |
| 12 | Accessibility | [Shared design foundations](foundations.md) |
| 13 | Mascot and custom assets | [Floating companion, Otto, and assets](areas/floating-companion.md) |
| 14 | Deep module and seam rules | [Shared seams and performance budgets](implementation.md) |
| 14.1 | Performance budgets | [Shared seams and performance budgets](implementation.md) |
| 15 | Visual QA and release acceptance | [Design verification and handoff](verification.md) |
| 16 | Administration workspace | [Administration index](admin/README.md) |
| 16.1 | Shell and navigation | [Notifications and review reminders](areas/notifications.md); [Administration shell and shared contracts](admin/shell.md) |
| 16.2 | Page contracts | [Administration index](admin/README.md) |
| 16.3 | Data and provenance | [Insights and analytical charts](areas/insights.md); [Administration shell and shared contracts](admin/shell.md) |
| 16.4 | Evidence integrations | [Administration evidence and integrations](admin/evidence.md) |
| 17 | Implementation checklist | [Design verification and handoff](verification.md) |

## Editorial clarifications during the split

The refactor moves the contracts and changes navigation; it does not change
application behavior. These bounded wording corrections resolve contradictions
already present in the baseline:

| Topic | Clarification and existing evidence |
|---|---|
| Profile hosting | The companion's shared form normally renders inline in Settings → Profile; its content rules also cover the retained modal host. The original Settings-category contract already says this, and [ProfileSettings](../../desktop/work-os-companion/src/ProfileSettings.tsx), [settingsSections](../../desktop/work-os-companion/src/settingsSections.tsx), and [App](../../desktop/work-os-companion/src/App.tsx) support it. |
| Appearance fallback | Name the existing defaults: Text size Small, Mascot size Large, Theme System. [appearance.ts](../../desktop/work-os-companion/src/appearance.ts) declares and normalizes those exact defaults; the former blanket “never the larger setting” sentence was inaccurate for mascot size. |
| Flexible EOD | Scope the ten-minute scheduled-end rule to scheduled arrangements. Flexible work follows the existing arrangement contract: started work or a closed day makes today's EOD available. The [server gate](../../src/lib/work-os-eod-shift-gate.ts) branches to that rule before scheduled gating. |
| Web dark material | Preserve the explicit console-graphite scope and remove the earlier “light stack only” wording that contradicted it. |
| Wide layout example | The responsive matrix now describes the work stage; the old hero/pulse example was superseded by the command-surface dashboard contract in the same blueprint. |
| Duplicate attention timing | One named section in the floating-companion guide owns the bounded sequence, snooze replay, and reduced-motion behavior. |
| List defaults | The shared pagination guide now routes to the already documented task, recap, memory, admin task, and evidence exceptions. Their numerical limits remain in their owning guides. |

**Implementation follow-up, not a verified UI fix:** source inspection found
the scheduled helper still used by the EOD UI gates in
[EmployeeReview](../../src/modules/work-os/employee/EmployeeReview.tsx) and
[App](../../desktop/work-os-companion/src/App.tsx). Verify flexible-worker
availability in those clients before claiming they implement the server's
flexible branch. This documentation change preserves the approved contract;
it does not resolve or runtime-test that possible client discrepancy.

## Preservation record

All substantive source text was assigned to 81 bounded source spans. The only
unassigned nonempty lines were five structural headings, replaced by the new
entry point or named area indexes. Internal section references became local
Markdown links. A source-span comparison checks the relocated text after the
explicit editorial changes above; the original remains available in Git.

Return to the [design index](../../design.md) for current task routing or
[maintenance guidance](maintenance.md) when moving a contract again.
