# Soft Ash Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Soft ash dark material to the desktop companion, a per-device Light/Dark/System preference, and a one-time first-login theme choice that previews the real workspace.

**Architecture:** Extend the existing per-device appearance seam (`appearance.ts` → vault → root `data-*` → broadcast) with a resolved theme, add one `theme.css` that overrides the already-tokenised surface groups, then audit the remaining hardcoded light values surface by surface. A single `ThemePrompt` component mounts from the existing global overlay stack and blocks the first page guide until it closes.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 3, Tauri 2, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-11-13-ash-dark-theme-and-first-login-choice-design.md`

## Global Constraints

- Soft ash values: canvas `#242527`, navigation `#292a2c`, work surface `#303133`, raised `#393a3d`, inset `#414246`, line `#505256`, line strong `#686b70`, ink `#f0f0ef`, ink soft `#d2d3d6`, muted `#bfc0c3`, faint `#8f9298`, signal `#a8f15b`, signal deep `#8fd24a`, ink on signal `#1d2815`, danger `#f09a93`, danger soft `#3b2b2b`, warning `#e3b15f`, warning soft `#3a3223`, observed `#8fbdd8`, observed soft `#26343c`, focus `#b8e794`.
- Theme preference is per device, stored in the vault beside text and mascot size. Never synced to the account.
- Default is System. System resolves through `prefers-color-scheme` and follows live changes.
- The first-login prompt appears once per device after the first signed-in workspace or administration paint. It never appears during onboarding, over the vault gate, in the floating window, or over another overlay.
- Theme and `themePromptSeen` save in one vault write. A failed choice keeps the prompt open and retryable.
- The web palette, Agent OS theme provider, public site, mascot art, screenshots, and evidence images are not changed.
- Light tokens keep their current values. `faint` never carries text in either theme.
- Text ≥4.5:1; large text, icons, and focus rings ≥3:1. State is never colour-only.
- Respect `prefers-reduced-motion`; remove transitions and entrances while preserving states and geometry.
- No new dependencies. Keep fonts self-hosted.
- Every task ends with its focused test run, typecheck where touched, and one commit.

## Review Focus

- **Corrupt or unknown stored theme** — a bad value must resolve to System, never leave an invalid or missing `data-theme`.
- **OS theme changes while System** — both the main and floating windows must follow without a restart.
- **Prompt competing with onboarding, a guide, or a modal** — only one overlay may own focus; the guide waits for the prompt.
- **Save failure on theme or seen** — the prompt must not close as if the choice landed; Settings must roll back.
- **Hardcoded light values on dark surfaces** — white patches, unreadable labels, or invisible borders on any page, drawer, chart, or chat card.

---

### Task 1: Theme preference model, resolution, and boot paint

**Files:**
- Modify: `desktop/work-os-companion/src/appearance.ts`
- Modify: `desktop/work-os-companion/src/appearance.test.ts`
- Modify: `desktop/work-os-companion/src/App.tsx`
- Modify: `desktop/work-os-companion/src/SettingsPreview.tsx`

**Interfaces:**
- Produces:
  - `type ThemePreference = "light" | "dark" | "system"`
  - `AppearanceSettings = { textSize: TextSize; mascotSize: MascotSize; theme: ThemePreference }`
  - `APPEARANCE_DEFAULTS = { textSize: "small", mascotSize: "large", theme: "system" }`
  - `normalizeAppearance(value): AppearanceSettings`
  - `appearanceFromChange(current, next): AppearanceSettings`
  - `resolveTheme(theme: ThemePreference, prefersDark: boolean): "light" | "dark"`
  - `systemPrefersDark(): boolean`
  - `applyAppearance(appearance, root?, prefersDark?): void`
  - `rememberTheme(theme, storage?): void`
  - `readRememberedTheme(storage?): ThemePreference | null`
  - `applyBootTheme(options?: { root?: HTMLElement | null; storage?: ThemeStorage | null; prefersDark?: boolean }): void`
  - `watchSystemTheme(callback: () => void, match?: ThemeMediaQuery | null): () => void`
  - `type ThemeStorage = Pick<Storage, "getItem" | "setItem">`
  - `type ThemeMediaQuery = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">`
  - `THEME_MIRROR_KEY = "work-os.theme"`

- [ ] **Step 1: Write the failing tests**

Extend `appearance.test.ts` with these assertions. Use a fake storage `{ getItem, setItem }` and a fake matchMedia object `{ matches, addEventListener, removeEventListener }`; do not touch the real `document` or `localStorage`.

