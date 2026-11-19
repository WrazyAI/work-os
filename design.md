# Work OS design guide

This is the entry point for Work OS's canonical design guidance. The focused
guides below share one product identity and preserve the web, companion,
employee, manager, and administration contracts.

## Read only what the task needs

1. Read this index and [shared foundations](docs/design/foundations.md) once for
   a UI task. Foundations establish the common visual and interaction baseline.
2. Choose the affected area below. For a shared-pattern-only change, go directly
   to that pattern and identify its affected consumers.
3. Follow a guide's **Requires** field. Read **Read next only if** links only
   when the named behavior changes. Other links are references, not instructions
   to load more files. Do not read or concatenate the entire guide directory.
4. Expand the reading set when the actual change crosses another boundary.
   Shared CSS, tokens, or components require checking the surfaces they affect.
5. Use [design verification](docs/design/verification.md) to plan evidence and
   complete a UI handoff. Keep the engineering gates in [AGENTS.md](AGENTS.md).

For non-UI work, consult a design contract only when its product behavior is
affected. Reopen an already-read guide when its content or the task scope changes.

## Choose an app area

| Working on | Read |
|---|---|
| Companion rail, caption bar, platform menus, navigation | [Desktop shell](docs/design/areas/desktop-shell.md) |
| Web employee routes, host material, web/desktop parity | [Web workspace](docs/design/areas/web-workspace.md) |
| Manager Team review console and role dispatch | [Manager Team review](docs/design/areas/web-workspace.md#manager-team-review) |
| Workspace selection, membership presentation, device connection | [Workspace identity](docs/design/areas/workspace-identity.md) |
| My Day / Today, command surface, workday detail | [Dashboard](docs/design/areas/dashboard.md) |
| Employee task views, ordering, task finder | [Tasks](docs/design/areas/tasks.md) |
| Daily plan, focus strip, goal editing or suggestions | [Planning and focus](docs/design/areas/planning-and-focus.md) |
| Clock actions, Worktivity observation, attendance freshness | [Attendance](docs/design/areas/attendance.md) |
| Employee end-of-day drafts, report document, wrap-up | [EOD Review](docs/design/areas/eod-review.md) |
| Insights, metrics, charts, accessible exact values | [Insights](docs/design/areas/insights.md) |
| In-app chat, launcher, tool previews, approvals | [Chat](docs/design/areas/chat.md) |
| Floating Otto, mascot assets, prompt bubbles, view switch | [Floating companion](docs/design/areas/floating-companion.md) |
| Microphone, transcription, hold-to-talk | [Voice input](docs/design/areas/voice.md) |
| Activity recaps, evidence panels, confirm/amend, history | [Activity interval reviews](docs/design/areas/recaps.md) |
| Task suggestions after an approved recap | [Next steps](docs/design/areas/next-steps.md) |
| Notification bell, flyouts, review reminders | [Notifications](docs/design/areas/notifications.md) |
| Settings category navigation and page layout | [Settings](docs/design/areas/settings.md) |
| Theme, text/mascot size, first-login theme choice | [Appearance](docs/design/areas/appearance.md) |
| Profile signals, connected accounts, scheduled/flexible hours | [Profile and work arrangements](docs/design/areas/profile-and-schedule.md) |
| What Otto remembers, proposed/retained facts | [Work Memory](docs/design/areas/memory.md) |
| First run, welcome, setup, completion handoff | [Onboarding](docs/design/areas/onboarding.md) |
| Page guides, recorded films, chapters, workspace tour | [Page guides](docs/design/areas/page-guides.md) |
| Launch loading, local vault, retry/reset | [Startup](docs/design/areas/startup.md) |
| Developer scenarios, live trace, export | [Diagnostics](docs/design/areas/diagnostics.md) |
| Administration pages, team evidence, Admin Otto | [Administration index](docs/design/admin/README.md), then the affected page |
| Public landing, downloads, installation help, tutorials | [Public site](docs/design/areas/public-site.md) |

The companion's dedicated employee Evidence destination remains intentionally gated; see
[design exceptions](docs/design-exceptions.md). Administration evidence has its
own [record and access contract](docs/design/admin/evidence.md).

## Add shared guidance only when relevant

| Changing | Read |
|---|---|
| Color, typography, geometry, elevation, light/dark material | [Tokens](docs/design/tokens.md) |
| Actions, forms, search/filter controls, menus, tabs, shortcuts | [Controls and keyboard behavior](docs/design/patterns/controls.md) |
| Task-row layout, status, selection, text overflow, completion cascade | [Task rows](docs/design/patterns/task-rows.md) |
| Task drawer, completion uploads, file preview/download | [Task details and evidence](docs/design/patterns/task-details.md) |
| Input/drafted workflow dialogs or submission receipts | [Workflow dialogs](docs/design/patterns/workflow-dialogs.md) |
| Provenance, loading/error/queued states, dates, pagination | [Data and state](docs/design/patterns/data-and-state.md) |
| Layout, breakpoints, density, overlays, zoom | [Responsive matrix](docs/design/patterns/responsive.md) |
| Animation, transitions, automatic playback | [Motion](docs/design/patterns/motion.md) |
| Shared components, state ownership, subscriptions, budgets | [Implementation seams](docs/design/implementation.md) |

## Keep the guides coherent

The current task brief and approved Work OS contracts govern the work. Shared
foundations apply everywhere; explicit surface exceptions stay scoped. The
[Anthropic design guidance](https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md)
informs the design process described in foundations without replacing the
approved Work OS identity or product behavior.

Update the owning guide when an approved contract changes. Keep this file a
router; use [maintenance guidance](docs/design/maintenance.md) when adding or
moving documentation. Dated plans and QA reports remain historical evidence.
For older `design.md §…` references, use the [legacy section lookup](docs/design/legacy-sections.md).
