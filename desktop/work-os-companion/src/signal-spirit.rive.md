# Signal Spirit — Rive handoff contract

The React app deliberately speaks in semantic mascot states. The final Rive
asset should preserve this contract so swapping the inline vector renderer for
Rive does not change product code.

## File

- Target: `public/mascot/signal-spirit.riv`
- Artboard: `SignalSpirit`
- State machine: `Companion`
- Fit: contain
- Alignment: center

## Inputs

Prefer a Rive View Model/Data Binding implementation for the production asset.
The equivalent logical inputs are:

| Property | Type | Values |
| --- | --- | --- |
| `activity` | enum/string | idle, working, needs-input, ready, blocked |
| `workday` | enum/string | disconnected, off-shift, active, paused, late, check-in-due, eod-due |
| `hovered` | boolean | pointer/focus proximity |
| `reducedMotion` | boolean | OS/user motion preference |
| `attentionPulse` | trigger | one-shot nudge |
| `celebrate` | trigger | one-shot completion |
| `lookX` | number | -1…1 |
| `lookY` | number | -1…1 |

## Layers

1. **Base locomotion** — idle drift / working float / rest / sleep.
2. **Expression** — eyes, mouth, face squash.
3. **Signal** — beacon, core, glow intensity, alert ping.
4. **Secondary motion** — tail/ribbon, arms, particles.
5. **One-shots** — needs-input nudge and ready celebration.

## Transition principles

- Idle movement is low amplitude and non-repetitive enough to avoid becoming
  visual noise during long sessions.
- Working is visibly active without reading as an error/loading spinner.
- Needs-input performs one clear attention gesture, then settles.
- Ready celebrates once and returns to a proud/quiet hold.
- Blocked should communicate friction, never guilt or sadness.
- Off-shift/sleep reduces luminance and motion.
- Reduced motion keeps expression/state changes but removes translation,
  rotation, particle travel, and repeated pulse loops.

## Runtime strategy

The current `SignalSpirit.tsx` is the fallback renderer and visual prototype.
When the authored file is ready, add the Rive React runtime and implement a
`SignalSpiritRive` renderer with the exact same `MascotRendererProps`.
Then change only `MASCOT.Pet` (and optionally `MASCOT.Mark`) in
`mascot.ts`.
