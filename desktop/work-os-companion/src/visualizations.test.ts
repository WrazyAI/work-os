import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const app = readText(resolve(root, "src/App.tsx"));
const sidebar = readText(resolve(root, "src/SidebarNav.tsx"));
const sidebarStyles = readText(resolve(root, "src/sidebar.css"));
const avatarApp = readText(resolve(root, "src/AvatarApp.tsx"));
const chatPreview = readText(resolve(root, "src/ChatPreview.tsx"));
const taskSurfaces = readText(resolve(root, "src/taskSurfaces.tsx"));
const styles = readText(resolve(root, "src/styles.css"));
const workspaceStyles = readText(resolve(root, "src/workspace-redesign.css"));
const dashboardStyles = readText(resolve(root, "src/dashboard-overhaul.css"));
const insightStyles = readText(resolve(root, "src/plan-insights.css"));
const insightChartStyles = readText(resolve(root, "src/insight-charts.css"));
const insightCharts = readText(resolve(root, "src/InsightCharts.tsx"));
const insightMath = readText(resolve(root, "src/insights.ts"));
const planningSession = readText(resolve(root, "src/PlanningSession.tsx"));
const modalScrollLock = readText(resolve(root, "src/modalScrollLock.ts"));
const memoryPanel = readText(resolve(root, "src/MemorySettings.tsx"));
const profileSettings = readText(resolve(root, "src/ProfileSettings.tsx"));
const memoryStyles = readText(resolve(root, "src/workspace-redesign.css"));
const listShift = readText(resolve(root, "src/listShift.ts"));

