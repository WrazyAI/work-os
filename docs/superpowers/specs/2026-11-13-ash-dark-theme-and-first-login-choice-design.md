# Ash dark theme and first-login theme choice

Date: 2026-11-13
Status: approved design, not yet implemented
Surfaces: desktop companion first; web Work OS workspace follows

## 1. Intent

Work OS has one material: warm ivory paper, near-black green ink, and a rare
signal lime. This adds a second material — **Soft ash** — that preserves every
semantic role on a neutral graphite ground, and lets each device choose Light,
Dark, or System the first time it meets the update.

The theme is a re-material, not an inversion. Surface hierarchy comes from
luminance steps, not borders or glow. The signal lime remains the only
saturated accent; danger, warning, and observed keep their meanings.

The first-login choice is a one-time product moment, not a setting buried in a
list: the workspace itself repaints while the employee tries each option, and
one action commits it.

## 2. Decisions already made

- **Material:** Soft ash (the middle of the three studied palettes).
- **Choices:** Light, Dark, System. System follows the device live.
- **Default:** System, so a new device matches the operating system before the
  employee decides.
- **Storage:** per device, in the existing local vault settings, beside text
  size and mascot size. Never synced to the account.
- **Prompt cadence:** one prompt per device on the first signed-in workspace
  paint after this build. No sign-out or re-login required.
- **Scope order:** this plan changes the desktop companion only, including the
  floating window, onboarding, connect, loading, and the debug window.
- **Not in scope:** the web workspace, the Agent OS shell theme, the public
  marketing site, per-page themes, scheduled light/dark switching, recolouring
  mascot art, screenshots, or evidence images.
- **Web note:** the web already ships its own dark material and the Agent OS
  host owns a binary light/dark toggle. Soft ash is a different, lighter
  material, so adopting it on the web (or aligning the two) is a separate
  decision and a separate plan. This document does not change the web palette,
  the host theme provider, or the web's storage.

## 3. Material

### 3.1 Soft ash roles

| Role | Value | Notes |
|---|---|---|
| canvas | `#242527` | outer application ground |
| navigation | `#292a2c` | rail and caption bar |
| work surface | `#303133` | command surface, list panel, settings panel |
| raised | `#393a3d` | dialogs, menus, fields, drawers |
| inset | `#414246` | grouped rows, hover, selected peer |
| line | `#505256` | hairlines and default borders |
| line strong | `#686b70` | focused surface outline |
| ink | `#f0f0ef` | headings and body |
| ink soft | `#d2d3d6` | strong secondary text |
| muted | `#bfc0c3` | metadata and helper text |
| faint | `#8f9298` | icons and non-text only; never body text |
| signal | `#a8f15b` | primary action, progress, current state |
| signal deep | `#8fd24a` | signal icon and progress on dark |
| ink on signal | `#1d2815` | labels on a signal fill |
| danger | `#f09a93` | error and destructive text |
| danger soft | `#3b2b2b` | danger surface |
| warning | `#e3b15f` | aging work and recoverable warning |
| warning soft | `#3a3223` | warning surface |
| observed | `#8fbdd8` | Worktivity and provider observation |
| observed soft | `#26343c` | observation surface |
| focus | `#b8e794` | focus ring on dark (≥3:1) |
| shadow | `rgba(0, 0, 0, 0.42)` | raised and floating surfaces |

The light material keeps its current values. Every unchanged light token is
still the reference; the dark block overrides the same names.

### 3.2 Surface ladder

Four steps, always used in this order:

```
navigation #292a2c  <  work surface #303133  <  raised #393a3d  <  inset #414246
canvas #242527 sits below the navigation and work-surface steps
```

A dialog is always one step above the surface it covers. A menu is the raised
step. Hover is the inset step or a 4–7% white wash, never a new colour.

Borders stay hairline. No dark surface uses a coloured edge as decoration. The
one sanctioned colour edge remains the focused/selected outline.

### 3.3 Semantic colour rules

- Signal lime means action, progress, or current state only.
- Danger, warning, and observed keep their light-theme meanings and never
  become decorative.
- The observed blue stays cool and distinct from signal.
- `faint` never carries text; it is for icons, spines, and unavailable marks.
- Charts use a theme-aware categorical set, not the light hues on graphite.

## 4. Theme contract

