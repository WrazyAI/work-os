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
    expect(app).toContain("Scheduled progress, your explicit Work OS session, Worktivity observations, and task outcomes remain separate.");
    expect(app).toContain("Worktivity observation");
    expect(styles).toContain(".pulse-provider.active");
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

  it("keeps the application hierarchy and sidebar footer intentional", () => {
    expect(app).toContain("nav-group nav-core");
    expect(app).toContain("nav-group nav-context");
    expect(app).toContain("nav-group nav-settings");
    expect(app).toContain("Plan and complete Nifty work without losing the history behind it.");
    expect(styles).toContain("Settings and shift state form one full-width footer cluster");
    expect(styles).toContain("--ease-product");
    expect(styles).toContain("animation: pageEnter");
  });

  it("treats keyboard and readable secondary text as part of the polish", () => {
    expect(app).toContain("function moveMenuFocus");
    expect(app).toContain('document.body.classList.add("modal-open")');
    expect(app).toContain('event.key === "Escape"');
    expect(app).toContain('event.key !== "Tab"');
    expect(styles).toContain("Finishing-quality accessibility and legibility floor");
    expect(styles).toContain('[role="menuitem"]):focus-visible');
    expect(insightStyles).toContain("Chart labels must remain readable at native Windows scaling");
  });
});
