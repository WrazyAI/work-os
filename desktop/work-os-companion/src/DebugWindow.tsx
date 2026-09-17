import { useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bug, Download, RotateCcw, X } from "lucide-react";
import { diagnosticsSnapshot, exportDiagnostics, openLogsDir, type DiagnosticEvent, type DiagnosticLevel, type DiagnosticSource } from "./diagnostics";
import { useNotifications } from "./NotificationFlyouts";
import { SettingsSwitch } from "./SettingsSwitch";
import { ALL_ONBOARDING_DETAILS, DEBUG_PRESETS, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import type { DebugDayState, DebugScenario } from "./types";

type Tab = "scenarios" | "trace" | "export";

const TAB_LABELS: Record<Tab, string> = { scenarios: "Scenarios", trace: "Live trace", export: "Export" };

export default function DebugWindow() {
  const notifications = useNotifications();
  const [tab, setTab] = useState<Tab>("scenarios");
  const [scenario, setScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<DiagnosticLevel | "all">("all");
  const [source, setSource] = useState<DiagnosticSource | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenCurrent: (() => void) | undefined;
    let unlistenEvents: (() => void) | undefined;
    void listen<DebugScenario>("work-os://debug-current", (event) => setScenario(event.payload)).then((cleanup) => { unlistenCurrent = cleanup; }).catch(() => undefined);
    void listen<DiagnosticEvent>("work-os://diagnostics", (event) => {
      if (pausedRef.current) return;
      setEvents((current) => [...current.slice(-1999), event.payload]);
    }).then((cleanup) => { unlistenEvents = cleanup; }).catch(() => undefined);
    void emit("work-os://debug-request").catch(() => undefined);
    void diagnosticsSnapshot().then(setEvents).catch(() => undefined);
    return () => { unlistenCurrent?.(); unlistenEvents?.(); };
  }, []);

  const visible = useMemo(() => events.filter((event) => {
    if (level !== "all" && event.level !== level) return false;
    if (source !== "all" && event.source !== source) return false;
    if (!query.trim()) return true;
    const haystack = `${event.category} ${event.message} ${event.correlationId ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [events, level, query, source]);

  function closeWindow() {
    if (!isTauri()) { window.close(); return; }
    void getCurrentWindow().hide().catch(() => undefined);
  }

  function update(patch: Partial<DebugScenario>) {
    const next = { ...scenario, ...patch };
    setScenario(next);
    void emit("work-os://debug-scenario", next).catch(() => undefined);
  }

  async function copyEvent(event: DiagnosticEvent) {
    await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  }

  async function runExport() {
    notifications.info("Preparing a redacted diagnostics bundle.", "Exporting diagnostics");
    try {
      const path = await exportDiagnostics({
        runtimeHealth: { online: navigator.onLine, userAgent: navigator.userAgent, href: window.location.href },
        queueSummary: { note: "Queue bodies are never exported." },
        sanitizedConfig: { window: "debug" },
      });
      notifications.success(`Saved to ${path}`, "Diagnostics exported");
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : "Export failed", "Diagnostics export failed", { label: "Open logs folder", onClick: () => void openLogsDir() });
    }
  }

  const statuses = [
    { key: "enabled", label: scenario.enabled ? "Scenario on" : "Scenario off", tone: scenario.enabled ? "on" : "off" },
    ...(scenario.syncBypass ? [{ key: "bypass", label: "Offline bypass", tone: "warn" }] : []),
    ...(scenario.liveWrites ? [{ key: "live", label: "Live writes", tone: "danger" }] : []),
  ];

  return <main className="debug-shell">
    <header className="debug-header">
      <div className="debug-title"><Bug size={18} /><span><strong>Work OS debugger</strong><small>Scenarios and live diagnostics</small></span></div>
      <div className="debug-header-actions">
        {statuses.map((status) => <span className={`debug-status ${status.tone}`} key={status.key}>{status.label}</span>)}
        <button className="debug-close" title="Close" aria-label="Close" onClick={closeWindow}><X size={16} /></button>
      </div>
    </header>
    <nav className="debug-tabs" role="tablist" aria-label="Debugger views">
      {(["scenarios", "trace", "export"] as Tab[]).map((id) => <button
        key={id}
        role="tab"
        aria-selected={tab === id}
        className={tab === id ? "active" : ""}
        onClick={() => setTab(id)}
      >
        {TAB_LABELS[id]}
        {id === "trace" && <em>{events.length}</em>}
      </button>)}
    </nav>

    {tab === "scenarios" && <div className="debug-content">
      <div className="debug-warning">Scenarios do not change authentication, consent, tasks, evidence, or reports on the server.</div>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Presets</h2><small>Load a whole scenario in one click</small></header>
        <div className="debug-presets">{DEBUG_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => update({ ...DEFAULT_DEBUG_SCENARIO, ...preset.scenario })}><strong>{preset.label}</strong><small>{preset.description}</small></button>)}</div>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Master switch</h2><small>Scenarios reset themselves when the app exits</small></header>
        <label className="debug-switch-row"><span><strong>Enable debug scenario</strong><small>Applies the overrides below to this device</small></span><SettingsSwitch label="Enable debug scenario" checked={scenario.enabled} onChange={(value) => update({ enabled: value })} /></label>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Session</h2><small>What the app believes about sign-in and setup</small></header>
        <label className="debug-field"><span>Authentication</span><select value={scenario.authState} onChange={(event) => update({ authState: event.target.value as DebugScenario["authState"] })}><option value="real">Use saved session</option><option value="unauthenticated">Not authenticated</option></select></label>
        <label className="debug-field"><span>Onboarding</span><select value={scenario.onboardingState} onChange={(event) => update({ onboardingState: event.target.value as DebugScenario["onboardingState"] })}><option value="real">Use server state</option><option value="complete">Complete</option><option value="missing">Missing details</option></select></label>
        <div className="debug-action-row">
          <button type="button" className="debug-invalidate" onClick={() => update({ enabled: true, authState: "real", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ALL_ONBOARDING_DETAILS.filter((item) => item.owner === "employee").map((item) => item.key) })}>Invalidate employee onboarding</button>
          <p className="debug-help">Clears the local form fixture and requires the employee-owned details again. Server data is unchanged.</p>
        </div>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Backend</h2><small>How far this scenario may reach</small></header>
        <label className="debug-switch-row"><span><strong>Offline sync bypass</strong><small>Never contact the backend; writes stay on this device</small></span><SettingsSwitch label="Offline sync bypass" checked={scenario.syncBypass} onChange={(value) => update({ enabled: true, syncBypass: value })} /></label>
        <label className="debug-switch-row"><span><strong>Live writes in scenario</strong><small>Approval actions file against the real server</small></span><SettingsSwitch label="Live writes in scenario" checked={!!scenario.liveWrites} onChange={(value) => update({ enabled: true, liveWrites: value })} /></label>
        <p className="debug-help">Launches the workspace from local fixtures even when the server is unreachable (quota-restricted, offline, or not yet signed in). Task, composer, and shift actions are simulated locally, so full workflows — including the update classification flow — can be exercised end to end. No server data is changed. With live writes enabled, approvals are actually sent; use only against a server you intend to change.</p>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Missing details</h2><small>Which employee-owned answers onboarding still needs</small></header>
        <div className="debug-checks">{ALL_ONBOARDING_DETAILS.map((item) => <label key={item.key}><input type="checkbox" checked={scenario.missingDetails.includes(item.key)} onChange={() => update({ missingDetails: scenario.missingDetails.includes(item.key) ? scenario.missingDetails.filter((entry) => entry !== item.key) : [...scenario.missingDetails, item.key] })} /><span>{item.label}<small>{item.owner}</small></span></label>)}</div>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>My Day conditions</h2><small>The workday state the app renders</small></header>
        <label className="debug-field"><span>Shift state</span><select value={scenario.dayState} onChange={(event) => update({ dayState: event.target.value as DebugDayState })}>
          <option value="real">Use server state</option><option value="no_shift">No shift</option><option value="scheduled">Scheduled — clock-in required</option><option value="shift_start">Shift start</option><option value="clocked_in">Clocked in</option><option value="paused">Paused</option><option value="catch_up">First-hour follow-up</option><option value="optional">Optional hourly check-in</option><option value="final_hour">Final-hour suppression</option><option value="eod_due">EOD due</option><option value="eod">EOD review</option><option value="clocked_out">Clocked out</option>
        </select></label>
        <div className="debug-switches">
          <DebugSwitch label="Nifty sync failure" checked={scenario.niftyFailure} onChange={(value) => update({ niftyFailure: value })} />
          <DebugSwitch label="No tasks" checked={scenario.emptyTasks} onChange={(value) => update({ emptyTasks: value })} />
          <DebugSwitch label="No evidence" checked={scenario.emptyEvidence} onChange={(value) => update({ emptyEvidence: value })} />
          <DebugSwitch label="No proposals" checked={scenario.emptyProposals} onChange={(value) => update({ emptyProposals: value })} />
        </div>
        <label className="debug-field"><span>Planning session</span><select value={scenario.planningState ?? ""} onChange={(event) => update({ planningState: event.target.value ? event.target.value as NonNullable<DebugScenario["planningState"]> : null })}>
          <option value="">Use live behavior</option><option value="required">Required plan</option><option value="ai_unavailable">AI unavailable</option><option value="conflict">Revision conflict</option><option value="offline">Offline queue</option>
        </select></label>
        <label className="debug-field"><span>Queued updates</span><input type="number" min="0" max="99" value={scenario.queuedUpdates} onChange={(event) => update({ queuedUpdates: Math.max(0, Math.min(99, Number(event.target.value) || 0)) })} /></label>
      </section>
      <section className="debug-group">
        <header className="debug-group-head"><h2>Companion</h2><small>The floating companion's machine state</small></header>
        <label className="debug-field"><span>Force state</span><select value={scenario.companionForce ?? ""} onChange={(event) => update({ companionForce: event.target.value || null })}>
          <option value="">Auto (evaluate normally)</option>
          <option value="clock_in_greeting">Clock-in greeting</option>
          <option value="awaiting_plan">Awaiting plan</option>
          <option value="progress_check">Progress check</option>
          <option value="blocker_follow_up">Blocker follow-up</option>
          <option value="eod_due">EOD due</option>
          <option value="quiet">Quiet</option>
          <option value="offline">Offline</option>
        </select></label>
        <p className="debug-help">Forces the companion machine into a state with its synthetic prompt. Offline beats every force; quiet mode in Settings suppresses notifications for real.</p>
      </section>
      <div className="debug-footer-actions">
        <button type="button" className="debug-reset" onClick={() => update(DEFAULT_DEBUG_SCENARIO)}><RotateCcw size={15} /> Reset all overrides</button>
      </div>
    </div>}

    {tab === "trace" && <div className="debug-content">
      <div className="trace-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search category, message, correlation" aria-label="Search events" />
        <select value={level} onChange={(event) => setLevel(event.target.value as DiagnosticLevel | "all")} aria-label="Filter by level"><option value="all">All levels</option><option value="trace">trace</option><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
        <select value={source} onChange={(event) => setSource(event.target.value as DiagnosticSource | "all")} aria-label="Filter by source"><option value="all">All sources</option><option value="frontend">frontend</option><option value="rust">rust</option><option value="ipc">ipc</option><option value="sync">sync</option><option value="storage">storage</option></select>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</button>
        <button type="button" onClick={() => setEvents([])}>Clear view</button>
      </div>
      <p className="debug-help">Clearing the view does not delete disk logs. {visible.length} shown / {events.length} buffered.</p>
      {visible.length > 0 ? <ol className="trace-list">
        {visible.map((event) => <li key={event.id}>
          <button className={`trace-row ${event.level}`} onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
            <time>{event.timestamp.slice(11, 23)}</time>
            <b>{event.level}</b>
            <span>{event.source}</span>
            <strong>{event.category}</strong>
            <em>{event.message}</em>
          </button>
          {expanded === event.id && <pre>{JSON.stringify(event, null, 2)}<button type="button" onClick={() => void copyEvent(event)}>Copy event</button></pre>}
        </li>)}
      </ol> : <p className="debug-empty">No events match these filters. Widen the level or source filter, or clear the search.</p>}
    </div>}

    {tab === "export" && <div className="debug-content">
      <div className="debug-warning">The bundle excludes tokens, cookies, Stronghold contents, transcripts, screenshots, and raw task or update text.</div>
      <section className="debug-group">
        <header className="debug-group-head"><h2>What the bundle holds</h2><small>Redacted structured files only</small></header>
        <ul className="export-list">
          <li><strong>manifest.json</strong><small>app, session, export time</small></li>
          <li><strong>app-events.jsonl</strong><small>redacted structured events</small></li>
          <li><strong>runtime-health.json</strong><small>online state and WebView info</small></li>
          <li><strong>queue-summary.json</strong><small>counts only, never bodies</small></li>
          <li><strong>sanitized-config.json</strong><small>non-secret settings</small></li>
        </ul>
      </section>
      <div className="export-actions">
        <button className="primary" onClick={() => void runExport()}><Download size={15} /> Export diagnostics ZIP</button>
        <button onClick={() => void openLogsDir()}>Open logs folder</button>
      </div>
    </div>}
  </main>;
}

function DebugSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="debug-switch-row compact"><span><strong>{label}</strong></span><SettingsSwitch label={label} checked={checked} onChange={onChange} /></label>;
}
