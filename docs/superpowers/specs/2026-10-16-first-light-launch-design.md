# First Light — companion launch screen and handoff design

Date: 2026-10-16
Status: draft for builder review
Scope: Work OS desktop companion, pre-app loading surface and its transition
into the workspace. (Web console and in-app loaders are out of scope.)

## 1. Intent

The companion's launch screen works but does not yet carry the premium standard
the product is being rebuilt toward. The landing moment is the first thing an
employee sees, and it currently reads as a utilitarian wait: a stacked title
and paragraph, a generic five-bar equalizer wave, and an abrupt swap into the
workspace.

This design replaces that with **First Light**: Otto works at a bench of light
while the app prepares the day; when the day is genuinely ready, the night
lifts and the workspace rises into place. The bar is emotional, not
functional — the screen must feel composed, intentional, and crafted, in the
spirit of two reference products the owner named: **Raycast** (precise,
technical calm) and **Granola** (warm, editorial restraint).

Direction chosen by the owner from three live mockups (Terminal Composure,
First Light, The Handoff): **First Light**. Handoff flavor chosen: **Morning
Rise** (B1). When the owner watched the two handoff variants, the difference
was hard to read because both exits compressed into the same 800ms as the
scene fade. That lesson is folded in below: the handoff now has a distinct
"landing" beat before the exit, so the ready moment is perceptible.

## 2. Design plan

### 2.1 Tokens (existing values, no new palette)

- Night canvas: `#171914` with the existing radial signal glow
  `rgba(168,241,91,.1)` (unchanged from today).
- Bench hairline: `rgba(237,244,238,.16)`, 1px.
- Pulse: signal `#a8f15b`, soft gradient with ~2px blur.
- Title ink: `#f2f4ec`. Stage line: `#8d9187`. (Values already in
  `loading.css`.)

No new colors, no new fonts (Manrope/Inter stack as today), no new assets.
Otto's art and palette are used as configured in `mascot.ts`.

### 2.2 Type and layout

One centered column, generous rhythm:

```
        [ Otto, working pose ]
        ———————————————————————   ← bench (1px hairline), pulse travels it
        Getting your day ready      ← h1, existing 26px Manrope 600
        Opening this device's saved session
```

