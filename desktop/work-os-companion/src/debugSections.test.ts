import { describe, expect, it } from "vitest";
import { DEBUG_SECTIONS, nextDebugSection } from "./debugSections";

describe("debugger rail keyboard order", () => {
  it("walks the rail in reading order and wraps at the ends", () => {
    expect(nextDebugSection("overview", "ArrowDown")).toBe("presets");
    expect(nextDebugSection("presets", "ArrowUp")).toBe("overview");
    expect(nextDebugSection("export", "ArrowDown")).toBe("overview");
    expect(nextDebugSection("overview", "ArrowUp")).toBe("export");
  });

  it("jumps to the first and last destination", () => {
    expect(nextDebugSection("workday", "Home")).toBe(DEBUG_SECTIONS[0].id);
    expect(nextDebugSection("session", "End")).toBe(DEBUG_SECTIONS[DEBUG_SECTIONS.length - 1].id);
  });

  it("leaves other keys alone", () => {
    expect(nextDebugSection("overview", "Enter")).toBeNull();
    expect(nextDebugSection("overview", "Tab")).toBeNull();
  });
});
