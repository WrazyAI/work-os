import { describe, expect, it } from "vitest";
import { GUIDE_VIEWS } from "./guideState";
import { PAGE_GUIDES } from "./guides";

describe("page guide registry", () => {
  it("covers every guided page with two or three short steps", () => {
    for (const view of GUIDE_VIEWS) {
      const guide = PAGE_GUIDES[view];
      expect(guide, `missing guide for ${view}`).toBeTruthy();
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.promise.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThanOrEqual(2);
      expect(guide.steps.length).toBeLessThanOrEqual(3);
      for (const step of guide.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.body.trim().length).toBeGreaterThan(0);
      }
      expect(new Set(guide.steps.map((step) => step.title)).size).toBe(guide.steps.length);
    }
    expect(Object.keys(PAGE_GUIDES).sort()).toEqual([...GUIDE_VIEWS].sort());
  });
});
