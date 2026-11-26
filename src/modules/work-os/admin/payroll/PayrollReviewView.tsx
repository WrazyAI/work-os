"use client";

import { useEffect, useState } from "react";
import type { PayrollCitation, PayrollDayResult, PayrollFinding, PayrollReview, PayrollTotals } from "@/modules/work-os/payroll/contracts";
import { payrollApi } from "./api";
import { PayrollBrief } from "./PayrollBrief";
import { PayrollProgress } from "./PayrollProgress";
import { payrollReviewModel } from "./model";
import { groupBreakFindings } from "@/modules/work-os/payroll/break-groups";

const FINDING_LABELS: Record<PayrollFinding["kind"], string> = {
  inactivity: "Inactivity", break: "Unpaid break", outside_window: "Outside schedule",
  unverified_gap: "Unverified coverage", low_evidence: "Low evidence",
  activity_during_break: "Activity during break", break_mismatch: "Conflicting break records",
  possible_work: "Possible work", manual_adjustment: "Manual adjustment", no_work: "No recorded work",
  no_schedule: "Schedule correction", no_session: "Missing session", timezone_changed: "Time zone changed",
  source_conflict: "Source conflict",
};

const hours = (minutes: number) => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const label = (value: string | null | undefined) => (value ?? "").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const fullDate = (value: string) => {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed) : value;
};

type Decision = { finding: PayrollFinding; action: "payable" | "excluded" | "acknowledged" };

