# Web workspace and role routing

**Use when:** Changing authenticated employee routes, manager Team review entry, role dispatch, web shell, or web/desktop parity.

**Owns:** Web role routing, employee composition, console material scope, and companion-only capabilities.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing membership selection or device handoff: [Workspace identity and device connection](workspace-identity.md).
- Changing administration / my workspace switching: [Administration shell and shared contracts](../admin/shell.md).
- Changing observed attendance or freshness: [Attendance and provider freshness](attendance.md).

**Implementation starting points:** [EmployeeWorkspaceShell.tsx](../../../src/modules/work-os/employee/EmployeeWorkspaceShell.tsx), [employee-routes.ts](../../../src/modules/work-os/employee-routes.ts).

## Routes and material

The deployed web console hosts the employee workspace on nested routes, so each
destination is a real, deep-linkable, role-guarded page instead of one stacked
page:

    /work-os/today      command center: status band, focus, check-in, first moves
    /work-os/tasks      task workspace: My day · Unfinished · Completed · All tasks
    /work-os/review     EOD reports, proposed changes, and recorded evidence
    /work-os/insights   range brief and per-day records
    /work-os/settings   profile, working hours, consent, and companion connect

- `/work-os/workspace` dispatches by role and active view. Employees and mapped
  administrators in **My workspace** use the employee destinations; managers
  keep the review console, and administrators in **Administration** use its
  separate routes. Employee-view legacy `?tab=` links map reports and evidence
  to Review, and people, schedules, and blueprints to Today. In Administration,
  evidence opens Evidence, people and schedules open People, blueprints opens
  Settings, and reports opens administration EOD Review. Old links retain the
  meaning of the selected view.
- Work OS navigation is role-aware in the console sidebar: the workspace
  destinations for employees, Team review for managers, and the administration
  destinations for administrators, with the active state resolved on the real
  route.
- The workspace carries the Work OS material system inside the console shell:
  warm canvas, white work surfaces, near-black green ink, and signal green for
  actions, progress, and current state. The tokens are scoped to the workspace
  routes; the shell keeps its own palette around them. The dark variant keeps
  the same roles; its host-console material is scoped as described below.
- The dark variant is a role-preserving re-material, never a hue-preserving
  inversion of the light stack. Inverting the warm ivory stack keeps its warm
  cast, so a dark workspace rendered that way reads as a warm island inside a
  cold console. The dark scope therefore takes the console's neutral graphite
  family and a clean near-white ink: same roles, one material with the host
  application. Signal green stays the single accent; the categorical chart
  family is theme-aware, because a hue tuned for ivory paper turns sandy on
  graphite.
- Each destination owns one masthead (context eyebrow, single title, compact
  utilities), one content axis, one panel family with hairline dividers, and at
  most one primary action per decision area. Task rows stay flat; task details
  open in a right-side drawer and menus are detached surfaces.
- At narrow widths, masthead utilities move below the title and wrap without
  extending the page horizontally; the primary action remains visible.
- The web surface is status-only for attendance: it names the Worktivity state
  and freshness, keeps the activity watch truthful, and points to the Windows
  Companion for Clock in, Pause/Resume, and Clock out.

A mapped administrator has two Work OS views, the way the companion does:
**Administration** and **My workspace**. The active view is a per-device
presentation preference stored in the `work-os-view` cookie and reported by
`/api/work-os/session`; it is never an authorization boundary. Administration
keeps the platform console and the administration destinations. My workspace
keeps only the employee destinations, and an administration URL redirects to
the employee home while it is active (and the reverse while Administration is
active). The switch is visible on both sides: the employee workspace band
carries `Switch to Administration`, every administration masthead carries
`Switch to my workspace`, and the platform sidebar's Work OS group follows the
active view. An administrator without a mapped person stays in Administration,
managers keep the review console, and non-admin behavior is unchanged. The
default with no stored preference is Administration, so existing administrator
bookmarks keep their meaning.

The web workspace also carries the companion's employee-facing capabilities so
the two surfaces tell the same story: the two-view Plan your day session
(input → drafted review → refine/confirm, with the Loom attachment), the
Activity Interval Review stream with confirm/amend, Work Memory management
(Needs review / Remembered), the shift-time instrument (elapsed, bounded
scheduled-window progress, remaining time), optimistic task adds with
surface/defer, per-day screenshot evidence, and the deterministic insights
record with exact-value charts. Surfaces that stay companion-only by design:
Worktivity attendance mutations, the system-wide hold-to-talk shortcut, the
window-focused Ctrl + , Settings shortcut, the
floating window and orb chat, OS notifications and sounds, the offline queue,
appearance settings, and device sessions.

## Manager Team review

Team review remains the manager console at `/work-os/workspace`. The
[server dispatcher](../../../src/app/work-os/workspace/page.tsx) keeps managers
on that route; [WorkOsHome](../../../src/modules/work-os/WorkOsHome.tsx) renders
[ManagerWorkOsHome](../../../src/modules/work-os/ManagerWorkOsHome.tsx).
Use those entry points when changing the manager surface and retain its role
and workspace boundaries. Administration's shell and queue layout belong to
its separate role-specific guides.

For changes to the underlying report, also read the
[employee EOD document](eod-review.md#the-eod-document-a-brief-then-the-full-record).
For shared evidence or async-state behavior, use
[data truth and state](../patterns/data-and-state.md). These are conditional
references, not additional shell requirements.
