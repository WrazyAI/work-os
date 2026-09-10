import { DashboardSkeleton, InsightsSkeleton, TaskDetailSkeleton, TaskListSkeleton } from "./LoadingUi";
import { LayoutDashboard, ListChecks, MessageSquareText, Gauge, ShieldCheck, Settings } from "lucide-react";
import wordmark from "./assets/work-os-mark.png";

/** Visual review states for every skeleton in the loading language. */
export default function SkeletonsPreview() {
  return <div className="workspace preview-workspace">
    <aside className="rail"><div className="wordmark"><img src={wordmark} alt="" /><span>WORK <b>OS</b></span></div><nav aria-label="Work OS"><div className="nav-group nav-core">{[[LayoutDashboard, "My day"], [ListChecks, "Tasks"], [MessageSquareText, "Review"]].map(([Icon, label]) => <button key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-context">{[[Gauge, "Insights"], [ShieldCheck, "Evidence"]].map(([Icon, label]) => <button key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-settings"><button><Settings size={18} /><span>Settings</span></button></div></nav><div className="rail-foot"><span className="presence" /><div><strong>Loading</strong><small>Syncing</small></div></div></aside>
    <section className="stage">
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Dashboard skeleton</span></div></main>
      <DashboardSkeleton />
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Tasks skeleton</span></div><section className="panel task-list-panel"><TaskListSkeleton rows={5} /></section></main>
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Task detail skeleton</span></div><section className="panel"><TaskDetailSkeleton /></section></main>
      <main className="page"><div className="card-title"><span><ListChecks size={17} /> Insights skeleton</span></div><section className="panel"><InsightsSkeleton /></section></main>
    </section>
  </div>;
}
