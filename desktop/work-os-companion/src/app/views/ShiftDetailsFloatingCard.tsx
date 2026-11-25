import type { CSSProperties } from "react";
import { Activity, ChevronLeft, Clock3, X } from "lucide-react";
import { formatWorkOsTime as formatTime } from "../../dateFormat";
import type { DayData } from "../../types";
import { sentence, worktivityClockOutLabel } from "../constants";

export function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }

export function ShiftDetailsFloatingCard({ view, progressPercent, shiftStart, remaining, shiftEnd, elapsed, openTasks, attendance, timezone, observedActive, providerBreak, onBack, onClose }: {
  view: "shift" | "worktivity"; progressPercent: number; shiftStart: string; remaining: string; shiftEnd: string; elapsed: string;
  openTasks: number; attendance: DayData["attendance"] | null; timezone?: string; observedActive: string; providerBreak: string; onBack: () => void; onClose: () => void;
}) {
  return <section className="shift-detail-popover" role="dialog" aria-label={view === "shift" ? "Workday status" : "Worktivity details"}>
    <header><button className="detail-back" aria-label="Back to detail options" onClick={onBack}><ChevronLeft size={16} /></button><div><span>{view === "shift" ? <Clock3 size={15} /> : <Activity size={15} />}{view === "shift" ? "Workday status" : "Worktivity details"}</span><small>{view === "shift" ? "Schedule and mirrored session context" : "Provider attendance and activity details"}</small></div><button aria-label="Close details" onClick={onClose}><X size={16} /></button></header>
    {view === "shift" ? <><div className="shift-pulse-visual"><div className="shift-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}><span><small>Scheduled shift</small><strong>{Math.round(progressPercent)}%</strong><em>elapsed</em></span></div><div className="shift-track-summary"><div><span><small>Shift start</small><strong>{shiftStart}</strong></span><span><small>Time remaining</small><strong>{remaining}</strong></span><span><small>Shift end</small><strong>{shiftEnd}</strong></span></div><div className="shift-detail-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div></div></div><div className="shift-detail-grid"><span><small>Elapsed</small><strong>{elapsed}</strong></span><span><small>Open tasks</small><strong>{openTasks}</strong></span></div></> : <><div className="worktivity-state"><span className={`presence ${attendance?.state === "active" ? "live" : ""}`} /><div><small>Worktivity attendance</small><strong>{attendance?.status ? sentence(attendance.status) : "Unavailable"}</strong></div></div><div className="shift-detail-grid worktivity-grid"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{worktivityClockOutLabel(attendance, timezone)}</strong></span><span><small>Last activity</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>Observed active time</small><strong>{observedActive}</strong></span><span><small>Provider refresh</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>OnBreak deducted</small><strong>{providerBreak}</strong></span></div></>}
  </section>;
}
