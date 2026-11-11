# Public-site light-green controls

Ledger: `f063666c-5232-4f22-949f-4e8d3f4b7659`

## Scope and plan

- [x] Restore pale-green download buttons and all eleven tutorial play icons,
  with dark-green foregrounds and readable selected/focus colors.
- [x] Preserve purple landing background, light secondary pages, red install
  warnings, tutorial films, download routing and motion behavior.
- [x] Rendered regression failed against production's purple button before
  styling, then passed locally at 1440px and 390px.
- [x] Extend rendered verification to all tutorial icons and keyboard opening.
- [x] Run focused tests, typecheck, full Work OS suite and bounded review.
- [x] Record final implementation evidence.
- [x] Deploy through Agent OS and verify live pages (user authorized).

Deployment ledger: `39514539-b77d-46dd-8606-258dd19f1f1b`.
Agent OS port is limited to the five matching marketing stylesheets and the
rendered palette regression, plus the corresponding design paragraph.
No platform shell/configuration files are replaced.

Work OS implementation commit: `f0711de7` (prior to this deployment evidence).
Work OS isolated production webpack build passed
(`/tmp/opencode/green-controls-build.log`); only the generated extra distDir
entries were removed from `tsconfig.json` afterward.
Agent OS base: `de26ee27`. The five CSS files and browser regression match by
bytes after the bounded port.

Agent OS port commit: `5fc5c573`. Focused tests: 26 passed. Typecheck: passed.
Full `work-os:test`: 931 main tests, 23 screenshot tests and 3 migration tests
passed; one opt-in live screenshot test skipped. Tool runtime for the main test
suite was about 4m27s, separate from implementation work. Logs:
`/tmp/opencode/green-controls-agentos-{focused,typecheck,full-suite}.log`.

Agent OS webpack dev startup could not serve the local acceptance page: existing
`src/instrumentation.ts` imports the SEO executor and pulls Node-only `pg`/`fs`
into an instrumentation compile. No styling assertion ran in that attempt.
The dev process was stopped; acceptance will use the production artifact, as in
the previous Good company deployment. No instrumentation changes are in scope.

## Evidence

- RED: `/tmp/opencode/green-controls-red.log`: actual button `rgb(111, 84, 139)`
  versus requested `rgb(212, 232, 190)`.
- Initial GREEN: `/tmp/opencode/green-controls-browser.log`.
- All eleven icons and keyboard opening GREEN:
  `/tmp/opencode/green-controls-browser-all.log`.
- Focused public routes/download/tutorial suites: 31 passed, 0 failed
  (`/tmp/opencode/green-controls-focused.log`).
- Work OS typecheck passed (`/tmp/opencode/green-controls-typecheck.log`).
- Existing Good company browser acceptance passed across eight viewport sizes,
  including short-screen hero, success face, motion, light sibling pages and
  no-JS (`/tmp/opencode/green-controls-landing.log`).
- Full Work OS suite: **1,273 passed, 11 skipped, 0 failed**
  (`/tmp/opencode/green-controls-full-suite.log`). The 11 opt-in PostgreSQL
  tests were not run without an explicitly disposable database.
- Desktop/mobile screenshots: `/tmp/opencode/green-controls/`.
- CodeRabbit 0.9.3 completed review of all eight changed/new files against
  `4587bb36`: zero findings (`/tmp/opencode/green-controls-review.log`).
- TestSprite `e2ed4fb0-96ed-4892-a053-8173e21afcb9`, local run
  `11baa0fc-9c99-42b3-a2ea-71370546866f`: **inconclusive** despite reported
  pass, because run-pinned steps are empty. Direct Playwright checks supply
  rendered acceptance; TestSprite is not counted as acceptance.

## Production deployment

- Deployed Agent OS commit: `5fc5c573f880fbbb37ed87121ddcde606fd2e9f7`
  (`de26ee27..5fc5c573`, fast-forward).
- Work OS implementation commit: `f0711de7` (pushed to `main`).
- Atomic staging build, swap, restart, asset health check and runner check
  succeeded; `agentos-web.service` and `agentos-runner.service` are active.
  Log: `/tmp/opencode/green-controls-deploy.log`.
- The first deploy attempt stopped before building because the non-interactive
  SSH shell lacked `node` on `PATH` (exit 127); the guarded wrapper was re-run
  with the VPS login-shell toolchain at `/home/dev/.local/bin` (Node 22.22.3).
- Live rendered acceptance at 1440px and 390px passed: pale-green download
  button and all eleven tutorial play icons with dark-green ink and readable
  contrast/hover/focus/selected states, keyboard opening of the existing film
  player, purple landing background preserved, red install warning preserved,
  no horizontal overflow. Log:
  `/tmp/opencode/green-controls-live-palette.log`; screenshots:
  `/tmp/opencode/green-controls-live/`.
- Existing eight-viewport Good company acceptance passed against production,
  including short-screen hero, success face, motion, light sibling pages and
  no-JS (`/tmp/opencode/green-controls-live-landing.log`).
- Installer endpoints still resolve: `/downloads/work-os/windows` (200, 14.3 MB)
  and `/downloads/work-os/macos` (200, 32.3 MB).

No database migration, application logic, installer asset, companion version or
release-queue change was made. This is a web-only deployment.

No companion version, release queue, media or application logic changes.
