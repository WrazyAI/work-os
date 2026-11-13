"use client";
import { useState } from "react";
import { WorkArrangementFields, type ArrangementDraft } from "./WorkArrangementFields";

export interface ArrangementReviewData {
  status: string;
  revision: number;
  submittedAt: string | null;
  timezone: string;
  schedule: ArrangementDraft | null;
  note: string | null;
  canReview: boolean;
}
export type ArrangementReviewRequest = { action: "approve" | "request_changes"; revision: number; submittedAt: string; schedule: ArrangementDraft; timezone: string; note: string };

export function ArrangementReview({ proposal, onReview }: {
  proposal: ArrangementReviewData;
  onReview: (request: ArrangementReviewRequest) => Promise<{ status: string; effectiveFrom?: string | null }>;
}) {
  const [schedule, setSchedule] = useState(proposal.schedule);
  const [timezone, setTimezone] = useState(proposal.timezone);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  async function decide(action: ArrangementReviewRequest["action"]) {
    if (!schedule || !proposal.submittedAt || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await onReview({ action, revision: proposal.revision, submittedAt: proposal.submittedAt, schedule, timezone, note });
      const date = result.effectiveFrom ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${result.effectiveFrom}T12:00:00Z`)) : null;
      setReceipt(result.status === "confirmed" ? `Arrangement approved${date ? `, effective ${date}` : ""}.` : "Changes requested. The official arrangement is unchanged.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The review could not be saved. Refresh the record before retrying."); }
    finally { setBusy(false); }
  }
  return <section style={{ display: "grid", gap: 12 }} aria-label="Work arrangement review">
    <h3 style={{ margin: 0 }}>Work arrangement proposal</h3>
    <p style={{ margin: 0 }}>
      {proposal.status === "submitted" ? "Pending administrator review. The current official arrangement stays in effect until a change is approved." : proposal.status === "confirmed" ? "This proposal was approved. The official arrangement and effective dates are listed below." : proposal.status === "changes_requested" ? "Changes requested. The official arrangement is unchanged." : "Onboarding has not submitted an arrangement for review yet."}
    </p>
    {proposal.note && <p style={{ margin: 0 }}>Administrator note: {proposal.note}</p>}
    {receipt ? <p role="status">{receipt}</p> : proposal.status === "submitted" && schedule ? <>
      <WorkArrangementFields value={schedule} onChange={setSchedule} disabled={busy || !proposal.canReview} />
      <label style={{ display: "grid", gap: 6 }}>Timezone<input value={timezone} disabled={busy || !proposal.canReview} onChange={(event) => setTimezone(event.target.value)} style={{ minHeight: 42, padding: 8, width: "100%", boxSizing: "border-box", color: "inherit", background: "transparent", border: "1px solid currentColor", borderRadius: 8 }} /></label>
      {proposal.canReview && <>
        <label style={{ display: "grid", gap: 6 }}>Review note<textarea maxLength={1000} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} style={{ minHeight: 64, padding: 8, width: "100%", boxSizing: "border-box", color: "inherit", background: "transparent", border: "1px solid currentColor", borderRadius: 8 }} /></label>
        <p style={{ margin: 0 }}>A replacement takes effect tomorrow in the selected timezone. A first arrangement takes effect today. Approval waits until any running work session has closed.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" disabled={busy || !schedule.daysOfWeek.length} onClick={() => void decide("approve")} style={{ minHeight: 42, padding: "8px 14px" }}>{busy ? "Saving…" : "Approve arrangement"}</button>
          <button type="button" disabled={busy || !note.trim()} onClick={() => void decide("request_changes")} style={{ minHeight: 42, padding: "8px 14px" }}>Request changes</button>
        </div>
      </>}
    </> : null}
    {error && <p role="alert">{error}</p>}
  </section>;
}