- The middle paragraph ("Syncing your schedule, tasks, and provider
  context…") is removed. The honest stage line is promoted to carry the
  wait, at 12.5px, under the title.
- The bench is slightly wider than Otto: `clamp(220px, 44vw, 300px)`,
  centered, with generous margin above the title.
- The five-bar equalizer (`Wave`, `loading-wave-large`) is removed from this
  surface. `Wave` remains for in-app major waits (plan drafting etc.).

### 2.3 Principles

1. Otto is the only character; the loader belongs to his world (his bench,
   his light) — never a generic widget.
2. The truthful stage line is the most interesting text on screen; truth is
   the aesthetic. The stage line always states the real boot phase.
3. One ambient motion cue (the pulse) plus the existing stop-motion Otto
   loop; nothing else moves. A slow, low-amplitude glow breath (opacity
   .85↔1 over 6s) keeps the room alive — deliberate, documented, and removed
   under reduced motion.
4. The exit is choreographed, short (≤1s), and truthful: it starts only when
   the next screen is genuinely ready.

### 2.4 Anti-tells (deliberate checks)

- Dark + single lime accent is a known generated-design cluster; here it is
  the product's established pre-app surface with its real signal token and
  the configured mascot, not a stock hero. The composition is anchored by
  the bench metaphor.
- No gradient washes, no tracked uppercase eyebrows, no stray "→" or middle
  dot strings, no equalizer/audio metaphor, no spinner.

## 3. The screen

Rendered by the non-failed branch of `LoadingScreen` (App.tsx). Both call
sites get it: the vault gate (`stage="Opening this device's saved session"`)
and the waiting-for-data state (`stage="Reading your schedule and workday"`).

- Otto: existing `MascotPet isolated agent="working" workday="active"`
  (stop-motion working loop already in `studio-otto.css`).
- Bench loader: new component in `LoadingUi.tsx` (working name `Bench`):
  a decorative, `aria-hidden` hairline with one soft light pulse crossing
  left → right over 3.4s, ease-in-out, then a ~600ms quiet rest before the
  next crossing — the loop breathes instead of zipping back-to-back.
  Purely CSS animation.
- Stage line: `<small>` keeps its existing prop-driven text, becomes
  `role="status"` (polite) so phase changes are announced; the loader carries
  no status role of its own (avoids a second "Loading" announcement — the
  stage line states the real state).
- Entrance: existing shell entrance (320ms, 6px rise) is kept as-is.

## 4. The handoff (Morning Rise)

The boot overlay is **one persistent surface**: the vault gate and the
waiting-for-data state are phases of the same First Light screen, not two
mounts. The vault → data swap changes only the stage line (the persisting
`role="status"` region announces it); Otto's loop, the pulse, and the shell
entrance never restart. The overlay lives at the App level, above whichever
gate branch resolves, and plays the exit only when a non-loading surface
(connect, onboarding, admin, or the workspace) takes over. Returning from
the failure branch after a successful retry is a plain swap, as today.

Exit trigger: the moment a non-loading surface takes over — never a timer,
never a fixed delay. What "takes over" means for the workspace path is the
one open decision (§4.1).

1. **Landing** (≤300ms). The pulse loop is shaped as crossing → rest (§3):
   each crossing fades out over its final stretch, then the bench rests
   quiet for ~600ms. On ready: if the pulse is mid-travel, accelerate it to
   the right end within 300ms (Web Animations API from the current computed
   position) and hold it landed ~150ms; if the bench is already resting,
   exit immediately — the landing already happened. Under reduced motion
   this beat is skipped; if WAAPI is unavailable, fade the pulse in place
   instead.
2. **Rise** (~640ms, product easing `cubic-bezier(.2,.8,.2,1)`). The night
   surface (dark canvas + scene) lifts 8px and fades out, while the workspace
   — already mounted with real content beneath — rises 8px and fades in.
   The exiting overlay is `pointer-events: none` and unmounts when done.

Integrity rules:

- The workspace is interactive the moment it mounts; the exit is presentation
  only. Nothing blocks input or delays data.
- The loading overlay stays mounted during the exit; it is positioned to
  cover the workspace (`position: fixed; inset: 0`) and removed on
  animation completion (or the reduced-motion timeout).
- Boot phases (`boot:*`) remain data-driven and unchanged; ~1s of exit
  presentation never delays them.
- If the app becomes ready before the loading surface ever paints, skip
  straight to the fade; never fabricate a crossing.

Reduced motion: no landing, no transforms. A single ~150ms opacity fade from
the night surface to the workspace.

### 4.1 Open decision: when does the workspace path exit?

The workspace mounts as soon as the onboarding record resolves (today's
swap), but the first day payload can still be in flight, so an immediate
rise can reveal a content-shaped skeleton. Two honest options:

- **Hold for real content (recommended).** The overlay stays until the
  workspace's first real render is possible (day payload present; admin
  path: session and role resolved). The stage line stays truthful the whole
  time — "Reading your schedule and workday" is still exactly what is
  happening — and the rise always reveals the employee's actual day. Slow
  networks hold the night screen longer, which is still a live, honest
  wait.
- **Exit as today.** The rise fires at today's swap and may reveal the
  dashboard skeleton (itself an accepted pattern in the blueprint). The
  swap happens marginally earlier on slow loads.

Pending the owner's call; the builder plan depends on it.

## 5. Copy

- Title: `Getting your day ready` (unchanged).
- Stage lines: unchanged, still passed truthfully from boot state
  (`Opening this device's saved session`, `Reading your schedule and
  workday`).
- The paragraph `Syncing your schedule, tasks, and provider context…` is
  retired on this surface.

## 6. Accessibility

