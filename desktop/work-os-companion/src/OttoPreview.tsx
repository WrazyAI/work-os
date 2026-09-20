import { useEffect, useRef, useState } from "react";
import { Otto } from "./Otto";
import { MascotPet } from "./MascotPet";
import { MASCOT } from "./mascot";
import type { MascotAgentActivity, MascotWorkdayState } from "./mascotState";
import { MASCOT_POSES, type MascotPose } from "./mascotTypes";
import SidebarNav from "./SidebarNav";

const POSES: MascotPose[] = [...MASCOT_POSES];
const CORE_STATES: MascotAgentActivity[] = ["idle", "working", "needs-input", "ready"];
const WORKDAY_STATES: MascotWorkdayState[] = ["disconnected", "off-shift", "active", "paused", "late", "check-in-due", "eod-due"];
const SIZES = [16, 24, 36, 64] as const;

/** Converts state ids into the readable labels shown in the lab controls. */
const titleCase = (value: string) => value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

/** Mascot Lab: behavior, transitions, scaling, dark/light contrast, and the
 * Signal Spirit lifecycle in one dev-only surface. */
export default function OttoPreview() {
  const [agent, setAgent] = useState<MascotAgentActivity>("idle");
  const [workday, setWorkday] = useState<MascotWorkdayState>("active");
  const [dark, setDark] = useState(false);
  const [scale, setScale] = useState<1 | 2>(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timers = useRef<number[]>([]);

  /** Cancels any in-flight state sequence before a new preview starts. */
  const clearSequence = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  /** Queues one lifecycle transition while keeping timers under one cleanup path. */
  const schedule = (delay: number, next: MascotAgentActivity) => {
    timers.current.push(window.setTimeout(() => setAgent(next), delay));
  };

  /** Replays a normal working-to-attention-to-ready notification journey. */
  const runNotificationSequence = () => {
    clearSequence();
    setAgent("working");
    schedule(850, "needs-input");
    schedule(1_850, "ready");
    schedule(3_000, "idle");
  };

  /** Stops work at the needs-input state to test an interruptible transition. */
  const runInterruptionSequence = () => {
    clearSequence();
    setAgent("working");
    schedule(900, "needs-input");
  };

  return <div className="workspace preview-workspace">
    <SidebarNav activeView="day" onNavigate={() => undefined} onNewChat={() => undefined} initiallyCollapsed={new URLSearchParams(window.location.search).get("sidebar") !== "expanded"} />
    <section className="stage">
      <main className={`page mascot-lab${reducedMotion ? " reduced-motion" : ""}`}>
        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Mascot Lab — {MASCOT.name}</span><small>Signal Spirit prototype · Rive-ready state contract</small></div>
          <div className="mascot-lab-controls" aria-label="Agent lifecycle">
            {CORE_STATES.map((state) => <button key={state} aria-pressed={agent === state} onClick={() => { clearSequence(); setAgent(state); }}>{titleCase(state)}</button>)}
            <button aria-pressed={agent === "blocked"} onClick={() => { clearSequence(); setAgent("blocked"); }}>Blocked</button>
          </div>
          <div className="mascot-lab-controls" aria-label="Workday state">
            {WORKDAY_STATES.map((state) => <button key={state} aria-pressed={workday === state} onClick={() => setWorkday(state)}>{titleCase(state)}</button>)}
          </div>
          <div className="mascot-lab-controls" aria-label="Preview options">
            <button aria-pressed={dark} onClick={() => setDark((value) => !value)}>{dark ? "Dark surface" : "Light surface"}</button>
            <button aria-pressed={scale === 2} onClick={() => setScale((value) => value === 1 ? 2 : 1)}>{scale}× scale</button>
            <button aria-pressed={reducedMotion} onClick={() => setReducedMotion((value) => !value)}>Reduced motion</button>
            <button onClick={runNotificationSequence}>Run notification</button>
            <button onClick={runInterruptionSequence}>Interrupt work</button>
          </div>
          <div className={`mascot-lab-live ${dark ? "dark" : ""} scale-${scale}`}>
            <MascotPet agent={agent} workday={workday} />
          </div>
        </section>

        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Core lifecycle — light</span><small>Idle · working · needs input · ready</small></div>
          <div className="mascot-lab-state-grid">
            {CORE_STATES.map((state) => <div className="mascot-lab-state" key={state}><MascotPet agent={state} workday="active" /><small>{titleCase(state)}</small></div>)}
          </div>
        </section>

        <section className="panel otto-preview-panel otto-preview-dark">
          <div className="card-title"><span>Core lifecycle — dark</span><small>Contrast and silhouette check</small></div>
          <div className="mascot-lab-state-grid">
            {CORE_STATES.map((state) => <div className="mascot-lab-state dark" key={state}><MascotPet agent={state} workday="active" /><small>{titleCase(state)}</small></div>)}
          </div>
        </section>

        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Mark sizes</span><small>Signal Spirit identity readability</small></div>
          <div className="otto-preview-sizes">{SIZES.map((size) => <div className="otto-preview-cell" key={size}><Otto pose="idle" style={{ width: size, height: size }} /><small>{size}px</small></div>)}</div>
        </section>

        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Legacy Otto comparison</span><small>Reference only — retained while the new Signal Spirit is validated</small></div>
          <div className="otto-preview-grid">{POSES.map((pose) => <div className="otto-preview-cell" key={pose}><Otto pose={pose} className="otto-preview-figure" /><small>{pose}</small></div>)}</div>
        </section>
      </main>
    </section>
  </div>;
}
