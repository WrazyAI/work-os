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
- [ ] Deploy through Agent OS and verify live pages (user authorized).

Deployment ledger: `39514539-b77d-46dd-8606-258dd19f1f1b`.
Agent OS port is limited to the five matching marketing stylesheets and the
rendered palette regression. No platform shell/configuration files are replaced.

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

No companion version, release queue, media or application logic changes.