```ts
it("defaults a fresh device to System", () => {
  expect(APPEARANCE_DEFAULTS.theme).toBe("system");
  expect(normalizeAppearance({ textSize: "medium" })).toEqual({ textSize: "medium", mascotSize: "large", theme: "system" });
  expect(normalizeAppearance({ theme: "sepia" }).theme).toBe("system");
  expect(normalizeAppearance({ theme: "dark" }).theme).toBe("dark");
});

it("resolves System against the device and leaves an explicit choice alone", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
  expect(resolveTheme("light", true)).toBe("light");
});

it("writes the resolved theme, preference, and color scheme to the root", () => {
  const root = { dataset: {}, style: {} } as unknown as HTMLElement;
  applyAppearance({ textSize: "small", mascotSize: "large", theme: "system" }, root, true);
  expect(root.dataset.theme).toBe("dark");
  expect(root.dataset.themePreference).toBe("system");
  expect(root.style.colorScheme).toBe("dark");
});

it("remembers an explicit choice for the boot paint", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  rememberTheme("light", storage);
  expect(readRememberedTheme(storage)).toBe("light");
  expect(readRememberedTheme({ getItem: () => "sepia" })).toBeNull();
});

it("boots from the mirror, then the OS", () => {
  const root = { dataset: {}, style: {} } as unknown as HTMLElement;
  applyBootTheme({ root, storage: { getItem: () => "dark" }, prefersDark: false });
  expect(root.dataset.theme).toBe("dark");
  const fallback = { dataset: {}, style: {} } as unknown as HTMLElement;
  applyBootTheme({ root: fallback, storage: { getItem: () => null }, prefersDark: true });
  expect(fallback.dataset.theme).toBe("dark");
  expect(fallback.dataset.themePreference).toBe("system");
});

it("watches the system preference and cleans up", () => {
  let listener: (() => void) | null = null;
  const match = { matches: false, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: () => { listener = null; } };
  const stop = watchSystemTheme(() => undefined, match);
  expect(typeof listener).toBe("function");
  stop();
  expect(listener).toBeNull();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/appearance.test.ts`
Expected: FAIL because `theme`, `resolveTheme`, `applyBootTheme`, and the mirror functions do not exist.

- [ ] **Step 3: Implement the model in `appearance.ts`**

Add the theme type to `AppearanceSettings`, normalize unknown values to `"system"`, and extend `appearanceFromChange`. `applyAppearance` resolves System and writes `dataset.theme`, `dataset.themePreference`, and `style.colorScheme`. `applyBootTheme` reads `readRememberedTheme()` first, then `prefersDark`, and writes the same three values without persisting. `watchSystemTheme` registers one `change` listener and returns its cleanup; tolerate a match object without `addEventListener` by returning a no-op cleanup. `rememberTheme` catches storage exceptions. Every browser access is guarded for the node test environment.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd desktop/work-os-companion && npx vitest run src/appearance.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify and commit**

Run: `cd desktop/work-os-companion && npx vitest run src/appearance.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add desktop/work-os-companion/src/appearance.ts desktop/work-os-companion/src/appearance.test.ts desktop/work-os-companion/src/App.tsx desktop/work-os-companion/src/SettingsPreview.tsx
git commit -m "feat(companion): model per-device light, dark, and system themes"
```

---

### Task 2: Vault persistence for theme and prompt history

**Files:**
- Modify: `desktop/work-os-companion/src/vault.ts`
- Create: `desktop/work-os-companion/src/vaultSettings.test.ts`

**Interfaces:**
- Produces:
  - `WorkOsSettings` adds `theme: ThemePreference` and `themePromptSeen: boolean`
  - `mergeWorkOsSettings(current: WorkOsSettings | null, next: Partial<WorkOsSettings>): WorkOsSettings`
  - `saveSettings(settings: { apiBase?; autoCheckUpdates?; voiceHotkey?; textSize?; mascotSize?; theme?: ThemePreference; themePromptSeen?: boolean; recapVoice? })`
- Consumes: `normalizeAppearance`, `APPEARANCE_DEFAULTS`, `ThemePreference` from Task 1.

- [ ] **Step 1: Write the failing merge tests**

```ts
import { describe, expect, it } from "vitest";
import { APPEARANCE_DEFAULTS } from "./appearance";
import { mergeWorkOsSettings } from "./vault";

const base = {
  apiBase: "https://work-os.example", autoCheckUpdates: true, voiceHotkey: true,
  textSize: "small" as const, mascotSize: "large" as const,
  theme: "system" as const, themePromptSeen: false,
};

describe("vault settings", () => {
  it("keeps the theme and prompt history when only text size changes", () => {
    expect(mergeWorkOsSettings({ ...base, theme: "dark", themePromptSeen: true }, { textSize: "medium" }))
      .toMatchObject({ textSize: "medium", theme: "dark", themePromptSeen: true });
  });

  it("writes theme and seen together", () => {
    expect(mergeWorkOsSettings(base, { theme: "light", themePromptSeen: true }))
      .toMatchObject({ theme: "light", themePromptSeen: true });
  });

  it("normalizes a corrupt stored theme to System and seen to false", () => {
    expect(mergeWorkOsSettings({ ...base, theme: "sepia" as never, themePromptSeen: "yes" as never }, {}))
      .toMatchObject({ theme: "system", themePromptSeen: false });
  });

  it("does not mark the prompt seen from an unrelated save", () => {
    expect(mergeWorkOsSettings(base, { mascotSize: "small" }).themePromptSeen).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/vaultSettings.test.ts`
Expected: FAIL because `mergeWorkOsSettings` is not exported.

- [ ] **Step 3: Implement the merge and wire `settings` / `saveSettings`**

