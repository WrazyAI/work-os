import { describe, expect, it } from "vitest";
import { APPEARANCE_DEFAULTS, appearanceFromChange, applyAppearance, normalizeAppearance } from "./appearance";

describe("appearance", () => {
  it("falls back to the historical rendering for unknown or missing values", () => {
    expect(normalizeAppearance(null)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearance(undefined)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearance({ textSize: "gigantic", mascotSize: 4 })).toEqual(APPEARANCE_DEFAULTS);
  });

  it("keeps exactly the two known choices", () => {
    expect(normalizeAppearance({ textSize: "medium", mascotSize: "small" })).toEqual({ textSize: "medium", mascotSize: "small" });
  });

  it("merges a partial change over the current appearance", () => {
    expect(appearanceFromChange({ textSize: "medium", mascotSize: "large" }, { mascotSize: "small" })).toEqual({ textSize: "medium", mascotSize: "small" });
    expect(appearanceFromChange(APPEARANCE_DEFAULTS, {})).toEqual(APPEARANCE_DEFAULTS);
  });

  it("writes both scales onto the document root", () => {
    const root = { dataset: {} } as unknown as HTMLElement;
    applyAppearance({ textSize: "medium", mascotSize: "small" }, root);
    expect(root.dataset.textSize).toBe("medium");
    expect(root.dataset.mascotSize).toBe("small");
  });
});
