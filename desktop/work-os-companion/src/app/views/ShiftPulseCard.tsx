import { useEffect, useRef, useState } from "react";
import { Activity, CalendarDays, ChevronRight, Clock3, MoreHorizontal, X } from "lucide-react";
import { formatWorkOsTime as formatTime } from "../../dateFormat";
import { shiftPulse } from "../../shiftPulse";
import { moveMenuFocus } from "../../taskSurfaces";
import type { DayData } from "../../types";
import { remainingShiftLabel, sentence, worktivityClockOutLabel } from "../constants";

export function ShiftPulseCard({ pulse, now, shift, active, attendance, initialDetailsOpen = false, initialMenuOpen = false }: {
  pulse: ReturnType<typeof shiftPulse>; now: Date; shift: DayData["shift"];
  active: boolean; attendance: DayData["attendance"] | null; initialDetailsOpen?: boolean; initialMenuOpen?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const disclosureRef = useRef<HTMLDivElement>(null);
  const timezone = shift?.timezone;
  const progress = Math.round(pulse.progressPercent);
  const observationEnded = Boolean(attendance?.clockedOutAt);
  const providerState = attendance?.stale
    ? "Stale"
    : observationEnded
      ? "Observed session ended"
      : attendance?.clockedInAt && attendance?.state === "off_shift"
        ? "Last activity observed"
      : attendance?.status
        ? sentence(attendance.status)
        : "Unavailable";
  const state = active
    ? "Work OS live"
    : attendance?.state === "active" || attendance?.state === "paused"
      ? "Activity observed"
      : observationEnded
        ? "Observation complete"
        : attendance?.clockedInAt && attendance?.state === "off_shift"
          ? "No current activity"
        : "Waiting";
  const observationClass = attendance?.stale
    ? "stale"
    : attendance?.status === "break"
      ? "break"
      : attendance?.state === "active"
        ? "active"
        : "idle";
  const providerClockOut = worktivityClockOutLabel(attendance, timezone);
  const scheduleLabel = pulse.schedulePhase === "upcoming" ? "Next shift" : "Scheduled shift";
  const scheduleStatus = pulse.schedulePhase === "upcoming" ? "upcoming" : pulse.schedulePhase === "complete" ? "complete" : "elapsed";
  const middleLabel = pulse.schedulePhase === "upcoming" ? "Starts in" : pulse.schedulePhase === "complete" ? "Shift status" : "Time remaining";
  const middleValue = pulse.schedulePhase === "upcoming"
    ? remainingShiftLabel(shift?.startsAt, now)
    : pulse.schedulePhase === "complete"
      ? "Complete"
      : remainingShiftLabel(shift?.endsAt, now);
  const scheduleAria = pulse.schedulePhase === "upcoming"
    ? "The next scheduled shift has not started"
    : `${progress}% of the scheduled shift has passed`;
  const phaseCaption = pulse.schedulePhase === "upcoming"
    ? `Starts at ${formatTime(shift?.startsAt, timezone)}`
    : pulse.schedulePhase === "complete"
      ? `Ended at ${formatTime(shift?.endsAt, timezone)}`
      : `Ends at ${formatTime(shift?.endsAt, timezone)}`;

  useEffect(() => {
    if (!menuOpen && !detailsOpen) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && disclosureRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      setDetailsOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [detailsOpen, menuOpen]);

  return <section className="pulse-card pre-shift-pulse">
    <div className="card-title pulse-title"><span><Activity size={17} /> Shift pulse</span><div className="pulse-card-controls"><small><i className={active ? "live" : attendance?.state === "active" ? "observed" : ""} />{state}</small><div className="pulse-disclosure" ref={disclosureRef}><button className="ellipsis-button pulse-more" aria-label="Shift pulse options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen((value) => !value); setDetailsOpen(false); }}><MoreHorizontal size={17} /></button>{menuOpen && <div className="pulse-menu" role="menu" onKeyDown={(event) => moveMenuFocus(event.nativeEvent)}><button role="menuitem" autoFocus onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}><Activity size={15} /><span><strong>Worktivity status</strong><small>View provider attendance</small></span><ChevronRight size={14} /></button></div>}{detailsOpen && <section className={`pulse-provider-popover ${observationClass}`} role="dialog" aria-label="Worktivity status"><header><div><Activity size={16} /><span><small>Worktivity attendance</small><strong>{providerState}</strong></span></div><button aria-label="Close Worktivity status" onClick={() => setDetailsOpen(false)}><X size={15} /></button></header><div className="pulse-provider-facts"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{providerClockOut}</strong></span><span><small>Last activity</small><strong>{attendance?.activityObservedAt ? formatTime(attendance.activityObservedAt, timezone) : "—"}</strong></span><span><small>Observed active time</small><strong>{pulse.observedElapsedLabel}</strong></span><span><small>Provider refresh</small><strong>{attendance?.observedAt ? formatTime(attendance.observedAt, timezone) : "—"}</strong></span><span><small>OnBreak deducted</small><strong>{pulse.observedBreakLabel}</strong></span></div><footer>Worktivity is the attendance source; Work OS mirrors fresh provider status.</footer></section>}</div></div></div>
    <div className="pulse-countdown" role="img" aria-label={scheduleAria}>
      <div className="pulse-countdown-copy"><small>{middleLabel}</small><strong>{middleValue}</strong><span>{phaseCaption}</span></div>
      <div className="pulse-window"><CalendarDays size={17} /><div><small>{scheduleLabel}</small><strong>{formatTime(shift?.startsAt, timezone)} <i>to</i> {formatTime(shift?.endsAt, timezone)}</strong></div></div>
    </div>
    <div className="pulse-compact-track" aria-hidden="true"><div><i style={{ width: `${pulse.progressPercent}%` }} /><b style={{ left: `clamp(5px, ${pulse.progressPercent}%, calc(100% - 5px))` }} /></div><span><small>{formatTime(shift?.startsAt, timezone)}</small><small>{scheduleStatus}</small><small>{formatTime(shift?.endsAt, timezone)}</small></span></div>
    <p className="pulse-separation-note"><Clock3 size={13} /> Worktivity owns clock actions; the Windows Companion waits for provider confirmation.</p>
  </section>;
}
