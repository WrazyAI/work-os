# Employee task finder — approved direction

## Intent and scope

Replace the employee companion Tasks panel's search input and labelled date-range control with Search, Calendar and Add task icon buttons beside its view tabs. Remove Add task from the sortable column row. Preserve the masthead date navigator, page tabs, task ordering, mutations and existing detail drawer. This scope is the companion employee page shown in the operator's screenshot, not administration or floating chat.

The operator approved one unified finder: Search opens the text field; Calendar opens the same modal with its date area expanded. Both start independently of the page's selected tab and day. Closing the finder leaves the underlying page unchanged. Selecting a result closes the finder and opens the existing task detail panel.

## Search and filters

- Initial status is All; pills expose All, Pending, In progress, Overdue and Completed. Completed is the filter label for the existing Done state. No generic Filter button.
- Status follows the employee display precedence: completed before overdue before stored in-progress before pending. An overdue in-progress task belongs under Overdue rather than In progress. No invented states.
- Text, one selected status pill and date range intersect before pagination. Results include all authorized, active parent tasks the employee can inspect, including delegated and completed work under existing access rules; archived/deleted tasks stay excluded. Never filter only loaded pages.
- Use the existing task-attributed calendar-date semantics (due date with existing creation fallback), not an unannounced new completion-date rule. Label the control `Task date` and explain this briefly within the expanded date area.
- Today, This week, Last week and Custom range are inline quick choices. This week starts Monday. From and To accept calendar dates, inclusive, with future dates permitted. Reject reversed/impossible ranges inline without requesting them. An applied range appears as a removable letter-month chip.
- Empty query with All and no dates browses all tasks, 50 parents per cursor page. Load more is explicit; show the complete filtered count and loaded window. Debounce text by 250ms, cap at the API's 200 characters, cancel obsolete requests and isolate query keys/cursors by all filters and authorized scope.
- Show loading, no tasks, no matches with Reset filters, error with Retry, and load-more failure without discarding good rows or input. Never offer stale results from a different filter as current matches.

## Layout and material

Keep Work OS's self-hosted fonts, Lucide icons, semantic tokens and restrained hairline list rhythm. External references are inspiration, not permission to replace the existing design system.

- Toolbar: views on the left; three aligned 38px icon controls on desktop, 44px on touch widths; plus is the sole ink-filled primary control. Accessible names and tooltips name all actions.
- Finder: roughly 680px maximum width, near the upper third of a desktop viewport, max height bounded by viewport. A 24px content inset and a strong 18px search field establish hierarchy; filters are quieter. One flat result list, not stacked nested cards.
- Backdrop: muted ink translucency and backdrop blur. A decorative, pointer-inert feathered halo softens the panel's outside edge/corners. The actual surface, text, focus rings and controls stay crisp. No glow, glossy gradient or full-panel blur. Solid fallback if backdrop filtering is unsupported.
- Results: 64px minimum rows; task title leads, project/description secondary, date/status aligned at the trailing edge. At 390px move metadata below the title, wrap pills and date fields, retain all controls and prevent horizontal page overflow. Only the result area scrolls when possible; expanded dates remain reachable on short viewports.
- Opening/closing uses a brief 180–220ms opacity/4px transition; reduced motion skips translation. No ambient motion.

## Interaction quality

Labelled modal with focus trapping, background scroll lock and inert background. Search entry focuses text; Calendar entry focuses the date area. Escape, backdrop and close dismiss and restore the exact originating toolbar button. Result activation hands focus to the drawer rather than restoring focus behind it; drawer close restores to a stable Tasks toolbar control. Support keyboard result navigation without stealing normal input editing keys. Native date picker interactions and IME composition must remain usable.

## Delivery constraints

No new dependencies, fonts, models or assets. Extend the existing authorized employee task paging API with a validated status parameter and a new additive SQL migration; preserve old callers and grants. Never apply historical migrations or write to a database without verifying its resolved host. Any live migration/deployment is a separate tracked action. Update design.md's superseded Tasks toolbar contract. Count this as one companion outcome only after actual verification; no automatic release/version bump.

## Acceptance

Actual rendered checks at 1440, 1024, 720 and 390px, long/empty/error/loading results, date intersections, later-page matches, all task statuses, keyboard/IME, wheel over results, reduced motion, result-to-drawer handoff and plus-to-creator. TestSprite regression, focused model/query/route/SQL tests, typechecks, full Work OS and companion suites, companion build and one CodeRabbit pass. Record evidence rather than claiming a static test proves visual acceptance.
