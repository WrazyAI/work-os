import { useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "./tauriEvents";
import { MascotDebugControls } from "./MascotDebugControls";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertTriangle, Bug, Check, ChevronRight, Copy, Download, FolderOpen, Minus, RotateCcw, Square, X } from "lucide-react";
import { exportDiagnostics, openLogsDir } from "./diagnostics";
import { DebugTrace, type TraceFilters } from "./DebugTrace";
import { createTraceFixture, type DebugTraceFixture } from "./debugTraceFixture";
import { useNotifications } from "./NotificationFlyouts";
import { SettingsSwitch } from "./SettingsSwitch";
import { DebugSidebar } from "./DebugSidebar";
import { debugSection, type DebugSectionId } from "./debugSections";
import { isMacOS } from "./platform";
import { ALL_ONBOARDING_DETAILS, DEBUG_PRESET_GROUPS, DEBUG_PRESETS, DEFAULT_DEBUG_SCENARIO, activePresetId } from "./scenarios";
import type { DebugDayState, DebugScenario } from "./types";

const AUTH_OPTIONS: Array<{ value: DebugScenario["authState"]; label: string }> = [
  { value: "real", label: "Use saved session" },
  { value: "unauthenticated", label: "Not authenticated" },
];

const ONBOARDING_OPTIONS: Array<{ value: DebugScenario["onboardingState"]; label: string }> = [
  { value: "real", label: "Use server state" },
  { value: "complete", label: "Complete" },
  { value: "missing", label: "Missing details" },
];

const SHIFT_OPTIONS: Array<{ value: DebugDayState; label: string }> = [
  { value: "real", label: "Use server state" },
  { value: "no_shift", label: "No shift" },
  { value: "scheduled", label: "Scheduled — clock-in required" },
  { value: "shift_start", label: "Shift start" },
  { value: "clocked_in", label: "Clocked in" },
  { value: "paused", label: "Paused" },
  { value: "catch_up", label: "First-hour follow-up" },
  { value: "optional", label: "Optional hourly check-in" },
  { value: "final_hour", label: "Final-hour suppression" },
  { value: "eod_due", label: "EOD due" },
  { value: "eod", label: "EOD review" },
  { value: "clocked_out", label: "Clocked out" },
];

const SHIFT_SUMMARY: Record<DebugDayState, string> = {
  real: "Server state",
  no_shift: "No shift",
  scheduled: "Scheduled",
  shift_start: "Shift start",
  clocked_in: "Clocked in",
  paused: "Paused",
  catch_up: "First-hour follow-up",
  optional: "Optional check-in",
  final_hour: "Final-hour suppression",
  eod_due: "EOD due",
  eod: "EOD review",
  clocked_out: "Clocked out",
};

const PLANNING_OPTIONS: Array<{ value: NonNullable<DebugScenario["planningState"]> | ""; label: string }> = [
  { value: "", label: "Use live behavior" },
  { value: "required", label: "Required plan" },
  { value: "ai_unavailable", label: "AI unavailable" },
  { value: "conflict", label: "Revision conflict" },
  { value: "offline", label: "Offline queue" },
];

const PLANNING_SUMMARY: Record<NonNullable<DebugScenario["planningState"]>, string> = {
  required: "Required plan",
  ai_unavailable: "AI unavailable",
  conflict: "Revision conflict",
  offline: "Offline queue",
};

const COMPANION_FORCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Auto (evaluate normally)" },
  { value: "clock_in_greeting", label: "Clock-in greeting" },
  { value: "awaiting_plan", label: "Awaiting plan" },
  { value: "progress_check", label: "Progress check" },
  { value: "blocker_follow_up", label: "Blocker follow-up" },
  { value: "eod_due", label: "EOD due" },
  { value: "quiet", label: "Quiet" },
  { value: "offline", label: "Offline" },
];

const MASCOT_ACTIVITY_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  "needs-input": "Needs input",
  ready: "Completed",
  blocked: "Failed",
};

function optionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export default function DebugWindow() {
  const notifications = useNotifications();
  const mac = isMacOS();
  const appWindow = useMemo(() => (isTauri() ? getCurrentWindow() : null), []);
  const [maximized, setMaximized] = useState(false);
  const [section, setSection] = useState<DebugSectionId>("overview");
  const [scenario, setScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  // Trace filters and pause live here so they survive switching sections. The
  // trace itself unmounts with its category, which releases its rows.
  const [traceFilters, setTraceFilters] = useState<TraceFilters>({ query: "", level: "all", source: "all" });
  const [traceClearFloor, setTraceClearFloor] = useState<number | null>(null);
  const previewTrace = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview-trace");
  const [traceFixture] = useState<DebugTraceFixture | null>(() => previewTrace ? createTraceFixture() : null);
  const [paused, setPaused] = useState(false);
  const [confirmLiveWrites, setConfirmLiveWrites] = useState(false);
  const [flash, setFlash] = useState<"scenario" | "path" | null>(null);
  const [exportResult, setExportResult] = useState<null | { tone: "ok" | "error"; title: string; detail: string; path?: string }>(null);
  const [guideReplayStatus, setGuideReplayStatus] = useState<"opened" | "unavailable" | null>(null);

  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    void listen<DebugScenario>("work-os://debug-current", (event) => {
      if (disposed || !event.payload || typeof event.payload.enabled !== "boolean") return;
      const next = { ...DEFAULT_DEBUG_SCENARIO, ...event.payload };
      scenarioRef.current = next;
      setScenario(next);
    }).then((off) => {
      register(off);
      if (!disposed) void emit("work-os://debug-request");
    }).catch(() => undefined);
    void listen<{ opened: boolean }>("work-os://debug-page-guide-result", (event) => {
      if (disposed) return;
      setGuideReplayStatus(event.payload?.opened ? "opened" : "unavailable");
    }).then(register).catch(() => undefined);
    return () => { disposed = true; cleaners.forEach((off) => off()); };
  }, []);

  const currentPresetId = useMemo(() => activePresetId(scenario), [scenario]);
  const currentPreset = useMemo(() => DEBUG_PRESETS.find((preset) => preset.id === currentPresetId) ?? null, [currentPresetId]);
  const presetLabel = currentPreset?.label ?? (scenario.enabled ? "Custom overrides" : "No scenario loaded");

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!appWindow) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(() => undefined);
    };
    sync();
    void appWindow.onResized(sync).then((off) => {
      if (disposed) off();
      else stop = off;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [appWindow]);

  // Closing destroys the window; `open_debug_window` recreates it on demand, and the
  // scenario is re-requested from the host on mount.
  function closeWindow() {
    if (!appWindow) { window.close(); return; }
    void appWindow.close().catch(() => undefined);
  }

  function minimizeWindow() {
    void appWindow?.minimize().catch(() => undefined);
  }

  function toggleMaximizeWindow() {
    void appWindow?.toggleMaximize().catch(() => undefined);
  }

  function update(patch: Partial<DebugScenario>) {
    const next = { ...scenarioRef.current, ...patch };
    scenarioRef.current = next;
    setScenario(next);
    void emit("work-os://debug-scenario", next).catch(() => undefined);
  }

  function openSection(next: DebugSectionId, focusHeading = false) {
    setSection(next);
    if (focusHeading) window.requestAnimationFrame(() => document.getElementById("debug-page-title")?.focus());
  }

  async function copyScenario() {
    await navigator.clipboard.writeText(JSON.stringify(scenario, null, 2));
    setFlash("scenario");
  }

  async function copyExportPath() {
    if (!exportResult?.path) return;
    await navigator.clipboard.writeText(exportResult.path);
    setFlash("path");
  }

  async function runExport() {
    notifications.info("Preparing a redacted diagnostics bundle.", "Exporting diagnostics");
    try {
      const path = await exportDiagnostics({
        runtimeHealth: { online: navigator.onLine, userAgent: navigator.userAgent, href: window.location.href },
        queueSummary: { note: "Queue bodies are never exported." },
        sanitizedConfig: { window: "debug" },
      });
      setExportResult({ tone: "ok", title: path, detail: "Redacted bundle saved. Nothing secret leaves this machine.", path });
      notifications.success(`Saved to ${path}`, "Diagnostics exported");
    } catch (error) {
      const detail = isTauri()
        ? (error instanceof Error ? error.message : "Export failed")
        : "The diagnostics ZIP is written by the desktop app; a browser preview cannot save it.";
      setExportResult({ tone: "error", title: "The bundle could not be written.", detail });
      notifications.error(detail, "Diagnostics export failed", { label: "Open logs folder", onClick: () => void openLogsDir() });
    }
  }

  const statuses = [
    { key: "enabled", label: scenario.enabled ? "Scenario on" : "Scenario off", tone: scenario.enabled ? "on" : "off" },
    ...(scenario.syncBypass ? [{ key: "bypass", label: "Offline bypass", tone: "warn" }] : []),
    ...(scenario.liveWrites ? [{ key: "live", label: "Live writes", tone: "danger" }] : []),
  ];

  const meta = debugSection(section);
  const sessionValue = `${scenario.authState === "unauthenticated" ? "Not authenticated" : "Saved session"} · ${scenario.onboardingState === "real" ? "Server onboarding" : optionLabel(ONBOARDING_OPTIONS, scenario.onboardingState)}`;
  const workdayValue = `${SHIFT_SUMMARY[scenario.dayState]} · Planning ${scenario.planningState ? PLANNING_SUMMARY[scenario.planningState].toLowerCase() : "live"}${scenario.queuedUpdates > 0 ? ` · ${scenario.queuedUpdates} queued` : ""}`;
  const companionValue = `${scenario.companionForce ? optionLabel(COMPANION_FORCE_OPTIONS, scenario.companionForce) : "Auto"}${scenario.mascotActivity ? ` · Mascot ${MASCOT_ACTIVITY_LABELS[scenario.mascotActivity] ?? scenario.mascotActivity}` : ""}`;
  const reachValue = `${scenario.syncBypass ? "Offline only" : "Backend reachable"} · ${scenario.liveWrites ? "Live writes on" : "Live writes off"}`;
  const summaryRows: Array<{ id: DebugSectionId; label: string; value: string }> = [
    { id: "presets", label: "Preset", value: currentPreset?.label ?? (scenario.enabled ? "Custom overrides — no preset matches" : "No scenario loaded") },
    { id: "session", label: "Session", value: sessionValue },
    { id: "workday", label: "Workday", value: workdayValue },
    { id: "companion", label: "Companion", value: companionValue },
    { id: "backend", label: "Reach", value: reachValue },
  ];

  return <main className="debug-shell">
    <header className="debug-header" data-tauri-drag-region data-platform={mac ? "mac" : "windows"}>
      <div className="debug-title" data-tauri-drag-region="deep"><Bug size={18} aria-hidden="true" /><span><strong>Work OS debugger</strong><small>Developer diagnostics</small></span></div>
      <div className="debug-header-actions">
        {statuses.map((status) => <span className={`debug-status ${status.tone}`} key={status.key}>{status.label}</span>)}
        {!mac && <div className="debug-window-controls">
          <button type="button" aria-label="Minimize" title="Minimize" onClick={minimizeWindow}><Minus size={14} aria-hidden="true" /></button>
          <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximizeWindow}>{maximized ? <Copy size={12} aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}</button>
          <button type="button" aria-label="Close window" title="Close window" className="debug-window-close" onClick={closeWindow}><X size={14} aria-hidden="true" /></button>
        </div>}
      </div>
    </header>

    <div className="debug-body">
      <DebugSidebar
        active={section}
        onSelect={openSection}
        scenarioEnabled={scenario.enabled}
        presetLabel={presetLabel}
        exportState={exportResult ? exportResult.tone : null}
      />

      <section className="debug-content" aria-labelledby="debug-page-title">
        <header className="debug-page-head">
          <h1 id="debug-page-title" tabIndex={-1}>{meta.label}</h1>
          <p>{meta.detail}</p>
        </header>

        {section === "overview" && <div className="debug-page-body">
          <p className="debug-warning">Scenarios never write to the server by themselves. They change what this device believes while the debugger is open; authentication, consent, tasks, evidence, and reports stay untouched until an action is deliberately filed.</p>
          <section className="debug-panel">
            <label className="debug-switch-row">
              <span><strong>Enable debug scenario</strong><small>Applies the overrides on this device. Scenarios reset themselves when the app exits.</small></span>
              <SettingsSwitch label="Enable debug scenario" checked={scenario.enabled} onChange={(value) => { setConfirmLiveWrites(false); update({ enabled: value }); }} />
            </label>
          </section>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Current scenario</h2><small>Each row opens the category that owns it</small></header>
            <div className="debug-summary">
              {summaryRows.map((row) => <button key={row.id} type="button" className="debug-summary-row" onClick={() => openSection(row.id, true)}>
                <span className="debug-summary-copy"><strong>{row.label}</strong><small>{row.value}</small></span>
                <ChevronRight size={15} className="debug-summary-chevron" aria-hidden="true" />
              </button>)}
            </div>
          </section>
        </div>}

        {section === "presets" && <div className="debug-page-body">
          <p className="debug-note">A preset loads a complete scenario at once. Choosing one replaces every override; changing any control afterwards turns it into a custom scenario.</p>
          {scenario.enabled && !currentPreset && <p className="debug-preset-custom">Custom overrides — no preset matches the current scenario.</p>}
          <div className="debug-preset-groups">
            {DEBUG_PRESET_GROUPS.map((group) => {
              const presets = DEBUG_PRESETS.filter((preset) => preset.group === group);
              if (!presets.length) return null;
              return <section className="debug-preset-group" key={group}>
                <h2>{group}<span>{presets.length}</span></h2>
                <div className="debug-presets">{presets.map((preset) => <button key={preset.id} type="button" aria-pressed={currentPresetId === preset.id} className={currentPresetId === preset.id ? "active" : ""} onClick={() => update({ ...DEFAULT_DEBUG_SCENARIO, ...preset.scenario })}>
                  <span className="debug-preset-head"><strong>{preset.label}</strong>{currentPresetId === preset.id && <span className="debug-preset-current">Current</span>}</span>
                  <small>{preset.description}</small>
                </button>)}</div>
              </section>;
            })}
          </div>
        </div>}

        {section === "session" && <div className="debug-page-body">
          <p className="debug-note">These overrides change only this device's view. No auth session, consent record, or profile write is sent.</p>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Sign-in</h2><small>What the app believes about the current session</small></header>
            <div className="debug-panel-body">
              <label className="debug-field"><span>Authentication</span><select value={scenario.authState} onChange={(event) => update({ authState: event.target.value as DebugScenario["authState"] })}>{AUTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
          </section>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Onboarding</h2><small>Whether setup is required and which details it asks for</small></header>
            <div className="debug-panel-body">
              <label className="debug-field"><span>Onboarding state</span><select value={scenario.onboardingState} onChange={(event) => update({ onboardingState: event.target.value as DebugScenario["onboardingState"] })}>{ONBOARDING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div className="debug-action-row">
                <button type="button" className="debug-invalidate" onClick={() => update({ enabled: true, authState: "real", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ALL_ONBOARDING_DETAILS.filter((item) => item.owner === "employee").map((item) => item.key) })}>Invalidate employee onboarding</button>
                <p className="debug-help">Clears the local form fixture and requires the employee-owned details again. Server data is unchanged.</p>
              </div>
              <div className="debug-subhead"><strong>Missing details</strong><small>Which employee-owned answers onboarding still needs</small></div>
              <div className="debug-checks">{ALL_ONBOARDING_DETAILS.map((item) => <label key={item.key}><input type="checkbox" checked={scenario.missingDetails.includes(item.key)} onChange={() => update({ missingDetails: scenario.missingDetails.includes(item.key) ? scenario.missingDetails.filter((entry) => entry !== item.key) : [...scenario.missingDetails, item.key] })} /><span>{item.label}<small>{item.owner}</small></span></label>)}</div>
            </div>
          </section>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Page guide</h2><small>Replay the guide for the page open in the main window</small></header>
            <div className="debug-panel-body">
              <div className="debug-action-row">
                <button type="button" className="debug-invalidate" onClick={() => {
                  setGuideReplayStatus(null);
                  void emit("work-os://debug-show-page-guide").catch(() => setGuideReplayStatus("unavailable"));
                }}>Show current page guide</button>
                <p className="debug-help" aria-live="polite">{guideReplayStatus === "opened"
                  ? "Guide opened in the main window. Its seen/unseen state will not change."
                  : guideReplayStatus === "unavailable"
                    ? "No guide for this page."
                    : "Replay the guide modal for the page open in the main window without changing its first-visit state."}</p>
              </div>
            </div>
          </section>
        </div>}

        {section === "workday" && <div className="debug-page-body">
          <p className="debug-note">The workday state the workspace renders. Server sessions and attendance are never rewritten.</p>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Shift</h2><small>The state the dashboard opens in</small></header>
            <div className="debug-panel-body">
              <label className="debug-field"><span>Shift state</span><select aria-label="Shift state" value={scenario.dayState} onChange={(event) => update({ dayState: event.target.value as DebugDayState })}>{SHIFT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
          </section>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Planning</h2><small>The planning session and queued update count</small></header>
            <div className="debug-panel-body">
              <label className="debug-field"><span>Planning session</span><select value={scenario.planningState ?? ""} onChange={(event) => update({ planningState: event.target.value ? event.target.value as NonNullable<DebugScenario["planningState"]> : null })}>{PLANNING_OPTIONS.map((option) => <option key={option.value || "live"} value={option.value}>{option.label}</option>)}</select></label>
              <label className="debug-field"><span>Queued updates</span><input type="number" min="0" max="99" value={scenario.queuedUpdates} onChange={(event) => update({ queuedUpdates: Math.max(0, Math.min(99, Number(event.target.value) || 0)) })} /></label>
            </div>
          </section>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Empty and failed states</h2><small>Make missing work visible without changing the record</small></header>
            <div className="debug-panel-body">
              <div className="debug-switches">
                <DebugSwitch label="Task load failure" checked={scenario.niftyFailure} onChange={(value) => update({ niftyFailure: value })} />
                <DebugSwitch label="No tasks" checked={scenario.emptyTasks} onChange={(value) => update({ emptyTasks: value })} />
                <DebugSwitch label="No evidence" checked={scenario.emptyEvidence} onChange={(value) => update({ emptyEvidence: value })} />
                <DebugSwitch label="No proposals" checked={scenario.emptyProposals} onChange={(value) => update({ emptyProposals: value })} />
              </div>
            </div>
          </section>
        </div>}

        {section === "companion" && <div className="debug-page-body">
          <p className="debug-note">Forces the floating companion into a machine state. Offline beats every force; quiet mode in Settings suppresses notifications for real.</p>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Machine state</h2><small>The prompt the companion believes it owes</small></header>
            <div className="debug-panel-body">
              <label className="debug-field"><span>Force state</span><select value={scenario.companionForce ?? ""} onChange={(event) => update({ companionForce: event.target.value || null })}>{COMPANION_FORCE_OPTIONS.map((option) => <option key={option.value || "auto"} value={option.value}>{option.label}</option>)}</select></label>
            </div>
          </section>
          <MascotDebugControls scenario={scenario} onChange={update} />
        </div>}

        {section === "backend" && <div className="debug-page-body">
          <p className="debug-warning">Live writes file real approvals against the real server. Every other control in this window only changes local fixtures.</p>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>Reach</h2><small>How far this scenario may reach</small></header>
            <div className="debug-panel-body">
              <label className="debug-switch-row compact"><span><strong>Offline sync bypass</strong><small>Never contact the backend; writes stay on this device</small></span><SettingsSwitch label="Offline sync bypass" checked={scenario.syncBypass} onChange={(value) => update({ enabled: true, syncBypass: value })} /></label>
              <label className="debug-switch-row compact"><span><strong>Live writes in scenario</strong><small>Approval actions file against the real server</small></span><SettingsSwitch label="Live writes in scenario" checked={!!scenario.liveWrites && !confirmLiveWrites} onChange={(value) => { if (value) { setConfirmLiveWrites(true); return; } setConfirmLiveWrites(false); update({ liveWrites: false }); }} /></label>
              {confirmLiveWrites && <div className="debug-confirm" role="alertdialog" aria-label="Confirm live writes">
                <p><AlertTriangle size={14} /><span><strong>Confirm live writes.</strong> Approvals are filed against the real server with no local simulation from here on. Only continue against a server you intend to change{scenario.syncBypass ? ", and switch off Offline sync bypass first — it currently keeps every write on this device" : ""}.</span></p>
                <div className="debug-confirm-actions">
                  <button type="button" className="debug-confirm-proceed" onClick={() => { setConfirmLiveWrites(false); update({ enabled: true, liveWrites: true }); }}>Confirm live writes</button>
                  <button type="button" onClick={() => setConfirmLiveWrites(false)}>Cancel</button>
                </div>
              </div>}
              <p className="debug-help">Launches the workspace from local fixtures even when the server is unreachable (quota-restricted, offline, or not yet signed in). Task, composer, and shift actions are simulated locally, so full workflows — including the update classification flow — can be exercised end to end. No server data is changed. With live writes enabled, approvals are actually sent; use only against a server you intend to change.</p>
            </div>
          </section>
        </div>}

        {section === "trace" && <div className="debug-page-body debug-page-body-flush">
          <DebugTrace
            filters={traceFilters}
            onFiltersChange={setTraceFilters}
            fixture={traceFixture}
            clearFloor={traceClearFloor}
            onClear={setTraceClearFloor}
            paused={paused}
            onPausedChange={setPaused}
          />
        </div>}

        {section === "export" && <div className="debug-page-body">
          <p className="debug-warning">The bundle excludes tokens, cookies, Stronghold contents, transcripts, screenshots, and raw task or update text.</p>
          <section className="debug-panel">
            <header className="debug-panel-head"><h2>What the bundle holds</h2><small>Redacted structured files only</small></header>
            <ul className="export-list">
              <li><strong>manifest.json</strong><small>app, session, export time</small></li>
              <li><strong>app-events.jsonl</strong><small>redacted structured events</small></li>
              <li><strong>runtime-health.json</strong><small>online state and WebView info</small></li>
              <li><strong>queue-summary.json</strong><small>counts only, never bodies</small></li>
              <li><strong>sanitized-config.json</strong><small>non-secret settings</small></li>
            </ul>
          </section>
          <div className="export-actions">
            <button className="debug-button primary" onClick={() => void runExport()}><Download size={15} /> Export diagnostics ZIP</button>
            <button className="debug-button" onClick={() => void openLogsDir()}><FolderOpen size={15} /> Open logs folder</button>
          </div>
          {exportResult && <div className={`export-result ${exportResult.tone}`} role="status">
            <span><strong>{exportResult.tone === "ok" ? "Exported" : "Export failed"}</strong><small>{exportResult.title}</small><small>{exportResult.detail}</small></span>
            <div className="export-result-actions">
              {exportResult.tone === "ok" && <button type="button" onClick={() => void copyExportPath()}>{flash === "path" ? "Copied" : "Copy path"}</button>}
              {exportResult.tone === "error" && <button type="button" onClick={() => void runExport()}>Try again</button>}
              <button type="button" onClick={() => void openLogsDir()}>Open logs folder</button>
            </div>
          </div>}
        </div>}
      </section>
    </div>

    <footer className="debug-actionbar">
      <div className="debug-actionbar-state">
        <span className={`debug-dot${scenario.enabled ? " is-on" : ""}`} aria-hidden="true" />
        <span><strong title={presetLabel}>{presetLabel}</strong><small>{scenario.enabled ? "Applied on this device" : "Nothing is overridden"}</small></span>
      </div>
      <div className="debug-actionbar-actions">
        <button type="button" className="debug-copy" onClick={() => void copyScenario()}>{flash === "scenario" ? <Check size={15} /> : <Copy size={15} />} {flash === "scenario" ? "Scenario copied" : "Copy scenario JSON"}</button>
        <button type="button" className="debug-reset" onClick={() => { setConfirmLiveWrites(false); update(DEFAULT_DEBUG_SCENARIO); }}><RotateCcw size={15} /> Reset all overrides</button>
      </div>
    </footer>
  </main>;
}

function DebugSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="debug-switch-row compact"><span><strong>{label}</strong></span><SettingsSwitch label={label} checked={checked} onChange={onChange} /></label>;
}
