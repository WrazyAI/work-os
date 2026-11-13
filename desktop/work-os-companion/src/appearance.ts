/** Per-device appearance preferences: theme, text size, and mascot size.
 *
 * These are accessibility and presentation settings, not workspace state —
 * they belong to the device a person is sitting at and never sync to an
 * account. The default reproduces the historical light rendering and follows
 * the operating system until the employee chooses otherwise. `design.md`
 * §8.6 owns the contract. */
export type TextSize = "small" | "medium";
export type MascotSize = "small" | "large";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface AppearanceSettings {
  /** `small` = the historical text scale, `medium` = 115%. */
  textSize: TextSize;
  /** `large` = the historical mascot scale, `small` = 62%. */
  mascotSize: MascotSize;
  /** `system` follows the device and is the default for a fresh install. */
  theme: ThemePreference;
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = { textSize: "small", mascotSize: "large", theme: "system" };

/** Broadcast the main window emits after a change; the floating companion
 * window listens and re-applies so both windows stay in step. */
export const APPEARANCE_EVENT = "work-os://appearance-changed";

/** Best-effort mirror of the explicit theme choice, readable before the vault
 * opens. The vault is always the source of truth once it loads. */
export const THEME_MIRROR_KEY = "work-os.theme";

export type ThemeReadStorage = Pick<Storage, "getItem">;
export type ThemeStorage = ThemeReadStorage & Pick<Storage, "setItem">;
/** The only media-query shape this module uses: a match flag and one
 * `change` listener. Narrower than MediaQueryList so tests need no DOM. */
export type ThemeMediaQuery = {
  matches: boolean;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
};

/** Coerce stored or broadcast values into the known choices. Unknown or
 * missing values mean the historical default, never the larger setting, and
 * an unknown theme means System rather than a broken root attribute. */
export function normalizeAppearance(value: { textSize?: unknown; mascotSize?: unknown; theme?: unknown } | null | undefined): AppearanceSettings {
  return {
    textSize: value?.textSize === "medium" ? "medium" : "small",
    mascotSize: value?.mascotSize === "small" ? "small" : "large",
    theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "system",
  };
}

export function appearanceFromChange(current: AppearanceSettings, next: Partial<AppearanceSettings>): AppearanceSettings {
  return normalizeAppearance({
    textSize: next.textSize ?? current.textSize,
    mascotSize: next.mascotSize ?? current.mascotSize,
    theme: next.theme ?? current.theme,
  });
}

export function resolveTheme(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

function systemThemeQuery(): ThemeMediaQuery | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)") as unknown as ThemeMediaQuery;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return systemThemeQuery()?.matches === true;
}

function defaultStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Blocked storage can throw from the getter itself.
    return null;
  }
}

export function readRememberedTheme(storage: ThemeReadStorage | null = defaultStorage()): ThemePreference | null {
  try {
    const value = storage?.getItem(THEME_MIRROR_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : null;
  } catch {
    return null;
  }
}

export function rememberTheme(theme: ThemePreference, storage: ThemeStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(THEME_MIRROR_KEY, theme);
  } catch {
    // A missing mirror only costs a correct boot paint; the vault still wins.
  }
}

/** Point the document at the chosen theme and scales. CSS does the rest: every
 * px text size is compiled to `calc(px * var(--text-scale))`, `.otto` reads
 * `--mascot-scale`, and `[data-theme="dark"]` rematerials the surface tokens.
 * Safe to call before paint and in either window. */
export function applyAppearance(appearance: AppearanceSettings, root?: HTMLElement | null, prefersDark = systemPrefersDark()): void {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;
  const resolved = resolveTheme(appearance.theme, prefersDark);
  target.dataset.textSize = appearance.textSize;
  target.dataset.mascotSize = appearance.mascotSize;
  target.dataset.themePreference = appearance.theme;
  target.dataset.theme = resolved;
  target.style.colorScheme = resolved;
}

/** Apply the theme before the first React paint. The mirror prevents a wrong
 * flash for an explicit choice; otherwise the device preference is used. The
 * vault reconciles once its settings load. */
export function applyBootTheme(options: {
  root?: HTMLElement | null;
  storage?: ThemeReadStorage | null;
  prefersDark?: boolean;
} = {}): void {
  const target = options.root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;
  const preference = readRememberedTheme(options.storage === undefined ? defaultStorage() : options.storage) ?? "system";
  const resolved = resolveTheme(preference, options.prefersDark ?? systemPrefersDark());
  target.dataset.themePreference = preference;
  target.dataset.theme = resolved;
  target.style.colorScheme = resolved;
}

/** Follow a live OS theme change while the preference is System. The caller
 * decides whether the current preference should react; this only wires the
 * query and returns its cleanup. */
export function watchSystemTheme(callback: () => void, match: ThemeMediaQuery | null = systemThemeQuery()): () => void {
  if (!match || typeof match.addEventListener !== "function") return () => undefined;
  const listener = () => callback();
  match.addEventListener("change", listener);
  return () => match.removeEventListener("change", listener);
}
