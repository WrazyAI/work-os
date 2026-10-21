# Native onboarding investigation — October 21

The affected employee is confirmed on 0.4.84; a fresh diagnostic export and
screenshot are unavailable. Do not interpret prior CSS fixes as resolution.

## Evidence

- Published 0.4.84 on a real macOS-14 runner: with the actual native work area
  reduced to 777px by the Dock, its native window automatically fit that area.
  Run 39652804818: frame y=25, height=777, bottom=802; work area identical.
  The screenshot was taken early in boot and is **not** setup acceptance.
  This does not justify adding a speculative `preventOverflow` config patch.
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

## Limits and next decision

The employee's actual window width is still unknown. This is a reproduced
current defect, **not proof** that her Mac used this breakpoint. No product
fix, new release, local data reset, or new telemetry collection has been made.

Proposed bounded change: at narrow widths, keep the existing scrollable setup
content but anchor Back / save state / Continue to the viewport bottom and
reserve content clearance so nothing is hidden underneath. Leave the desktop
layout and all save/consent behavior unchanged. Verify the native probe without
scrolling, then walk the controls and inspect desktop/narrow screenshots.
