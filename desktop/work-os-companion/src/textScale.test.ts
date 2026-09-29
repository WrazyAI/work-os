import { describe, expect, it } from "vitest";
import { scaleTextDeclaration } from "./textScale";

describe("scaleTextDeclaration", () => {
  it("scales pixel font sizes through the text-scale hook", () => {
    expect(scaleTextDeclaration("font-size", "12px")).toBe("calc(12px * var(--text-scale, 1))");
    expect(scaleTextDeclaration("font-size", "10.5px")).toBe("calc(10.5px * var(--text-scale, 1))");
  });

  it("scales the size and fixed line-height inside the font shorthand", () => {
    expect(scaleTextDeclaration("font", '700 8px/1 "Manrope", sans-serif')).toBe('700 calc(8px * var(--text-scale, 1))/1 "Manrope", sans-serif');
    expect(scaleTextDeclaration("font", "800 13px/14px ui-monospace, monospace")).toBe("800 calc(13px * var(--text-scale, 1))/calc(14px * var(--text-scale, 1)) ui-monospace, monospace");
  });

  it("scales fixed line-heights so text never outgrows its leading", () => {
    expect(scaleTextDeclaration("line-height", "16px")).toBe("calc(16px * var(--text-scale, 1))");
  });

  it("leaves non-text properties and font-relative sizes alone", () => {
    expect(scaleTextDeclaration("width", "12px")).toBe("12px");
    expect(scaleTextDeclaration("padding", "0 10px")).toBe("0 10px");
    expect(scaleTextDeclaration("font-size", "1rem")).toBe("1rem");
    expect(scaleTextDeclaration("font-size", "inherit")).toBe("inherit");
    expect(scaleTextDeclaration("font-size", "var(--headline-size)")).toBe("var(--headline-size)");
  });

  it("is idempotent for values that already carry the scale", () => {
    const once = scaleTextDeclaration("font-size", "12px");
    expect(scaleTextDeclaration("font-size", once)).toBe(once);
  });
});
