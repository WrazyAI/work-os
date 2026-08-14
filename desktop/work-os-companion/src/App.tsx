import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, BriefcaseBusiness, Bug, Check, ChevronRight, CirclePause, CirclePlay, Clock3, FileCheck2, Fingerprint, Gauge, Inbox, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquareText, Pause, PlugZap, RefreshCw, RotateCcw, Send, Settings, ShieldCheck, Sparkles, X } from "lucide-react";
import { apiRequest, flushQueue, sendOrQueue } from "./api";
import { beginAuthentication, errorMessage, listenForAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openDebuggerWindow, openLogsDir } from "./diagnostics";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import { schedulePrompt } from "./scheduler";
import { sessionGate } from "./sessionGate";
import type { DailyPlanItem, DayData, DebugScenario, DesktopSession, OnboardingData } from "./types";
import { secureState } from "./vault";
import companionArt from "./assets/work-os-companion.png";
import wordmark from "./assets/work-os-mark.png";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

type View = "day" | "plan" | "review" | "insights" | "evidence" | "settings";
const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "day", label: "My day", icon: LayoutDashboard }, { id: "plan", label: "Plan", icon: ListChecks },
  { id: "review", label: "Review", icon: MessageSquareText }, { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck }, { id: "settings", label: "Settings", icon: Settings },
];

const formatTime = (value?: string | null, zone?: string) => value ? new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());