`mergeWorkOsSettings` normalizes appearance, keeps booleans when omitted, reads `themePromptSeen === true` (never truthy coercion), and returns the full `WorkOsSettings`. `settings()` uses it with the stored record; in the browser branch return `themePromptSeen: true` so a web preview never prompts. `saveSettings` writes one merged object, so theme and seen share one store write. Export the helper for tests.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/vaultSettings.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/vault.ts desktop/work-os-companion/src/vaultSettings.test.ts
git commit -m "feat(companion): persist the theme per device with the prompt history"
```

---

### Task 3: Theme token block and contrast guard

**Files:**
- Create: `desktop/work-os-companion/src/theme.css`
- Create: `desktop/work-os-companion/src/themeContrast.test.ts`
- Modify: `desktop/work-os-companion/src/main.tsx`

**Interfaces:**
- Consumes: `data-theme="dark"` and `data-theme-preference` from Task 1.
- Produces: CSS variables `--chart-1` … `--chart-8`, and the dark overrides for every existing group.

- [ ] **Step 1: Write the failing contrast and coverage test**

The test reads `theme.css` with `readFileSync`, extracts the dark block with `/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/`, parses `--name: #rrggbb;`, and computes WCAG contrast. Assert:

```ts
const pairs: [string, string, number][] = [
  ["ink", "canvas", 4.5], ["ink", "surface", 4.5], ["ink", "raised", 4.5],
  ["ink-soft", "surface", 4.5], ["muted", "canvas", 4.5], ["muted", "surface", 4.5],
  ["muted", "raised", 4.5], ["danger", "surface", 4.5], ["warning", "surface", 4.5],
  ["observed", "surface", 4.5], ["signal", "surface", 4.5], ["ink-on-signal", "signal", 4.5],
  ["focus", "surface", 3.0],
];
```

Also assert the dark block declares `--dash-ink`, `--sidebar-ink`, `--conversation-ink`, `--tool-ink`, `--ob-line`, `--avatar-ink`, and `--wc-bar`, and that `theme.css` defines all eight chart tokens in both materials. It must fail now because the file does not exist.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts`
Expected: FAIL with ENOENT for `theme.css`.

- [ ] **Step 3: Write `theme.css`**

Start with the light chart tokens on `:root`:

```css
:root {
  --chart-1: #82bd39; --chart-2: #c8845a; --chart-3: #c9b56a; --chart-4: #9a8fbd;
  --chart-5: #668aa0; --chart-6: #983e35; --chart-7: #4f9c86; --chart-8: #b07fa6;
  --focus: #4a7d22;
}
```

Then one dark block. Set the base roles to the Global Constraints values, name the resolved tokens (`--canvas`, `--surface`, `--raised`, `--ink-soft`, `--line-strong`, `--signal-deep`, `--ink-on-signal`, `--danger-soft`, `--warning-soft`, `--observed-soft`), and alias each existing group to the base role. Example for the first member of each group; complete every member listed below:

```css
:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #242527; --surface: #303133; --raised: #393a3d; --inset: #414246;
  --ink: #f0f0ef; --ink-soft: #d2d3d6; --muted: #bfc0c3; --faint: #8f9298;
  --line: #505256; --line-strong: #686b70;
  --signal: #a8f15b; --signal-deep: #8fd24a; --ink-on-signal: #1d2815;
  --danger: #f09a93; --danger-soft: #3b2b2b;
  --warning: #e3b15f; --warning-soft: #3a3223;
  --observed: #8fbdd8; --observed-soft: #26343c;
  --focus: #b8e794;

  --dash-ink: var(--ink); --dash-ink-soft: var(--ink-soft); --dash-muted: var(--muted);
  --dash-faint: var(--faint); --dash-paper: var(--canvas); --dash-card: rgba(48,49,51,.94);
  --dash-card-solid: var(--surface); --dash-inset: var(--inset); --dash-line: var(--line);
  --dash-line-strong: var(--line-strong); --dash-signal: var(--signal);
  --dash-signal-deep: var(--signal-deep); --dash-warning: var(--warning);
  --dash-danger: var(--danger);

  --sidebar-surface: rgba(41,42,44,.98); --sidebar-surface-raised: var(--raised);
  --sidebar-ink: var(--ink); --sidebar-muted: var(--muted); --sidebar-line: var(--line);
  --sidebar-hover: var(--inset); --sidebar-active: var(--inset);
  --sidebar-active-ink: var(--ink); --sidebar-marker: var(--signal-deep);

  --conversation-paper: var(--canvas); --conversation-surface: var(--surface);
  --conversation-ink: var(--ink); --conversation-muted: var(--muted);
  --conversation-line: var(--line); --conversation-focus: var(--focus);

  --tool-ink: var(--ink); --tool-muted: var(--muted); --tool-faint: var(--faint);
  --tool-paper: var(--surface); --tool-inset: var(--inset); --tool-hover: var(--inset);
  --tool-line: var(--line); --tool-line-strong: var(--line-strong);
  --tool-signal: var(--signal); --tool-signal-strong: var(--signal-deep);

  --ob-field: var(--surface); --ob-inset: var(--inset); --ob-line: var(--line);
  --ob-line-strong: var(--line-strong); --ob-hairline: var(--line);
  --ob-ink-soft: var(--ink-soft); --ob-faint: var(--faint);

  --avatar-ink: var(--ink); --avatar-surface: var(--raised); --avatar-signal: var(--signal);

  --wc-bar: rgba(41,42,44,.96); --wc-hover: rgba(255,255,255,.08);
  --wc-menu: var(--raised); --wc-menu-hover: var(--inset);

  --chart-1: #9bd45a; --chart-2: #d99a72; --chart-3: #d9c27a; --chart-4: #b4a6d8;
  --chart-5: #8fb6cc; --chart-6: #d97a70; --chart-7: #79c2b0; --chart-8: #c294bd;
}
```

Do not invent tokens for retired components. The dark block must not set `--text-scale` or `--mascot-scale`.

- [ ] **Step 4: Import it last**

In `main.tsx`, add `import "./theme.css";` after `import "./window-chrome.css";`.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts`
Expected: PASS. Fix token values rather than loosening the floors.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/theme.css desktop/work-os-companion/src/themeContrast.test.ts desktop/work-os-companion/src/main.tsx
git commit -m "feat(companion): add the soft ash token layer and contrast guard"
```

---

### Task 4: The theme prompt component

**Files:**
- Create: `desktop/work-os-companion/src/ThemePrompt.tsx`
- Create: `desktop/work-os-companion/src/theme-prompt.css`
- Create: `desktop/work-os-companion/src/ThemePrompt.render.test.ts`

**Interfaces:**
- Produces:
```ts
export type ThemePromptProps = {
  selected: ThemePreference;
  saving?: boolean;
  error?: string | null;
  onSelect: (theme: ThemePreference) => void;
  onUse: () => void;
  onDismiss: () => void;
};
export default function ThemePrompt(props: ThemePromptProps): JSX.Element
```
- Consumes: `ThemePreference` from Task 1; tokens from Task 3.

- [ ] **Step 1: Write the failing render test**

Use `renderToStaticMarkup` like `AppMenuBar.test.ts`.

```ts
it("renders three named choices, the live preview, and one commit action", () => {
  const markup = renderToStaticMarkup(createElement(ThemePrompt, {
    selected: "system", onSelect: () => undefined, onUse: () => undefined, onDismiss: () => undefined,
  }));
  expect(markup).toContain('role="dialog"');
  expect(markup).toContain("How should Work OS look?");
  expect(markup).toContain("Light");
  expect(markup).toContain("Dark");
  expect(markup).toContain("System");
  expect(markup).toContain("Previewing System");
  expect(markup).toContain("This device is set to");
  expect(markup).toContain("Use System");
  expect(markup.match(/role="radio"/g)).toHaveLength(3);
  expect(markup).toContain('aria-checked="true"');
  expect(markup).toContain("theme-prompt");
});

