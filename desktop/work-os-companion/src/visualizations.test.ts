import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const insightStyles = readFileSync(resolve(root, "src/plan-insights.css"), "utf8");

describe("operational visualizations", () => {
  it("keeps schedule, activity, and outcomes visibly separate", () => {
    expect(app).toContain("Scheduled progress is separate from observed activity and task outcomes.");
    expect(app).toContain("Observed time and task completion · separate scales");
    expect(insightStyles).toContain("truth-preserving trend visualization");
  });

  it("shows the human review barrier before provider write-back", () => {
    expect(app).toContain("You are the write barrier.");
    expect(app).toContain("No provider change has been made.");
    expect(app).toContain("What you said");
    expect(styles).toContain(".review-flow");
  });

  it("retains reduced-motion support for chart transitions", () => {
    expect(styles).toContain("prefers-reduced-motion");
  });
});