### 4.1 Preference and resolution

```ts
type ThemePreference = "light" | "dark" | "system";
```

`appearance.ts` owns the type, defaults, normalization, resolution, and the
`applyAppearance` seam. `AppearanceSettings` gains `theme`; unknown or missing
stored values normalize to `"system"`.

`applyAppearance` resolves System against `prefers-color-scheme` and writes the
resolved value to the root:

- `documentElement.dataset.themePreference` — the stored choice
- `documentElement.dataset.theme` — `"light"` or `"dark"`
- `documentElement.style.colorScheme` — the resolved value, so native
  controls, scrollbars, and form widgets follow

A `matchMedia("(prefers-color-scheme: dark)")` listener re-applies when the
device changes while the preference is System. Both windows register it.

### 4.2 Boot paint

The window must not flash the wrong material before the encrypted vault opens.

- `main.tsx` calls a shared `applyBootTheme()` before `createRoot`. It reads a
  best-effort `localStorage` mirror of the preference; when the mirror is
  missing or unreadable it resolves the OS preference.
- The vault remains the source of truth: once settings load, `applyAppearance`
  reconciles the root with the stored value.
- The mirror is written only on an explicit choice. It is not a second source
  of truth and never contains account data.
- The avatar window runs the same boot step before its own render.

`index.html`'s `theme-color` meta is not a substitute for this; the webview
background is painted from the same resolved canvas value.

### 4.3 Persistence and broadcast

`vault.ts` extends `WorkOsSettings` and `saveSettings` with `theme` and
`themePromptSeen`. Both are per-device, like text and mascot size.

Changing the theme applies immediately, persists second, and broadcasts
`APPEARANCE_EVENT` with `{ textSize, mascotSize, theme }`. On a failed save the
visible theme rolls back and the Settings control states the failure. The
floating companion applies the broadcast; it never writes settings itself.

`themePromptSeen` is set when the employee chooses a theme or dismisses the
prompt. A force-quit before either action may show it again; that is acceptable
and never loses a recorded choice.

The prompt's save contract is explicit:

- `theme` and `themePromptSeen` are written in **one** vault settings save, so
  a choice can never be recorded as "seen" without its theme or the reverse.
- If that save fails after `Use Light/Dark/System`, the prompt stays open with
  the preview and the chosen card intact, states that the theme could not be
  saved, and offers retry. It never closes as if the choice had landed.
- Dismissal closes the prompt and writes `themePromptSeen` best-effort. A
  failed write may show the prompt again on the next launch; it never changes
  the theme.
- Choosing a theme in Settings also writes `themePromptSeen` in the same save,
  so an explicit choice made while the prompt was suppressed cannot be
  followed by the prompt later.

## 5. First-login prompt

### 5.1 Contract

- One prompt per device, on the first signed-in workspace or administration
  paint after this build, when `themePromptSeen` is false.
- It never appears on the connect screen, during onboarding, over the vault
  gate, over the debug window, or while another modal, drawer, menu, or the
  task finder owns the screen.
- It outranks the automatic first-visit page guide. The guide's timer waits
  until the prompt closes, then opens normally if it is still due.
- It is not shown in the floating companion window.
- Closing it by the close control, Escape, or a backdrop press keeps the
  current theme (System by default) and marks it seen.
- Choosing `Use Light`, `Use Dark`, or `Use System` applies, persists, marks it
  seen, broadcasts to the floating window, and closes.
- It never blocks the workspace beneath it from painting: the employee sees the
  real page, not a mock.

### 5.2 Composition

A centred dialog on the raised step, inside the workspace's own theme, so it
repaints with the choice:

- A split light/dark mark, the title `How should Work OS look?`, and one
  sentence: `Choose a theme for this device. You can change it any time in
  Settings, under Appearance.`
- Three peer choices as a radio group: **Light** (sun), **Dark** (moon),
  **System** (monitor), each with a small real-surface miniature and one line:
  `Bright and familiar`, `Dim, easy on the eyes`, `Follows your device`.
  The chosen card carries a quiet raised surface and a filled check mark, never
  a coloured rail.
- A live line `Previewing Dark` (`Previewing System. This device is set to
  Dark.`) and one primary `Use Dark` / `Use System` action.
- A close control, Escape, and a backdrop press dismiss without changing the
  stored preference.
