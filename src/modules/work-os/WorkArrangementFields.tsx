"use client";
import { useId, type CSSProperties } from "react";
import type { WorkArrangementProposal } from "./work-arrangement";

export type ArrangementDraft = Omit<WorkArrangementProposal, "arrangement"> & { arrangement?: WorkArrangementProposal["arrangement"] };
const group: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 10 };
const input: CSSProperties = { minHeight: 42, maxWidth: "100%", padding: "8px 10px", border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", font: "inherit" };

/** The same accessible work-pattern controls in onboarding and administrator review. */
export function WorkArrangementFields({ value, onChange, disabled = false, authoritativeBreaks = false }: {
  value: ArrangementDraft; onChange: (next: ArrangementDraft) => void; disabled?: boolean; authoritativeBreaks?: boolean;
}) {
  const flexible = value.arrangement === "flexible";
  const radioName = useId();
  const patch = (next: Partial<ArrangementDraft>) => onChange({ ...value, ...next });
  return <div style={{ display: "grid", gap: 18 }}>
    <fieldset disabled={disabled} style={group}>
      <legend>Work arrangement</legend>
      <label><input name={radioName} type="radio" checked={!flexible} onChange={() => patch({ arrangement: "scheduled", shiftStart: value.shiftStart || "09:00", shiftEnd: value.shiftEnd || "17:00" })} /> Scheduled hours</label>
      <label><input name={radioName} type="radio" checked={flexible} onChange={() => patch({ arrangement: "flexible" })} /> Contractor / flexible hours</label>
    </fieldset>
    <fieldset disabled={disabled} style={group}>
      <legend>Working days</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => <label key={day} style={{ minHeight: 40, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={value.daysOfWeek.includes(index)} onChange={() => patch({ daysOfWeek: value.daysOfWeek.includes(index) ? value.daysOfWeek.filter((item) => item !== index) : [...value.daysOfWeek, index].sort() })} /> {day}
        </label>)}
      </div>
    </fieldset>
    {flexible ? <p style={{ margin: 0 }}>Your workdays are fixed. Choose when to work on those days; no shift times or required number of hours are set.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 12 }}>
      <label style={group}>Shift starts<input disabled={disabled} style={input} type="time" value={value.shiftStart ?? ""} onChange={(event) => patch({ shiftStart: event.target.value })} /></label>
      <label style={group}>Shift ends<input disabled={disabled} style={input} type="time" value={value.shiftEnd ?? ""} onChange={(event) => patch({ shiftEnd: event.target.value })} /></label>
      {!authoritativeBreaks && <>
        <label style={group}>Break starts<input disabled={disabled} style={input} type="time" value={value.breaks[0]?.start ?? ""} onChange={(event) => patch({ breaks: [{ start: event.target.value, end: value.breaks[0]?.end ?? "" }] })} /></label>
        <label style={group}>Break ends<input disabled={disabled} style={input} type="time" value={value.breaks[0]?.end ?? ""} onChange={(event) => patch({ breaks: [{ start: value.breaks[0]?.start ?? "", end: event.target.value }] })} /></label>
      </>}
    </div>}
  </div>;
}
