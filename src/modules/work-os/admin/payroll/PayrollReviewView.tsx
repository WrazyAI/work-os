"use client";

import { useEffect, useState } from "react";
import type { PayrollCitation, PayrollDayResult, PayrollFinding, PayrollReview, PayrollTotals, RevisionToken } from "@/modules/work-os/payroll/contracts";
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

type Decision = { finding: PayrollFinding; action: "payable" | "excluded" | "acknowledged"; reviewId: string; token: RevisionToken };

export function PayrollReviewView({ review, displayName, busy, days = [], findings = [], daysLoading, findingsLoading, daysError, findingsError, onRetryEvidence, onApprove, onReopen, onAdvance, onCancel, onDecide }: {
  review: PayrollReview; displayName?: string; busy?: boolean;
  days?: PayrollDayResult[]; findings?: PayrollFinding[]; daysLoading?: boolean; findingsLoading?: boolean;
  daysError?: string; findingsError?: string; onRetryEvidence?: () => void;
  onApprove?: () => void; onReopen?: () => void; onAdvance?: () => void; onCancel?: () => void;
  onDecide?: (key: string, action: Decision["action"], note: string, token: RevisionToken) => Promise<void>;
}) {
  const model = payrollReviewModel(review);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [attentionPage, setAttentionPage] = useState(0);
  const decisionChanged = decision !== null && !decisionSaving && (!onDecide || decision.reviewId !== review.id
    || decision.token.rowVersion !== review.token.rowVersion
    || decision.token.analysisRevision !== review.token.analysisRevision
    || decision.token.sourceHash !== review.token.sourceHash);
  useEffect(() => {
    if (decisionChanged) {
      setDecision(null);
      setDecisionNotice("The review changed while this decision was open. Close and reopen the finding to try again.");
    }
  }, [decisionChanged]);
  const chooseDecision = (finding: PayrollFinding, action: Decision["action"]) => {
    setDecisionNotice(null);
    setDecision({ finding, action, reviewId: review.id, token: review.token });
  };
  const binaryDecision = (finding: PayrollFinding) => finding.requiredAction === "decide"
    || (finding.requiredAction === "acknowledge" && (finding.minutes > 0 || finding.durationMs > 0));
  const running = review.run?.progress.status === "queued" || review.run?.progress.status === "running";
  const attention = findings.filter((finding) => finding.kind !== "low_evidence"
    && (finding.status === "needs_review" || finding.status === "needs_correction"));
  const pageSize = 50;
  const firstAttention = Math.min(attentionPage, Math.max(0, Math.ceil(attention.length / pageSize) - 1)) * pageSize;
  const lastAttention = Math.min(firstAttention + pageSize, attention.length);
  const lowEvidence = findings.filter((finding) => finding.kind === "low_evidence");
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
          <div className="payroll-attention">{attention.slice(firstAttention, lastAttention).map((finding) => <section className="payroll-attention-row" key={finding.id}>
            <div>
              <div className="payroll-finding-title"><h3>{FINDING_LABELS[finding.kind]}</h3><span className="payroll-pill" data-tone={finding.requiredAction === "correct" ? "err" : "warn"}>{label(finding.status)}</span></div>
              <p className="payroll-quiet">{fullDate(finding.date)} · {span(finding)} · {amount(finding)}</p>
              <p>{finding.reason}</p>
              {binaryDecision(finding) ? <p className="payroll-quiet">Approve keeps this time payable; reject excludes it.</p> : null}
              <Sources citations={finding.citations} />
            </div>
            <div className="payroll-attention-actions">
              {finding.kind !== "break" && (finding.frameSummaryIds?.length ?? 0) ? <PayrollFrameButton review={review} finding={finding} /> : null}
              {finding.requiredAction === "correct" ? <span className="payroll-quiet">Correct the source, then re-analyze.</span>
                : onDecide && !busy ? (binaryDecision(finding) ? <>
                  <button type="button" className="payroll-approve" onClick={() => chooseDecision(finding, "payable")}>Approve</button>
                  <button type="button" className="payroll-reject" onClick={() => chooseDecision(finding, "excluded")}>Reject</button>
                </> : <button type="button" onClick={() => chooseDecision(finding, "acknowledged")}>Acknowledge</button>) : null}
            </div>
          </section>)}</div>
          {attention.length > pageSize ? <div className="payroll-actions">
            <button type="button" disabled={firstAttention === 0} onClick={() => setAttentionPage(firstAttention / pageSize - 1)}>Previous findings</button>
            <span role="status">Showing {firstAttention + 1}–{lastAttention} of {attention.length} findings needing attention</span>
            <button type="button" disabled={lastAttention === attention.length} onClick={() => setAttentionPage(firstAttention / pageSize + 1)}>Next findings</button>
          </div> : null}
          {lowEvidence.length ? <p className="payroll-quiet">Low evidence on {lowEvidence.length} {lowEvidence.length === 1 ? "day" : "days"}: {lowEvidence.map((finding) => fullDate(finding.date)).join(", ")}. Review the individual gaps to change payable time.</p> : null}
        </section> : null}

        {!findingsError ? <section className="payroll-panel" aria-labelledby="excluded-title">
          <div className="payroll-report-head"><h2 id="excluded-title">Excluded by rule</h2><p>{excludedCount ? `${excludedCount} interval${excludedCount === 1 ? "" : "s"} · ${hours(excludedMinutes)} removed from pay.` : "No intervals removed from pay."}</p></div>
          <ExcludedGroup title="Continuous inactivity · 3 minutes or more" detail="Zero activity for 3 minutes or more is excluded unless meeting, training, reading, or work evidence covers it." findings={inactivity} review={review} />
          <ExcludedGroup title="Unpaid break" detail="Break time never counts as work. Worktivity captures no screenshots during a break." findings={breaks} review={review} collapsed />
          <ExcludedGroup title="Outside the eligible window" detail="Recorded time before the shift or after its grace end is never payable." findings={outside} review={review} />
          {otherExcluded.length ? <ExcludedGroup title="Other rule exclusions" detail="These intervals were removed by a payroll rule and do not need a decision." findings={otherExcluded} review={review} /> : null}
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
              return brief ? <PayrollBrief key={week} brief={brief} period={review.period} /> : <section key={week} className="payroll-panel"><h3>Week {week}</h3><p>No recap text is available for these dates.</p></section>;
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

      {decision && !decisionChanged && onDecide ? <DecisionDialog decision={decision} busy={busy || decisionSaving} onClose={() => setDecision(null)} onConfirm={async (note) => {
        setDecisionSaving(true);
        try {
          await onDecide(decision.finding.key, decision.action, note, decision.token);
          setDecisionNotice(null);
          setDecision(null);
        } finally { setDecisionSaving(false); }
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

function ExcludedGroup({ title, detail, findings, review, collapsed = false }: {
  title: string; detail: string; findings: PayrollFinding[]; review: PayrollReview; collapsed?: boolean;
}) {
  const total = findings.reduce((sum, finding) => sum + finding.minutes, 0);
  const head = <div className="payroll-rule-head"><div><h3>{title}</h3><p>{detail}</p></div><span className="payroll-rule-count">{findings.length ? `${findings.length} · ${hours(total)}` : "None"}</span></div>;
  const body = findings.length ? <div className="payroll-rule-table">
    <div className="payroll-rule-columns"><span>Date</span><span>Time</span><span>Excluded</span><span>Evidence</span></div>
    {findings.map((finding) => <div className="payroll-rule-row" key={finding.id}>
      <span className="payroll-rule-date">{fullDate(finding.date)}</span>
      <span className="payroll-rule-time">{finding.span ? `${new Intl.DateTimeFormat("en-US", { timeZone: review.period.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(finding.span.startMs))}–${new Intl.DateTimeFormat("en-US", { timeZone: review.period.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(finding.span.endMs))}` : "—"}</span>
      <span className="payroll-rule-minutes">{hours(finding.minutes)}</span>
      <span className="payroll-rule-evidence">{finding.kind === "break" ? "No frames by policy" : finding.kind === "inactivity"
        ? ((finding.frameSummaryIds?.length ?? 0) ? <PayrollFrameButton review={review} finding={finding} /> : "No linked frames")
        : "Not reviewable by policy"}</span>
    </div>)}</div> : null;
  if (!findings.length) return <section className="payroll-rule is-empty">{head}</section>;
  return collapsed ? <details className="payroll-rule"><summary>{head}</summary>{body}</details> : <section className="payroll-rule">{head}{body}</section>;
}

const FRAME_REASON = "Reviewing payroll evidence";

function PayrollFrameButton({ review, finding }: { review: PayrollReview; finding: PayrollFinding }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(FRAME_REASON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const count = finding.frameSummaryIds?.length ?? 0;
  useEffect(() => () => { urls.forEach((url) => URL.revokeObjectURL(url)); }, [urls]);
  useEffect(() => { if (index >= urls.length) setIndex(0); }, [index, urls.length]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight" && urls.length > 1) setIndex((current) => (current + 1) % urls.length);
      if (event.key === "ArrowLeft" && urls.length > 1) setIndex((current) => (current - 1 + urls.length) % urls.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, urls.length]);
  const load = async (value = reason) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setReason(trimmed);
    setBusy(true); setError(null);
    const next: string[] = [];
    try {
      for (const summaryId of finding.frameSummaryIds ?? []) next.push(URL.createObjectURL(await payrollApi.previewFrame(review.id, finding.key, summaryId, trimmed)));
      setUrls(next);
      setIndex(0);
    } catch (issue) {
      next.forEach((url) => URL.revokeObjectURL(url));
      setUrls([]);
      setError((issue as Error).message);
    } finally { setBusy(false); }
  };
  const openDialog = () => {
    setOpen(true);
    if (!urls.length) void load(FRAME_REASON);
  };
  return <>
    <button type="button" className="payroll-link" onClick={openDialog}>{count} {count === 1 ? "frame" : "frames"}</button>
    {open ? <div className="payroll-overlay" role="dialog" aria-modal="true" aria-label="Evidence frames" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="payroll-dialog payroll-frame-dialog">
        <div className="payroll-dialog-head">
          <div><h3>Evidence · {FINDING_LABELS[finding.kind]}</h3><p className="payroll-quiet">{fullDate(finding.date)} · {count} same-day {count === 1 ? "frame" : "frames"}</p></div>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div className="payroll-frame-stage">
          {urls.length
            ? <img src={urls[index]} alt={`Evidence frame ${index + 1} of ${urls.length}`} />
            : <p className="payroll-frame-state">{busy ? "Opening frames…" : error ? "Frames could not be opened." : "No frames linked."}</p>}
          {urls.length > 1 ? <>
            <button type="button" className="payroll-frame-nav prev" aria-label="Previous frame" onClick={() => setIndex((current) => (current - 1 + urls.length) % urls.length)}>‹</button>
            <button type="button" className="payroll-frame-nav next" aria-label="Next frame" onClick={() => setIndex((current) => (current + 1) % urls.length)}>›</button>
            <span className="payroll-frame-counter">{index + 1} / {urls.length}</span>
          </> : null}
        </div>
        {urls.length > 1 ? <div className="payroll-frame-thumbs" aria-label="Evidence frames">
          {urls.map((url, thumb) => <button key={url} type="button" className={`payroll-frame-thumb${thumb === index ? " is-current" : ""}`} aria-label={`Show frame ${thumb + 1}`} aria-pressed={thumb === index} onClick={() => setIndex(thumb)}><img src={url} alt="" /></button>)}
        </div> : null}
        <div className="payroll-frame-meta">
          <p className="payroll-quiet">These are representative frames captured on the same day as this finding; they are not a complete gallery of the period. Access is logged.</p>
          <div className="payroll-frame-reason">
            <label className="payroll-field"><span>Access reason</span><input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why are you reviewing this evidence?" /></label>
            <button type="button" className="primary" disabled={busy || !reason.trim()} onClick={() => void load()}>{busy ? "Opening…" : "Reload with this reason"}</button>
          </div>
          {error ? <p className="payroll-blocker">{error}</p> : null}
        </div>
      </div>
    </div> : null}
  </>;
}

function DecisionDialog({ decision, busy, onClose, onConfirm }: {
  decision: Decision; busy?: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const title = decision.action === "payable" ? "Approve finding" : decision.action === "excluded" ? "Reject finding" : "Acknowledge finding";
  const confirm = decision.action === "payable" ? "Approve" : decision.action === "excluded" ? "Reject" : "Acknowledge";
  const hasAmount = decision.finding.minutes > 0 || decision.finding.durationMs > 0;
  const amount = decision.finding.minutes === 0 && decision.finding.durationMs > 0 ? "under 1 minute" : hours(decision.finding.minutes);
  const consequence = decision.action === "payable"
    ? (hasAmount ? `Approving keeps ${amount} payable.` : "Approving records your review without changing payable hours.")
    : decision.action === "excluded"
      ? (hasAmount ? `Rejecting removes ${amount} from payable hours.` : "Rejecting records your review without changing payable hours.")
      : "Acknowledging records your review without changing payable hours.";
  return <div className="payroll-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="payroll-dialog">
      <div className="payroll-dialog-head"><h3>{title}</h3><button type="button" onClick={onClose}>Cancel</button></div>
      <p>{decision.finding.reason}</p>
      <p className="payroll-quiet">{consequence}</p>
      <label className="payroll-field"><span>Reason (required)</span><input autoFocus value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      {error ? <p className="payroll-blocker">{error}</p> : null}
      <div className="payroll-actions"><button type="button" className="primary" disabled={busy || !note.trim()} onClick={() => {
        setError(null);
        void onConfirm(note.trim()).catch((issue: Error) => setError(issue.message));
      }}>{busy ? "Saving…" : confirm}</button></div>
    </div>
  </div>;
}

export function PayrollFindingsView({ review }: { review: PayrollReview }) {
  return <section className="payroll-panel">
    <h3>Decision queue</h3>
    {review.blockers.length ? review.blockers.map((blocker) => <p key={blocker} className="payroll-blocker">{blocker}</p>) : <p className="payroll-empty">No held findings are waiting.</p>}
  </section>;
}