- The whole workspace behind the dialog previews the candidate theme while the
  dialog is open. Preview never persists and never broadcasts; only `Use`
  commits.

### 5.3 Behaviour

- Arrow keys move and preview between the three choices; Home/End jump.
- Focus lands on the current choice, is trapped in the dialog, and returns to
  the element that had it when the prompt closes.
- The dialog arrives with an 8px rise and a fade over 220ms using the product
  easing. Surface colours cross-fade over 180ms. Reduced motion removes both
  and preserves every state.
- The dialog is one scroll region at narrow widths, with the choices staying
  side by side until 420px, then stacking if labels would otherwise clip.
- The dialog remains fully operable at 390×844 with no horizontal overflow.

## 6. Settings

A new **Appearance** group sits above Reading & display in the shared Settings
component, so the employee and administration surfaces cannot drift:

- Title: `Appearance`
- Detail: `Choose how Work OS looks on this device.`
- One three-option segmented radio group: Light, Dark, System.
- It applies instantly, persists to the vault, broadcasts to the floating
  window, and states a save failure inline and truthfully.
- It is the permanent home of the choice; the first-login prompt is not
  repeated and is not reachable from Settings.

Reading & display keeps text size and mascot size. Its two choices use the same
segmented-control language as Appearance.

## 7. Surface migration

The theme lands by overriding the existing variable groups, then auditing the
surfaces that still hardcode light values. New or changed themed code must use
tokens, never raw hex.

### 7.1 Seam

Add `src/theme.css`, imported last in `main.tsx` after every surface stylesheet.
It defines one `:root[data-theme="dark"]` block for the base roles and for each
existing component group:

- base: `--ink`, `--ink-soft`, `--muted`, `--line`, `--line-strong`, `--paper`,
  `--white`, `--surface`, `--surface-raised`, `--signal`, `--signal-strong`,
  `--danger`, `--focus`, shadows.
- dashboard: `--dash-*` (dashboard-overhaul.css)
- sidebar: `--sidebar-*` (sidebar.css)
- chat: `--conversation-*` (chat/conversation.css)
- tool cards: `--tool-*` (chat/tool-surfaces.css)
- onboarding: `--ob-*` (onboarding-form.css)
- floating companion: `--avatar-*` (avatar.css)
- window chrome: `--wc-*` (window-chrome.css)

Each group keeps its own names; the dark block maps the same roles onto the ash
ladder. The file is the one place to audit the palette.

### 7.2 Per-surface checklist

- **Shell and caption bar** — canvas, rail, hairlines, menu, hover, focus. The
  Windows close-hover stays red; macOS traffic lights stay native. The bar
  reads `color-scheme: dark` so native menus and scrollbars match.
- **Sidebar** — surface, raised, ink, muted, hover, active, marker. The active
  destination keeps a quiet inset surface, not a new colour.
- **My Day** — command surface, counts, focus line, task list, footers. The
  lime progress fill is unchanged; danger and warning adopt the dark text-safe
  values.
- **Tasks and task drawer** — table hairlines, status pills, selection, menus,
  drawer, composer, evidence rows. Selection stays an inset surface plus a
  neutral outline; no coloured rail.
- **EOD** — document surface, dateline, brief, disclosure, evidence rows,
  submitted confirmation.
- **Insights** — KPI strip, banded cards, chart axes/grid, chart categorical
  hues, legends, table. Exact-value fallbacks and observation blue unchanged in
  meaning.
- **Settings** — groups, panels, fields, switches, segmented controls, profile
  and memory modals.
- **Chat** — conversation paper, agent and employee bubbles, tool cards,
  composer, approval batches, task cards, detached menus.
- **Onboarding and connect** — stage, panel, fields, supplied values, journey
  rail, validation, footer bar.
- **Loading and vault failure** — the First Light bench, stage line, recovery
  actions. The existing night surface is already dark; it must match the ash
  ladder rather than introduce a second navy.
- **Notifications and flyouts** — surfaces, badges, amber attention, scroll
  edges.
- **Debug window** — its own dark surface and dense rows, since it shares the
  app's tokens.
- **Floating companion** — bubble and orb surfaces, ink, line, signal; mascot
  art is untouched. The orb keeps its one orange attention marker.

