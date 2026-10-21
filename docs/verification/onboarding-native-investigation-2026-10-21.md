# Native onboarding investigation — October 21

The affected employee is confirmed on 0.4.84; a fresh diagnostic export and
screenshot are unavailable. Do not interpret prior CSS fixes as resolution.

## Evidence

- Published 0.4.84 on a real macOS-14 runner: with the actual native work area
  reduced to 777px by the Dock, its native window automatically fit that area.
  Run 39652804818: frame y=25, height=777, bottom=802; work area identical.
  The screenshot was taken early in boot and is **not** setup acceptance.
  This did not justify adding a speculative `preventOverflow` config patch.
  This observation applies to the tested runner, not every Mac configuration.
- Production-built, complete nine-card setup fixture in real macOS WKWebView:
  run 39654147138, viewport 1000×749, footer y=669–749 and visible.
- The same production-built fixture in WebKit 16 and WebKit 15-era Linux
  builds, 1000×760: footer y=680–760 and visible. These are engine probes,
  not a claim about the employee's operating-system version.
- Real macOS WKWebView at **720×600**, run 39654854896: the shell is 1749px
  tall, the stage takes 440px, and the footer occupies **y=1669–1749**.
  `footerVisible:false`; the captured screenshot shows the page's top and no
  footer. This reproduces an off-screen footer in a supported narrow window.
- The first narrow workflow returned success despite `footerVisible:false`
  because its `tee` pipeline masked the probe's exit code. Explicit
  `set -euo pipefail` is added so the failing assertion becomes a failing job.
  Trust the recorded geometry, not that initial green job status.

## Root cause of this reproduced path

At widths ≤720px, the responsive stylesheet replaces viewport-bounded setup
with a document-height layout. The footer's `position:sticky; bottom:0` does
not pull an element that starts below the viewport into view. Earlier browser
verification explicitly scrolled the footer into view at narrow widths,
masking this usability failure. The two earlier fixes affected other paths.

## Approved fix and verification

The user approved the narrow-only fix. At ≤720px, the footer is fixed to the
viewport bottom with an 80px plus safe-area content clearance. The panel's
forwards-filled transform entrance is disabled only at this breakpoint,
because it creates a containing block that otherwise captures the fixed bar;
step-content animations remain. No save, draft, consent, or desktop-layout
behavior changed.

Both failures were observed before their fixes: the strengthened browser
check failed at 720×600 with the footer below the viewport, then normal-motion
testing exposed the container-animation capture. After both changes, the
normal-motion and reduced-motion browser matrices each passed 90 footer checks
(180 total) without scrolling the footer into view. Back/Continue retained specialty selection; keyboard focus,
consent validation, last-specialty clearance, reduced motion, and larger text
with a long offline label were checked at 720px and 390px.

Native Mac run **39656931062** passed: the production-built fixture in real
WKWebView at 720×600 placed the footer at **y=520–600**, visible before any
scrolling. Screenshots were downloaded and inspected. The fixture uses the
same production build configuration, CSS imports, real React component, and
complete nine-card catalog, but not the employee's live account or vault.

The first full companion run had one test-selector error (the guard located
an earlier unrelated media block); after correcting the guard, all **1,236
tests passed**, and the final post-rebase suite passed **1,239 tests**.
Work OS typecheck and companion build passed. A concurrent build/browser
verification attempt timed out under host load; unchanged sequential reruns
completed the build and both 90-check matrices. CodeRabbit reviewed all 17
changed files and completed with **zero findings**. The broader
Work OS TypeScript phase reported **572 passed / 7 failed**, all in unchanged
`work-os-provider-outbox.test.mts`; the same seven failures reproduced directly
on a clean baseline checkout at `455d1fac`. They are not claimed green:

- create_task adopts a recorded provider id before any provider work
- orphan search is skipped on a first attempt and the hook records the id
- the create intent is recorded after credentials and before the POST
- an unresolved intent refuses to POST again and searches with retries
- only a definite 4xx clears the intent
- a confirmed clear-and-retry resolves the intent before the POST
- the outbox write is fenced on the live attempt

No TestSprite run was commissioned: the user previously selected local checks
only. Native Mac CI is the additional platform evidence, not a TestSprite run.

## Limits and remaining acceptance

The employee's actual window width is still unknown. This is a reproduced
current defect, **not proof** that her Mac used this breakpoint. No local data
reset or new telemetry collection has been made by this task.

A separate native window-fitting change (`7cc853d3`, release 0.4.96) landed
while this investigation was running. It is preserved on rebase; this narrow
footer fix is complementary, not a replacement or a claim to have validated
every native configuration. Release 0.4.97 is prepared for the narrow fix;
publication, cross-repo runtime convergence, final post-rebase verification,
and the affected employee's confirmation remain pending at this checkpoint.
