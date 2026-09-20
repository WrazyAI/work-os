import { DashboardSkeleton, InsightsSkeleton, TaskDetailSkeleton, TaskListSkeleton } from "./LoadingUi";
import { ListChecks } from "lucide-react";
import SidebarNav from "./SidebarNav";
import { SIDEBAR_PREVIEW_CHATS } from "./sidebarPreviewData";

/** Visual review states for every skeleton in the loading language. */
export default function SkeletonsPreview() {
  return <div className="workspace preview-workspace">
    <SidebarNav activeView="day" onNavigate={() => undefined} onNewChat={() => undefined} onSelectChat={() => undefined} status={{ label: "Loading", detail: "Syncing", tone: "loading" }} chats={SIDEBAR_PREVIEW_CHATS} initiallyCollapsed={new URLSearchParams(window.location.search).get("sidebar") !== "expanded"} />
    <section className="stage">
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Dashboard skeleton</span></div></main>
      <DashboardSkeleton />
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Tasks skeleton</span></div><section className="panel task-list-panel"><TaskListSkeleton rows={5} /></section></main>
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Task detail skeleton</span></div><section className="panel"><TaskDetailSkeleton /></section></main>
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Insights skeleton</span></div><section className="panel"><InsightsSkeleton /></section></main>
    </section>
  </div>;
}
