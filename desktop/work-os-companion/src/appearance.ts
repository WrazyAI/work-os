/** Per-device appearance preferences: text size and mascot size.
 *
 * These are accessibility settings, not workspace state — they belong to the
 * device a person is sitting at and never sync to an account. The defaults
 * reproduce the historical rendering (100% text, 100% mascot), so nothing
 * moves for anyone until they choose. `design.md` §19.9 owns the contract. */
export type TextSize = "small" | "medium";
export type MascotSize = "small" | "large";

export interface AppearanceSettings {
  /** `small` = the historical text scale, `medium` = 115%. */
  textSize: TextSize;
  /** `large` = the historical mascot scale, `small` = 62%. */
  mascotSize: MascotSize;
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = { textSize: "small", mascotSize: "large" };

/** Broadcast the main window emits after a change; the floating companion
 * window listens and re-applies so both windows stay in step. */
export const APPEARANCE_EVENT = "work-os://appearance-changed";

/** Coerce stored or broadcast values into the two known choices. Unknown or
 * missing values mean the historical default, never the larger setting. */
export function normalizeAppearance(value: { textSize?: unknown; mascotSize?: unknown } | null | undefined): AppearanceSettings {
  return {
    textSize: value?.textSize === "medium" ? "medium" : "small",
    mascotSize: value?.mascotSize === "small" ? "small" : "large",
  };
}

export function appearanceFromChange(current: AppearanceSettings, next: Partial<AppearanceSettings>): AppearanceSettings {
  return normalizeAppearance({ textSize: next.textSize ?? current.textSize, mascotSize: next.mascotSize ?? current.mascotSize });
}

/** Point the document at the chosen scales. CSS does the rest: every px text
 * size is compiled to `calc(px * var(--text-scale))`, and `.otto` reads
 * `--mascot-scale`. Safe to call before paint and in either window. */
export function applyAppearance(appearance: AppearanceSettings, root?: HTMLElement | null): void {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;
  target.dataset.textSize = appearance.textSize;
  target.dataset.mascotSize = appearance.mascotSize;
}
