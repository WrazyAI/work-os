import { describe, expect, it } from "vitest";
import { nativeMenuModel } from "./nativeMenuModel";
import { ottoVisibilityLabel, ottoVisibilityMenuItem } from "./ottoVisibility";

describe("Otto visibility menu item", () => {
  it("offers Hide only once the floating window is known visible", () => {
    expect(ottoVisibilityLabel(true)).toBe("Hide Otto");
    expect(ottoVisibilityLabel(false)).toBe("Show Otto");
    // The first read has not landed yet: claiming it is visible would offer a
    // hide the user cannot trust.
    expect(ottoVisibilityLabel(null)).toBe("Show Otto");
  });

  it("keeps the stable view:otto id and forwards selection", () => {
    let selected = 0;
    const item = ottoVisibilityMenuItem(null, () => { selected += 1; });
    expect(item).toMatchObject({ id: "view:otto", label: "Show Otto" });
    expect(() => item.onSelect?.()).not.toThrow();
    expect(selected).toBe(1);
  });

  it("carries the current label into the native menu without changing its id", () => {
    const model = nativeMenuModel([{ label: "View", items: [ottoVisibilityMenuItem(true, () => undefined)] }]);
    expect(model.groups[0]?.items[0]).toMatchObject({ id: "menu:view:otto", label: "Hide Otto", enabled: true });
  });
});