### 7.3 Hardcoded values

A per-file audit converts only values that carry a surface, text, border, or
state role. Shadows, gradients, and one-off illustration values may remain raw
where they are not on a themed surface, but they must be listed in the audit.

The dev-only galleries (`task-design-gallery.css`) and marketing pages are out
of scope.

## 8. Charts

Add `--chart-1` … `--chart-8` to both materials. The light values stay the
current series hues; the dark set is chosen for equal legibility on `#303133`
and for staying distinct from signal, danger, warning, and observed.

Axes, grid lines, and labels read `--line` and `--muted`. Tooltips and legends
use the raised surface. Observation keeps its cool hue. Exact-value fallbacks
and the no-productivity-score rule are unchanged.

## 9. Motion and accessibility

- Surface colour changes: 180ms, product easing.
- Prompt entrance: 220ms rise + fade; backdrop fades with it.
- Choice hover: the existing 2px lift; selected state is a border/surface
  change, never a colour flash.
- Reduced motion removes the entrance, the hover lift, and colour transitions,
  while preserving the states and geometry.
- Contrast floor: body and metadata text ≥4.5:1; large text and icons ≥3:1;
  focus ring ≥3:1; hairlines may be below 3:1 because they are not the only
  boundary. A unit test asserts the token pairs, not a screenshot.
- The test asserts every **dark** text pair and every light pair that already
  meets the floor. It does not change the light material: `faint` stays
  non-text in both themes, and the light `faint`/`warning` gaps documented in
  `design.md` §3.1 stay on an explicit allowlist rather than being silently
  "fixed" by this feature.
- State is never conveyed by colour alone: pills keep text labels, selection
  keeps an outline plus a check, and the prompt's selected card has a check.

## 10. Verification

### 10.1 Automated

- `appearance.test.ts`: normalization, System resolution, apply writes
  `data-theme`, `data-theme-preference`, and `color-scheme`.
- `theme.test.ts`: every token pair meets its contrast floor; dark tokens exist
  for every themed group; no duplicate/invalid hex.
- `ThemePrompt` render test: three choices, default System, preview label,
  commit, dismiss, Escape, focus trap, reduced-motion class.
- Existing companion suites, typecheck, production build, desktop static, ACL.

### 10.2 Rendered

At 1440×900, 1024×768, 720×900, and 390×844, in Light and Dark:

- My Day, Tasks, EOD, Insights, Settings, Administration Overview.
- Connect, onboarding, loading, vault failure.
- Task drawer, task finder, notifications, memory modal, chat and approval
  cards, command surface dialog, first-login prompt.
- Dense, empty, filtered-empty, error, and read-only states.
- Hover, focus-visible, selected, menu-open, drawer-open, and reduced motion.
- No horizontal overflow, clipped labels, uncovered controls, or light
  surfaces left on a dark page.

Packaged checks: Windows dark mode and first-login prompt; macOS dark mode with
native traffic lights, native menu bar, and the overlay title bar.

### 10.3 Truthfulness

Sample data in the study is fictional. The shipped prompt uses the real
workspace, real settings, and the real vault. No screenshot or recorded guide
film is recoloured or regenerated for the theme.

## 11. Rollout

- The theme is a companion outcome. Add it to the release queue only after a
  packaged Windows check (and the macOS check when a Mac is available).
- The first-login prompt is part of the same outcome, not a separate one.
- The web workspace is a second outcome only if it ships separately.

## 12. Builder calls made during review

- **Web stays untouched.** The web palette and Agent OS theme provider are not
  part of this plan; the desktop is the deliverable.
- **Light stays untouched.** The contrast test covers the dark material and the
  already-compliant light pairs; the light `faint`/`warning` gaps keep their
  existing allowlist.
- **Prompt saves are atomic.** Theme and seen are one save; a failed choice
  keeps the dialog open and retryable.
- **Boot mirror is `localStorage`.** It is the only store readable before the
  vault opens; the vault still wins when it loads.
- **Prompt placement follows the existing overlay stack.** It mounts from the
  same place as the other global overlays, so priority and focus restoration
  stay in one system.

One call is still left to the builder: the exact dark chart hue count. The
per-person stacked series may need a ninth hue; decide from the real chart
inventory and keep every series distinct from signal, danger, warning, and
observed.
