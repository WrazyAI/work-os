# Shared seams and performance budgets

**Use when:** Changing shared components, state ownership, subscriptions, polling, or guide-film delivery.

**Owns:** Module boundaries and bounded performance expectations.

**Requires:** [Shared foundations](foundations.md) (read each once per task).

**Read next only if:**

- Changing debugger lifetime: [Developer diagnostics](areas/diagnostics.md).
- Changing polling cadence: [Attendance and provider freshness](areas/attendance.md).
- Changing guide media: [Page guides and workspace tour](areas/page-guides.md).

**Implementation starting points:** [dashboardModel.ts](../../desktop/work-os-companion/src/dashboardModel.ts), [DashboardSurface.tsx](../../desktop/work-os-companion/src/DashboardSurface.tsx).

UI modules should be deep: a small interface should own the behavior,
accessibility, visual states, and test surface behind it.

- Dashboard state selection belongs in dashboardModel.ts, not repeated in
  dashboard renderers.
- Dashboard rendering belongs in the shared DashboardSurface seam so pre-shift
  and active surfaces share tokens and state behavior.
- Task row selection, sorting, grouping, and provenance belong in the task
  workspace seam, not in each page.
- Chat/tool frame behavior belongs in shared chat modules; dashboard code must
  only open the launcher and pass truthful context.
- Accept dependencies and return state/results; do not create hidden providers
  inside renderers.
- Keep local seams private unless two real adapters require a public seam.

The interface includes semantic contracts, focus behavior, responsive behavior,
error modes, provenance, and performance expectations, not just TypeScript
props.

## Performance budgets

Each surface states its budgets, and visual QA checks them.

- Bounded history: the developer trace holds 1,000 events in the host and at most
  100 rows in the DOM.
- Page size: one request returns at most 100 rows.
- A closed debugger window holds no subscriptions and no rows. Selecting another
  category releases the trace rows and its event listener.
- Diagnostic change notices target only the debugger window, never the main or
  avatar windows. Bursts coalesce to the latest sequence at most every 250ms; the
  trace pulls the rows it shows instead of receiving whole events.
- Polling cadence follows [attendance freshness](areas/attendance.md#attendance-freshness-activity-driven-clock-in-and-clock-out). No surface polls faster than its contract states.
- Guide film: 1,000×500 H.264 at 30fps, and the whole twelve-page set stays
  under 8 MB. Each clip is encoded for its own length only — nothing loops,
  nothing auto-repeats — and the generated manifest records the exact encoded
  length, so the module can never claim a duration the file does not have.
- Guide film is loaded per chapter on demand, not all at once. Opening a guide
  fetches one clip and one still, and a chapter that is never chosen is never
  downloaded.
- Automated film checks cover one clip per step, clip/still asset presence,
  chapter-title correspondence, minimum manifest duration, and total package
  size. They do not compare step instructions or rendered controls with the
  footage. Review the film when either changes, and re-shoot chapters that no
  longer demonstrate the current step.