it("states an error and disables the commit while saving", () => {
  const markup = renderToStaticMarkup(createElement(ThemePrompt, {
    selected: "dark", saving: true, error: "The theme could not be saved.",
    onSelect: () => undefined, onUse: () => undefined, onDismiss: () => undefined,
  }));
  expect(markup).toContain("The theme could not be saved.");
  expect(markup).toContain("Saving");
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain("disabled");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/ThemePrompt.render.test.ts`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Build the component**

One `role="dialog"` labelled by the title and described by the lede. A close button (`aria-label="Close theme preview"`, 32px target), the split light/dark mark, the title, the lede, a `role="radiogroup"` with three `role="radio"` cards, a polite preview line, an error line, and one primary button that reads `Use Light|Dark|System` or `Saving…`. The preview line resolves System through `systemPrefersDark()` so it can say `Previewing System. This device is set to Dark.` The button is disabled only while saving, so an error state is retryable. Each card carries its icon (sun, moon, monitor from `lucide-react`), an `aria-hidden` CSS-only miniature, the name, and the one-line description from the spec. The radiogroup uses roving tabindex: the selected card is `tabIndex={0}`, the others `-1`; arrow keys, Home, and End move selection and preview. Focus the selected card on mount. Backdrop press and the close button call `onDismiss`; Escape is handled by the App's global modal trap, so do not add a second document listener.

- [ ] **Step 4: Write `theme-prompt.css`**

Dialog width `min(560px, calc(100vw - 32px))`, raised surface, 18px radius, 220ms rise + fade. Cards are equal columns on the raised/inset steps, with a filled check disc on the selected card. Miniatures are CSS blocks (rail, content lines) in light, dark, and split variants. At `max-width: 420px` stack the three cards; at 720px and below the overlay uses a 16px inset. Every colour reads a token from `theme.css`. Add a reduced-motion block that removes the entrance and transitions. Import `./theme-prompt.css` in `main.tsx` after `./theme.css`.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/ThemePrompt.render.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/ThemePrompt.tsx desktop/work-os-companion/src/theme-prompt.css desktop/work-os-companion/src/ThemePrompt.render.test.ts
git commit -m "feat(companion): add the first-login theme prompt"
```

---

### Task 5: One-time prompt trigger, live preview, and atomic commit

**Files:**
- Create: `desktop/work-os-companion/src/themePromptState.ts`
- Create: `desktop/work-os-companion/src/themePromptState.test.ts`
- Modify: `desktop/work-os-companion/src/App.tsx`

**Interfaces:**
- Produces: `shouldOpenThemePrompt(input): boolean`
```ts
type ThemePromptGate = {
  signedIn: boolean;
  themePromptSeen: boolean;
  workspaceOnScreen: boolean;
  otherOverlayOpen: boolean;
  hasSession: boolean;
};
```
- Consumes: `ThemePrompt` from Task 4; `applyAppearance`, `rememberTheme` from Task 1; `mergeWorkOsSettings`/`saveSettings` from Task 2.

- [ ] **Step 1: Write the failing gate tests**

```ts
it("opens only for a signed-in workspace with no other overlay", () => {
  expect(shouldOpenThemePrompt({ signedIn: true, themePromptSeen: false, workspaceOnScreen: true, otherOverlayOpen: false, hasSession: true })).toBe(true);
});
it("never reopens once seen, signed out, on a boot screen, or over another overlay", () => {
  const base = { signedIn: true, themePromptSeen: false, workspaceOnScreen: true, otherOverlayOpen: false, hasSession: true };
  expect(shouldOpenThemePrompt({ ...base, themePromptSeen: true })).toBe(false);
  expect(shouldOpenThemePrompt({ ...base, signedIn: false })).toBe(false);
  expect(shouldOpenThemePrompt({ ...base, workspaceOnScreen: false })).toBe(false);
  expect(shouldOpenThemePrompt({ ...base, otherOverlayOpen: true })).toBe(false);
  expect(shouldOpenThemePrompt({ ...base, hasSession: false })).toBe(false);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/themePromptState.test.ts`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the helper and wire App state**

Add `theme`, `themePreview`, `themePromptSeen`, `themePromptOpen`, `themePromptSaving`, `themePromptError`. On the existing settings load, set all of them from the normalized settings and call `applyAppearance`. Add:

```ts
async function chooseTheme(next: ThemePreference, options: { markSeen?: boolean } = {}) {
  const previous = theme;
  setTheme(next);
  setThemePreview(next);
  applyAppearance({ textSize, mascotSize, theme: next });
  rememberTheme(next);
  try {
    await secureState.saveSettings({ theme: next, ...(options.markSeen ? { themePromptSeen: true } : {}) });
    if (options.markSeen) setThemePromptSeen(true);
    void emit(APPEARANCE_EVENT, { textSize, mascotSize, theme: next });
  } catch (value) {
    setTheme(previous);
    setThemePreview(previous);
    applyAppearance({ textSize, mascotSize, theme: previous });
    rememberTheme(previous);
    throw value;
  }
}
```

`selectThemePreview(next)` applies the candidate without persisting or writing the mirror. `dismissThemePrompt()` restores the committed theme, closes, clears the error, sets `themePromptSeen` true optimistically so the trigger cannot re-open it this session, and best-effort saves `themePromptSeen: true`. `useThemePrompt()` sets `themePromptSaving`, saves `{ theme: themePreview, themePromptSeen: true }` in one call, and only on success sets the committed theme, seen, `rememberTheme(themePreview)`, broadcasts, and closes. On failure it clears saving, keeps the dialog open with the preview and the chosen card intact, and sets `themePromptError` from `errorMessage(value, "The theme could not be saved.")` so the same button can retry. The initial `themePromptSeen` state is `true` until settings load, so the prompt cannot flash before the vault answers.

Compute `otherOverlaysOpen` from the current overlay flags, including the task finder and excluding the theme prompt; then `globalOverlaysOpen = otherOverlaysOpen || themePromptOpen`. Keep the finder's own inertness intact. Add the prompt first in `dismissTopLayer`. Add a 600ms trigger effect guarded by `shouldOpenThemePrompt` and a DEV-only `?theme-prompt` override.

- [ ] **Step 4: Mount it in the global overlay stack**

Render `<ThemePrompt selected={themePreview} saving={themePromptSaving} error={themePromptError} onSelect={selectThemePreview} onUse={() => void useThemePrompt()} onDismiss={dismissThemePrompt} />` first in `renderGlobalOverlays`, before `PageGuide`. The guide is blocked through `globalOverlaysOpen`, so it waits and then opens normally.

- [ ] **Step 5: Verify the interaction**

Run: `npx tsc --noEmit` and `npx vitest run src/themePromptState.test.ts src/ThemePrompt.render.test.ts`.
In the browser preview at 1024×768, open `?offline&day=clocked_in&theme-prompt`, confirm the preview repaints, Escape restores the previous theme, `Use Dark` closes and persists, and the page guide opens only after the prompt closes.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/themePromptState.ts desktop/work-os-companion/src/themePromptState.test.ts desktop/work-os-companion/src/App.tsx
git commit -m "feat(companion): show the theme choice once and preview it live"
```

---

### Task 6: Appearance group in Settings

**Files:**
- Modify: `desktop/work-os-companion/src/AppearanceSettings.tsx`
- Modify: `desktop/work-os-companion/src/PersonalSettings.tsx`
- Modify: `desktop/work-os-companion/src/SettingsPreview.tsx`
- Modify: `desktop/work-os-companion/src/App.tsx`
- Create: `desktop/work-os-companion/src/AppearanceSettings.render.test.ts`

**Interfaces:**
- `AppearanceSettings` adds `theme: ThemePreference` and `onTheme: (value: ThemePreference) => void`.
- `PersonalSettingsProps` adds `theme` and `onTheme`.
- The Appearance group renders before Reading & display.

- [ ] **Step 1: Write the failing render test**

```ts
it("renders the theme before reading and display, with the current choice checked", () => {
  const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
    theme: "dark", textSize: "small", mascotSize: "large",
    onTheme: () => undefined, onTextSize: () => undefined, onMascotSize: () => undefined,
  }));
  expect(markup.indexOf("Appearance")).toBeLessThan(markup.indexOf("Reading &amp; display"));
  expect(markup).toContain('aria-label="Theme"');
  expect(markup).toContain('aria-checked="true"');
  expect(markup).toContain(">Dark<");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/AppearanceSettings.render.test.ts`
Expected: FAIL because the props and group do not exist.

- [ ] **Step 3: Implement the group and pass the props**

Use one `Setting` titled `Theme` with detail `Choose how Work OS looks on this device.` and `SettingsChoice<ThemePreference>` with Light, Dark, System. Pass `theme`/`onTheme` through `PersonalSettings` and `SettingsPreview`; in App pass `theme` and `onTheme={(value) => void chooseTheme(value, { markSeen: true }).catch((error) => showError(error, "The theme could not be saved.", "Setting not saved"))}`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd desktop/work-os-companion && npx vitest run src/AppearanceSettings.render.test.ts src/ThemePrompt.render.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/AppearanceSettings.tsx desktop/work-os-companion/src/AppearanceSettings.render.test.ts desktop/work-os-companion/src/PersonalSettings.tsx desktop/work-os-companion/src/SettingsPreview.tsx desktop/work-os-companion/src/App.tsx
git commit -m "feat(companion): add the appearance group to settings"
```

---

### Task 7: Boot paint and the floating companion

**Files:**
- Modify: `desktop/work-os-companion/src/main.tsx`
- Modify: `desktop/work-os-companion/src/AvatarApp.tsx`
- Modify: `desktop/work-os-companion/src/appearance.test.ts` only if a new assertion is needed.

**Interfaces:**
- Consumes: `applyBootTheme`, `applyAppearance`, `watchSystemTheme`, `APPEARANCE_EVENT` from Task 1.
- Produces: both windows follow the stored preference and live OS changes.

- [ ] **Step 1: Add the boot call and the window listeners**

In `main.tsx`, call `applyBootTheme()` before `ReactDOM.createRoot`. In `AvatarApp.tsx`, extend the existing settings load and `APPEARANCE_EVENT` listener to pass `theme` into `normalizeAppearance`/`applyAppearance`, and register `watchSystemTheme` while the preference is System so the orb follows an OS change without relaunch. Clean up on unmount.

- [ ] **Step 2: Add a static guard**

In `visualizations.test.ts`, assert `main.tsx` contains `applyBootTheme` and imports `theme.css` last, and `AvatarApp.tsx` contains `watchSystemTheme`.

- [ ] **Step 3: Run the focused checks**

Run: `cd desktop/work-os-companion && npx vitest run src/visualizations.test.ts src/appearance.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Render both windows**

In the browser, open `?offline&day=clocked_in` with `data-theme` set to dark by the app, then open `?window=avatar&avatar-fixture=recorded-completion` and confirm the bubble adopts the dark surface, not white. Change the OS preference while System is selected and confirm both update.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/main.tsx desktop/work-os-companion/src/AvatarApp.tsx desktop/work-os-companion/src/visualizations.test.ts
git commit -m "feat(companion): paint the boot theme and sync the floating window"
```

---

### Task 8: Dark pass — shell, caption bar, sidebar, My Day

**Files:**
- Modify: `desktop/work-os-companion/src/window-chrome.css`
- Modify: `desktop/work-os-companion/src/sidebar.css`
- Modify: `desktop/work-os-companion/src/styles.css`
- Modify: `desktop/work-os-companion/src/dashboard-overhaul.css`
- Modify: `desktop/work-os-companion/src/workspace-redesign.css`
- Modify: `desktop/work-os-companion/src/theme.css`

- [ ] **Step 1: Replace the caption bar's raw colours with `--wc-*`**

Use `var(--wc-bar)`, `var(--wc-hover)`, `var(--wc-menu)`, `var(--wc-menu-hover)` for the bar, hover, menu, and menu hover. Add light defaults on `:root` in `window-chrome.css` (`--wc-bar: rgba(250,250,246,.96)` etc.) and the dark values already live in `theme.css`. Keep the Windows close-hover red; keep the macOS traffic lights native.

- [ ] **Step 2: Audit the four surface files**

Run `grep -nE '#[0-9a-fA-F]{3,8}'` on each file. Convert every value that carries a surface, text, border, or state role to the nearest token (`--ink`, `--muted`, `--line`, `--paper`, `--surface`, `--surface-raised`, `--signal`, `--danger`, `--warning`). Leave shadows, gradients, and illustration values raw, and add one comment per remaining group explaining why it is not a themed role.

- [ ] **Step 3: Render My Day dark at 1024×768 and 390×844**

Confirm: canvas, rail, caption bar, command surface, counts, focus line, task list, status pills, scrollbars, notification/card surfaces, and the floating share card all read the ash ladder; no white patches; muted text stays readable; the lime progress fill is the only saturated accent.

- [ ] **Step 4: Run the guards**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts src/visualizations.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/window-chrome.css desktop/work-os-companion/src/sidebar.css desktop/work-os-companion/src/styles.css desktop/work-os-companion/src/dashboard-overhaul.css desktop/work-os-companion/src/workspace-redesign.css desktop/work-os-companion/src/theme.css
git commit -m "feat(companion): theme the shell and My Day in soft ash"
```

---

### Task 9: Dark pass — Tasks, drawer, EOD, Settings, modals, notifications

**Files:**
- Modify: `desktop/work-os-companion/src/workspace-redesign.css`
- Modify: `desktop/work-os-companion/src/dashboard-overhaul.css`
- Modify: `desktop/work-os-companion/src/styles.css`
- Modify: `desktop/work-os-companion/src/task-finder.css`
- Modify: `desktop/work-os-companion/src/theme.css`

- [ ] **Step 1: Audit the task surfaces**

Convert table hairlines, row hover/selection, status pills (Pending, In progress, Overdue, Done), drawer, composer, evidence rows, menus, and the task finder to tokens. Selection stays an inset surface plus a neutral outline; no coloured rail. The finder's paper blur becomes the raised dark surface with the same geometry.

- [ ] **Step 2: Audit EOD, Settings, and overlays**

Convert the EOD document, dateline, brief, disclosure, evidence rows; the settings groups/panels/fields/switches; the memory modal, profile modal, notifications panel, flyouts, and receipt cards. Keep danger and amber semantics.

- [ ] **Step 3: Render the task matrix dark**

At 1024×768 and 390×844: Today list, Unfinished, Completed, All tasks, dense rows, empty and filtered-empty, task drawer open, status menu open, task finder open, EOD draft and submitted, Settings, memory modal, notifications panel. Check hover, focus-visible, selected, menu-open, and reduced motion.

- [ ] **Step 4: Run the guards and build**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts src/visualizations.test.ts && npx tsc --noEmit && npm run build`

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/workspace-redesign.css desktop/work-os-companion/src/dashboard-overhaul.css desktop/work-os-companion/src/styles.css desktop/work-os-companion/src/task-finder.css desktop/work-os-companion/src/theme.css
git commit -m "feat(companion): theme tasks, reports, settings, and overlays"
```

---

### Task 10: Dark pass — Insights and charts

**Files:**
- Modify: `desktop/work-os-companion/src/insight-charts.css`
- Modify: `desktop/work-os-companion/src/plan-insights.css`
- Modify: `desktop/work-os-companion/src/insight-dashboard.css`
- Modify: `desktop/work-os-companion/src/InsightCharts.tsx`
- Modify: `desktop/work-os-companion/src/admin/charts.tsx`
- Modify: `desktop/work-os-companion/src/admin/InsightsPage.tsx`
- Modify: `desktop/work-os-companion/src/admin/admin.css`
- Modify: any test that asserts a literal series colour.
- Modify: `desktop/work-os-companion/src/theme.css` only if a token is missing.

- [ ] **Step 1: Replace literal series colours with `var(--chart-1..8)`**

Find every literal series hex (`#82bd39`, `#c8845a`, `#c9b56a`, `#9a8fbd`, `#668aa0`, `#983e35`, and any new ones) and map it to a chart token. Axes, grid lines, and labels use `--line` and `--muted`; tooltips and legends use the raised surface. Keep the observation hue separate.

- [ ] **Step 2: Render the Insights matrix dark**

At 1440×900, 1024×768, and 390×844: KPI strip, daily chart, plan reliability, record mix, closing attention, work rhythm, evidence/context, daily table, and the detail drawer. Confirm every series stays distinct from signal, danger, warning, and observed; exact-value fallbacks and legends remain legible.

- [ ] **Step 3: Run the guards and build**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts src/visualizations.test.ts && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add desktop/work-os-companion/src/insight-charts.css desktop/work-os-companion/src/plan-insights.css desktop/work-os-companion/src/insight-dashboard.css desktop/work-os-companion/src/theme.css
git commit -m "feat(companion): theme insights and chart series"
```

---

### Task 11: Dark pass — chat, onboarding, connect, loading, failure, debug, floating companion

**Files:**
- Modify: `desktop/work-os-companion/src/chat/conversation.css`
- Modify: `desktop/work-os-companion/src/chat/tool-surfaces.css`
- Modify: `desktop/work-os-companion/src/work-os-chat.css`
- Modify: `desktop/work-os-companion/src/adminOtto/adminOtto.css`
- Modify: `desktop/work-os-companion/src/onboarding-form.css`
- Modify: `desktop/work-os-companion/src/onboarding-stage.css`
- Modify: `desktop/work-os-companion/src/loading.css`
- Modify: `desktop/work-os-companion/src/debug.css`
- Modify: `desktop/work-os-companion/src/avatar.css`
- Modify: `desktop/work-os-companion/src/theme.css`

- [ ] **Step 1: Audit chat and tool surfaces**

Convert conversation paper, agent/employee bubbles, tool cards, approval batches, task cards, composer, detached menus, and Admin Otto to the conversation/tool tokens. Keep the mascot art untouched and the orange attention marker intact.

- [ ] **Step 2: Audit first run and the companion window**

Convert the onboarding stage and form, connect screen, loading bench, vault failure, debug window, and the floating bubble/orb. The loading surface must use the ash ladder, not a second navy. The avatar bubble uses `--avatar-surface`, `--avatar-ink`, `--avatar-signal`; the art stays.

- [ ] **Step 3: Render the matrix**

At 1024×768 and 390×844: chat open, approval card, next-steps bubble, connect, onboarding step, loading, vault failure, debug trace, floating window with the recorded-completion fixture. Confirm no white patches, legible muted text, and the same focus/selection language.

- [ ] **Step 4: Run the guards and build**

Run: `cd desktop/work-os-companion && npx vitest run src/themeContrast.test.ts src/visualizations.test.ts && npx tsc --noEmit && npm run build`

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/chat/conversation.css desktop/work-os-companion/src/chat/tool-surfaces.css desktop/work-os-companion/src/work-os-chat.css desktop/work-os-companion/src/adminOtto/adminOtto.css desktop/work-os-companion/src/onboarding-form.css desktop/work-os-companion/src/onboarding-stage.css desktop/work-os-companion/src/loading.css desktop/work-os-companion/src/debug.css desktop/work-os-companion/src/avatar.css desktop/work-os-companion/src/theme.css
git commit -m "feat(companion): theme chat, first run, and the floating window"
```

---

### Task 12: Blueprint, changelog, and static guards

**Files:**
- Modify: `design.md`
- Modify: `desktop/work-os-companion/CHANGELOG.md`
- Modify: `desktop/work-os-companion/src/visualizations.test.ts`

- [ ] **Step 1: Update the blueprint**

In `design.md` §3.1, replace the provisional graphite reference with the Soft ash table and the surface ladder. Rename §8.6 to Appearance settings and add the theme preference above text size and mascot size. Add the first-login prompt contract to §8 (one prompt per device, System default, live preview, no collision with onboarding/guides, atomic save, Settings owns the permanent choice). Update §15's matrix to require both themes.

- [ ] **Step 2: Add the employee-facing changelog line**

`## Unreleased` gets one short bullet: `Work OS now has a dark theme, and you can choose Light, Dark, or System the first time you sign in on this device.` Keep it under the 160-character static limit.

- [ ] **Step 3: Extend the static guards**

In `visualizations.test.ts`, assert `theme.css` is imported after `window-chrome.css`, `ThemePrompt` is mounted in the global overlays, `AppearanceSettings` renders the Appearance group, and the vault settings include `theme` and `themePromptSeen`.

- [ ] **Step 4: Run the focused checks**

Run: `cd desktop/work-os-companion && npx vitest run src/visualizations.test.ts src/themeContrast.test.ts && npx tsc --noEmit`
Also run from the repo root: `node --test test/work-os-desktop-static.test.mts`.

- [ ] **Step 5: Commit**

```bash
git add design.md desktop/work-os-companion/CHANGELOG.md desktop/work-os-companion/src/visualizations.test.ts
git commit -m "docs(companion): document the ash theme and first-login choice"
```

---

### Task 13: Full verification and handoff evidence

**Files:** none unless a verification failure needs a fix.

- [ ] **Step 1: Run the companion and Work OS gates**

```bash
cd desktop/work-os-companion
npx tsc --noEmit
npm test
npm run build
cd ../..
npm run work-os:typecheck
npm run work-os:test
node --test test/work-os-desktop-static.test.mts test/work-os-companion-acl.test.mts
```

Expected: companion 21x files pass, Work OS suite passes with only the 11 opt-in Postgres tests skipped, build passes.

- [ ] **Step 2: Run the rendered matrix**

In both themes, at 1440×900, 1024×768, 720×900, and 390×844, capture and inspect: My Day, Tasks, EOD, Insights, Settings, Administration Overview, connect, onboarding, loading, vault failure, task drawer, task finder, notifications, memory modal, chat and approval cards, command-surface dialog, and the first-login prompt. Include dense, empty, filtered-empty, error, read-only, menu-open, focus-visible, selection, and reduced-motion states. Record the exact surfaces and any deliberate exception.

- [ ] **Step 3: Confirm the prompt contract**

On a fresh vault, confirm the prompt appears once after the workspace paints; System, Light, and Dark each preview live; `Use` persists and broadcasts; Escape and the close control restore and mark seen; a forced save failure keeps the prompt open with an error; the page guide opens after the prompt closes, not underneath it; the floating window follows after commit but does not flicker during preview.

- [ ] **Step 4: Package check**

On Windows, install the candidate build and verify the caption bar, menu, task pages, chat, and the prompt in dark mode. On macOS, verify the native traffic lights, native menu bar, overlay title bar, and the prompt in dark mode. Do not add the release-queue entry before the packaged check passes.

- [ ] **Step 5: Commit any verification fixes**

Only if a check found a defect; use one focused commit per fix and re-run the failed gate.