describe("operational visualizations", () => {
  it("keeps schedule, activity, and outcomes visibly separate", () => {
    expect(app).toContain("Worktivity owns clock actions; the Windows Companion waits for provider confirmation.");
    expect(app).toContain("Worktivity attendance");
    expect(workspaceStyles).toContain(".pulse-provider-popover.active");
    expect(app).toContain("Observed time and planned commitments · separate scales");
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
    expect(app).toContain("TaskDateNavigator");
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

  it("keeps collapsed rail tooltips above stage cards", () => {
    expect(sidebarStyles).toMatch(/\.sidebar-nav\[data-sidebar-collapsed=\"true\"\]\s*\{[^}]*z-index:\s*100;/s);
    expect(sidebarStyles).toContain('.sidebar-nav[data-sidebar-collapsed="true"] .sidebar-row:hover::after');
    expect(sidebarStyles).toContain('.sidebar-nav[data-sidebar-collapsed="true"] .sidebar-row:focus-visible::after');
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

  it("keeps profile settings reachable, calm, and consistent with the main Settings surface", () => {
    expect(app).toContain('title="Open profile settings"');
    expect(app).toContain('setProfileOpen(true)');
    expect(app).toContain('mode="modal"');
    expect(app).toContain('<span>Workspace settings</span>');
    expect(app).toContain('Identity, schedule, privacy, notifications, and work context.');
    expect(app).toContain('Open profile settings');
    expect(app).not.toContain('mode="page"');
    expect(profileSettings).toContain('title="Identity"');
    expect(profileSettings).toContain('title="Region &amp; time"');
    expect(profileSettings).toContain('title="Workday"');
    expect(profileSettings).toContain('title="Privacy"');
    expect(profileSettings).toContain('title="Work profile"');
    expect(profileSettings).toContain('className="profile-section-content"');
    expect(profileSettings).toContain('className="profile-photo-actions"');
    expect(profileSettings).toContain("Display name");
    expect(profileSettings).toContain("Account email");
    expect(profileSettings).toContain("Sensitive app or domain exclusions");
    expect(profileSettings).toContain("Screenshot analysis consent");
    expect(profileSettings).toContain("Changes sync when you save.");
    expect(profileSettings).not.toContain('eyebrow="Profile"');
    expect(app).toContain("new FormData()");
    expect(styles).toContain(".task-modal.profile-modal");
    expect(styles).toContain(".task-modal-backdrop.profile-backdrop");
    expect(styles).toContain(".profile-section-content");
    expect(styles).toMatch(/\.profile-editor-section \{[\s\S]*?grid-template-columns: minmax\(120px, 148px\) minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.profile-schedule \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
    expect(styles).toContain(".profile-modal .profile-editor-body::-webkit-scrollbar");
    expect(styles).toContain(".profile-editor-modal > .profile-editor-actions .primary");
    expect(app).toContain("!!clockOutConfirmation");
    expect(app).toContain('aria-describedby="profile-settings-description"');
  });

  it("keeps agenda planning available independently of attendance", () => {
    expect(app).toContain("Scheduled today");
    expect(app).toContain("Due from yesterday");
    expect(app).toContain('type ComposerMode = "progress" | "agenda"');
    expect(app).toContain('mode={sessionActive && view === "day" ? "progress" : "agenda"}');
    expect(app).toContain('performWorktivityControl("clock_in")');
    expect(app).toContain('performWorktivityControl("clock_out"');
    expect(app).toContain("retryWorktivityConfirmation");
    expect(app).not.toContain('sendOrQueue("/api/work-os/me/workday", "POST"');
    expect(app).toContain("Add a task — planning doesn't clock you in…");
    expect(app).toContain("Added from the Work OS daily composer.");
    expect(app).toContain("Share an update, a blocker, or add a task…");
    for (const label of ["Progress", "Completed work", "Blocker", "Priority change", "New task"]) expect(app).toContain(label);
    expect(app).toContain("mascot-hero");
    expect(app).toContain("mascot-connect");
    // The EOD confirmation keeps the page and plays the checked animation.
    expect(app).toContain("CheckedMoment");
    expect(app).toContain("All EODs");
    expect(app).not.toContain("mascot-celebrate");
    expect(app).not.toContain("CompanionPet");
    expect(workspaceStyles).toContain(".kpi-strip");
    expect(workspaceStyles).toContain(".kpi-card em.kpi-attention");
    expect(workspaceStyles).toContain(".agenda-dock .progress-input-shell");
  });

  it("keeps the floating companion inside its 400 by 620 window", () => {
    expect(avatarApp).toContain("const AVATAR_EXPANDED = { width: 400, height: 620 };");
    // The whole panel header drags the window; controls keep their clicks.
    expect(avatarApp).toContain("isHeaderDragStart");
    expect(avatarApp).toContain("startDragging");
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
    expect(app).toContain("My day is open work only");
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
    expect(app).toContain("cancelQueries({ queryKey: workOsKeys.taskHistory() })");
    expect(app).toContain("replaceTaskInCaches revalidates the active history variants.");
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
    expect(planningSession).toContain('className="planning-back"');
    expect(planningSession).toContain("Review draft");
    expect(planningSession).toContain("Remove the Loom source");
    expect(planningSession).toContain('className="planning-document-line"');
    expect(workspaceStyles).toContain(".planning-document-line::before");
    expect(workspaceStyles).toContain(".planning-review:focus");
    expect(planningSession).toContain("Your daily commitments are on the record.");
    expect(planningSession).toContain("planning-confirmation-title");
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
    expect(app).toContain("useModalScrollLock(modalOpen)");
    expect(modalScrollLock).toContain('target.documentElement.classList.add("modal-open")');
    expect(modalScrollLock).toContain('target.body.classList.add("modal-open")');
    expect(styles).toContain("html.modal-open");
    expect(styles).toContain("z-index: 1100;");
    expect(styles).toContain(".notification-flyouts::-webkit-scrollbar");
    expect(styles).toContain(".notification-flyout.persistent");
    expect(styles).toContain("box-shadow: none;");
    expect(app).toContain('event.key === "Escape"');
    expect(app).toContain('event.key !== "Tab"');
    expect(styles).toContain("Finishing-quality accessibility and legibility floor");
    expect(styles).toContain('[role="menuitem"]):focus-visible');
    expect(insightChartStyles).toContain("Chart labels must remain readable at native Windows scaling");
  });

  it("keeps the Tasks page layout flat, single-headed, and wrap-proof", () => {
    // The shell masthead owns the page title and date; the workspace must not
    // repeat a context label, queue heading, or secondary sort surface.
    expect(app).toContain("TaskDateNavigator");
    expect(app).not.toContain('className="tasks-heading-context"');
    expect(app).not.toContain(">Task queue<");
    expect(app).not.toContain('<h1>{historical ? "Workday history" : "Tasks"}</h1>');
    expect(workspaceStyles).not.toContain(".tasks-heading-context");
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

  it("keeps the settings page calm, editorial, and control-consistent", () => {
    expect(app).toContain('className="page settings-page"');
    expect(app).toContain('className="settings-lead"');
    expect(app).not.toContain("Your companion, your boundaries.");
    expect(app).toContain('className="settings-group"');
    expect(app).toContain('className="settings-group danger"');
    // Four switches: start with Windows, automatic update checks, the
    // hold-to-talk shortcut, and automatic page guides. Each one is a real
    // registration, not a stored wish, so none of them can be a bare checkbox.
    expect((app.match(/<SettingsSwitch/g) ?? []).length).toBe(4);
    expect(app).toContain('title="Hold-to-talk (Ctrl + M)"');
    expect(app).toContain('title="Show page guides automatically"');
    expect(app).toContain('from "./SettingsSwitch"');
    expect(readFileSync(resolve(root, "src/SettingsSwitch.tsx"), "utf8")).toContain("export function SettingsSwitch");
    const settingSource = readFileSync(resolve(root, "src/Setting.tsx"), "utf8");
    expect(settingSource).toContain('className="setting-copy"');
    expect(settingSource).toContain('className="setting-action"');
    expect(app).not.toContain('<input type="checkbox" checked={autoStart}');
    expect(app).not.toContain('<input type="checkbox" checked={autoCheckUpdates}');
    expect(app).not.toContain('<input type="checkbox" checked={voiceHotkeyEnabled}');
    expect(app).toContain('className="status-chip"');
    expect(app).toContain("Sign out of Work OS?");
    expect(styles).toContain(".settings-page");
    expect(styles).toContain(".settings-lead");
    expect(styles).toMatch(/\.settings-group \{[\s\S]*?grid-template-columns: minmax\(128px, 164px\) minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.settings-group-head h3 \{[\s\S]*?font: 750 13px\/1\.25/);
    expect(styles).toMatch(/\.settings-panel \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.setting \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?min-height: 64px;[\s\S]*?border-top: 1px solid/);
    expect(styles).toContain(".setting:first-child { border-top: 0; }");
    expect(styles).toContain(".setting-copy");
    expect(styles).toContain(".setting-action");
    expect(styles).toContain(".setting-controls");
    const controlStart = app.indexOf('className="setting-controls"');
    const updateRow = app.slice(controlStart, app.indexOf("</Setting>", controlStart));
    expect(updateRow).toContain("checkForUpdates()");
    expect(updateRow).toContain("setWhatsNew(");
    expect(styles).toContain(".settings-switch-track");
    expect(styles).toContain(".status-chip.attention");
    expect(styles).toContain(".settings-group.danger");
    expect(styles).not.toContain(".settings-panel .status-dot");
    const memoryIndex = app.indexOf("<MemorySettings />");
    const diagnosticsIndex = app.indexOf('aria-labelledby="settings-diagnostics-title"');
    expect(memoryIndex).toBeGreaterThan(-1);
    expect(memoryIndex).toBeLessThan(diagnosticsIndex);
    expect(styles).toMatch(/@media \(max-width: 850px\) \{[\s\S]*?\.settings-group \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.setting \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("keeps memory as a settings summary band with a two-tab management modal", () => {
    // The settings surface stays a flat band; the facts live in the modal, and
    // the three classes keep their own separated sections inside its tabs.
    expect(memoryPanel).not.toContain("settings-panel");
    expect(memoryPanel).toContain('className="memory-summary"');
    expect(memoryPanel).toContain('className="memory-section review"');
    expect(memoryPanel).toContain('className="memory-section facts"');
    expect(memoryPanel).toContain('className="memory-section activity"');
    expect(memoryPanel).toContain('role="tablist"');
    expect(memoryPanel).toContain("memoryDateLabel");
    expect(memoryPanel).toContain("formatWorkOsDate");
    expect(memoryStyles).toContain(".memory-summary {");
    expect(memoryStyles).toContain(".memory-summary-view");
    expect(memoryStyles).toContain(".memory-modal-panel");
    expect(memoryStyles).toContain(".memory-tabs");
    expect(memoryStyles).toContain(".memory-cards");
    expect(memoryStyles).toContain(".memory-rows.feed");
    expect(memoryStyles).toContain(".memory-provenance");
    expect(memoryStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.memory-cards \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("keeps the dock Focus panel on the shared scroll region and edge fade", () => {
    const conversationStyles = readText(resolve(root, "src/chat/conversation.css"));
    expect(app).toContain('className="conversation-scroll-region"><div className="goal-composer-panel"');
    expect(conversationStyles).toContain(".conversation-scroll-region > .goal-composer-panel");
  });

  it("anchors the floating chat fade to the composer and disables scroll anchoring", () => {
    const conversationStyles = readText(resolve(root, "src/chat/conversation.css"));
    expect(conversationStyles).toMatch(/\.conversation-surface-floating\s+\.avatar-chat\s*\{[^}]*overflow-anchor:\s*none/s);
    expect(conversationStyles).toMatch(/\.conversation-surface-floating\s+\.conversation-scroll-region\s*>\s*\.avatar-chat\s*\{[^}]*mask-image:\s*none/s);
    expect(conversationStyles).toMatch(/\.conversation-surface-floating\s+\.conversation-scroll-region::after\s*\{[^}]*backdrop-filter:\s*blur/s);
  });

  it("animates plan-view changes and the recorded confirmation without motion overrides", () => {
    const confirmationStyles = readText(resolve(root, "src/checked-moment.css"));
    expect(workspaceStyles).toContain(".planning-session-body.is-compose");
    expect(workspaceStyles).toContain(".planning-session-body.is-review");
    expect(workspaceStyles).toContain("planning-compose-enter");
    expect(workspaceStyles).toContain("planning-review-enter");
    expect(workspaceStyles).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.planning-session-body/);
    expect(confirmationStyles).toContain(".planning-confirmation-backdrop .checked-confirmation");
    expect(confirmationStyles).toContain("planning-recorded-enter");
  });

  it("keeps the insights chart kit truthful, accessible, and motion-safe", () => {
    expect(app).toContain("TrendChart");
    expect(app).toContain("DailyRhythmStrip");
    expect(app).not.toContain('className="panel insight-flow"');
    expect(app).toContain("HeatmapGrid");
    expect(app).toContain("OnTimeBar");
    expect(app).toContain("DeltaBadge");
    expect(app).toContain("UpdateKindChart");
    expect(app).toContain("ConsistencyChips");
    expect(insightCharts).toContain("BarBreakdown");
    expect(app).toContain("ActivityDonut");
    expect(app).toContain("TrackedBars");
    expect(app).toContain("ScrollFadeRegion");
    expect(insightCharts).toContain('role="img"');
    expect(insightCharts).toContain("aria-label");
    expect(insightCharts).toContain("No dated outcomes");
    expect(app).toContain("Undated work is never classified either way");
    expect(insightChartStyles).toContain("prefers-reduced-motion");
    expect(insightChartStyles).toContain(".trend-chart-table");
    expect(insightChartStyles).toContain(".activity-donut");
    expect(insightChartStyles).toContain(".daily-rhythm-line");
    expect(insightChartStyles).toContain(".heatmap-cell.bucket-4");
    expect(insightMath).toContain('completed: "Outcomes completed"');
    expect(insightMath).toContain('label: "Blockers"');
  });

  it("keeps every chart flat, split, and bounded instead of vertically scrolled", () => {
    expect(insightChartStyles).toContain(".heatmap-scroll");
    expect(insightChartStyles).toMatch(/\.heatmap-scroll \{[\s\S]*overflow-y: clip/);
    expect(insightChartStyles).toContain(".scroll-fade-region");
    expect(insightChartStyles).toContain(".insight-activity-inline");
    expect(insightChartStyles).toContain(".activity-donut");
    expect(insightChartStyles).toContain(".insight-table-wrap td::before");
    expect(insightChartStyles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(insightChartStyles).not.toContain("grid-template-columns: repeat(7, minmax(76px, 1fr));");
    expect(sidebarStyles).toMatch(/@media \(max-width: 560px\) \{[\s\S]*?\.workspace,[\s\S]*?display: grid;[\s\S]*?grid-template-columns: var\(--sidebar-collapsed-width\) minmax\(0, 1fr\)/);
    expect(insightChartStyles).toContain(".scroll-fade-strip.top");
    expect(insightCharts).toContain("useScrollEdges");
    expect(insightCharts).toContain("trendLineSegments");
    expect(insightCharts).toContain("trendAxis");
    expect(insightCharts).toContain("heatmapColumns");
    expect(insightCharts).toContain("sharePercent");
    expect(app).toContain("maxHeight={360}");
    expect(app).toContain("maxHeight={320}");
    expect(app).toContain('className="insight-activity-inline"');
    expect(readFileSync(resolve(root, "src/ScrollFadeRegion.tsx"), "utf8")).toContain('role="region"');
  });

  it("uses an editorial Insights hierarchy with progressive disclosure", () => {
    expect(app).toContain('className="panel insight-hero"');
    expect(app).toContain("Your work, without the noise.");
    expect(app).toContain("Closing carry-over");
    expect(app).toContain('className="panel insight-detail-disclosure"');
    expect(app).toContain('range === "30d" ? <div className="split-chart"><HeatmapGrid');
    expect(insightChartStyles).toContain(".insight-hero-stats");
    expect(insightChartStyles).toContain(".daily-rhythm-strip");
    expect(insightChartStyles).toContain(".insight-detail-disclosure");
  });

  it("renders the grounded synthesis as bold-labelled short paragraphs with an evidence fallback", () => {
    const synthesisCard = readFileSync(resolve(root, "src/InsightSynthesis.tsx"), "utf8");
    expect(app).toContain("<InsightSynthesisCard state={synthesis} onSynthesize={synthesize} />");
    expect(synthesisCard).toContain('<ChatMarkdown text={state.text} />');
    expect(synthesisCard).toContain('state.mode === "evidence"');
    expect(synthesisCard).toContain("showing the exact fact record instead");
    expect(synthesisCard).toContain("Every figure is checked against the record");
    expect(synthesisCard).not.toContain("Selects only from the verified facts below");
  });

  it("keeps the active focus card's flow off the card floor", () => {
    // A long focus statement used to push the workday flow legend onto the
    // card's bottom border; the flow now owns the card's floor with clearance.
    expect(dashboardStyles).toContain(".active-focus-panel { display: flex; flex-direction: column; padding-bottom: 20px; }");
    expect(dashboardStyles).toContain(".active-focus-panel .dashboard-flow-visual { margin-top: auto; padding-top: 22px; }");
  });
});
