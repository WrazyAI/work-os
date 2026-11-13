"use client";
import { useId, type CSSProperties } from "react";
import type { WorkArrangementProposal } from "./work-arrangement";

export type ArrangementDraft = Omit<WorkArrangementProposal, "arrangement" | "breaks"> & {
  arrangement?: WorkArrangementProposal["arrangement"];
  breaks?: WorkArrangementProposal["breaks"];
};
const group: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 10 };
const input: CSSProperties = { minHeight: 42, maxWidth: "100%", padding: "8px 10px", border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", font: "inherit" };
const action: CSSProperties = { minHeight: 40, padding: "8px 12px", border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", font: "inherit" };

/** The same accessible work-pattern controls in onboarding, Settings, and
 * administrator review. Scheduled breaks remain a full add/remove list so a
 * legacy or scheduled schedule never loses a window to this control. */
export function WorkArrangementFields({ value, onChange, disabled = false, authoritativeBreaks = false }: {
  value: ArrangementDraft; onChange: (next: ArrangementDraft) => void; disabled?: boolean; authoritativeBreaks?: boolean;
}) {
  const flexible = value.arrangement === "flexible";
  const radioName = useId();
  const breaks = value.breaks ?? [];
  const patch = (next: Partial<ArrangementDraft>) => onChange({ ...value, ...next });
  const setBreak = (index: number, next: Partial<{ start: string; end: string }>) => {
    patch({ breaks: breaks.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item) });
  };
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
    {flexible ? <p style={{ margin: 0 }}>Your workdays are fixed. Choose when to work on those days; no shift times or required number of hours are set.</p> : <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 12 }}>
        <label style={group}>Shift starts<input disabled={disabled} style={input} type="time" value={value.shiftStart ?? ""} onChange={(event) => patch({ shiftStart: event.target.value })} /></label>
        <label style={group}>Shift ends<input disabled={disabled} style={input} type="time" value={value.shiftEnd ?? ""} onChange={(event) => patch({ shiftEnd: event.target.value })} /></label>
      </div>
      {!authoritativeBreaks && <fieldset disabled={disabled} style={group}>
        <legend>Break windows</legend>
        {breaks.length ? breaks.map((item, index) => <div key={index} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}>
          <label style={group}>Break {index + 1} starts<input style={input} type="time" value={item.start} onChange={(event) => setBreak(index, { start: event.target.value })} /></label>
          <label style={group}>Break {index + 1} ends<input style={input} type="time" value={item.end} onChange={(event) => setBreak(index, { end: event.target.value })} /></label>
          <button type="button" style={action} aria-label={`Remove break ${index + 1}`} onClick={() => patch({ breaks: breaks.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
        </div>) : <p style={{ margin: 0 }}>No break windows added.</p>}
        <button type="button" style={{ ...action, justifySelf: "start" }} onClick={() => patch({ breaks: [...breaks, { start: "12:00", end: "12:30" }] })}>Add break</button>
      </fieldset>}
    </div>}
  </div>;
}
