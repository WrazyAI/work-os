import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const taskSurfaces = readFileSync(resolve(root, "src/taskSurfaces.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const workspaceStyles = readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8");
const insightStyles = readFileSync(resolve(root, "src/plan-insights.css"), "utf8");
const insightChartStyles = readFileSync(resolve(root, "src/insight-charts.css"), "utf8");
const insightCharts = readFileSync(resolve(root, "src/InsightCharts.tsx"), "utf8");
const insightMath = readFileSync(resolve(root, "src/insights.ts"), "utf8");
const planningSession = readFileSync(resolve(root, "src/PlanningSession.tsx"), "utf8");

describe("operational visualizations", () => {
  it("keeps schedule, activity, and outcomes visibly separate", () => {
    expect(app).toContain("Clock in when you begin. Activity observation stays separate.");
    expect(app).toContain("Worktivity observation");
    expect(workspaceStyles).toContain(".pulse-provider-popover.active");
    expect(app).toContain("Observed time and planned commitments · separate scales, named in the legend");
    expect(insightChartStyles).toContain("Every series keeps its own scale");
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
    expect(styles).toMatch(/\.task-state\.open[\s\S]*#edf0ea/);
    expect(styles).toMatch(/\.task-state\.complete[\s\S]*#e8f4da/);
    expect(styles).toMatch(/\.task-state\.overdue[\s\S]*#fbe7e3/);
    expect(styles).toMatch(/\.task-state\.sync-issue[\s\S]*#fff3d1/);
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
    expect(app).toContain('className="tasks-heading-row"');
    expect(styles).toContain("Settings and shift state form one full-width footer cluster");
    expect(styles).toContain("--ease-product");
    expect(styles).toContain("animation: pageEnter");
  });

  it("keeps agenda planning available independently of attendance", () => {
    expect(app).toContain("Scheduled today");
    expect(app).toContain("Due from yesterday");
    expect(app).toContain('type ComposerMode = "progress" | "agenda"');
    expect(app).toContain('mode={sessionActive && view === "day" ? "progress" : "agenda"}');
    expect(app).toContain('label === "shift.clock_in" && /workday is already closed/i.test(message)');
    expect(app).toContain("Add a task — planning doesn't clock you in…");
    expect(app).toContain("Added from the Work OS daily composer.");
    expect(app).toContain("Share an update or add a task…");
    for (const label of ["Progress", "Completed work", "Blocker", "Priority change", "New task"]) expect(app).toContain(label);
    expect(app).toContain("otto-hero");
    expect(app).toContain("otto-connect");
    expect(app).toContain("otto-celebrate");
    expect(app).not.toContain("CompanionPet");
    expect(workspaceStyles).toContain(".kpi-strip");
    expect(workspaceStyles).toContain(".kpi-card em.kpi-attention");
    expect(workspaceStyles).toContain(".agenda-dock .progress-input-shell");
  });

  it("pins task row columns so the status pill aligns across every row shape", () => {
    expect(app).toContain("function KpiStrip");
    expect(app).toContain("kpiStrip={<KpiStrip");
    expect(app).toContain("kpiStrip?: ReactNode");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .task-state { grid-column: 5;");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .task-due { grid-column: 4;");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .workspace-task-menu { grid-column: 6;");
    expect(styles).toContain("grid-template-columns: 24px minmax(0, 1fr) 64px 104px 76px 30px !important");
  });

  it("keeps focus contextual and task lifecycle actions consistent", () => {
    expect(app).toContain('className={`panel task-agenda-strip');
    expect(app).toContain("agenda-strip-chip");
    expect(app).toContain("Review unfinished work");
    expect(app).toContain("function DashboardTaskCard");
    expect(app).toContain('className="task-check"');
    expect(app).toContain("onEditFocus={openPlanningSession}");
    expect(app).not.toContain('className="panel daily-goal-card"');
    expect(app).toContain("function TaskLifecycleMenu");
    expect(app).toContain("Delete permanently");
    expect(app).toContain("Archive <small>reversible</small>");
    expect(workspaceStyles).toContain(".task-agenda-strip");
    expect(workspaceStyles).toContain(".dashboard-task-menu");
    expect(workspaceStyles).toContain(".goal-composer-panel .composer-goal-suggestion");
    expect(planningSession).toContain("openAnnotationCard");
    expect(planningSession).toContain("SelectionAnnotator");
    expect(planningSession).toContain("AnnotationPopover");
    expect(planningSession).toContain("rectFromElement");
    expect(planningSession).not.toContain("planning-feedback-composer");
    expect(planningSession).not.toContain("editsLocked");
    expect(workspaceStyles).toContain(".selection-annotator");
    expect(workspaceStyles).toContain(".annotation-popover");
    expect(workspaceStyles).not.toContain(".planning-feedback-composer");
    expect(app).toContain("sendPendingTask");
    expect(app).toContain("function PendingTaskControls");
    expect(app).toContain("retryPendingTask");
    expect(app).toContain("dismissPendingTask");
    expect(app).toContain("pending_status");
    expect(app).toContain("goal-retry");
    expect(planningSession).toContain("planning-loading");
    expect(planningSession).toContain("Wave");
    expect(workspaceStyles).toContain(".pending-indicator");
    expect(workspaceStyles).toContain(".pending-retry");
    expect(workspaceStyles).toContain(".goal-retry");
    expect(planningSession).toContain("Review commitments");
    expect(planningSession).toContain("Your daily commitments are confirmed.");
    expect(planningSession).toContain("queued locally");
    expect(planningSession).toContain("Your plan was not saved.");
    expect(planningSession).toContain("planning-clarification-");
    expect(planningSession).toContain("clarificationAnswers");
    expect(app).toContain("clarification_answers");
    expect(app).toContain("confirm: active");
    expect(workspaceStyles).toContain(".planning-session");
  });

  it("treats keyboard and readable secondary text as part of the polish", () => {
    expect(app).toContain("moveMenuFocus");
    expect(taskSurfaces).toContain("function moveMenuFocus");
    expect(app).toContain('document.body.classList.add("modal-open")');
    expect(app).toContain('event.key === "Escape"');
    expect(app).toContain('event.key !== "Tab"');
    expect(styles).toContain("Finishing-quality accessibility and legibility floor");
    expect(styles).toContain('[role="menuitem"]):focus-visible');
    expect(insightChartStyles).toContain("Chart labels must remain readable at native Windows scaling");
  });

  it("keeps the insights chart kit truthful, accessible, and motion-safe", () => {
    expect(app).toContain("TrendChart");
    expect(app).toContain("FlowDonut");
    expect(app).toContain("HeatmapGrid");
    expect(app).toContain("OnTimeBar");
    expect(app).toContain("DeltaBadge");
    expect(app).toContain("UpdateKindChart");
    expect(app).toContain("ConsistencyChips");
    expect(app).toContain("BarBreakdown");
    expect(app).toContain("TrackedBars");
    expect(app).toContain("ScrollFadeRegion");
    expect(insightCharts).toContain('role="img"');
    expect(insightCharts).toContain("aria-label");
    expect(insightCharts).toContain("No dated outcomes");
    expect(app).toContain("Undated work is never classified either way");
    expect(insightChartStyles).toContain("prefers-reduced-motion");
    expect(insightChartStyles).toContain(".trend-chart-table");
    expect(insightChartStyles).toContain(".heatmap-cell.bucket-4");
    expect(insightMath).toContain('completed: "Outcomes completed"');
    expect(insightMath).toContain('label: "Blockers"');
  });

  it("keeps every chart flat, split, and bounded instead of vertically scrolled", () => {
    expect(insightChartStyles).toContain(".heatmap-scroll");
    expect(insightChartStyles).toMatch(/\.heatmap-scroll \{[\s\S]*overflow-y: clip/);
    expect(insightChartStyles).toContain(".scroll-fade-region");
    expect(insightChartStyles).toContain(".insight-split.mirror");
    expect(insightChartStyles).toContain(".scroll-fade-strip.top");
    expect(insightCharts).toContain("useScrollEdges");
    expect(insightCharts).toContain("trendLineSegments");
    expect(insightCharts).toContain("trendAxis");
    expect(insightCharts).toContain("heatmapColumns");
    expect(insightCharts).toContain("sharePercent");
    expect(app).toContain("maxHeight={360}");
    expect(app).toContain("maxHeight={320}");
    expect(app).toContain('className="insight-split mirror"');
    expect(readFileSync(resolve(root, "src/ScrollFadeRegion.tsx"), "utf8")).toContain('role="region"');
  });

  it("renders the grounded synthesis as bold-labelled short paragraphs with an evidence fallback", () => {
    const synthesisCard = readFileSync(resolve(root, "src/InsightSynthesis.tsx"), "utf8");
    expect(app).toContain("<InsightSynthesisCard state={synthesis} onSynthesize={synthesize} />");
    expect(synthesisCard).toContain('<ChatMarkdown text={state.text} />');
    expect(synthesisCard).toContain('state.mode === "evidence"');
    expect(synthesisCard).toContain("showing the exact fact record instead");
    expect(synthesisCard).toContain("every figure is checked against the record");
    expect(synthesisCard).not.toContain("Selects only from the verified facts below");
  });
});