export function PayrollReviewView({ review, displayName, busy, days = [], findings = [], daysLoading, findingsLoading, daysError, findingsError, onRetryEvidence, onApprove, onReopen, onAdvance, onCancel, onDecide }: {
  review: PayrollReview; displayName?: string; busy?: boolean;
  days?: PayrollDayResult[]; findings?: PayrollFinding[]; daysLoading?: boolean; findingsLoading?: boolean;
  daysError?: string; findingsError?: string; onRetryEvidence?: () => void;
  onApprove?: () => void; onReopen?: () => void; onAdvance?: () => void; onCancel?: () => void;
  onDecide?: (key: string, action: Decision["action"], note: string) => Promise<void>;
}) {
  const model = payrollReviewModel(review);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  useEffect(() => {
    if (decision && !onDecide) {
      setDecision(null);
      setDecisionNotice("The review changed while this decision was open. Close and reopen the finding to try again.");
    }
  }, [decision, onDecide]);
  const running = review.run?.progress.status === "queued" || review.run?.progress.status === "running";
  const attention = findings.filter((finding) => finding.status === "needs_review" || finding.status === "needs_correction");
  const excluded = findings.filter((finding) => finding.status === "auto_excluded");
  const inactivity = excluded.filter((finding) => finding.kind === "inactivity");
  const breaks = groupBreakFindings(excluded.filter((finding) => finding.kind === "break"));
  const outside = excluded.filter((finding) => finding.kind === "outside_window");
  const otherExcluded = excluded.filter((finding) => finding.kind !== "break" && finding.kind !== "inactivity" && finding.kind !== "outside_window");
  const excludedMinutes = excluded.reduce((sum, finding) => sum + finding.minutes, 0);
  const excludedCount = inactivity.length + breaks.length + outside.length
    + excluded.filter((finding) => finding.kind !== "break" && finding.kind !== "inactivity" && finding.kind !== "outside_window").length;
  const apps = review.apps?.items ?? [];
  const appTotal = apps.reduce((sum, app) => sum + app.durationMs, 0);
  const topApps = apps.slice(0, 8);
  const otherApps = apps.slice(8);
  const otherMs = otherApps.reduce((sum, app) => sum + app.durationMs, 0);
  const appMax = Math.max(1, otherMs, ...apps.map((app) => app.durationMs));
  const dayMax = Math.max(1, ...days.map((day) => day.minutes.recommended));
  const time = (ms: number) => {
    if (!Number.isFinite(ms)) return "Unavailable";
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: review.period.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    } catch { return "Unavailable"; }
  };
  const span = (finding: PayrollFinding) => finding.span ? `${time(finding.span.startMs)}–${time(finding.span.endMs)}` : "All day";
  const amount = (finding: PayrollFinding) => finding.minutes === 0 && finding.durationMs > 0 ? "Under 1m" : hours(finding.minutes);
  const stack: { key: keyof PayrollTotals; label: string; color: string }[] = [
    { key: "recommended", label: "Payable", color: "var(--payroll-green)" },
    { key: "break", label: "Break", color: "var(--payroll-sand)" },
    { key: "inactivity", label: "Inactivity", color: "var(--payroll-clay)" },
    { key: "held", label: "Held", color: "var(--payroll-amber)" },
    { key: "outside", label: "Outside", color: "var(--payroll-slate)" },
    { key: "manualExcluded", label: "Manual", color: "var(--payroll-c6)" },
  ];
  const visibleStack = stack.filter((row) => review.totals[row.key] > 0);
  const failedRun = review.run?.progress.status === "failed";
  const failureBlocksApproval = review.status === "failed" || (failedRun && review.status !== "ready");

  return (
    <article className="payroll-shell payroll-report">
      <header className="payroll-header">
        <div>
          <p className="payroll-kicker">Payroll audit</p>
          <h2>{displayName ? `${displayName} · ` : ""}{fullDate(review.period.from)} — {fullDate(review.period.through)}</h2>
          <div className="payroll-meta">
            <span className="payroll-pill" data-tone={review.status === "approved" ? "ok" : review.status === "needs_review" ? "warn" : "neutral"}>{label(review.status)}</span>
            <span>Pay date {fullDate(review.period.payDate)}</span>
            <span>{review.providerVerifiedAt ? `Evidence checked ${fullDate(review.providerVerifiedAt)}` : "Evidence not verified"}</span>
            <span>Expires {fullDate(review.retentionExpiresAt)}</span>
          </div>
        </div>
        <div className="payroll-actions">
          {model.canApprove && onApprove ? <button type="button" className="primary" disabled={busy} onClick={onApprove}>Approve payable hours</button> : null}
          {review.status === "approved" && onReopen ? <button type="button" disabled={busy} onClick={onReopen}>Reopen with reason</button> : null}
          {running && onCancel ? <button type="button" disabled={busy} onClick={onCancel}>Cancel analysis</button> : null}
          {!running && review.status !== "approved" && onAdvance ? <button type="button" disabled={busy} onClick={onAdvance}>{review.token.analysisRevision > 0 ? "Re-analyze" : "Run audit"}</button> : null}
        </div>
      </header>
      <PayrollProgress review={review} />
      <div className="payroll-banner" data-tone={model.stale || failureBlocksApproval ? "warn" : review.status === "approved" ? "ok" : "neutral"}>
        <strong>{failureBlocksApproval
          ? "Analysis did not finish — re-analyze before approval"
          : failedRun ? "Latest re-analysis did not finish; the published analysis is unchanged"
          : running ? "Analysis in progress"
            : model.stale ? (review.approval ? "Approved receipt unchanged — evidence changed after approval" : "Evidence changed — re-analyze before approval")
              : review.status === "approved" ? "Approved payroll record" : "Review in progress"}</strong>
        <span>{model.retentionLabel}</span>
      </div>
      {review.recapStats ? <p className="payroll-provenance">
        {review.recapStats.employeeReviewed} employee-reviewed · {review.recapStats.autoApproved} system-reviewed · {review.recapStats.pending} pending
        {review.recapStats.pending ? " — pending recaps must be settled before approval." : ""}
      </p> : null}
      {daysError || findingsError ? <p className="payroll-blocker" role="alert">{(daysError ?? findingsError)} {onRetryEvidence ? <button type="button" onClick={onRetryEvidence}>Retry evidence</button> : null}</p> : null}
      {[...new Set([...review.blockers, ...model.blockers])].map((blocker) => <p className="payroll-blocker" key={blocker}>{blocker}</p>)}
      {decisionNotice ? <p className="payroll-blocker" role="alert">{decisionNotice}</p> : null}

      {review.token.analysisRevision > 0 ? <>
        <section className="payroll-panel payroll-hours-card" aria-labelledby="hours-title">
          <div className="payroll-report-head"><h2 id="hours-title">Hours</h2><p>Recorded time reconciled against the schedule and evidence.</p></div>
          <div className="payroll-hours">
            <div>
              <span className="payroll-label">Estimated payable</span>
              <div className="payroll-big">{hours(review.totals.recommended)} <small>of {hours(review.totals.recorded)} recorded</small></div>
              <div className="payroll-legend">{visibleStack.map((row) => <span key={row.key}><b style={{ background: row.color }} />{row.label} {hours(review.totals[row.key])}</span>)}</div>
            </div>
            <div>
              <div className="payroll-stack" role="img" aria-label={`Recorded time split: ${visibleStack.map((row) => `${row.label} ${hours(review.totals[row.key])}`).join(", ")}`}>
                {visibleStack.map((row) => <i key={row.key} style={{ width: `${(review.totals[row.key] / Math.max(1, review.totals.recorded)) * 100}%`, background: row.color }} />)}
              </div>
              <div className="payroll-hours-stats">
                <div><span className="payroll-label">Flags</span><strong>{findings.length}</strong><span>{attention.length} need attention</span></div>
                <div><span className="payroll-label">Excluded</span><strong>{excludedCount}</strong><span>intervals by rule</span></div>
                <div><span className="payroll-label">Recaps</span><strong>{review.recapStats?.employeeReviewed ?? 0}</strong><span>employee reviewed</span></div>
              </div>
            </div>
          </div>
          {days.length ? <div className="payroll-day-band">
            <div className="payroll-day-head"><span className="payroll-label">Payable time by day</span><span>{review.period.timezone}</span></div>
            <div className="payroll-days" role="img" aria-label="Payable time by day">
              {days.map((day) => <div className="payroll-day" key={day.date}><i style={{ height: `${Math.max(3, (day.minutes.recommended / dayMax) * 100)}%` }} /><span>{day.date.slice(-2)}</span></div>)}
            </div>
          </div> : null}
        </section>

        {!findingsError ? <section className="payroll-panel" aria-labelledby="attention-title">
          <div className="payroll-report-head"><h2 id="attention-title">Needs attention</h2><p>{attention.length} of {findings.length} flags require a person.</p></div>
          {findingsLoading ? <p role="status">Loading findings…</p> : null}
          {!findingsLoading && !attention.length ? <p className="payroll-empty">Nothing needs a decision on this page.</p> : null}
          <div className="payroll-attention">{attention.map((finding) => <section className="payroll-attention-row" key={finding.id}>
            <div>
              <div className="payroll-finding-title"><h3>{FINDING_LABELS[finding.kind]}</h3><span className="payroll-pill" data-tone={finding.requiredAction === "correct" ? "err" : "warn"}>{label(finding.status)}</span></div>
              <p className="payroll-quiet">{fullDate(finding.date)} · {span(finding)} · {amount(finding)}</p>
              <p>{finding.reason}</p>
              <Sources citations={finding.citations} />
            </div>
            <div className="payroll-attention-actions">
              {finding.kind !== "break" && (finding.frameSummaryIds?.length ?? 0) ? <PayrollFrameButton review={review} finding={finding} /> : null}
              {finding.requiredAction === "correct" ? <span className="payroll-quiet">Correct the source, then re-analyze.</span>
                : onDecide && !busy ? (finding.requiredAction === "decide" ? <>
                  <button type="button" onClick={() => { setDecisionNotice(null); setDecision({ finding, action: "payable" }); }}>Keep payable</button>
                  <button type="button" onClick={() => { setDecisionNotice(null); setDecision({ finding, action: "excluded" }); }}>Exclude time</button>
                </> : <button type="button" onClick={() => { setDecisionNotice(null); setDecision({ finding, action: "acknowledged" }); }}>Acknowledge</button>) : null}
            </div>
          </section>)}</div>
        </section> : null}

        {!findingsError ? <section className="payroll-panel" aria-labelledby="excluded-title">
          <div className="payroll-report-head"><h2 id="excluded-title">Excluded by rule</h2><p>{excludedCount} intervals · {hours(excludedMinutes)} removed from pay.</p></div>
          <ExcludedGroup title="Continuous inactivity · 3 minutes or more" detail="Zero activity for 3 minutes or more is excluded unless meeting, training, reading, or work evidence covers it." findings={inactivity} review={review} empty="No inactivity intervals were excluded." />
          <ExcludedGroup title="Unpaid break" detail="Break time never counts as work. Worktivity captures no screenshots during a break." findings={breaks} review={review} collapsed empty="No break intervals were excluded." />
          <ExcludedGroup title="Outside the eligible window" detail="Recorded time before the shift or after its grace end is never payable." findings={outside} review={review} empty="No outside-window intervals were excluded." />
          {otherExcluded.length ? <ExcludedGroup title="Other rule exclusions" detail="These intervals were removed by a payroll rule and do not need a decision." findings={otherExcluded} review={review} empty="No other rule exclusions." /> : null}
        </section> : null}

        <details className="payroll-panel payroll-daily">
          <summary>Daily evidence · {days.length} days {daysLoading ? "(loading…)" : ""}</summary>
          <div className="payroll-daily-list">{days.map((day) => <div key={day.date} className="payroll-daily-row">
            <strong>{fullDate(day.date)}</strong>
            <span>{hours(day.minutes.recommended)} recommended</span>
            <span>{hours(day.minutes.recorded)} recorded</span>
            <span>{hours(day.minutes.break)} break</span>
            <span>{hours(day.minutes.inactivity)} inactivity</span>
            <span>{day.findings.length} {day.findings.length === 1 ? "flag" : "flags"}</span>
          </div>)}</div>
        </details>

        <details className="payroll-panel payroll-fold" open>
          <summary><span><strong>Weekly briefs</strong><small>Grounded in recaps and evidence. This is not a productivity score.</small></span></summary>
          <div className="payroll-briefs">
            {review.period.weeks.filter(({ from, through }) => from <= through).map(({ week }) => {
              const brief = review.briefs.find((entry) => entry.week === week);
              return brief ? <PayrollBrief key={week} brief={brief} /> : <section key={week} className="payroll-panel"><h3>Week {week}</h3><p>No recap text is available for these dates.</p></section>;
            })}
          </div>
        </details>

        <details className="payroll-panel payroll-fold payroll-apps-fold">
          <summary><span><strong>Apps and sites</strong><small>{appTotal ? `${hours(Math.round(appTotal / 60_000))} observed · Worktivity · context only, never payable hours` : "App usage unavailable for this period"}</small></span></summary>
          {apps.length ? <div className="payroll-apps">
            {topApps.map((app, index) => <div className="payroll-app-row" key={`${app.name}-${index}`}>
              <span className="payroll-app-name"><b style={{ background: `var(--payroll-c${(index % 6) + 1})` }} />{app.name}</span>
              <span className="payroll-track"><i style={{ width: `${Math.max(2, (app.durationMs / appMax) * 100)}%`, background: `var(--payroll-c${(index % 6) + 1})` }} /></span>
              <span className="payroll-app-time">{hours(Math.round(app.durationMs / 60_000))} · {Math.round((app.durationMs / Math.max(1, appTotal)) * 100)}%</span>
            </div>)}
            {otherApps.length ? <div className="payroll-app-row">
              <span className="payroll-app-name"><b style={{ background: "var(--payroll-slate)" }} />Other ({otherApps.length} apps)</span>
              <span className="payroll-track"><i style={{ width: `${Math.max(2, (otherMs / appMax) * 100)}%`, background: "var(--payroll-slate)" }} /></span>
              <span className="payroll-app-time">{hours(Math.round(otherMs / 60_000))} · {Math.round((otherMs / Math.max(1, appTotal)) * 100)}%</span>
            </div> : null}
          </div> : <p className="payroll-empty">No app distribution was captured. This does not change payable hours.</p>}
          {review.apps && !review.apps.complete ? <p className="payroll-footnote">App coverage is incomplete for this period.</p> : null}
        </details>
      </> : null}

      {review.approval ? <section className="payroll-panel payroll-receipt">
        <h3>Approved receipt</h3>
        <p>{review.approval.approvedAt} · {hours(review.approval.totals.approved)} approved · receipt {review.approval.snapshotHash.slice(0, 12)}</p>
      </section> : null}

      <div className="payroll-askbar"><div className="payroll-askpill" role="group" aria-label="Ask about this report">
        <span>Ask anything about this report</span><span className="payroll-soon">Coming soon</span>
        <button type="button" disabled aria-label="Send (coming soon)">→</button>
      </div></div>

      {decision ? <DecisionDialog decision={decision} busy={busy} onClose={() => setDecision(null)} onConfirm={async (note) => {
        await onDecide?.(decision.finding.key, decision.action, note);
        setDecision(null);
      }} /> : null}
    </article>
  );
}

