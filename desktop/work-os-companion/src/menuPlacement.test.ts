import { describe, expect, it } from "vitest";
import { computeMenuPlacement } from "./menuPlacement";

const viewport = { width: 1440, height: 900 };

describe("computeMenuPlacement", () => {
  it("opens below a trigger in the middle of the viewport", () => {
    const result = computeMenuPlacement({
      trigger: { top: 400, bottom: 430, left: 1000, right: 1030 },
      menu: { width: 196, height: 180 },
      viewport,
    });
    expect(result.placement).toBe("down");
    expect(result.top).toBe(436);
  });

  it("flips above when there is no room below", () => {
    const result = computeMenuPlacement({
      trigger: { top: 820, bottom: 850, left: 1000, right: 1030 },
      menu: { width: 196, height: 180 },
      viewport,
    });
    expect(result.placement).toBe("up");
    expect(result.top).toBe(634);
  });

  it("prefers below when both sides are tight and below fits", () => {
    const result = computeMenuPlacement({
      trigger: { top: 440, bottom: 470, left: 1000, right: 1030 },
      menu: { width: 196, height: 420 },
      viewport,
    });
    expect(result.placement).toBe("down");
    expect(result.top).toBe(476);
    expect(result.top + 420).toBeLessThanOrEqual(viewport.height);
  });

  it("clamps horizontally to the viewport edge", () => {
    const result = computeMenuPlacement({
      trigger: { top: 100, bottom: 130, left: 20, right: 50 },
      menu: { width: 300, height: 160 },
      viewport,
    });
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + 300).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("aligns right when the trigger sits at the right edge", () => {
    const result = computeMenuPlacement({
      trigger: { top: 100, bottom: 130, left: 1380, right: 1410 },
      menu: { width: 196, height: 160 },
      viewport,
    });
    expect(result.align).toBe("right");
    expect(result.left).toBe(1410 - 196);
  });
});
