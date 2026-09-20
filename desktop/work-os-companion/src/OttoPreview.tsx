import { Otto, type OttoPose } from "./Otto";
import SidebarNav from "./SidebarNav";
import { SIDEBAR_PREVIEW_CHATS } from "./sidebarPreviewData";

const POSES: OttoPose[] = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"];
const SIZES = [16, 24, 36, 64] as const;

/** Visual review for Otto: every pose, at favicon through hero sizes, on light and dark. */
export default function OttoPreview() {
  return <div className="workspace preview-workspace">
    <SidebarNav activeView="day" onNavigate={() => undefined} onNewChat={() => undefined} onSelectChat={() => undefined} status={{ label: "On shift", detail: "Synced", tone: "live" }} chats={SIDEBAR_PREVIEW_CHATS} initiallyCollapsed={new URLSearchParams(window.location.search).get("sidebar") !== "expanded"} />
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
