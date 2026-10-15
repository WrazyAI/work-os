# Otto animation assets

The full companion uses a transparent 1536×2288 lossless WebP: eight columns,
eleven rows, 192×208 cells, 73 populated cells and 15 empty cells. Chat marks,
rest/sleep, loading and image failures retain the configured Studio Otto SVG.
No asset is fetched from an external service at runtime.

Rows: idle (6), right travel (8), left travel (8), greeting (4), success hop (5),
failure (8), waiting (6), active work (6), review (6), eight clockwise looks
from up through down-right, then eight from down through up-left.

Source strips were generated with the built-in image tool from the bundled
Studio Otto identity; they are kept in `source/` alongside the original SVG
raster reference and four cardinal anchors. Left travel was independently
generated to preserve asymmetric chest details. No new product or brand marks
were sourced from another pet. Rejected intermediates remain outside the repo.

## Rebuild and verify

From the repository root, in a Python environment with the pinned dependencies:

```sh
python3 -m pip install -r scripts/otto/requirements.txt
python3 scripts/otto/test_build_atlas.py
python3 scripts/otto/build_atlas.py
```

The build detects separated connected pose groups instead of assuming equal
source slots. It discards detached fringe specks, recovers original edge pixels,
uses one head-based scale per strip, preserves vertical jump displacement and
uses the same scale for both look rows. It refuses clipping or missing poses.
It writes the exact atlas hashes and source hashes to `atlas-build.json`.

With the companion Vite server listening on port 5173 and Playwright installed:

```sh
node scripts/verify-otto-playback.cjs
node scripts/verify-mascot-sync.cjs
```

Set `OTTO_PREVIEW_URL` to use another local port. The checks inspect decoded
pixels, occupied/empty cells, edge isolation, persistent failure color, all
sixteen rendered looks, all nine moving clips, single-hop landing, replay,
reduced motion, SVG fallback, and the shared 35-state matrix. The contact sheet
and state GIFs are review artifacts, not substitutes for those checks.

Native dragging uses Tauri window movement only after a drag-handle gesture.
Programmatic moves do not start travel. Browser checks and movement-model tests
do not establish native Windows/macOS interactive acceptance. There is no
desktop-wide cursor tracking, pet collection, sharing, or upload integration.