export default function App() {
  const [session, setSession] = useState<DesktopSession | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [view, setView] = useState<View>("day");
  const [input, setInput] = useState("");
  const [updateKind, setUpdateKind] = useState("material_progress");
  const [planIntent, setPlanIntent] = useState("");
  const [planItems, setPlanItems] = useState<DailyPlanItem[]>([]);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [apiBase, setApiBase] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectHint, setConnectHint] = useState("");
  const [debugError, setDebugError] = useState<React.ReactNode>(null);
  const [debugScenario, setDebugScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  const debugRef = useRef(debugScenario);

  const refresh = useCallback(async () => {
    const [nextDay, nextOnboarding] = await Promise.all([apiRequest<DayData>("/api/work-os/me/day"), apiRequest<OnboardingData>("/api/work-os/me/onboarding")]);
    setDay(nextDay); setOnboarding(nextOnboarding); setReport(nextDay.report?.markdown ?? "");
    setPlanIntent(nextDay.plan?.freeform_intent ?? ""); setPlanItems([...(nextDay.plan?.items ?? [])].sort((a, b) => a.rank - b.rank));
    await schedulePrompt(nextDay, () => apiRequest<DayData>("/api/work-os/me/day"));
    return nextDay;
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void Promise.all([secureState.session(), secureState.queue(), secureState.settings(), isEnabled()]).then(([saved, queue, settings, enabled]) => {
      const current = saved?.apiBase ? saved : null; setSession(current); setQueueCount(queue.length); setApiBase(settings.apiBase); setAutoStart(enabled);
      if (current) void refresh().catch((value) => setError(errorMessage(value, "Could not load your workday.")));
    }).catch((value) => setError(errorMessage(value, "Could not open the local vault.")));
    void listenForAuthentication((saved) => { setSession(saved); setConnectHint(""); void refresh(); }, (value) => setError(errorMessage(value, "Desktop authorization failed."))).then((fn) => { cleanup = fn; }).catch((value) => setError(errorMessage(value, "Could not listen for desktop sign-in.")));
    return () => cleanup?.();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const recover = async () => { if (!navigator.onLine) return; const result = await flushQueue(); setQueueCount(result.remaining); await refresh(); };
    window.addEventListener("online", recover); const timer = window.setInterval(() => void recover().catch(() => undefined), 60_000);
    return () => { window.removeEventListener("online", recover); clearInterval(timer); };
  }, [refresh, session]);

  useEffect(() => {
    let unlistenScenario: (() => void) | undefined;
    let unlistenRequest: (() => void) | undefined;
    void listen<DebugScenario>("work-os://debug-scenario", (event) => {
      debugRef.current = event.payload;
      setDebugScenario(event.payload);
    }).then((fn) => { unlistenScenario = fn; }).catch(() => undefined);
    void listen("work-os://debug-request", () => {
      void emit("work-os://debug-current", debugRef.current);
    }).then((fn) => { unlistenRequest = fn; }).catch(() => undefined);
    return () => { unlistenScenario?.(); unlistenRequest?.(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void openDebugger();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError("");
    diagnostics.info("ui.action.requested", label, { activeView: view });
    try {
      if (debugRef.current.enabled) throw new Error("Scenario mode is active. Reset the debugger scenario before submitting real changes.");
      await action(); setQueueCount((await secureState.queue()).length); await refresh();
      diagnostics.info("ui.action.completed", label, { activeView: view });
    }
    catch (value) {
      const message = value instanceof Error ? value.message : "Action failed";
      diagnostics.error("ui.action.failed", message, { action: label, activeView: view });
      setError(message);
    }
    finally { setBusy(false); }
  }
  function setScenario(next: DebugScenario) { debugRef.current = next; setDebugScenario(next); void emit("work-os://debug-current", next); }

  async function openDebugger() {
    try {
      await openDebuggerWindow();
      setDebugError(null);
      diagnostics.info("debug.window.open", "Opened Work OS Debugger");
    } catch (value) {
      diagnostics.error("debug.window.open_failed", value instanceof Error ? value.message : "open failed");
      setDebugError(<DebugFailedNotice onDismiss={() => setDebugError(null)} />);
    }
  }

  async function logout() {
    setBusy(true); setError("");
    try {
      if (session && !debugRef.current.enabled) await apiRequest("/api/work-os/desktop/session", { method: "DELETE" });
    } catch {
      // Local sign-out must still succeed if the server is unavailable.
    } finally {
      await secureState.clearAccount();
      setSession(null); setDay(null); setOnboarding(null); setQueueCount(0); setView("day");
      setScenario(DEFAULT_DEBUG_SCENARIO); setBusy(false);
    }
  }

  async function resetOnboarding() {
    if (!window.confirm("Restart onboarding? Your personal setup answers will be cleared. Your role, team, manager, official schedule, and consent history will remain intact.")) return;
    if (debugRef.current.enabled) {
      setScenario({ ...debugRef.current, onboardingState: "missing", invalidateOnboardingData: true });
      setView("day");
      return;
    }
    setBusy(true); setError("");
    try {
      const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "DELETE" });
      setOnboarding(next); setView("day");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Onboarding could not be reset.");
    } finally { setBusy(false); }
  }

  const visibleOnboarding = useMemo(() => applyOnboardingScenario(onboarding, debugScenario), [onboarding, debugScenario]);
  const visibleDay = useMemo(() => applyDayScenario(day, debugScenario), [day, debugScenario]);
  const visibleSession = debugScenario.enabled
    ? debugScenario.authState === "unauthenticated" ? null : session ?? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "Local scenario" }
    : session;
  useEffect(() => {
    if (debugScenario.enabled && visibleDay?.plan) {
      setPlanIntent(visibleDay.plan.freeform_intent ?? "");
      setPlanItems([...visibleDay.plan.items].sort((a, b) => a.rank - b.rank));
    }
  }, [debugScenario.enabled, visibleDay?.plan]);
  const workSession = visibleDay?.session;
  const gate = sessionGate(visibleDay);
  const active = gate.active;
  const paused = workSession?.state === "paused";
  const openTasks = visibleDay?.tasks.filter((task) => !task.completed) ?? [];
  const selectedItems = planItems.filter((item) => item.disposition === "selected");

  async function connectWorkspace() {
    setConnecting(true); setError(""); setConnectHint("");
    try {
      await beginAuthentication(apiBase);
      setConnectHint("Browser opened. Sign in to WrazyOS if asked, then authorize this device.");
    } catch (value) {
      setError(errorMessage(value, "Could not open workspace sign-in."));
    } finally {
      setConnecting(false);
    }
  }

  function clockIn() {
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop", late_acknowledged: true }));
  }

  function requireActive(label: string, action: () => Promise<unknown>) {
    if (!active) {
      diagnostics.warn("ui.action.blocked", gate.message, { action: label, activeView: view });
      setError(gate.message);
      return;
    }
    void act(label, action);
  }

  if (!visibleSession) return <ConnectScreen apiBase={apiBase} setApiBase={setApiBase} error={error} hint={connectHint} connecting={connecting} debugError={debugError} onDebug={() => void openDebugger()} onConnect={() => void connectWorkspace()} onSave={async () => secureState.saveSettings({ apiBase })} />;
  if (!visibleOnboarding) return <LoadingScreen error={error} retry={() => void refresh()} />;
  if (visibleOnboarding.onboardingRequired) return <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} appError={error} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={() => void refresh()} onSaveDraft={async (body) => { if (!debugScenario.enabled) await apiRequest("/api/work-os/me/onboarding", { method: "PUT", body: JSON.stringify(body) }); }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", body: JSON.stringify(body) }); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} />;

  const moveItem = (id: string, amount: number) => setPlanItems((items) => {
    const index = items.findIndex((item) => item.id === id); const target = index + amount;
    if (index < 0 || target < 0 || target >= items.length) return items;
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next.map((item, rank) => ({ ...item, rank }));
  });

  function proposeRemoval(item: DailyPlanItem) {
    const reason = window.prompt(`Why should “${item.title_snapshot}” be removed from today’s plan?`, "Priority changed or no longer relevant.");
    if (!reason?.trim()) return;
    requireActive("plan.removal_propose", () => sendOrQueue("/api/work-os/me/plan/removals", "POST", { plan_item_id: item.id, reason: reason.trim() }));
  }

  return <div className="workspace">
    <aside className="rail">
      <div className="wordmark"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div>
      <nav>{views.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === "review" && !!visibleDay?.proposals.length && <em>{visibleDay.proposals.length}</em>}</button>)}</nav>
      <div className="rail-foot"><span className={`presence ${active && !paused ? "live" : ""}`} /> <div><strong>{active ? paused ? "Paused" : "On shift" : "Off shift"}</strong><small>{queueCount ? `${queueCount} queued` : navigator.onLine ? "Synced" : "Offline"}</small></div></div>
    </aside>
    <section className="stage">
      <header className="masthead"><div><p>{visibleDay?.shiftDate}</p><h1>{views.find((item) => item.id === view)?.label}</h1></div><div className="mast-actions"><span className="provider"><PlugZap size={14} /> Nifty {visibleDay?.niftySync?.fresh ? "live" : "delayed"}</span><button className="icon" title="Refresh" onClick={() => void refresh()}><RefreshCw size={17} /></button><button className="avatar" aria-label="Profile">DZ</button></div></header>
      {error && <div className="notice error" role="alert"><AlertTriangle size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
      {debugError}
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> Scenario mode is active. Writes are disabled.<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {!active && <div className="notice session-gate" role="status"><Clock3 size={15} /><span>{gate.message}</span>{gate.canClockIn && <button className="primary" disabled={busy} onClick={clockIn}><CirclePlay size={15} /> Clock in</button>}</div>}
      {view === "day" && <main className="day-grid">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{active ? `${sentence(workSession!.state)} · ${formatTime(workSession?.clocked_in_at, visibleDay?.shift?.timezone)}` : "Ready when you are"}</span><h2>{active ? paused ? "Take the pause." : "Make today count." : "Your workday, in focus."}</h2><p>{active ? visibleDay?.prompt.reason : visibleDay?.shift ? `Scheduled ${formatTime(visibleDay.shift.startsAt, visibleDay.shift.timezone)}–${formatTime(visibleDay.shift.endsAt, visibleDay.shift.timezone)}. Clock in when you begin.` : "No scheduled shift is available today."}</p>
            <div className="hero-actions">{!active ? <button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button> : <><button className="primary" disabled={busy} onClick={() => void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }))}>{paused ? <CirclePlay size={17} /> : <CirclePause size={17} />}{paused ? "Resume" : "Pause"}</button><button disabled={busy} onClick={() => window.confirm("Clock out and close today’s plan?") && void act("shift.clock_out", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: "clock_out", extended_acknowledged: true }))}>Clock out</button></>}</div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay.attendance.message}</small>}
          </div><img className="companion" src={assetUrl(companionArt)} alt="Abstract Work OS companion" />
        </section>
        <section className="pulse-card"><div className="card-title"><span><Activity size={17} /> Shift pulse</span><small>{active ? "Live" : "Waiting"}</small></div><div className="pulse-time">{active ? formatTime(workSession?.clocked_in_at, visibleDay?.shift?.timezone) : "00:00"}</div><div className="meter"><i style={{ width: active ? "42%" : "0%" }} /></div><div className="stat-row"><span><small>Next check-in</small><strong>{formatTime(visibleDay?.prompt.nextPromptAt, visibleDay?.shift?.timezone)}</strong></span><span><small>Open tasks</small><strong>{openTasks.length}</strong></span><span><small>Reviews</small><strong>{visibleDay?.proposals.length ?? 0}</strong></span></div></section>
        <section className="capture-card"><div className="card-title"><span><Sparkles size={17} /> {visibleDay?.prompt.kind === "eod" ? "Close the loop" : "Update your companion"}</span><small>{visibleDay?.prompt.required ? "Due now" : "Natural language"}</small></div><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="What changed? Mention progress, blockers, priorities, or work you completed…" /><div className="capture-actions"><select value={updateKind} onChange={(event) => setUpdateKind(event.target.value)}><option value="starting">Starting</option><option value="continuing">Continuing</option><option value="material_progress">Material progress</option><option value="completion_claim">Completion claim</option><option value="blocked">Blocked</option><option value="priority_change">Priority changed</option><option value="unplanned_work">Unplanned work</option></select><button className="primary" disabled={!input.trim() || busy} onClick={() => requireActive("check_in.create", async () => { await sendOrQueue("/api/work-os/check-ins", "POST", { source: "desktop", kind: visibleDay?.prompt.kind || "optional", update_kind: updateKind, input_text: input }); setInput(""); })}><Send size={16} /> Send update</button></div></section>
        <section className="focus-card"><div className="card-title"><span><BriefcaseBusiness size={17} /> Today’s focus</span><button onClick={() => setView("plan")}>Edit plan <ChevronRight size={14} /></button></div>{selectedItems.length ? selectedItems.slice(0, 4).map((item, index) => <div className="focus-row" key={item.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.title_snapshot}</strong><small>{sentence(item.source)}{item.blocker ? ` · Blocked: ${item.blocker}` : ""}</small></div><span>{item.disposition}</span></div>) : <Empty title="No plan yet" body="Clock in to pull your open and carry-over work into a daily plan." />}</section>
      </main>}
      {view === "plan" && <main className="page"><PageIntro eyebrow="Daily planning" title="Choose the work that earns today." body="Nifty remains the source of truth. Reorder, defer, or propose removal without deleting provider tasks." /><section className="panel"><label className="intent"><span>Today’s intent</span><textarea value={planIntent} onChange={(event) => setPlanIntent(event.target.value)} placeholder="What outcome would make today successful?" /></label><div className="plan-list">{planItems.map((item, index) => <article key={item.id} className={item.disposition !== "selected" ? "deferred" : ""}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.title_snapshot}</strong><small>{sentence(item.source)}{item.blocker ? ` · ${item.blocker}` : ""}</small></div><div className="plan-controls"><button aria-label="Move up" disabled={item.disposition === "removed" || item.disposition === "removal_proposed"} onClick={() => moveItem(item.id, -1)}><ArrowUp size={15} /></button><button aria-label="Move down" disabled={item.disposition === "removed" || item.disposition === "removal_proposed"} onClick={() => moveItem(item.id, 1)}><ArrowDown size={15} /></button>{item.disposition === "selected" || item.disposition === "deferred" ? <><button onClick={() => setPlanItems((items) => items.map((entry) => entry.id === item.id ? { ...entry, disposition: entry.disposition === "selected" ? "deferred" : "selected" } : entry))}>{item.disposition === "selected" ? "Defer" : "Restore"}</button><button onClick={() => proposeRemoval(item)}>Propose removal</button></> : <span>{item.disposition === "removal_proposed" ? "Removal pending review" : "Removed from plan"}</span>}</div></article>)}</div><div className="panel-actions"><button className="primary" disabled={busy} onClick={() => requireActive("plan.confirm", () => sendOrQueue("/api/work-os/me/plan", "PATCH", { confirm: true, freeform_intent: planIntent, item_ids: planItems.filter((item) => item.disposition === "selected").map((item) => item.id), deferred_ids: planItems.filter((item) => item.disposition === "deferred").map((item) => item.id) }))}><Check size={16} /> Confirm plan</button></div></section></main>}
      {view === "review" && <main className="page"><PageIntro eyebrow="Human in the loop" title="Review before anything changes." body="Your words become structured proposals. Nothing writes back to Nifty without explicit approval." /><section className="proposal-grid">{visibleDay?.proposals.length ? visibleDay.proposals.map((proposal) => <article className="proposal-card" key={proposal.id}><span>{sentence(proposal.operation)}</span><h3>{proposal.proposed_change?.name || proposal.proposed_change?.title || proposal.proposed_change?.summary || proposal.input_text}</h3><p>Original statement preserved · {proposal.status}</p><div><button disabled={busy} onClick={() => void act("proposal.reject", () => sendOrQueue(`/api/work-os/proposals/${proposal.id}`, "PATCH", { decision: "reject" }))}>Reject</button><button className="primary" disabled={busy} onClick={() => void act("proposal.accept", () => sendOrQueue(`/api/work-os/proposals/${proposal.id}`, "PATCH", { decision: "accept" }))}><Check size={15} /> Approve</button></div></article>) : <Empty title="All clear" body="No AI proposals are waiting for your review." />}</section></main>}
      {view === "insights" && <main className="page"><PageIntro eyebrow="Work signals" title="Progress without surveillance theater." body="Observed activity, employee claims, and output evidence stay separate so the record remains honest." /><div className="metric-grid"><Metric icon={Clock3} label="Shift state" value={active ? sentence(workSession!.state) : "Off shift"} /><Metric icon={ListChecks} label="Plan coverage" value={`${selectedItems.length} priorities`} /><Metric icon={Fingerprint} label="Evidence events" value={String(visibleDay?.evidence.length ?? 0)} /><Metric icon={Inbox} label="Pending reviews" value={String(visibleDay?.proposals.length ?? 0)} /></div><section className="panel insight"><h3>Today’s signal mix</h3><div className="signal-bars"><span><b style={{ width: "76%" }} />Employee updates</span><span><b style={{ width: "52%" }} />Output evidence</span><span><b style={{ width: "34%" }} />Activity context</span></div><p>These are descriptive signals, not a performance score. Work OS does not infer attendance or completion from screenshots.</p></section></main>}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : "Output evidence"}</span><div><h3>{item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
      {view === "settings" && <main className="page"><PageIntro eyebrow="Workspace control" title="Your companion, your boundaries." body="Manage launch behavior, local sync, privacy context, updates, and diagnostics." /><section className="settings-panel"><Setting title="Start with Windows" detail="Open quietly in the tray after sign-in"><input type="checkbox" checked={autoStart} onChange={async (event) => { event.target.checked ? await enable() : await disable(); setAutoStart(event.target.checked); }} /></Setting><Setting title="Offline queue" detail={queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className="status-dot">Ready</span></Setting><Setting title="Scenario debugger" detail="Opens a separate diagnostics window. Ctrl+Shift+D"><button onClick={() => void openDebugger()}><Bug size={15} /> Open</button></Setting><Setting title="Export diagnostics" detail="Redacted ZIP of recent events. Never includes tokens or queue bodies."><button onClick={async () => { const queue = await secureState.queue(); const path = await exportDiagnostics({ runtimeHealth: { online: navigator.onLine, queueCount }, queueSummary: { count: queue.length, paths: queue.map((item) => item.path), attempts: queue.map((item) => item.attempts) }, sanitizedConfig: { apiBase: visibleSession.apiBase, autoStart } }); setUpdateStatus(`Exported ${path}`); }}>Export</button></Setting><Setting title="Desktop updates" detail={updateStatus || "Stable channel"}><button onClick={async () => { setUpdateStatus("Checking…"); const update = await check(); if (!update) return setUpdateStatus("Up to date"); await update.downloadAndInstall(); await relaunch(); }}>Check</button></Setting><Setting title="Restart onboarding" detail="Clear your personal setup answers and return to employee onboarding. Manager-owned setup and consent history stay intact."><button disabled={busy} onClick={() => void resetOnboarding()}><RotateCcw size={15} /> Reset</button></Setting><Setting title="Account session" detail={`Signed in through ${visibleSession.apiBase}`}><button className="danger" disabled={busy} onClick={() => void logout()}><LogOut size={15} /> Sign out</button></Setting></section></main>}
    </section>
  </div>;
}

function ConnectScreen({ apiBase, setApiBase, error, hint, connecting, debugError, onDebug, onConnect, onSave }: { apiBase: string; setApiBase: (value: string) => void; error: string; hint: string; connecting: boolean; debugError: React.ReactNode; onDebug: () => void; onConnect: () => void; onSave: () => Promise<void> }) { return <main className="connect"><section><div className="wordmark large"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div><span className="kicker">Desktop companion</span><h1>Clarity for the workday.</h1><p>Plan what matters, capture progress naturally, and close the loop—without turning work into surveillance.</p>{error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}{hint && <div className="notice">{hint}</div>}{debugError}<button className="primary connect-button" disabled={connecting} onClick={onConnect}><LogIn size={17} /> {connecting ? "Opening browser…" : "Connect workspace"}</button><details><summary>Server settings</summary><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" /><button onClick={() => void onSave()}>Save</button></details><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></section><aside><img src={assetUrl(companionArt)} alt="Work OS companion" /></aside></main>; }
function LoadingScreen({ error, retry }: { error: string; retry: () => void }) { return <main className="loading"><img src={assetUrl(wordmark)} alt="" /><h1>{error ? "Couldn’t load Work OS" : "Preparing your workday"}</h1><p>{error || "Syncing your schedule, plan, and provider context…"}</p>{error && <button className="primary" onClick={retry}>Retry</button>}</main>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><p>{body}</p></div>; }
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <header className="page-intro"><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p></header>; }
function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }
function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
function DebugFailedNotice({ onDismiss }: { onDismiss: () => void }) {
  return <div className="notice error" role="alert"><AlertTriangle size={16} />Debugger window could not open.<button onClick={() => void openLogsDir()}>Open logs folder</button><button onClick={onDismiss}><X size={14} /></button></div>;
}
