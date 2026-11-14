import { describe, expect, it } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  appearanceFromChange,
  applyAppearance,
  applyBootTheme,
  normalizeAppearance,
  readRememberedTheme,
  rememberTheme,
  resolveTheme,
  watchSystemTheme,
} from "./appearance";

describe("appearance", () => {
  it("falls back to the historical rendering for unknown or missing values", () => {
    expect(normalizeAppearance(null)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearance(undefined)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearance({ textSize: "gigantic", mascotSize: 4 })).toEqual(APPEARANCE_DEFAULTS);
  });

  it("keeps exactly the two known choices", () => {
    expect(normalizeAppearance({ textSize: "medium", mascotSize: "small" })).toEqual({ textSize: "medium", mascotSize: "small", theme: "system" });
  });

  it("merges a partial change over the current appearance", () => {
    expect(appearanceFromChange({ textSize: "medium", mascotSize: "large", theme: "dark" }, { mascotSize: "small" }))
      .toEqual({ textSize: "medium", mascotSize: "small", theme: "dark" });
    expect(appearanceFromChange(APPEARANCE_DEFAULTS, {})).toEqual(APPEARANCE_DEFAULTS);
  });

  it("writes both scales onto the document root", () => {
    const root = { dataset: {}, style: {} } as unknown as HTMLElement;
    applyAppearance({ textSize: "medium", mascotSize: "small", theme: "light" }, root);
    expect(root.dataset.textSize).toBe("medium");
    expect(root.dataset.mascotSize).toBe("small");
    expect(root.dataset.theme).toBe("light");
  });

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
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
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

  it("boots when storage access throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage is blocked"); },
    });
    try {
      const root = { dataset: {}, style: {} } as unknown as HTMLElement;
      expect(() => applyBootTheme({ root, prefersDark: true })).not.toThrow();
      expect(root.dataset.theme).toBe("dark");
      expect(root.dataset.themePreference).toBe("system");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("watches the system preference and cleans up", () => {
    let listener: (() => void) | null = null;
    const match = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => { listener = fn; },
      removeEventListener: () => { listener = null; },
    };
    const stop = watchSystemTheme(() => undefined, match);
    expect(typeof listener).toBe("function");
    stop();
    expect(listener).toBeNull();
  });
});
