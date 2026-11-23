import type { PayrollDayResult, PayrollFinding, Span } from "@/modules/work-os/payroll/contracts";
import { PayrollSources } from "./PayrollBrief";

function spanLabel(span: Span | null, timezone: string) {
  if (!span || !Number.isFinite(span.startMs) || !Number.isFinite(span.endMs)) return "Unavailable";
  try {
    const format = new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit", second: "2-digit" });
    return `${format.format(span.startMs)}–${format.format(span.endMs)}`;
  } catch { return "Unavailable"; }
}

export function PayrollAuditDays({ days, timezone }: { days: PayrollDayResult[]; timezone: string }) {
  return (
    <section className="payroll-panel payroll-audit-evidence" aria-label="Daily evidence">
      <h2>Daily evidence</h2>
      <p>Expand a day to see how its recorded time was reconciled. Missing activity coverage is not treated as inactivity.</p>
      {days.length ? days.map((day) => (
        <details className="payroll-day" key={day.date}>
          <summary><strong>{day.date}</strong> · {day.minutes.recorded} min recorded · {day.minutes.recommended} min recommended
            {day.blockers.length ? " · correction needed" : day.minutes.held ? ` · ${day.minutes.held} min held` : ""}</summary>
          <dl className="payroll-day-totals">
            <div><dt>Eligible recorded</dt><dd>{day.minutes.eligibleTracked} min</dd></div>
            <div><dt>Outside schedule</dt><dd>{day.minutes.outside} min</dd></div>
            <div><dt>Unpaid break</dt><dd>{day.minutes.break} min</dd></div>
            <div><dt>Verified inactivity excluded</dt><dd>{day.minutes.inactivity} min</dd></div>
            <div><dt>Held</dt><dd>{day.minutes.held} min</dd></div>
            <div><dt>Manual exclusions</dt><dd>{day.minutes.manualExcluded} min</dd></div>
            <div><dt>Findings on this day</dt><dd>{day.findings.length}</dd></div>
            {day.evidence ? <>
              <div><dt>Sessions</dt><dd>{day.evidence.sessions.length}</dd></div>
              <div><dt>Frames analyzed</dt><dd>{day.evidence.sampledFrames}</dd></div>
            </> : null}
          </dl>
          {day.evidence?.scheduleSource ? <p>Schedule source: {day.evidence.scheduleSource.replaceAll("_", " ")}</p> : null}
          {day.evidence?.sessions.length ? (
            <ul>{day.evidence.sessions.map((session, index) => (
              <li key={index}>Session {index + 1} · recorded {spanLabel(session.recorded, timezone)} · eligible window {spanLabel(session.eligible, timezone)}</li>
            ))}</ul>
          ) : null}
          {day.blockers.length ? <ul>{day.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        </details>
      )) : <p className="payroll-empty">No daily evidence was recorded.</p>}
    </section>
  );
}

export type PayrollFindingAction = "payable" | "excluded" | "acknowledged";

const labels: Record<PayrollFinding["kind"], string> = {
  inactivity: "Inactivity", break: "Unpaid break", outside_window: "Outside schedule",
  unverified_gap: "Unverified coverage", low_evidence: "Low evidence",
  activity_during_break: "Activity during break", break_mismatch: "Conflicting break records",
  possible_work: "Possible work", manual_adjustment: "Manual adjustment", no_work: "No recorded work",
  no_schedule: "Schedule correction", no_session: "Missing session", timezone_changed: "Time zone changed",
  source_conflict: "Source conflict",
};

export function PayrollAuditFinding({ finding, timezone, busy, onDecide, onError }: {
  finding: PayrollFinding; timezone: string; busy: boolean;
  onDecide?: (key: string, action: PayrollFindingAction, note: string) => void;
  onError?: string;
}) {
  const actions: { action: PayrollFindingAction; label: string }[] = finding.requiredAction === "decide"
    ? [{ action: "payable", label: "Keep payable" }, { action: "excluded", label: "Exclude time" }]
    : finding.requiredAction === "acknowledge" ? [{ action: "acknowledged", label: "Acknowledge" }] : [];
  const open = finding.status === "needs_review" || finding.status === "needs_correction";
  return (
    <li className="payroll-finding">
      <div className="payroll-finding-heading">
        <strong>{labels[finding.kind]}</strong>
        <span>{finding.date} · {finding.span ? `${spanLabel(finding.span, timezone)} · ` : ""}
          {finding.minutes === 0 && finding.durationMs > 0 ? "Under 1 min" : `${finding.minutes} min`}</span>
        <span>{finding.status.replaceAll("_", " ")}{open && finding.blocksApproval ? " · blocks approval" : ""}</span>
      </div>
      <p>{finding.reason}</p>
      <PayrollSources citations={finding.citations} />
      {open && finding.requiredAction === "correct" ? <p>Correct the source record, then re-analyze this period.</p> : null}
      {onDecide && open && actions.length ? (
        <details>
          <summary>Record decision</summary>
          <form className="payroll-finding-form" onSubmit={(event) => {
            event.preventDefault();
            const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
            const selected = actions.find((item) => item.action === action);
            const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
            if (selected && note) onDecide(finding.key, selected.action, note);
          }}>
            <label>Reason <input name="note" required pattern={".*\\S.*"} maxLength={500} disabled={busy} /></label>
            <div className="payroll-actions">{actions.map(({ action, label }) => (
              <button key={action} type="submit" value={action} disabled={busy}>{label}</button>
            ))}</div>
            {onError ? <p className="payroll-blocker" role="alert">{onError}</p> : null}
          </form>
        </details>
      ) : null}
    </li>
  );
}
