# Onboarding footer diagnostic follow-up — October 20, 2026

## Findings

### Remaining defect in 0.4.82+

The user confirmed the affected Mac is on 0.4.82 or newer. Further testing
found a second independent defect in current main: `.guided-onboarding` has
`height: 100vh` **and** `min-height: 600px`. A 500px-tall webview therefore
renders a 600px shell, placing the entire footer at y=520–600, outside the
visible area. This was observed before any browser automation could focus or
scroll an off-screen Continue button. The new rendered regression failed on
that geometry before the fix; the new shell contract unit test also failed.

The fix removes that hard content minimum (`min-height: 0`) while preserving
the actual viewport height, the existing per-child flex contract, and the
narrow layout's page-scrolling behavior. At the same 500px viewport, the
footer now occupies y=420–500 and all five steps remain operable.

**Attribution limit:** the supplied bundle has no affected-window dimensions.
This proves and fixes a current off-screen-footer defect, but does not prove
the employee's Mac encountered this exact height condition. She has not yet
tested the new fix, and no confirmed fullscreen/resizing result is available.

### Earlier defect already fixed

The pre-`b8e78067` production layout reproduces the reported missing Back /
Saved / Continue row. Its positional grid reserves a row for the conditional
scenario banner. Without that banner, the scope step takes the wrong row and
the footer falls below the panel's overflow clip. At 1000×760, restoring the
old template puts the footer at y=760–840, entirely outside the viewport.

The flex-column fix already on main keeps that same footer at y=680–760.
This was observed in both Chromium and Playwright WebKit on Linux, using the
real nine-card catalog, not filler DOM. Linux WebKit is not an installed-Mac
acceptance test.

The published 0.4.82 release targets `9d78cea23688ea89f888cfa431a26a742d264c7f`,
which includes `b8e78067`. The uploaded diagnostic bundle does **not** identify
the installed version or contain panel geometry. Therefore it cannot establish
that this defect persists in 0.4.82, or that the employee has that build.

## Separate diagnostic failure

The supplied export contains successful onboarding reads and draft saves on
October 19. The most recent October 20 launches instead stop at the vault gate:
`vault.open.failed`, with `invalid file failed to decode/decrypt age content
BadFileKey`. That failure happens before onboarding mounts; it is not evidence
of a footer rendering failure. No local vault, keychain, or queued data was
reset or deleted during this investigation.

## Regression coverage added

- The onboarding preview now uses `workProfileCatalog()` instead of a two-card
  substitute. A failing-then-passing unit test protects catalog parity.
- `scripts/verify-onboarding-footer.mjs` walks all five form steps and checks
  footer geometry, pointer hit targets, horizontal overflow, keyboard forward
  navigation, consent validation, and arrival at the completion screen.
- `--prove-legacy` restores the previous template in the browser only and
  asserts that the known production clipping returns.

## Executed checks

- Final companion unit suite: **1,202 passed**, 133 files.
- Work OS typecheck: passed.
- Work OS suite: **552 passed** in its TypeScript test phase; preceding
  migration/macOS-release phase also exited successfully.
- Companion build: passed.
- Chromium: **80 footer checks passed** after removing the shell minimum.
- WebKit: **80 footer checks passed** after removing the shell minimum. An earlier run
  crashed the Linux browser during navigation after 20 checks, with no layout
  assertion failure; the rerun completed all sizes unchanged.
- Matrix per engine: 1000×500, 1000×540, 1440×900, 1024×768, 1000×600, 900×640,
  720×900, 390×844; scenario banner present and absent; reduced motion.
- Legacy clipping reproduced in both engines; before/after screenshots were
  inspected. Narrow layouts were page-scrolled to the whole footer; desktop
  checks do not auto-scroll and require it pinned to the viewport bottom.

No authenticated employee account, installed macOS application, or live
onboarding write was exercised. The user explicitly selected local checks only
instead of creating or running a new paid TestSprite regression. CodeRabbit's
initial fixture/script pass and follow-up production-fix review both completed
with zero findings. The second pass was necessary because the production CSS
fix materially changed the reviewed surface.

## Remaining acceptance

Release **0.4.84** was published on October 20 at 17:46:32 UTC from Work OS
`9ae9a04a9ab8cb40ac1ed5a9a81b6f7461ed52b5`. Release workflow
`39467530053` passed all Windows, universal macOS, packaged-Mac startup, and
combined updater/asset verification jobs; all 12 release assets are uploaded.
This is an explicitly unsigned internal prerelease with signed updater artifacts.
An unauthenticated live updater probe redirected to sign-in; no employee session
was available, so authenticated in-app update delivery is not verified here.

The same runtime CSS and fixture/unit regression were ported by content into
Agent OS `ae44b0ce`, preserving its independent version metadata and platform
surfaces. Its companion suite passed **1,196 tests**, its Work OS suite passed
**521 tests** in the TypeScript phase, and typecheck/build passed. No server
redeployment was needed for this desktop-only fix. The standalone browser
regression script and this release-verification report remain in Work OS.

An extra WebKit check exercised normal motion at both default and 15% larger
text at 1000×500: Back/Continue retained the selected specialty and the footer
remained clickable.

Recheck the affected Mac after installing 0.4.84. If the footer remains
absent, capture that window's dimensions and screenshot before changing
layout again. Resolve the separate vault failure through a user-approved
recovery path; do not silently discard local queued work.
