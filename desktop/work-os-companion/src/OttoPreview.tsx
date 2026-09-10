import { Otto, type OttoPose } from "./Otto";
import { LayoutDashboard, ListChecks, MessageSquareText, Gauge, ShieldCheck, Settings } from "lucide-react";
import wordmark from "./assets/work-os-mark.png";

const POSES: OttoPose[] = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"];
const SIZES = [16, 24, 36, 64] as const;

/** Visual review for Otto: every pose, at favicon through hero sizes, on light and dark. */
export default function OttoPreview() {
  return <div className="workspace preview-workspace">
    <aside className="rail"><div className="wordmark"><img src={wordmark} alt="" /><span>WORK <b>OS</b></span></div><nav aria-label="Work OS"><div className="nav-group nav-core">{[[LayoutDashboard, "My day"], [ListChecks, "Tasks"], [MessageSquareText, "Review"]].map(([Icon, label]) => <button key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-context">{[[Gauge, "Insights"], [ShieldCheck, "Evidence"]].map(([Icon, label]) => <button key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-settings"><button><Settings size={18} /><span>Settings</span></button></div></nav></aside>
    <section className="stage">
      <main className="page">
        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Otto — every pose on light</span></div>
          <div className="otto-preview-grid">{POSES.map((pose) => <div className="otto-preview-cell" key={pose}><Otto pose={pose} className="otto-preview-figure" /><small>{pose}</small></div>)}</div>
        </section>
        <section className="panel otto-preview-panel">
          <div className="card-title"><span>Sizes — favicon through hero</span></div>
          <div className="otto-preview-sizes">{SIZES.map((size) => <div className="otto-preview-cell" key={size}><Otto pose="idle" style={{ width: size, height: size }} /><small>{size}px</small></div>)}</div>
        </section>
        <section className="panel otto-preview-panel otto-preview-dark">
          <div className="card-title"><span>On the dark pre-app shell</span></div>
          <div className="otto-preview-grid"><Otto pose="idle" className="otto-connect" /><Otto pose="celebrate" className="otto-celebrate" /></div>
        </section>
      </main>
    </section>
  </div>;
}
