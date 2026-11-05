import { describe, expect, it } from "vitest";
import { placeViewPopover } from "./viewPopover";

const size = { width: 248, height: 196 };

describe("view popover placement", () => {
  it("opens below and clamps to the left and right viewport edges", () => {
    expect(placeViewPopover({ anchor: { left: 2, right: 40, top: 80, bottom: 116 }, size, viewport: { width: 420, height: 700 } }))
      .toMatchObject({ left: 8, top: 124, placement: "below" });
    expect(placeViewPopover({ anchor: { left: 390, right: 420, top: 80, bottom: 116 }, size, viewport: { width: 420, height: 700 } }).left)
      .toBe(164);
  });

  it("opens above when the bottom would clip", () => {
    expect(placeViewPopover({ anchor: { left: 20, right: 58, top: 610, bottom: 646 }, size, viewport: { width: 390, height: 700 } }))
      .toMatchObject({ left: 20, placement: "above" });
  });

  it("caps a menu taller than the viewport and keeps it inside", () => {
    const result = placeViewPopover({ anchor: { left: 12, right: 48, top: 120, bottom: 156 }, size: { width: 300, height: 900 }, viewport: { width: 390, height: 320 } });
    expect(result.height).toBe(304);
    expect(result.top).toBe(8);
    expect(result.left).toBeGreaterThanOrEqual(8);
  });

  it("works at zoom-equivalent narrow widths", () => {
    const result = placeViewPopover({ anchor: { left: 200, right: 236, top: 40, bottom: 76 }, size, viewport: { width: 280, height: 600 } });
    expect(result.width).toBe(248);
    expect(result.left).toBe(24);
    expect(result.top).toBe(84);
  });
});
