# Employee in-app chat view switch

Ledger: `04688003-12e6-47c5-9eb1-5b1f650e6bc6`

## Cause and fix

The administration in-app chat received `CompanionViewSwitch` through
`headerLeading`, but `ProgressComposer` rendered only the configured mascot
name and had no header-leading seam. The floating employee header already used
the shared switch. The employee in-app header now accepts the same shared
control for an administrator; ordinary employee chrome remains unchanged.
Both chat tabs retain it. The existing workspace owner still handles all
authorization/availability checks and mode changes; chat storage is unchanged.

## Checklist and evidence

- [x] Regression failed before the fix: employee header had no menu trigger.
- [x] Focused render suites: 25 tests passed.
- [x] Root typecheck passed.
- [x] Full root suite: 1284 tests, 1273 passed, 11 opt-in PostgreSQL skips.
- [x] Full companion suite: 205 files, 1844 tests passed.
- [x] Companion production build (includes TypeScript) passed.
- [x] Changed-file ESLint passed.
- [x] Real component browser checks at 1440, 1024, 720, and 390 pixels:
  employee option checked, Admin selection invoked the requested callback,
  Focus tab kept its menu, menu stayed within viewport, Escape restored focus,
  header did not overflow, and no page errors. 390px used reduced motion.
  Screenshots: `/tmp/opencode/employee-navbar-{width}.png`.
- [x] TestSprite existing header regression attempted: test
  `e9b97404-478e-4185-bce3-48e9fdffb01d`, run
  `266b518e-1296-40e3-aecd-f9f83172d468` was **blocked** by
  `ERR_EMPTY_RESPONSE`: the saved plan navigated to historical localhost port
  1433 rather than the current target. Refined the plan to use the current
  target and exercise the real employee view-switch request. Rerun
  `24f16039-9ca3-48af-a5d6-566f9adac8b9` returned passed, but is treated as
  **inconclusive**: its recorded URL had a malformed query suffix and its six
  steps omitted Admin selection and the requested-workspace assertion. Only the
  header-layout assertion ran. No further retries; direct Playwright checks
  above are the menu-interaction evidence, not this false-positive verdict.
  Failure bundle request was refused because the temporary environment had
  already been removed; run-specific steps and result are in `/tmp/opencode/`.
- [x] CodeRabbit review completed: two minor documentation findings, fixed by
  naming reproducible commands in the queue and simplifying the changelog.

The isolated `?preview-chat&isolate=inapp&view-switch` fixture reports the
requested workspace rather than claiming a live workspace changed. The full
admin-shell fixture has no ready mode controller, so it cannot prove an
authenticated two-way workspace transition. Installed-client acceptance is
still required after publication. No installer release or server deployment
is part of this fix.
