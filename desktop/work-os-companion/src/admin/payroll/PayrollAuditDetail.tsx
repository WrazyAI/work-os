import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PayrollCitation, PayrollFinding, PayrollReview } from "@wrazy/work-os-shared/payroll/contracts";
import { formatWorkOsDateTime, formatWorkOsFullDate, formatWorkOsTime } from "../../dateFormat";
import { ADMIN_DETAIL_STALE_MS, formatMinutes, statusLabel } from "../data";
import { AdminButton, AdminCard, AdminControls, Drawer, Empty, Notice, Pill, SelectField } from "../ui";
import { desktopPayroll, desktopPayrollKey } from "./api";
import { groupBreakFindings } from "@wrazy/work-os-shared/payroll/break-groups";
import "./payroll.css";

const FINDING_LABELS: Record<PayrollFinding["kind"], string> = {
  inactivity: "Inactivity",
  break: "Unpaid break",
  outside_window: "Outside schedule",
  unverified_gap: "Unverified coverage",
  low_evidence: "Low evidence",
  activity_during_break: "Activity during break",
  break_mismatch: "Conflicting break records",
  possible_work: "Possible work",
  manual_adjustment: "Manual adjustment",
  no_work: "No recorded work",
  no_schedule: "Schedule correction",
  no_session: "Missing session",
  timezone_changed: "Time zone changed",
  source_conflict: "Source conflict",
};

type Intent =
  | { kind: "approve" }
  | { kind: "reopen" }
  | { kind: "finding"; finding: PayrollFinding; action: "payable" | "excluded" | "acknowledged" };

export function PayrollAuditDetail({ organizationId, userId, reviewId, personId, name, payDate, onBack }: {
  organizationId: string; userId: string; reviewId: string; personId: string; name: string; payDate: string; onBack: () => void;
}) {
  const back = useRef<HTMLDivElement>(null);
  const request = useRef<string | null>(null);
  const api = desktopPayroll(organizationId);
  const keys = desktopPayrollKey(organizationId, userId);
  const cache = useQueryClient();
  const review = useQuery({
    queryKey: [...keys, "review", reviewId],
    queryFn: ({ signal }) => api.review(reviewId, signal),
    staleTime: ADMIN_DETAIL_STALE_MS,
    refetchInterval: (query) => isRunning(query.state.data) ? 4000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const runId = review.data?.run?.id;
  const running = isRunning(review.data);
  useEffect(() => {
    if (!runId || !running) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await desktopPayroll(organizationId).advance(runId);
        await review.refetch();
      } catch {
        // The cron or another window may own the lease; retry on the next poll.
      } finally { inFlight = false; }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [organizationId, runId, running, review.refetch]);
  const restart = useMutation({
    mutationFn: async () => {
      request.current ??= crypto.randomUUID();
      const period = review.data?.period;
      const run = await api.start({
        personId, payDate: period?.payDate ?? payDate,
        from: period?.from, through: period?.through, requestKey: request.current,
      });
      request.current = null;
      return run;
    },
    onSuccess: (run) => {
      cache.setQueryData<PayrollReview>([...keys, "review", reviewId], (current) => current && run.reviewId === current.id ? { ...current, run } : current);
      void cache.invalidateQueries({ queryKey: keys });
    },
  });
  useEffect(() => { back.current?.querySelector("button")?.focus(); }, []);
  const record = review.data;
  return <div className="admin-grid payroll-native">
    <div ref={back}><AdminButton icon={ArrowLeft} variant="ghost" onClick={onBack}>Back to payroll</AdminButton></div>
    {review.isPending ? <p role="status">Loading payroll audit…</p> : null}
    {review.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void review.refetch()}>Retry</AdminButton>}>{review.error.message}</Notice> : null}
    {record && record.scope.organizationId === organizationId && record.scope.personId === personId ? (
      <AuditRecord key={`${record.id}:${record.token.analysisRevision}`} name={name} record={record} userId={userId}
        writesDisabled={Boolean(review.error) || restart.isPending} onRestart={() => restart.mutate()} restartError={restart.error?.message} />
    ) : record ? <Notice tone="err">This audit does not belong to the selected workspace and employee.</Notice> : null}
  </div>;
}

