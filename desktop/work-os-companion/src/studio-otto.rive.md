# Studio Otto: integration and future Rive handoff

## Unreleased

Studio Otto replaces the active Signal Spirit art with the approved ivory,
retro-computer design. Pocket was an isolated experiment, not the renderer on
PR #77's starting head (`918608dc`). Storage identity and display name stay Otto.
No agent, approval, receipt, notification timer, or attendance logic changes.

## Current renderer

`StudioOtto.tsx` is the SVG mark, resting pose and failure fallback. `MASCOT`
selects `SpriteOtto` for the animated full pet and `StudioOtto` for the mark.
The full figure uses the bundled, validated 73-frame atlas documented in
`brand/otto/README.md`; authored source strips and review previews are retained.
The components import their own scoped styles,
so every entrypoint that imports it gets the same artwork. The pet wrapper
sets `data-motion="renderer"` to prevent the old generic wrapper animations
from doubling the new rig's motions. Existing production sizes are preserved.

The design preserves the approved ivory retro-terminal identity. It is not a
3D model or Rive asset. No new production dependency or external network request
is added; the local atlas is loaded once and cached by the browser.

## Palette and state contract

| Semantic pose | Display | Motion / gesture |
| --- | --- | --- |
| idle / focus | Ivory, white terminal eyes and prompt | Slow blink; grounded body |
| think | Yellow terminal prompt, dots, workpad | Small typing gesture |
| alert | Yellow question glyph | Bounded attention sequence, then a static wait |
| celebrate | Green expression and check | One hop, then a held landing |
| recover | Coral-red error glyph | Short reaction, then a persistent red expression |
| review | Yellow inspection expression | Careful scan while evidence/EOD preparation is in flight |
| sleep / rest | White dimmed eyes | Static relaxed posture |

Color is never the only cue. `tone=late` remains a red clock on the full pet;
work/input stays yellow and completion stays green even while late. An idle
late state retains the previous red-attention convention. Compact marks omit
limbs, pads, shadows, clock badges, texture and blur filters and never animate.

Intentional design-blueprint deviations approved by the user: yellow means
agent work/input and green means actual completion, rather than using green
for all agent activity. The character has a restrained blink/typing loop;
page/dashboard surfaces are not animated. Hardware stays ivory throughout.

## Preview and exports

Use the existing DEV route `?preview-mascot` (also `?preview-otto`). The lab now
shows all five lifecycle states, including failure, on light/dark backgrounds.
Use its workday, scale, reduced-motion, interruption and notification controls.
These routes remain DEV-only. Never expose fake fixture data as live product data.

After `npm ci` in `desktop/work-os-companion`, regenerate the bundled SVGs with:

```sh
node scripts/export-studio-otto.mjs
npm test
npm run build
```

At repository root, also run the existing mascot architecture guard in the
Work OS test suite. Static SVGs are generated from the component; do not redraw
an independent mark. The sandbox HTML is a separate offline review harness,
not an app route or a replacement for native Tauri validation.

## Playback contract

`mascotPlayback.ts` maps semantic states to clips and quantizes sixteen gaze
directions. `useMascotPlayback.ts` owns visibility, system reduced motion and
the frame clock. A replay key combines explicit preview/snooze replay with new
confirmed receipt revisions; restored receipts do not increment it. Attention
uses that same replay key. The compact mark never loads a sprite atlas.

The native movement adapter consumes existing Tauri move events only after a
drag-handle gesture. Programmatic placement does not trigger travel. Gaze is
window-local; no OS-wide cursor access is requested. Work, input and failure
retain priority over incidental pointer/drag motion.

## Rive contract (future, not installed)

An authored `.riv` asset can later replace `MASCOT.Pet` through an adapter for
`MascotRendererProps`. Keep the compact vector mark as the inexpensive fallback.
Suggested animation inputs: activity enum, workday tone, lookX/lookY, reducedMotion,
and discrete attention/completion triggers. Map the existing semantic pose;
do not create a second source of agent state or replay historical receipts.

Rig independently: monitor head pivot (80,107), arms at their shoulders,
face/gaze, taskpad/typing hand. Keep the floor shadow outside the moving rig.
Use one-shot attention and success motions; reduced motion must retain final
poses, glyphs and palette, not hide essential state. Gate OS and lab reduced
motion, suspend hidden canvases, and handle asset-load failure with this SVG.

## Verification boundary

The offline Chromium preview exercises the actual renderer and pet adapter,
using the locally available React 18.2 harness. It is not the production
React 19 / Vite bundle. Full project tests/builds must be verified by CI, and
native window dragging, transparency, real receipts and Windows WebView2
behavior require a native smoke test. The visual pass must not be described
as those checks passing. No merge or release is performed by this change.
