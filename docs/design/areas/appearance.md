# Appearance and first-login theme choice

**Use when:** Changing theme, text size, mascot size, or the first-login appearance prompt.

**Owns:** Device preferences, named defaults, scaling, and atomic preference saves.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing light/dark token values: [Color, type, and surface tokens](../tokens.md).
- Changing category navigation: [Settings categories and layout](settings.md).
- Changing first-run sequencing: [First run and setup](onboarding.md).

**Implementation starting points:** [AppearanceSettings.tsx](../../../desktop/work-os-companion/src/AppearanceSettings.tsx), [appearance.ts](../../../desktop/work-os-companion/src/appearance.ts), [ThemePrompt.tsx](../../../desktop/work-os-companion/src/ThemePrompt.tsx).

Appearance sits above Reading & display and holds exactly one preference:
**Theme** — `Light`, `Dark`, or `System` (default). It is per-device, applies
instantly in every window, and is remembered locally rather than synced to the
workspace. System resolves through the device preference and follows a live
change. A best-effort local mirror paints the boot theme before the vault
opens; the vault is always the source of truth once it loads.

Reading & display sits below it and holds exactly two preferences. Both are
per-device, apply instantly in every window, and are remembered locally
rather than synced to the workspace:

- **Text size** — `Small` (default) or `Medium`,
  which scales text 15% through one root custom property (`--text-scale`).
  Every px `font-size`, `font` shorthand size, and fixed `line-height` is
  compiled to `calc(px * var(--text-scale))` by the companion's build seam, so
  text scales without moving layout, icons, or spacing.
- **Mascot size** — `Large` (default) or `Small`
  (62% of current). One scale rule over the shared art class follows
  `--mascot-scale`, so every surface — chat marks, the thinking trace, hero
  and EOD art, the connect screen, the dashboard, the memory tile, and the
  floating companion orb — changes together. Only the art scales; labels,
  progress rings, and status text keep their size and legibility.

Both preferences render as a two-option segmented radio group
(`role="radiogroup"` with `role="radio"`, roving tabindex, and arrow keys),
state the current value, and normalize unknown or missing stored values back to
the declared defaults: Text size → Small, Mascot size → Large, and Theme → System. The main window applies
and persists a change (rolling the visible state back if the save fails) and
broadcasts it with `work-os://appearance-changed`; the floating companion
window reads the stored value on boot and follows the broadcast live.

## First-login theme choice

The first signed-in workspace paint after the build that introduces themes
offers the choice once per device, when the stored prompt flag is false:

- Three peer choices — Light, Dark, System — preview against the real
  workspace. The dialog itself uses the chosen material, so the decision is
  seen, not described. Closing without choosing restores the previous theme;
  `Use` commits and broadcasts to the floating window. Preview never persists.
- The prompt is suppressed during onboarding, over the vault gate, over the
  task finder or any other modal, and in the floating window. It outranks the
  automatic first-visit page guide; the guide's timer waits for it to close.
- Theme and the seen flag are written in one vault save. A failed choice keeps
  the dialog open with the preview and a retry; dismissal keeps the current
  theme and writes the seen flag best-effort.
- Settings remains the permanent home of the choice. Choosing there also
  marks the prompt seen, so a choice made while the prompt was suppressed is
  never followed by the prompt later.
