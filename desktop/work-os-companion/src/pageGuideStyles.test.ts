import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

describe("page guide interaction styles", () => {
  it("keeps every dismissal/control target at least 40px", () => {
    expect(styles).toMatch(/\.task-modal\.guide-modal > header button \{[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.task-modal\.guide-modal > footer \.primary \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-quiet-action \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-step-control \{[\s\S]*?min-height:\s*40px;/);
  });

  it("has bounded guide motion and a reduced-motion override", () => {
    expect(styles).toMatch(/\.guide-phase[\s\S]*?transition:/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guide-phase/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guide-step-control/);
  });
});