- Bench and pulse: `aria-hidden` decoration; the stage line carries
  `role="status"` for phase changes.
- The h1 remains the single page heading; the failed/recovery branch of the
  screen is untouched (existing buttons, hints, and arming behavior).
- Reduced motion behavior as in §4; nothing essential is conveyed by motion
  alone — title, stage line, and final geometry all state the same thing.

## 7. Files and seams (initial map for the builder)

- `desktop/work-os-companion/src/LoadingUi.tsx` — add the bench loader
  component; keep `Wave`/`FadeArc`/`Skeleton` intact.
- `desktop/work-os-companion/src/loading.css` — bench/pulse styles, glow
  breath, handoff keyframes, `.workspace` entrance revision, reduced-motion
  additions.
- `desktop/work-os-companion/src/App.tsx` — `LoadingScreen` non-failed
  branch renders the new loader and promoted stage line; add one persistent
  boot overlay seam at the App level (both loading call sites render through
  it; exit state + kept-mounted overlay so the exit can play while the next
  screen mounts beneath). Keep the failed branch and `boot:*` marking
  untouched.
- `desktop/work-os-companion/src/LoadingPreview.tsx` — add a `handoff`
  review state (frozen landing + rise) so the exit is reviewable without a
  packaged app; `loading` state updates automatically.
- Tests: extend `loadingUi.render.test.ts` (bench renders; decorative);
  keep `work-os-desktop-static.test.mts` assertions true; add an assertion
  that the launch screen uses the bench loader and no longer renders
  `loading-wave-large`.
- `design.md` — update §9.3 (gate table: wave → bench), §10 (handoff motion
  contract and the bench pulse loop rationale), §13 (pre-app loading surface
  description).
- `desktop/work-os-companion/CHANGELOG.md` — one plain, employee-readable
  entry under Unreleased (release process decides the version and date).

## 8. Goals / non-goals / anti-goals

Goals:

- The launch moment reads as crafted and composed at first glance.
- The exit makes "your day is ready" perceptible without added wait.
- Truth rules hold: real phases, real readiness, honest reduced-motion.

Non-goals:

- No redesign of the failed/recovery branch, ConnectScreen, onboarding, the
  floating avatar window, or the web console.
- No replace of `Wave`/`FadeArc` in other in-app surfaces (possible
  follow-up, not this task).
- No new assets, fonts, or third-party animation runtimes (no Lottie here).

Anti-goals:

- A showy, theatrical, or looping-scene exit; a fake progress bar; any
  fabricated delay; any added motion that survives reduced motion.

## 9. Verification (before completion)

- Renders inspected at companion sizes (wide ~960px, compact ~1024 window
  emulation not applicable — use the LoadingPreview harness at 960/720/390
  content widths), normal + reduced motion, and the handoff mid-frame.
- Vault-failure and offline paths regression-checked (unchanged behavior).
- `npm run work-os:typecheck` and `npm run work-os:test` in the worktree;
  the desktop static surface test reviewed for drift.
- Backend harness is not sufficient for motion; the preview must be rendered
  and watched (screen recording or screenshots at keyframes).
- CodeRabbit review once at batch end; changelog entry written.

## 10. Record of decisions

- Direction: First Light (owner pick from A/B/C; B clicked three times).
- Handoff: Morning Rise (B1). The owner noted B1 and B2 were hard to
  distinguish in the demo; the landing beat in §4 is the fix (my call,
  flagged for review).
- Middle paragraph removed; stage line promoted (validated in mockups).
- Dark → light transition retained (companion keeps its dark pre-app
  surface).
- The mockups used Otto's real art and his real stop-motion loop; the final
  screen must too.
- Builder check (fresh reviewer) raised three questions; two settled as my
  calls: one persistent boot overlay across loading phases with in-place
  stage-line updates (Q1), and the pulse loop's crossing → rest shape with
  the landing rules in §4 (Q3). The workspace-path readiness question (Q2)
  is §4.1 and goes to the owner.
