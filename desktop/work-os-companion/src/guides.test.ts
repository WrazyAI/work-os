import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_GUIDE_VIEWS, GUIDE_VIEWS, guideViewForAdminSection } from "./guideState";
import { PAGE_GUIDES } from "./guides";
import type { AdminSection } from "./admin/types";

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

  it("names each administration guide after the section it answers for", () => {
    // The masthead control's accessible name is `How <section title> works`,
    // so the modal's title has to be built from the same section title; both
    // are checked here against the workspace's own label.
    const workspace = readFileSync(new URL("./admin/AdminWorkspace.tsx", import.meta.url), "utf8");
    const sections = [...workspace.matchAll(/(\w+): \{ title: "([^"]+)"/g)].map((entry) => ({
      section: entry[1] as AdminSection,
      title: entry[2]!,
    }));
    expect(sections.length).toBe(ADMIN_GUIDE_VIEWS.length);
    for (const { section, title } of sections) {
      expect(PAGE_GUIDES[guideViewForAdminSection(section)].title).toBe(`How ${title} works`);
    }
  });
});
