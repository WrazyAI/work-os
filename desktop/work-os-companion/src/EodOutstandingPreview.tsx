import { useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { NotificationsBell } from "./NotificationsBell";
import { EodComposer } from "./taskSurfaces";
import type { OutstandingEodDay } from "./types";

const DRAFT = "## Summary\nFinished the settlement reconciliation and documented the handoff.\n\n## Completed\n- Reconcile September 10 payments\n\n## Carried forward\n- Two approvals still pending";

const NORMAL: OutstandingEodDay[] = [
  { date: "2026-09-10", status: "draft_unsubmitted", reportId: "r-10", observedMinutes: 290, completedTasks: 10, hasPlan: true },
  { date: "2026-09-08", status: "no_draft", reportId: null, observedMinutes: 319, completedTasks: 7, hasPlan: true },
  { date: "2026-09-03", status: "changes_requested", reportId: "r-03", observedMinutes: 306, completedTasks: 7, hasPlan: true },
];

function weekdaysBefore(start: string, count: number) {
  const out: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  while (out.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}

const DENSE: OutstandingEodDay[] = weekdaysBefore("2026-09-11", 9).map((date, index) => ({
  date,
  status: index % 3 === 0 ? "no_draft" as const : index % 3 === 1 ? "draft_unsubmitted" as const : "changes_requested" as const,
  reportId: index % 3 === 0 ? null : `r-${index}`,
  observedMinutes: 120 + index * 27,
  completedTasks: (index * 3) % 11,
  hasPlan: index % 2 === 0,
}));

export default function EodOutstandingPreview() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "normal";
  const [open, setOpen] = useState(state !== "selected");
  const days = state === "empty" || state === "loading" ? [] : state === "dense" ? DENSE : NORMAL;
  const masthead = <header className="masthead">
    <div><p>September 11</p><div className="masthead-title-row"><h1>{state === "selected" ? "EOD Review" : "My Day"}</h1>{days.length > 0 && <button type="button" className="eod-attention-pill"><AlertTriangle size={12} />{days.length} prior EOD{days.length === 1 ? "" : "s"} need attention</button>}</div></div>
    <div className="mast-actions">
      <span className="provider nifty-state fresh">Nifty current</span>
      <NotificationsBell
        memoryCandidates={0}
        recap={null}
        days={days}
        loading={state === "loading"}
        error={state === "error" ? "Outstanding EODs could not be loaded." : null}
        open={open}
        onToggle={() => setOpen((current) => !open)}
        onClose={() => setOpen(false)}
        onSelect={() => setOpen(false)}
        onOpenMemory={() => undefined}
        onOpenRecap={() => undefined}
        onRetry={() => undefined}
      />
      <button className="icon" title="Refresh this page" disabled><span /></button>
      <button className="avatar" aria-label="Profile for Preview">PV</button>
    </div>
  </header>;
  if (state === "selected") {
    return <div className="workspace preview-workspace"><section className="stage">{masthead}<main className="page">
      <div className="eod-day-context"><button type="button"><ArrowLeft size={14} /> Back to today</button><span>EOD for September 10.</span></div>
      <EodComposer
        initialMarkdown={DRAFT}
        source="deterministic"
        dayLabel="September 10"
        redrafting={false}
        busy={false}
        onRedraft={() => undefined}
        onRefine={async () => true}
        onSubmit={() => undefined}
      /></main></section></div>;
  }
  return <div className="workspace preview-workspace"><section className="stage">{masthead}</section></div>;
}
