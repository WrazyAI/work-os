import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const workspaceStyles = readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8");
const insightStyles = readFileSync(resolve(root, "src/plan-insights.css"), "utf8");

describe("operational visualizations", () => {
  it("keeps schedule, activity, and outcomes visibly separate", () => {
    expect(app).toContain("Clock in when you begin. Activity observation stays separate.");
    expect(app).toContain("Worktivity observation");
    expect(workspaceStyles).toContain(".pulse-provider-popover.active");
    expect(app).toContain("Observed time and task completion · separate scales");
    expect(insightStyles).toContain("truth-preserving trend visualization");
    expect(app).toContain("Observed active time");
    expect(app).toContain("Clocked in");
    expect(app).toContain("Clocked out");
    expect(app).toContain("Last activity");
    expect(app).toContain("Not observed");
    expect(app).toContain('pulse.schedulePhase === "upcoming" ? "Next shift"');
    expect(app).toContain('pulse.schedulePhase === "upcoming" ? "Starts in"');
    expect(workspaceStyles).toContain(".pulse-provider-popover .pulse-provider-facts");
    expect(app).toContain('aria-label="Shift pulse options"');
    expect(app).toContain('role="menuitem"');
    expect(app).not.toContain('className="pulse-stats"');
  });

  it("uses unmistakable task-state semantics", () => {
    expect(styles).toMatch(/\.task-state\.open[\s\S]*#fff3c4/);
    expect(styles).toMatch(/\.task-state\.complete[\s\S]*#eaf5df/);
    expect(styles).toMatch(/\.task-state\.overdue[\s\S]*#fde5e1/);
    expect(app).toContain('className={`task-state ${state}`}');
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

  it("keeps agenda planning available independently of attendance", () => {
    expect(app).toContain("scheduled for today");
    expect(app).toContain("due from yesterday");
    expect(app).toContain('type ComposerMode = "progress" | "agenda"');
    expect(app).toContain('mode={active && view === "day" ? "progress" : "agenda"}');
    expect(app).toContain("Plan ahead · this does not clock you in");
    expect(app).toContain("Added from today’s agenda composer.");
    expect(workspaceStyles).toContain(".pre-shift-agenda-summary .has-due");
    expect(workspaceStyles).toContain(".agenda-dock .progress-input-shell");
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
