import { describe, expect, it } from "vitest";
import { addProfileItem, customProfileItem, profileItemsOfKind, removeProfileItem, suggestedProfileItems } from "./profileItems";
import type { ProfileItemKind, WorkProfileItem } from "./types";

const item = (id: string, kind: ProfileItemKind, label: string, source: WorkProfileItem["source"] = "suggested"): WorkProfileItem => ({ id, kind, label, source });

const picked = [item("engineering:responsibility:design-and-implement-software", "responsibility", "Design and implement software")];
const catalog: WorkProfileItem[] = [
  ...picked,
  item("engineering:responsibility:review-and-improve-code", "responsibility", "Review and improve code"),
  item("engineering:deliverable:pull-requests", "deliverable", "Pull requests"),
  item("engineering:evidence:github", "evidence", "GitHub"),
];

describe("profile item pills", () => {
  it("keeps a kind's picked items in order", () => {
    expect(profileItemsOfKind(catalog, "responsibility").map((entry) => entry.label)).toEqual(["Design and implement software", "Review and improve code"]);
    expect(profileItemsOfKind(catalog, "evidence").map((entry) => entry.label)).toEqual(["GitHub"]);
  });

  it("offers only the scope suggestions the group has not picked", () => {
    expect(suggestedProfileItems(picked, catalog, "responsibility").map((entry) => entry.label)).toEqual(["Review and improve code"]);
    expect(suggestedProfileItems(picked, catalog, "deliverable").map((entry) => entry.label)).toEqual(["Pull requests"]);
    expect(suggestedProfileItems(picked, catalog, "evidence").map((entry) => entry.label)).toEqual(["GitHub"]);
  });

  it("treats a label as taken regardless of case or surrounding space", () => {
    expect(suggestedProfileItems([item("x", "responsibility", "  DESIGN and implement software ")], catalog, "responsibility").map((entry) => entry.label))
      .toEqual(["Review and improve code"]);
  });

  it("keeps a catalog pick's own id and never duplicates a label", () => {
    const review = catalog[1];
    const next = addProfileItem(picked, review);
    expect(next.map((entry) => entry.id)).toEqual(["engineering:responsibility:design-and-implement-software", "engineering:responsibility:review-and-improve-code"]);
    expect(addProfileItem(next, { ...review, id: "duplicate" })).toBe(next);
    expect(addProfileItem(next, item("other", "responsibility", "design and implement software"))).toBe(next);
  });

  it("allows the same label under a different kind", () => {
    const next = addProfileItem(picked, item("engineering:evidence:nifty", "evidence", "Design and implement software"));
    expect(next).toHaveLength(2);
  });

  it("removes by id only, so a same-label item in another group survives", () => {
    const items = [item("a", "responsibility", "Maintain technical quality"), item("b", "evidence", "Maintain technical quality")];
    expect(removeProfileItem(items, "a").map((entry) => entry.id)).toEqual(["b"]);
    expect(removeProfileItem(items, "missing")).toEqual(items);
  });

  it("turns your own addition into a bounded user item", () => {
    expect(customProfileItem("responsibility", "  Run customer office hours  ")).toEqual({
      id: "custom:responsibility:run-customer-office-hours",
      kind: "responsibility",
      label: "Run customer office hours",
      source: "user",
    });
    expect(customProfileItem("evidence", "   ")).toBeNull();
    expect(customProfileItem("deliverable", "x".repeat(300))?.label).toHaveLength(120);
  });
});