function Sources({ citations }: { citations: PayrollCitation[] }) {
  if (!citations.length) return null;
  return <details className="payroll-sources"><summary>Sources ({citations.length})</summary>
    <ul>{citations.map((citation) => <li key={`${citation.type}:${citation.id}:${citation.revision}`}>{citation.type === "interval" ? "Recap" : label(citation.type)} {citation.id} · revision {citation.revision}</li>)}</ul>
  </details>;
}

function ExcludedGroup({ title, detail, findings, review, empty, collapsed = false }: {
  title: string; detail: string; findings: PayrollFinding[]; review: PayrollReview; empty: string; collapsed?: boolean;
}) {
  const total = findings.reduce((sum, finding) => sum + finding.minutes, 0);
  const head = <div className="payroll-rule-head"><div><h3>{title}</h3><p>{detail}</p></div><span className="payroll-pill">{findings.length} · {hours(total)}</span></div>;
  const body = findings.length ? <div className="payroll-rule-table">{findings.map((finding) => <div className="payroll-rule-row" key={finding.id}>
      <span>{fullDate(finding.date)}</span>
      <span>{finding.span ? `${new Intl.DateTimeFormat("en-US", { timeZone: review.period.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(finding.span.startMs))}–${new Intl.DateTimeFormat("en-US", { timeZone: review.period.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(finding.span.endMs))}` : "—"}</span>
      <span>{hours(finding.minutes)}</span>
      <span>{finding.kind === "break" ? "No frames by policy" : finding.kind === "inactivity"
        ? ((finding.frameSummaryIds?.length ?? 0) ? <PayrollFrameButton review={review} finding={finding} /> : "No linked frames")
        : "Not reviewable by policy"}</span>
    </div>)}</div> : <p className="payroll-empty">{empty}</p>;
  return collapsed ? <details className="payroll-rule"><summary>{head}</summary>{body}</details> : <section className="payroll-rule">{head}{body}</section>;
}