function isRunning(record: PayrollReview | undefined) {
  return record?.run?.progress.status === "queued" || record?.run?.progress.status === "running";
}

function AuditRecord({ record, name, userId, writesDisabled, onRestart, restartError }: {
  record: PayrollReview; name: string; userId: string; writesDisabled: boolean; onRestart: () => void; restartError?: string;
}) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [frameFinding, setFrameFinding] = useState<PayrollFinding | null>(null);
  const org = record.scope.organizationId;
  const cache = useQueryClient();
  const keys = desktopPayrollKey(org, userId);
  const api = desktopPayroll(org);
  const revision = record.token.analysisRevision;
  const running = isRunning(record);
  const failed = record.run?.progress.status === "failed" || record.status === "failed";
  const stale = record.status === "stale" || record.evidenceChangedSinceApproval;
  const mutable = !writesDisabled && !running && !stale && !record.approval;
  const canApprove = mutable && record.status === "ready" && !record.totals.held && !record.recapStats?.pending && !record.blockers.length;
  const days = useQuery({
    queryKey: [...keys, "days", record.id, revision],
    queryFn: ({ signal }) => api.days(record.id, signal), enabled: revision > 0,
    staleTime: ADMIN_DETAIL_STALE_MS, retry: false,
  });
  const findings = useQuery({
    queryKey: [...keys, "findings", record.id, revision],
    queryFn: ({ signal }) => api.findingsAll(record.id, signal), enabled: revision > 0,
    staleTime: ADMIN_DETAIL_STALE_MS, retry: false,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancel(record.run!.id, record.token.rowVersion),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: keys }); },
  });
  const time = (ms: number) => Number.isFinite(ms)
    ? formatWorkOsTime(new Date(ms).toISOString(), record.period.timezone)
    : "Unavailable";
  const allFindings = findings.data?.items ?? [];
  const attention = allFindings.filter((finding) => finding.status === "needs_review" || finding.status === "needs_correction");
  const excluded = allFindings.filter((finding) => finding.status === "auto_excluded");
  const inactivity = excluded.filter((finding) => finding.kind === "inactivity");
  const breaks = groupBreakFindings(excluded.filter((finding) => finding.kind === "break"));
  const outside = excluded.filter((finding) => finding.kind === "outside_window");
  const otherExcluded = excluded.filter((finding) => finding.kind !== "break" && finding.kind !== "inactivity" && finding.kind !== "outside_window");
  const excludedMinutes = excluded.reduce((sum, finding) => sum + finding.minutes, 0);
  const excludedCount = inactivity.length + breaks.length + outside.length
    + excluded.filter((finding) => finding.kind !== "break" && finding.kind !== "inactivity" && finding.kind !== "outside_window").length;
  const appItems = record.apps?.items ?? [];
  const appTotal = appItems.reduce((sum, app) => sum + app.durationMs, 0);
  const topApps = appItems.slice(0, 8);
  const otherApps = appItems.slice(8);
  const otherMs = otherApps.reduce((sum, app) => sum + app.durationMs, 0);
  const appMax = Math.max(1, otherMs, ...appItems.map((app) => app.durationMs));
  const dayItems = days.data?.items ?? [];
  const dayMax = Math.max(1, ...dayItems.map((day) => day.minutes.recommended));
  const framed = inactivity.filter((finding) => (finding.frameSummaryIds?.length ?? 0) > 0).slice(0, 5);
  const range = (finding: PayrollFinding) => finding.span
    ? `${time(finding.span.startMs)}–${time(finding.span.endMs)}`
    : "All day";
  const amount = (finding: PayrollFinding) => finding.minutes === 0 && finding.durationMs > 0 ? "Under 1 min" : formatMinutes(finding.minutes);
  const binaryDecision = (finding: PayrollFinding) => finding.requiredAction === "decide"
    || (finding.requiredAction === "acknowledge" && (finding.minutes > 0 || finding.durationMs > 0));
  const stack = [
    { key: "payable", label: "Payable", minutes: record.totals.recommended, color: "var(--chart-1)" },
    { key: "break", label: "Break", minutes: record.totals.break, color: "var(--chart-3)" },
    { key: "inactivity", label: "Inactivity", minutes: record.totals.inactivity, color: "var(--chart-2)" },
    { key: "held", label: "Held", minutes: record.totals.held, color: "var(--warning)" },
    { key: "outside", label: "Outside", minutes: record.totals.outside, color: "var(--chart-8)" },
    { key: "manual", label: "Manual", minutes: record.totals.manualExcluded, color: "var(--chart-7)" },
  ].filter((row) => row.minutes > 0);

  return <>
    <AdminCard title={name} detail={`${formatWorkOsFullDate(record.period.from)} to ${formatWorkOsFullDate(record.period.through)}`}
      action={running && record.run
        ? <AdminButton disabled={writesDisabled || cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelling…" : "Cancel analysis"}</AdminButton>
        : !record.approval ? <AdminButton disabled={writesDisabled} onClick={onRestart}>{revision > 0 ? "Re-analyze" : "Run audit"}</AdminButton> : undefined}>
      <div className="admin-grid">
        <AdminControls>
          <div className="payroll-native-meta">
            <Pill tone={record.status === "approved" ? "ok" : record.status === "needs_review" ? "warn" : "neutral"}>{statusLabel(record.status)}</Pill>
            <span className="admin-quiet">Pay date {formatWorkOsFullDate(record.period.payDate)}</span>
            {record.providerVerifiedAt ? <span className="admin-quiet">Evidence checked {formatWorkOsDateTime(record.providerVerifiedAt, record.period.timezone)}</span> : null}
            <span className="admin-quiet">Expires {formatWorkOsFullDate(record.retentionExpiresAt)}</span>
          </div>
        </AdminControls>
        {running && record.run ? <p role="status">{record.run.progress.message}
          {record.run.progress.days ? ` · ${record.run.progress.daysDone}/${record.run.progress.days} days` : ""}
        </p> : null}
        {failed ? <Notice tone="warn">{record.status === "ready"
          ? `The latest re-analysis did not finish. The published analysis is unchanged. ${record.run?.progress.message}`
          : `This audit did not finish. Re-analyze to try again. ${record.run?.progress.message}`}</Notice> : null}
        {cancel.error ? <Notice tone="err">{cancel.error.message}</Notice> : null}
        {stale ? <Notice tone="warn">{record.approval ? "The approved receipt is unchanged. Evidence changed after approval." : "Evidence changed. Re-analyze before recording decisions."}</Notice> : null}
        {restartError ? <Notice tone="err">{restartError}</Notice> : null}
        {revision > 0 && record.recapStats ? <>
          <p className="admin-quiet">{record.recapStats.employeeReviewed} employee reviewed, {record.recapStats.autoApproved} system reviewed, {record.recapStats.pending} pending.</p>
          {!record.approval && record.recapStats.pending ? <Notice tone="warn">Pending recaps must be settled before approval.</Notice> : null}
        </> : null}
        {findings.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void findings.refetch()}>Retry</AdminButton>}>Findings could not be loaded. {findings.error.message}</Notice> : null}
        {days.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void days.refetch()}>Retry</AdminButton>}>Daily evidence could not be loaded. {days.error.message}</Notice> : null}
        {record.blockers.length ? <ul className="payroll-native-list">{record.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        {canApprove ? <div><AdminButton variant="primary" onClick={() => setIntent({ kind: "approve" })}>Approve payable hours</AdminButton></div> : null}
        {record.approval ? <div>
          <p><strong>Approved receipt</strong> · {formatWorkOsDateTime(record.approval.approvedAt, record.period.timezone)}</p>
          <p className="admin-quiet">Receipt {record.approval.snapshotHash.slice(0, 12)}. Reopening does not change this receipt.</p>
          <AdminButton disabled={writesDisabled} onClick={() => setIntent({ kind: "reopen" })}>Reopen with reason</AdminButton>
        </div> : null}
      </div>
    </AdminCard>

    {revision > 0 ? <>
      <AdminCard title="Hours" detail="Recorded time reconciled against the schedule and evidence.">
        <div className="payroll-hours">
          <div>
            <span className="payroll-label">Estimated payable</span>
            <div className="payroll-big">{formatMinutes(record.totals.recommended)} <small>of {formatMinutes(record.totals.recorded)} recorded</small></div>
            <div className="payroll-legend">{stack.map((row) => (
              <span key={row.key}><b style={{ background: row.color }} />{row.label} {formatMinutes(row.minutes)}</span>
            ))}</div>
          </div>
          <div>
            <div className="payroll-stack" role="img" aria-label={`Recorded time split: ${stack.map((row) => `${row.label} ${formatMinutes(row.minutes)}`).join(", ")}`}>
              {stack.map((row) => <i key={row.key} style={{ width: `${(row.minutes / Math.max(1, record.totals.recorded)) * 100}%`, background: row.color }} />)}
            </div>
            <div className="payroll-hours-stats">
              <div><span className="payroll-label">Flags</span><strong>{allFindings.length}</strong><span>{attention.length} need attention</span></div>
              <div><span className="payroll-label">Excluded</span><strong>{excludedCount}</strong><span>intervals by rule</span></div>
              <div><span className="payroll-label">Recaps</span><strong>{record.recapStats?.employeeReviewed ?? 0}</strong><span>employee reviewed</span></div>
            </div>
          </div>
        </div>
        {dayItems.length ? <div className="payroll-day-band">
          <div className="payroll-day-head"><span className="payroll-label">Payable time by day</span><span>{record.period.timezone}</span></div>
          <div className="payroll-days" role="img" aria-label="Payable time by day">
            {dayItems.map((day) => <div className="payroll-day" key={day.date}>
              <i style={{ height: `${Math.max(3, (day.minutes.recommended / dayMax) * 100)}%` }} />
              <span>{day.date.slice(-2)}</span>
            </div>)}
          </div>
        </div> : null}
      </AdminCard>

      {!findings.error ? <><AdminCard title="Needs attention" detail={`${attention.length} of ${allFindings.length} flags require a person`}>
        {attention.length ? <div className="payroll-attention">
          {attention.map((finding) => <section className="payroll-attention-row" key={finding.id}>
            <div>
              <div className="payroll-finding-title"><h3>{FINDING_LABELS[finding.kind]}</h3>
                <Pill tone={finding.requiredAction === "correct" ? "err" : "warn"}>{statusLabel(finding.status)}</Pill>
              </div>
              <p className="admin-quiet">{formatWorkOsFullDate(finding.date)} · {range(finding)} · {amount(finding)}</p>
              <p>{finding.reason}</p>
              {binaryDecision(finding) ? <p className="admin-quiet">Approve keeps this time payable; reject excludes it.</p> : null}
              <Sources citations={finding.citations} />
            </div>
            <div className="payroll-attention-actions">
              {finding.kind !== "break" && (finding.frameSummaryIds?.length ?? 0) ? <AdminButton onClick={() => setFrameFinding(finding)}>{finding.frameSummaryIds?.length ?? 0} frame{(finding.frameSummaryIds?.length ?? 0) === 1 ? "" : "s"}</AdminButton> : null}
              {finding.requiredAction === "correct" ? <span className="admin-quiet">Correct the source, then re-analyze.</span>
                : mutable && (finding.status === "needs_review" || finding.status === "needs_correction") ? (
                  binaryDecision(finding) ? <>
                    <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "payable" })}>Approve</AdminButton>
                    <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "excluded" })}>Reject</AdminButton>
                  </> : <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "acknowledged" })}>Acknowledge</AdminButton>
                ) : null}
            </div>
          </section>)}
        </div> : <p className="admin-quiet">Nothing needs a decision on this page.</p>}
      </AdminCard>

      <AdminCard title="Excluded by rule" detail={`${excludedCount} intervals · ${formatMinutes(excludedMinutes)} removed from pay`}>
        <ExcludedGroup title="Continuous inactivity · 3 minutes or more"
          detail="Zero activity for 3 minutes or more is excluded unless meeting, training, reading, or work evidence covers it."
          findings={inactivity} onFrame={setFrameFinding} formatTime={time} empty="No inactivity intervals were excluded." />
        <ExcludedGroup title="Unpaid break"
          detail="Break time never counts as work. Worktivity captures no screenshots during a break."
          findings={breaks} onFrame={setFrameFinding} formatTime={time} collapsed empty="No break intervals were excluded." />
        <ExcludedGroup title="Outside the eligible window"
          detail="Recorded time before the shift or after its grace end is never payable."
          findings={outside} onFrame={setFrameFinding} formatTime={time} empty="No outside-window intervals were excluded." />
        {otherExcluded.length ? <ExcludedGroup title="Other rule exclusions"
          detail="These intervals were removed by a payroll rule and do not need a decision."
          findings={otherExcluded} onFrame={setFrameFinding} formatTime={time} empty="No other rule exclusions." /> : null}
      </AdminCard></> : null}

      {framed.length ? <AdminCard title="Evidence frames" detail="Linked to excluded inactivity intervals. Access is guarded.">
        <div className="payroll-shots">
          {framed.map((finding) => <button type="button" className="payroll-shot" key={finding.id} onClick={() => setFrameFinding(finding)}>
            <span className="payroll-shot-screen" aria-hidden="true"><span className="payroll-shot-body"><u /><span><em /><em /><em /><em /></span></span></span>
            <span className="payroll-shot-meta"><b>{formatWorkOsFullDate(finding.date)}</b><span>{finding.frameSummaryIds?.length ?? 0} frames</span></span>
          </button>)}
        </div>
        <p className="admin-quiet">Opening frames records a reason and rechecks consent, expiry, and sensitive-content policy.</p>
      </AdminCard> : null}

      <AdminCard title="Daily evidence" detail={`Times in ${record.period.timezone}`}>
        {days.isPending ? <p role="status">Loading daily evidence…</p> : null}
        {days.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void days.refetch()}>Retry</AdminButton>}>{days.error.message}</Notice> : null}
        {dayItems.length === 0 ? <p className="admin-quiet">No daily records were saved.</p> : null}
        {dayItems.map((day) => <details className="payroll-native-row" key={day.date}>
          <summary>{formatWorkOsFullDate(day.date)} <small>{formatMinutes(day.minutes.recommended)} recommended</small></summary>
          <dl className="payroll-native-totals">
            <div><dt>Recorded</dt><dd>{formatMinutes(day.minutes.recorded)}</dd></div>
            <div><dt>Outside shift</dt><dd>{formatMinutes(day.minutes.outside)}</dd></div>
            <div><dt>Unpaid break</dt><dd>{formatMinutes(day.minutes.break)}</dd></div>
            <div><dt>Verified inactivity</dt><dd>{formatMinutes(day.minutes.inactivity)}</dd></div>
            <div><dt>Held</dt><dd>{formatMinutes(day.minutes.held)}</dd></div>
            <div><dt>Manual exclusions</dt><dd>{formatMinutes(day.minutes.manualExcluded)}</dd></div>
          </dl>
          {day.evidence ? <p className="admin-quiet">{day.evidence.sessions.length} session{day.evidence.sessions.length === 1 ? "" : "s"}, {day.evidence.sampledFrames} frames analyzed.</p> : null}
          {day.evidence?.sessions.length ? <ul className="payroll-native-list">{day.evidence.sessions.map((session, i) => (
            <li key={i}>Session {i + 1}: {session.recorded ? `${time(session.recorded.startMs)} to ${time(session.recorded.endMs)}` : "Recorded time unavailable"}</li>
          ))}</ul> : null}
          {day.blockers.length ? <ul className="payroll-native-list">{day.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        </details>)}
      </AdminCard>

      <AdminCard title="Weekly briefs" detail="Grounded in recaps and evidence. This is not a productivity score.">
        {record.briefs.length ? <div className="payroll-native-stack">{record.briefs.map((brief) => (
          <section key={brief.week} className="payroll-native-row">
            <h3>Week {brief.week}: {brief.title || "Progress brief"}</h3>
            <p>{brief.summary || "No grounded summary is available."}</p>
            <Sources citations={brief.summaryCitations} />
            {brief.themes.length ? <ul className="payroll-native-list">{brief.themes.map((theme, i) => <li key={i}><strong>{theme.heading}</strong><p>{theme.detail}</p><Sources citations={theme.citations} /></li>)}</ul> : null}
            {brief.openItems.length ? <><h4>Open items</h4><ul className="payroll-native-list">{brief.openItems.map((item, i) => <li key={i}>{item.text}<Sources citations={item.citations} /></li>)}</ul></> : null}
            {brief.gaps.length ? <><h4>Evidence gaps</h4><ul className="payroll-native-list">{brief.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></> : null}
          </section>
        ))}</div> : <p className="admin-quiet">No recap brief was recorded for this period.</p>}
      </AdminCard>

      <AdminCard title="Apps and sites" detail={appTotal ? `${formatMinutes(Math.round(appTotal / 60_000))} observed · Worktivity · context only` : "App usage unavailable for this period"}>
        {appItems.length ? <div className="payroll-apps">
          {topApps.map((app, index) => {
            const minutes = Math.round(app.durationMs / 60_000);
            return <div className="payroll-app-row" key={`${app.name}-${index}`}>
              <span className="payroll-app-name"><b style={{ background: `var(--chart-${(index % 8) + 1})` }} />{app.name}</span>
              <span className="payroll-track"><i style={{ width: `${Math.max(2, (app.durationMs / appMax) * 100)}%`, background: `var(--chart-${(index % 8) + 1})` }} /></span>
              <span className="payroll-app-time">{formatMinutes(minutes)} · {Math.round((app.durationMs / Math.max(1, appTotal)) * 100)}%</span>
            </div>;
          })}
          {otherApps.length ? <div className="payroll-app-row">
            <span className="payroll-app-name"><b style={{ background: "var(--chart-8)" }} />Other ({otherApps.length} apps)</span>
            <span className="payroll-track"><i style={{ width: `${Math.max(2, (otherMs / appMax) * 100)}%`, background: "var(--chart-8)" }} /></span>
            <span className="payroll-app-time">{formatMinutes(Math.round(otherMs / 60_000))} · {Math.round((otherMs / Math.max(1, appTotal)) * 100)}%</span>
          </div> : null}
        </div> : <p className="admin-quiet">No app distribution was captured. This does not change payable hours.</p>}
        {record.apps && !record.apps.complete ? <p className="admin-quiet">App coverage is incomplete for this period.</p> : null}
      </AdminCard>
    </> : null}

    {typeof document !== "undefined" ? createPortal(
      <div className="payroll-askbar">
        <div className="payroll-askpill" role="group" aria-label="Ask about this report">
          <span>Ask anything about this report</span>
          <span className="payroll-soon">Coming soon</span>
          <button type="button" disabled aria-label="Send (coming soon)"><ArrowRight size={15} /></button>
        </div>
      </div>, document.body) : null}

    {frameFinding ? <PayrollFrameDialog record={record} finding={frameFinding} onClose={() => setFrameFinding(null)} /> : null}

    {intent && (intent.kind === "reopen" ? !writesDisabled && Boolean(record.approval) : intent.kind === "approve" ? canApprove : mutable) ? (
      <PayrollDecision record={record} userId={userId} intent={intent} onClose={() => setIntent(null)} />
    ) : null}
  </>;
}

function ExcludedGroup({ title, detail, findings, onFrame, formatTime, empty, collapsed = false }: {
  title: string; detail: string; findings: PayrollFinding[];
  onFrame: (finding: PayrollFinding) => void; formatTime: (ms: number) => string; empty: string; collapsed?: boolean;
}) {
  const total = findings.reduce((sum, finding) => sum + finding.minutes, 0);
  const head = <div className="payroll-rule-head"><div><h3>{title}</h3><p>{detail}</p></div><Pill>{findings.length} · {formatMinutes(total)}</Pill></div>;
  const body = findings.length ? <div className="payroll-rule-table">{findings.map((finding) => {
      const frames = finding.frameSummaryIds ?? [];
      return <div className="payroll-rule-row" key={finding.id}>
        <span>{formatWorkOsFullDate(finding.date)}</span>
        <span>{finding.span ? `${formatTime(finding.span.startMs)}–${formatTime(finding.span.endMs)}` : "—"}</span>
        <span>{finding.minutes === 0 && finding.durationMs > 0 ? "Under 1 min" : formatMinutes(finding.minutes)}</span>
        <span>{finding.kind === "break" ? "No frames by policy" : finding.kind === "inactivity"
          ? (frames.length ? <button type="button" className="admin-record-open" onClick={() => onFrame(finding)}>{frames.length} frame{frames.length === 1 ? "" : "s"}</button> : "No linked frames")
          : "Not reviewable by policy"}</span>
      </div>;
    })}</div> : <p className="admin-quiet">{empty}</p>;
  return collapsed ? <details className="payroll-rule"><summary>{head}</summary>{body}</details> : <section className="payroll-rule">{head}{body}</section>;
}

const FRAME_REASON = "Reviewing payroll evidence";

function PayrollFrameDialog({ record, finding, onClose }: { record: PayrollReview; finding: PayrollFinding; onClose: () => void }) {
  const [reason, setReason] = useState(FRAME_REASON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const api = desktopPayroll(record.scope.organizationId);
  const summaries = finding.frameSummaryIds ?? [];
  useEffect(() => () => { urls.forEach((url) => URL.revokeObjectURL(url)); }, [urls]);
  useEffect(() => { if (index >= urls.length) setIndex(0); }, [index, urls.length]);
  const load = async (value = reason) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setReason(trimmed);
    setBusy(true); setError(null);
    const next: string[] = [];
    try {
      for (const summaryId of summaries) {
        next.push(URL.createObjectURL(await api.previewFrame(record.id, finding.key, summaryId, trimmed)));
      }
      setUrls(next);
      setIndex(0);
    } catch (issue) {
      next.forEach((url) => URL.revokeObjectURL(url));
      setUrls([]);
      setError((issue as Error).message);
    } finally { setBusy(false); }
  };
  useEffect(() => { void load(FRAME_REASON); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && urls.length > 1) setIndex((current) => (current + 1) % urls.length);
      if (event.key === "ArrowLeft" && urls.length > 1) setIndex((current) => (current - 1 + urls.length) % urls.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [urls.length]);
  return <Drawer open onClose={onClose} title={`Evidence · ${FINDING_LABELS[finding.kind]}`}
    footer={<AdminButton onClick={onClose} disabled={busy}>Close</AdminButton>}>
    <div className="admin-grid">
      <p className="admin-quiet">{formatWorkOsFullDate(finding.date)} · {summaries.length} same-day {summaries.length === 1 ? "frame" : "frames"}. Representative evidence, not a complete gallery; access is logged.</p>
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
      <label className="admin-field"><span>Access reason</span><input value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Why are you reviewing this evidence?" /></label>
      <div><AdminButton onClick={() => void load()} disabled={busy || !reason.trim()}>{busy ? "Opening…" : "Reload with this reason"}</AdminButton></div>
      {error ? <Notice tone="err">{error}</Notice> : null}
    </div>
  </Drawer>;
}

function Sources({ citations }: { citations: PayrollCitation[] }) {
  if (!citations.length) return null;
  return <details className="payroll-native-sources">
    <summary>Sources ({citations.length})</summary>
    <ul className="payroll-native-list">{citations.map((citation) => <li key={`${citation.type}:${citation.id}:${citation.revision}`}>
      {citation.type === "interval" ? "Recap" : statusLabel(citation.type)} {citation.id}, revision {citation.revision}
    </li>)}</ul>
  </details>;
}

function PayrollDecision({ record, userId, intent, onClose }: { record: PayrollReview; userId: string; intent: Intent; onClose: () => void }) {
  const [note, setNote] = useState("");
  const request = useRef<{ note: string; key: string } | null>(null);
  const [token] = useState(record.token);
  const api = desktopPayroll(record.scope.organizationId);
  const keys = desktopPayrollKey(record.scope.organizationId, userId);
  const cache = useQueryClient();
  const changed = token.rowVersion !== record.token.rowVersion || token.sourceHash !== record.token.sourceHash;
  const title = intent.kind === "approve" ? "Approve payable hours" : intent.kind === "reopen" ? "Reopen payroll review"
    : intent.action === "payable" ? "Approve finding" : intent.action === "excluded" ? "Reject finding" : "Acknowledge finding";
  const confirm = intent.kind === "finding"
    ? (intent.action === "payable" ? "Approve" : intent.action === "excluded" ? "Reject" : "Acknowledge")
    : title;
  const hasAmount = intent.kind === "finding" && (intent.finding.minutes > 0 || intent.finding.durationMs > 0);
  const amount = intent.kind === "finding"
    ? (intent.finding.minutes === 0 && intent.finding.durationMs > 0 ? "under 1 minute" : formatMinutes(intent.finding.minutes))
    : "";
  const consequence = intent.kind !== "finding" ? null
    : intent.action === "payable"
      ? (hasAmount ? `Approving keeps ${amount} payable.` : "Approving records your review without changing payable hours.")
      : intent.action === "excluded"
        ? (hasAmount ? `Rejecting removes ${amount} from payable hours.` : "Rejecting records your review without changing payable hours.")
        : "Acknowledging records your review without changing payable hours.";
  const decision = useMutation({
    mutationFn: async (reason: string) => {
      if (request.current?.note !== reason) request.current = { note: reason, key: crypto.randomUUID() };
      const command = { ...token, requestKey: request.current.key };
      if (intent.kind === "approve") return api.approve(record.id, { ...command, note: reason });
      if (intent.kind === "reopen") return api.reopen(record.id, { ...command, reason });
      return api.decide(record.id, { ...command, findingIds: [intent.finding.key], action: intent.action, note: reason });
    },
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: keys }); onClose(); },
  });
  return <Drawer open onClose={() => { if (!decision.isPending) onClose(); }} title={title}
    footer={<>
      <AdminButton disabled={decision.isPending} onClick={onClose}>Cancel</AdminButton>
      <AdminButton variant="primary" disabled={decision.isPending || changed || !note.trim()} onClick={() => decision.mutate(note.trim())}>{decision.isPending ? "Saving…" : confirm}</AdminButton>
    </>}>
    <div className="admin-grid">
      <p>{intent.kind === "approve" ? `Approve ${formatMinutes(record.totals.recommended)} and create an immutable receipt.`
        : intent.kind === "reopen" ? "The existing receipt is kept. The review will need a new approval."
          : intent.finding.reason}</p>
      {consequence ? <p className="admin-quiet">{consequence}</p> : null}
      {changed ? <Notice tone="warn">The review changed. Close this dialog and check the latest record before trying again.</Notice> : null}
      <label className="admin-field"><span>Reason</span><input value={note} maxLength={500} disabled={decision.isPending} onChange={(event) => setNote(event.target.value)} /></label>
      {decision.error ? <Notice tone="err">{decision.error.message}</Notice> : null}
    </div>
  </Drawer>;
}
