import { useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bug, Download, RotateCcw, X } from "lucide-react";
import { diagnosticsSnapshot, exportDiagnostics, openLogsDir, type DiagnosticEvent, type DiagnosticLevel, type DiagnosticSource } from "./diagnostics";
import { ALL_ONBOARDING_DETAILS, DEBUG_PRESETS, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import type { DebugDayState, DebugScenario } from "./types";

type Tab = "scenarios" | "trace" | "export";

export default function DebugWindow() {
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
  const [exportStatus, setExportStatus] = useState("");

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
    setExportStatus("Exporting…");
    try {
      const path = await exportDiagnostics({
        runtimeHealth: { online: navigator.onLine, userAgent: navigator.userAgent, href: window.location.href },
        queueSummary: { note: "Queue bodies are never exported." },
        sanitizedConfig: { window: "debug" },
      });
      setExportStatus(`Wrote ${path}`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Export failed");
    }
  }

  return <main className="debug-shell">
    <header className="debug-header">
      <div><Bug size={18} /><span><strong>Work OS debugger</strong><small>Scenarios and live diagnostics</small></span></div>
      <button className="icon-button" title="Close" aria-label="Close" onClick={closeWindow}><X size={16} /></button>
    </header>
    <nav className="debug-tabs">
      {(["scenarios", "trace", "export"] as Tab[]).map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{id === "scenarios" ? "Scenarios" : id === "trace" ? "Live Trace" : "Export"}</button>)}
    </nav>
    {tab === "scenarios" && <div className="debug-content">
      <div className="debug-warning">Scenarios do not change authentication, consent, tasks, evidence, or reports on the server.</div>
      <label className="toggle-row debug-master"><span><strong>Enable debug scenario</strong><small>Reset automatically when the app exits</small></span><input type="checkbox" checked={scenario.enabled} onChange={(event) => update({ enabled: event.target.checked })} /></label>
      <section className="debug-section">
        <h2>Presets</h2>
        <div className="preset-grid">{DEBUG_PRESETS.map((preset) => <button key={preset.id} onClick={() => update({ ...DEFAULT_DEBUG_SCENARIO, ...preset.scenario })}>{preset.label}</button>)}</div>
      </section>
      <section className="debug-section">
        <h2>Session</h2>
        <label><span>Authentication</span><select value={scenario.authState} onChange={(event) => update({ authState: event.target.value as DebugScenario["authState"] })}><option value="real">Use saved session</option><option value="unauthenticated">Not authenticated</option></select></label>
        <label><span>Onboarding</span><select value={scenario.onboardingState} onChange={(event) => update({ onboardingState: event.target.value as DebugScenario["onboardingState"] })}><option value="real">Use server state</option><option value="complete">Complete</option><option value="missing">Missing details</option></select></label>
        <button className="debug-invalidate" onClick={() => update({ enabled: true, authState: "real", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ALL_ONBOARDING_DETAILS.filter((item) => item.owner === "employee").map((item) => item.key) })}>Invalidate employee onboarding</button>
        <p className="debug-help">Clears the local form fixture and requires the employee-owned details again. Server data is unchanged.</p>
      </section>
      <section className="debug-section">
        <h2>Missing details</h2>
        <div className="debug-checks">{ALL_ONBOARDING_DETAILS.map((item) => <label key={item.key}><input type="checkbox" checked={scenario.missingDetails.includes(item.key)} onChange={() => update({ missingDetails: scenario.missingDetails.includes(item.key) ? scenario.missingDetails.filter((entry) => entry !== item.key) : [...scenario.missingDetails, item.key] })} /><span>{item.label}<small>{item.owner}</small></span></label>)}</div>
      </section>
      <section className="debug-section">
        <h2>My Day conditions</h2>
        <label><span>Shift state</span><select value={scenario.dayState} onChange={(event) => update({ dayState: event.target.value as DebugDayState })}>
          <option value="real">Use server state</option><option value="no_shift">No shift</option><option value="scheduled">Scheduled — clock-in required</option><option value="shift_start">Shift start</option><option value="clocked_in">Clocked in</option><option value="paused">Paused</option><option value="catch_up">First-hour follow-up</option><option value="optional">Optional hourly check-in</option><option value="final_hour">Final-hour suppression</option><option value="eod_due">EOD due</option><option value="eod">EOD review</option><option value="clocked_out">Clocked out</option>
        </select></label>
        <div className="debug-checks compact">
          <DebugToggle label="Nifty sync failure" checked={scenario.niftyFailure} onChange={(value) => update({ niftyFailure: value })} />
          <DebugToggle label="No tasks" checked={scenario.emptyTasks} onChange={(value) => update({ emptyTasks: value })} />
          <DebugToggle label="No evidence" checked={scenario.emptyEvidence} onChange={(value) => update({ emptyEvidence: value })} />
          <DebugToggle label="No proposals" checked={scenario.emptyProposals} onChange={(value) => update({ emptyProposals: value })} />
        </div>
        <label><span>Queued updates</span><input type="number" min="0" max="99" value={scenario.queuedUpdates} onChange={(event) => update({ queuedUpdates: Math.max(0, Math.min(99, Number(event.target.value) || 0)) })} /></label>
      </section>
      <button className="debug-reset" onClick={() => update(DEFAULT_DEBUG_SCENARIO)}><RotateCcw size={15} /> Reset all overrides</button>
    </div>}
    {tab === "trace" && <div className="debug-content">
      <div className="trace-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search category, message, correlation" />
        <select value={level} onChange={(event) => setLevel(event.target.value as DiagnosticLevel | "all")}><option value="all">All levels</option><option value="trace">trace</option><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
        <select value={source} onChange={(event) => setSource(event.target.value as DiagnosticSource | "all")}><option value="all">All sources</option><option value="frontend">frontend</option><option value="rust">rust</option><option value="ipc">ipc</option><option value="sync">sync</option><option value="storage">storage</option></select>
        <button onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => setEvents([])}>Clear view</button>
      </div>
      <p className="debug-help">Clearing the view does not delete disk logs. {visible.length} shown / {events.length} buffered.</p>
      <ol className="trace-list">
        {visible.map((event) => <li key={event.id}>
          <button className={`trace-row ${event.level}`} onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
            <time>{event.timestamp.slice(11, 23)}</time>
            <b>{event.level}</b>
            <span>{event.source}</span>
            <strong>{event.category}</strong>
            <em>{event.message}</em>
          </button>
          {expanded === event.id && <pre>{JSON.stringify(event, null, 2)}<button onClick={() => void copyEvent(event)}>Copy event</button></pre>}
        </li>)}
      </ol>
    </div>}
    {tab === "export" && <div className="debug-content">
      <div className="debug-warning">The bundle excludes tokens, cookies, Stronghold contents, transcripts, screenshots, and raw task or update text.</div>
      <ul className="export-list">
        <li>manifest.json — app, session, export time</li>
        <li>app-events.jsonl — redacted structured events</li>
        <li>runtime-health.json — online state and WebView info</li>
        <li>queue-summary.json — counts only, never bodies</li>
        <li>sanitized-config.json — non-secret settings</li>
      </ul>
      <div className="export-actions">
        <button className="primary" onClick={() => void runExport()}><Download size={15} /> Export diagnostics ZIP</button>
        <button onClick={() => void openLogsDir()}>Open logs folder</button>
      </div>
      {exportStatus && <p className="debug-help">{exportStatus}</p>}
    </div>}
  </main>;
}

function DebugToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}