function PayrollFrameButton({ review, finding }: { review: PayrollReview; finding: PayrollFinding }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => () => { urls.forEach((url) => URL.revokeObjectURL(url)); }, [urls]);
  const load = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true); setError(null);
    const next: string[] = [];
    try {
      for (const summaryId of finding.frameSummaryIds ?? []) next.push(URL.createObjectURL(await payrollApi.previewFrame(review.id, finding.key, summaryId, reason.trim())));
      setUrls(next);
    } catch (issue) {
      next.forEach((url) => URL.revokeObjectURL(url));
      setUrls([]);
      setError((issue as Error).message);
    } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="payroll-link" onClick={() => setOpen(true)}>{(finding.frameSummaryIds?.length ?? 0)} {(finding.frameSummaryIds?.length ?? 0) === 1 ? "frame" : "frames"}</button>
    {open ? <div className="payroll-overlay" role="dialog" aria-modal="true" aria-label="Evidence frames" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="payroll-dialog">
        <div className="payroll-dialog-head"><h3>Evidence · {FINDING_LABELS[finding.kind]}</h3><button type="button" onClick={() => setOpen(false)}>Close</button></div>
        <p className="payroll-quiet">{fullDate(finding.date)}. These frames were captured on the same day as this finding. Access is recorded and limited to reviewable payroll evidence.</p>
        {urls.length ? <div className="payroll-frame-grid">{urls.map((url, index) => <img key={url} src={url} alt={`Evidence frame ${index + 1}`} />)}</div> : null}
        <label className="payroll-field"><span>Reason</span><input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why are you reviewing this evidence?" /></label>
        {error ? <p className="payroll-blocker">{error}</p> : null}
        <div className="payroll-actions"><button type="button" disabled={busy || !reason.trim()} onClick={() => void load()}>{busy ? "Opening…" : urls.length ? "Reload frames" : "Open frames"}</button></div>
      </div>
    </div> : null}
  </>;
}

function DecisionDialog({ decision, busy, onClose, onConfirm }: {
  decision: Decision; busy?: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const title = decision.action === "payable" ? "Keep payable" : decision.action === "excluded" ? "Exclude time" : "Acknowledge finding";
  return <div className="payroll-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="payroll-dialog">
      <div className="payroll-dialog-head"><h3>{title}</h3><button type="button" onClick={onClose}>Cancel</button></div>
      <p>{decision.finding.reason}</p>
      <label className="payroll-field"><span>Reason</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      {error ? <p className="payroll-blocker">{error}</p> : null}
      <div className="payroll-actions"><button type="button" className="primary" disabled={busy || !note.trim()} onClick={() => {
        setError(null);
        void onConfirm(note.trim()).catch((issue: Error) => setError(issue.message));
      }}>{busy ? "Saving…" : title}</button></div>
    </div>
  </div>;
}

export function PayrollFindingsView({ review }: { review: PayrollReview }) {
  return <section className="payroll-panel">
    <h3>Decision queue</h3>
    {review.blockers.length ? review.blockers.map((blocker) => <p key={blocker} className="payroll-blocker">{blocker}</p>) : <p className="payroll-empty">No held findings are waiting.</p>}
  </section>;
}
