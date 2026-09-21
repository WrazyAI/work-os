import { useEffect, useRef, useState } from "react";
import { emit, listen } from "./tauriEvents";
import type { DebugScenario } from "./types";
import { MascotPet } from "./MascotPet";
import { MASCOT } from "./mascot";
import { MASCOT_ACTIVITIES, MASCOT_WORKDAYS, isMascotActivity, isMascotWorkday, resolveMascotRuntime, type MascotRuntimeState } from "./mascotRuntimeModel";
import { MASCOT_SEQUENCES, type MascotSequence } from "./mascotDebugSequences";
import "./mascot-runtime.css";

const label = (value: string) => value.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
const ACTIVITY_LABELS = { idle: "Idle", working: "Working", "needs-input": "Needs input", ready: "Completed", blocked: "Failed / blocked" };

/** Presentation-only controls: never call a workday, task, notification or
 * approval API. Delayed steps cannot outlive disable, reset or unmount. */
export function MascotDebugControls({ scenario, onChange }: { scenario: DebugScenario; onChange: (patch: Partial<DebugScenario>) => void }) {
  const [reported, setReported] = useState<Partial<Record<"main" | "avatar", MascotRuntimeState>>>({});
  const [running, setRunning] = useState<MascotSequence | null>(null);
  const [matrix, setMatrix] = useState(false);
  const [dark, setDark] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const expectedOverride = useRef("");
  const overrideKey = JSON.stringify([scenario.mascotActivity ?? null, scenario.mascotWorkday ?? null, scenario.mascotMotion ?? "system", scenario.mascotReplay ?? 0]);
  const latest = useRef({ scenario, onChange });
  latest.current = { scenario, onChange };
  const clearTimers = () => { generation.current++; timers.current.forEach(clearTimeout); timers.current = []; };
  const stop = () => { clearTimers(); setRunning(null); };
  useEffect(() => {
    if (!scenario.enabled) { clearTimers(); setRunning(null); }
  }, [scenario.enabled]);
  useEffect(() => { clearTimers(); setRunning(null); }, [scenario.dayState, scenario.companionForce, scenario.authState, scenario.planningState, scenario.niftyFailure, scenario.syncBypass]);
  useEffect(() => {
    // Presets/reset can replace an override without changing the workday.
    // Own scheduled steps update expectedOverride before emitting their patch.
    if (running && overrideKey !== expectedOverride.current) { clearTimers(); setRunning(null); }
  }, [overrideKey, running]);
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void listen<{ window?: string; state?: MascotRuntimeState }>("work-os://mascot-resolved", ({ payload }) => {
      if (disposed || (payload?.window !== "main" && payload?.window !== "avatar") || !payload.state
        || !isMascotActivity(payload.state.activity) || !isMascotWorkday(payload.state.workday)) return;
      setReported((current) => ({ ...current, [payload.window!]: payload.state }));
    }).then((cleanup) => {
      if (disposed) cleanup();
      else { off = cleanup; void emit("work-os://mascot-request", { window: "debug" }).catch(() => undefined); }
    }).catch(() => undefined);
    return () => { disposed = true; off?.(); };
  }, []);

  const update = (patch: Partial<DebugScenario>) => {
    stop();
    latest.current.onChange(patch);
  };
  const replay = () => update({ mascotReplay: (scenario.mascotReplay ?? 0) + 1 });
  const run = (sequence: MascotSequence) => {
    stop();
    if (!latest.current.scenario.enabled) return;
    setRunning(sequence);
    const token = generation.current;
    const steps = MASCOT_SEQUENCES[sequence];
    steps.forEach((step, index) => {
      const apply = () => {
        if (token !== generation.current || !latest.current.scenario.enabled) return;
        const next = { ...latest.current.scenario, mascotActivity: step.activity, mascotReplay: (latest.current.scenario.mascotReplay ?? 0) + 1 };
        expectedOverride.current = JSON.stringify([next.mascotActivity ?? null, next.mascotWorkday ?? null, next.mascotMotion ?? "system", next.mascotReplay ?? 0]);
        latest.current.onChange({ mascotActivity: next.mascotActivity, mascotReplay: next.mascotReplay });
        if (index === steps.length - 1) setRunning(null);
      };
      if (step.after === 0) apply(); else timers.current.push(setTimeout(apply, step.after));
    });
  };
  const resolved = reported.main ?? reported.avatar;
  // The live window is authoritative in Auto. Before the handshake, explicitly
  // label this isolated sample instead of suggesting it reflects platform truth.
  const preview = resolved ?? resolveMascotRuntime({ connected: false }, {}, scenario);
  return <section className="debug-group" aria-labelledby="mascot-debug-heading">
    <header className="debug-group-head"><h2 id="mascot-debug-heading">Mascot</h2><small>{MASCOT.name}: dashboard, launcher and floating companion</small></header>
    <div className="debug-mascot-preview" style={dark ? { background: "#182018", color: "#fafaf6" } : undefined}>
      <MascotPet isolated agent={preview.activity} workday={preview.workday} reducedMotion={preview.reducedMotion} replayKey={preview.replay} />
      <div><strong>{resolved ? scenario.enabled ? "Window-reported simulation" : "Window-reported live state" : "Sample - waiting for window"}</strong><p>{preview.label}</p><code>{preview.pose} / {preview.tone}</code><p>{preview.reason}</p></div>
    </div>
    {!scenario.enabled && <div className="debug-mascot-actions"><button type="button" onClick={() => update({ enabled: true, liveWrites: false })}>Enable visual preview</button></div>}
    <fieldset className="debug-mascot-controls" disabled={!scenario.enabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="debug-help">Overrides change appearance only. No task is completed, no receipt is written and no notification is sent.</legend>
      <label className="debug-field"><span>Mascot activity</span><select aria-label="Mascot activity" value={scenario.mascotActivity ?? ""} onChange={(event) => update({ mascotActivity: isMascotActivity(event.target.value) ? event.target.value : null })}>
        <option value="">Auto - follow platform</option>{MASCOT_ACTIVITIES.map((state) => <option value={state} key={state}>{ACTIVITY_LABELS[state]}</option>)}
      </select></label>
      <label className="debug-field"><span>Mascot workday</span><select aria-label="Mascot workday" value={scenario.mascotWorkday ?? ""} onChange={(event) => update({ mascotWorkday: isMascotWorkday(event.target.value) ? event.target.value : null })}>
        <option value="">Auto - follow scenario / platform</option>{MASCOT_WORKDAYS.map((state) => <option value={state} key={state}>{label(state)}</option>)}
      </select></label>
      <label className="debug-field"><span>Mascot motion</span><select aria-label="Mascot motion" value={scenario.mascotMotion ?? "system"} onChange={(event) => update({ mascotMotion: event.target.value === "reduced" ? "reduced" : "system" })}>
        <option value="system">Follow system preference</option><option value="reduced">Force reduced motion</option>
      </select></label>
      <div className="debug-mascot-actions">
        <button type="button" onClick={replay}>Replay gesture</button>
        <button type="button" onClick={() => run("success")}>Work to completion</button>
        <button type="button" onClick={() => run("interrupt")}>Interrupt work</button>
        <button type="button" onClick={() => run("recover")}>Failure and recovery</button>
        <button type="button" onClick={() => { stop(); onChange({ mascotActivity: null, mascotWorkday: null, mascotMotion: "system", mascotReplay: 0 }); }}>Stop and restore Auto</button>
      </div>
    </fieldset>
    <p className="debug-help" role="status">{running ? `Running ${running} sequence...` : "No sequence running."} Auto also follows My Day conditions and Companion force. Explicit mascot overrides win while the scenario is enabled.</p>
    <div className="debug-mascot-actions"><button type="button" aria-pressed={dark} onClick={() => setDark((value) => !value)}>Dark preview surface</button><button type="button" aria-expanded={matrix} onClick={() => setMatrix((value) => !value)}>All 35 combinations</button></div>
    {matrix && <div className="mascot-lab-state-grid" style={{ marginTop: 16 }}>{MASCOT_WORKDAYS.flatMap((workday) => MASCOT_ACTIVITIES.map((agent) => <div className="mascot-lab-state" key={`${workday}-${agent}`}><MascotPet isolated agent={agent} workday={workday} reducedMotion={preview.reducedMotion} replayKey={preview.replay} /><small>{label(workday)} / {ACTIVITY_LABELS[agent]}</small></div>))}</div>}
    <div className="debug-mascot-readout" aria-label="Reported mascot states"><strong>Last reported by each window</strong>{(["main", "avatar"] as const).map((windowName) => <div key={windowName}>{windowName}: {reported[windowName] ? `${reported[windowName]!.activity} / ${reported[windowName]!.workday} / ${reported[windowName]!.pose} (${reported[windowName]!.source})` : "No response yet - open this window to verify."}</div>)}</div>
  </section>;
}
