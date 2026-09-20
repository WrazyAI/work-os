import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const sidebar = readFileSync(resolve(root, "src/SidebarNav.tsx"), "utf8");
const sidebarStyles = readFileSync(resolve(root, "src/sidebar.css"), "utf8");
const avatarApp = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
const chatPreview = readFileSync(resolve(root, "src/ChatPreview.tsx"), "utf8");
const taskSurfaces = readFileSync(resolve(root, "src/taskSurfaces.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const workspaceStyles = readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8");
const insightStyles = readFileSync(resolve(root, "src/plan-insights.css"), "utf8");
const insightChartStyles = readFileSync(resolve(root, "src/insight-charts.css"), "utf8");
const insightCharts = readFileSync(resolve(root, "src/InsightCharts.tsx"), "utf8");
const insightMath = readFileSync(resolve(root, "src/insights.ts"), "utf8");
const planningSession = readFileSync(resolve(root, "src/PlanningSession.tsx"), "utf8");
const memoryPanel = readFileSync(resolve(root, "src/MemorySettings.tsx"), "utf8");
const profileSettings = readFileSync(resolve(root, "src/ProfileSettings.tsx"), "utf8");
const memoryStyles = readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8");
const listShift = readFileSync(resolve(root, "src/listShift.ts"), "utf8");

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
    expect(sidebar).toContain("nav-group nav-core");
    expect(sidebar).toContain("nav-group nav-context");
    expect(sidebar).toContain("nav-group nav-settings");
    expect(sidebar).toContain("initiallyCollapsed = true");
    expect(sidebar).toContain('data-sidebar-collapsed={collapsed ? "true" : "false"}');
    expect(sidebarStyles).toContain("--sidebar-collapsed-width: 68px");
    expect(sidebarStyles).toContain("--sidebar-expanded-width: 208px");
    expect(sidebarStyles).toContain(":has(> .sidebar-nav[data-sidebar-collapsed=\"false\"])");
    expect(app).toContain('className="tasks-heading-row"');
    expect(styles).toContain("Settings and shift state form one full-width footer cluster");
    expect(styles).toContain("--ease-product");
    expect(styles).toContain("animation: pageEnter");
  });

  it("keeps the sidebar focused on navigation instead of an empty chat rail", () => {
    expect(sidebar).toContain('className="sidebar-nav"');
    expect(sidebar).not.toContain('className="rail sidebar-nav"');
    expect(sidebar).not.toContain("sidebar-chats");
    expect(sidebar).not.toContain("Search chats");
    expect(sidebar).not.toContain("No recent chats");
    expect(sidebarStyles).not.toContain(".rail.sidebar-nav");
    expect(sidebarStyles).toContain('.sidebar-nav[data-sidebar-collapsed="false"]');
    expect(sidebarStyles).toContain(".sidebar-row {\n  min-width: 0;");
    expect(sidebarStyles).toContain(".sidebar-footer");
  });

  it("uses the logo and non-navigation surface as the collapsed expand affordance", () => {
    expect(sidebar).toContain("data-sidebar-nav-option");
    expect(sidebar).toContain("data-sidebar-surface-hover");
    expect(sidebar).toContain('if (collapsed) {\n                setCollapsedState(false);');
    expect(sidebar).toContain('aria-label={collapsed ? "Expand sidebar" : "Work OS workspace menu"}');
    expect(sidebar).not.toContain("<PanelLeftOpen size={18}");
    expect(sidebarStyles).toContain(".sidebar-workspace-expand-icon");
    expect(sidebarStyles).toContain('[data-sidebar-surface-hover="true"]');
    expect(sidebarStyles).toContain("width: 28px;");
    expect(sidebarStyles).toContain("padding: 0 8px;");
  });

  it("hides the temporary evidence and shift-status surfaces", () => {
    expect(sidebar).not.toContain('label: "Evidence"');
    expect(sidebar).not.toContain("evidenceEnabled");
    expect(sidebar).not.toContain("sidebar-status");
    expect(sidebarStyles).not.toContain(".sidebar-status");
    expect(app).not.toContain("evidenceEnabled={FEATURES.evidence}");
    expect(app).not.toContain("sidebarStatus");
    expect(sidebarStyles).toContain(".sidebar-footer {\n  flex: 0 0 auto;\n  margin-top: auto;");
  });

  it("makes the account surface reachable from both the masthead and Settings", () => {
    expect(app).toContain('title="Open profile settings"');
    expect(app).toContain('setProfileOpen(true)');
    expect(app).toContain('mode="modal"');
    expect(app).toContain('<span>Workspace settings</span>');
    expect(app).toContain('Open profile settings');
    expect(app).not.toContain('mode="page"');
    expect(profileSettings).toContain("Display name");
    expect(profileSettings).toContain("Account email");
    expect(profileSettings).toContain("Sensitive app or domain exclusions");
    expect(profileSettings).toContain("Screenshot analysis consent");
    expect(app).toContain("new FormData()");
    expect(styles).toContain(".profile-modal");
    expect(styles).toContain(".task-modal-backdrop.profile-backdrop");
    expect(app).toContain('aria-describedby="profile-settings-description"');
    expect(styles).toContain(".profile-editor-actions");
  });

  it("keeps agenda planning available independently of attendance", () => {
    expect(app).toContain("Scheduled today");
    expect(app).toContain("Due from yesterday");
    expect(app).toContain('type ComposerMode = "progress" | "agenda"');
    expect(app).toContain('mode={sessionActive && view === "day" ? "progress" : "agenda"}');
    expect(app).toContain('label === "shift.clock_in" && /workday is already closed/i.test(message)');
    expect(app).toContain("Add a task — planning doesn't clock you in…");
    expect(app).toContain("Added from the Work OS daily composer.");
    expect(app).toContain("Share an update, a blocker, or add a task…");
    for (const label of ["Progress", "Completed work", "Blocker", "Priority change", "New task"]) expect(app).toContain(label);
    expect(app).toContain("otto-hero");
    expect(app).toContain("otto-connect");
    expect(app).toContain("otto-celebrate");
    expect(app).not.toContain("CompanionPet");
    expect(workspaceStyles).toContain(".kpi-strip");
    expect(workspaceStyles).toContain(".kpi-card em.kpi-attention");
    expect(workspaceStyles).toContain(".agenda-dock .progress-input-shell");
  });

  it("keeps the floating companion inside its 400 by 620 window", () => {
    expect(avatarApp).toContain("const AVATAR_EXPANDED = { width: 400, height: 620 };");
    expect(chatPreview).toContain('style={{ width: "min(400px, 100%)", height: 620 }}');
  });

  it("pins task row columns so the status pill aligns across every row shape", () => {
    expect(app).toContain("function KpiStrip");
    expect(app).toContain("kpiStrip={<KpiStrip");
    expect(app).toContain("kpiStrip?: ReactNode");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .task-state { grid-column: 5;");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .task-due { grid-column: 4;");
    expect(workspaceStyles).toContain(".task-records .workspace-task > .workspace-task-menu { grid-column: 6;");
    expect(styles).toContain("grid-template-columns: 24px minmax(0, 1fr) 56px max-content auto 30px !important");
  });

  it("spins the clicked checkbox and drops the row without freezing the list", () => {
    expect(app).toContain("completingTaskIds");
    expect(app).toContain("leavingTaskIds");
    expect(app).toContain('className={`task-check${flight === "completing" ? " is-completing" : ""}`}');
    expect(app).toContain('aria-busy={flight === "completing"}');
    // The old global freeze: no checkbox may gate on the shared busy flag.
    expect(app).not.toContain("disabled={busy || pendingStatus !== null}");
    expect(app).not.toContain("disabled={busy || historical || pendingStatus !== null}");
    expect(workspaceStyles).toContain(".task-check.is-completing");
    expect(workspaceStyles).toContain("task-row-leave");
    expect(workspaceStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps My day open-only and states its counts from the rendered list", () => {
    expect(app).toContain("const openToday = tasks.filter((task) => task.completed !== true);");
    expect(app).toContain("Today <em>{openToday.length}</em>");
    expect(app).toContain("count: myDayTasks.filter((task) => task.completed !== true).length");
    expect(app).toContain("My day is open work only");
  });

  it("draws one animated SVG progress ring everywhere instead of conic rings and tick meters", () => {
    expect(app).not.toContain("conic-gradient(var(--signal) var(--progress)");
    expect(styles).not.toContain(".completion-ring");
    expect(styles).not.toContain(".progress-ticks");
    expect(workspaceStyles).not.toContain(".completion-ring");
    expect(workspaceStyles).not.toContain(".progress-ticks");
    expect(workspaceStyles).toContain(".progress-ring-fill");
    expect(workspaceStyles).toContain("transition: stroke-dashoffset");
  });

  it("measures list shifts from layout positions and plays them once per membership change", () => {
    // A transform-inclusive rectangle re-records the from-keyframe position at
    // animation time 0, which made every later render replay the shift.
    expect(listShift).toContain("element.offsetTop");
    expect(listShift).toContain("element.offsetLeft");
    expect(listShift).not.toContain(".getBoundingClientRect(");
    // Only a real membership change animates; unrelated renders never restart it.
    expect(listShift).toContain("signature.current !== keys");
    expect(listShift).toContain("cancelListShift");
    expect(listShift).toContain('classList.contains("is-leaving")');
  });

  it("swaps an optimistic task into its slot instead of dropping and re-adding the row", () => {
    expect(app).toContain("replaceTaskInCaches");
    expect(app).toContain("insertPendingTaskIntoCaches");
    expect(app).not.toContain("unstable_batchedUpdates");
    expect(app).not.toContain("flushSync");
  });

  it("animates the composer closed and refreshes the open lists after an add", () => {
    expect(app).toContain("function closeTaskComposer");
    expect(app).toContain("closing={taskComposerClosing}");
    expect(styles).toContain(".task-modal-backdrop.is-closing");
    expect(app).toContain("void queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory() });");
    expect(app).toContain("void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });");
  });

  it("keeps focus contextual and task lifecycle actions consistent", () => {
    expect(app).toContain('className={`panel task-agenda-strip');
    expect(app).toContain("agenda-strip-chip");
    expect(app).toContain("Review unfinished work");
    expect(app).toContain("function DashboardTaskCard");
    expect(app).toContain('className={`task-check card-check');
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

  it("keeps the Tasks page layout flat, single-headed, and wrap-proof", () => {
    // The shell masthead owns the page title; the workspace row must not repeat it.
    expect(app).toContain('className="tasks-heading-context"');
    expect(app).not.toContain('<h1>{historical ? "Workday history" : "Tasks"}</h1>');
    expect(workspaceStyles).toContain(".tasks-heading-context");
    expect(workspaceStyles).not.toContain(".tasks-heading-row h1");
    expect(styles).not.toContain(".tasks-page");
    expect(styles).not.toContain(".task-view-tabs");
    expect(styles).not.toContain(".tasks-workspace .page-intro");
    // Chips never wrap inside their pill above 900px; the strip reflows instead.
    expect(workspaceStyles).toMatch(/\.agenda-strip-chips \{[\s\S]*?flex-wrap: nowrap/);
    expect(workspaceStyles).toMatch(/\.agenda-strip-focus \{[\s\S]*?display: flex;[\s\S]*?min-width: 280px;/);
    expect(workspaceStyles).toMatch(/grid-template-areas:[\s\S]*?"focus focus"[\s\S]*?"chips carry"/);
    expect(workspaceStyles).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.agenda-strip-chips \{ flex-wrap: wrap; \}/);
    // Title line never wraps the On today tag onto the metadata line.
    expect(workspaceStyles).toMatch(/\.task-row-line\.primary-line \{[\s\S]*?flex-wrap: nowrap;/);
    expect(workspaceStyles).toMatch(/\.task-row-line\.primary-line > h3 \{[\s\S]*?min-width: 0;/);
    expect(workspaceStyles).toMatch(/\.surfaced-tag \{[\s\S]*?margin-left: auto;/);
    // Completion aligns with the title; the right cluster stays centered.
    expect(workspaceStyles).toContain(".task-records .workspace-task > .task-check { grid-column: 1; align-self: start;");
    expect(workspaceStyles).toContain("align-self: start; margin-top: 1px; }");
    // One frame: the panel is the card, and in-row chips match the meta line.
    expect(workspaceStyles).toMatch(/\.task-records\.evidence-list \{[\s\S]*?border: 0;/);
    expect(workspaceStyles).toContain(".task-row-line.secondary-line .task-assignee-tags > span");
    // The dock matches the content column and never traps a focused row.
    // Clearance is scroll-margin on the scroll targets, not scroll-padding on
    // the scroller: scroll-padding-bottom also drives the browser's caret-reveal
    // scroll for the pinned composer, which nudged the page on every keystroke.
    expect(workspaceStyles).toMatch(/\.stage\.has-dock :not\(\.progress-dock\):not\(\.progress-dock \*\) \{[\s\S]{0,40}?scroll-margin-bottom: 140px;/);
    expect(workspaceStyles).not.toContain("scroll-padding-bottom: 140px;");
    expect(workspaceStyles).toContain("width: min(calc(100% - 48px), 1024px);");
  });

  it("keeps the settings page grouped, sized, and control-consistent", () => {
    expect(app).toContain('className="settings-group"');
    expect(app).toContain('className="settings-group danger"');
    expect((app.match(/<SettingsSwitch/g) ?? []).length).toBe(2);
    expect(app).toContain('from "./SettingsSwitch"');
    expect(readFileSync(resolve(root, "src/SettingsSwitch.tsx"), "utf8")).toContain("export function SettingsSwitch");
    expect(app).not.toContain('<input type="checkbox" checked={autoStart}');
    expect(app).not.toContain('<input type="checkbox" checked={autoCheckUpdates}');
    expect(app).toContain('className="status-chip"');
    expect(app).toContain("Sign out of Work OS?");
    expect(styles).toContain(".settings-group-head");
    // Settings rows are flat, hairline-separated entries on the page — never
    // per-row white cards (and never a second card around them).
    expect(styles).toMatch(/\.setting,[\s\S]*?min-height: 74px;/);
    expect(styles).toMatch(/\.setting,[\s\S]*?border-top: 1px solid var\(--line\);/);
    expect(styles).toMatch(/\.setting,[\s\S]*?background: transparent;/);
    expect(styles).toMatch(/\.setting,[\s\S]*?box-shadow: none;/);
    expect(styles).toMatch(/\.settings-panel \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(styles).toMatch(/\.settings-panel \{[\s\S]*?border: 0;/);
    expect(styles).toContain(".setting-controls");
    // The update row's actions share one control column, so Check and
    // What's new stay adjacent instead of being spread across the row.
    const controlStart = app.indexOf('className="setting-controls"');
    const updateRow = app.slice(controlStart, app.indexOf("</Setting>", controlStart));
    expect(updateRow).toContain("checkForUpdates()");
    expect(updateRow).toContain("setWhatsNew(");
    expect(styles).not.toMatch(/\.evidence-list,\n\.settings-panel \{/);
    expect(styles).toContain(".settings-switch-track");
    expect(styles).toContain(".status-chip.attention");
    expect(styles).toContain(".settings-group.danger");
    expect(styles).not.toContain(".settings-panel .status-dot");
    expect(styles).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.setting,[\s\S]*?flex-direction: column;/);
  });

  it("keeps the memory panel in its own column with three separated classes", () => {
    // The root cause of the interleaved panel was reusing the settings grid.
    expect(memoryPanel).not.toContain("settings-panel");
    expect(memoryPanel).toContain('className="memory-section review"');
    expect(memoryPanel).toContain('className="memory-section facts"');
    expect(memoryPanel).toContain('className="memory-section activity"');
    expect(memoryPanel).toContain("memory-section-head");
    expect(memoryPanel).toContain("memoryDateLabel");
    expect(memoryPanel).toContain("formatWorkOsDate");
    expect(memoryStyles).toMatch(/\.memory-panel \{[\s\S]*?display: grid;/);
    expect(memoryStyles).toContain(".memory-cards");
    expect(memoryStyles).toContain(".memory-rows.feed");
    expect(memoryStyles).toContain(".memory-provenance");
    expect(memoryStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.memory-cards \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
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
