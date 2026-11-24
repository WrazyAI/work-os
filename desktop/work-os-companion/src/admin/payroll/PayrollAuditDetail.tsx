import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { PayrollCitation, PayrollFinding, PayrollReview } from "../../../../../src/modules/work-os/payroll/contracts";
import { formatWorkOsDateTime, formatWorkOsFullDate, formatWorkOsTime } from "../../dateFormat";
import { ADMIN_DETAIL_STALE_MS, formatMinutes, statusLabel } from "../data";
import { AdminButton, AdminCard, AdminControls, Drawer, Empty, Notice, Pill, SelectField } from "../ui";
import { desktopPayroll, desktopPayrollKey } from "./api";
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
  const restart = useMutation({
    mutationFn: async () => {
      request.current ??= crypto.randomUUID();
      const run = await api.start({ personId, payDate, requestKey: request.current });
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
  const [status, setStatus] = useState("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [intent, setIntent] = useState<Intent | null>(null);
  const org = record.scope.organizationId;
  const cache = useQueryClient();
  const keys = desktopPayrollKey(org, userId);
  const api = desktopPayroll(org);
  const revision = record.token.analysisRevision;
  const cursor = pages.at(-1) ?? null;
  const running = isRunning(record);
  const failed = record.run?.progress.status === "failed" || record.status === "failed";
  const stale = record.status === "stale" || record.evidenceChangedSinceApproval;
  const mutable = !writesDisabled && !running && !failed && !stale && !record.approval;
  const canApprove = mutable && record.status === "ready" && !record.totals.held && !record.recapStats?.pending && !record.blockers.length;
  const days = useQuery({
    queryKey: [...keys, "days", record.id, revision],
    queryFn: ({ signal }) => api.days(record.id, signal), enabled: revision > 0,
    staleTime: ADMIN_DETAIL_STALE_MS, retry: false,
  });
  const findings = useQuery({
    queryKey: [...keys, "findings", record.id, revision, status, cursor],
    queryFn: ({ signal }) => api.findings(record.id, status, cursor, signal), enabled: revision > 0,
    staleTime: ADMIN_DETAIL_STALE_MS, retry: false,
  });
  const time = (ms: number) => Number.isFinite(ms)
    ? formatWorkOsTime(new Date(ms).toISOString(), record.period.timezone)
    : "Unavailable";
  return <>
    <AdminCard title={name} detail={`${formatWorkOsFullDate(record.period.from)} to ${formatWorkOsFullDate(record.period.through)}`}
      action={!running && !record.approval ? <AdminButton variant={canApprove ? "ghost" : "secondary"} disabled={writesDisabled} onClick={onRestart}>Re-analyze</AdminButton> : undefined}>
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
        {failed ? <Notice tone="warn">This audit did not finish. Re-analyze to try again.</Notice> : null}
        {stale ? <Notice tone="warn">{record.approval ? "The approved receipt is unchanged. Evidence changed after approval." : "Evidence changed. Re-analyze before recording decisions."}</Notice> : null}
        {restartError ? <Notice tone="err">{restartError}</Notice> : null}
        {revision > 0 ? <dl className="payroll-native-totals">
          <div><dt>Recorded</dt><dd>{formatMinutes(record.totals.recorded)}</dd></div>
          <div><dt>Recommended</dt><dd>{formatMinutes(record.totals.recommended)}</dd></div>
          <div><dt>Held</dt><dd>{formatMinutes(record.totals.held)}</dd></div>
          <div><dt>Approved</dt><dd>{record.approval ? formatMinutes(record.approval.totals.approved) : "—"}</dd></div>
        </dl> : null}
        {record.recapStats ? <p className="admin-quiet">{record.recapStats.employeeReviewed} employee reviewed, {record.recapStats.autoApproved} system reviewed, {record.recapStats.pending} pending.</p> : null}
        {!record.approval && record.recapStats?.pending ? <Notice tone="warn">Pending recaps must be settled before approval.</Notice> : null}
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
      <AdminCard title="Weekly briefs" detail="Observed evidence, not a productivity score">
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
      <AdminCard title="Daily evidence" detail={`Times in ${record.period.timezone}`}>
        {days.isPending ? <p role="status">Loading daily evidence…</p> : null}
        {days.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void days.refetch()}>Retry</AdminButton>}>{days.error.message}</Notice> : null}
        {days.data?.items.length === 0 ? <p className="admin-quiet">No daily records were saved.</p> : null}
        {days.data?.items.map((day) => <details className="payroll-native-row" key={day.date}>
          <summary>{formatWorkOsFullDate(day.date)} <small>{formatMinutes(day.minutes.recommended)} recommended</small></summary>
          <dl className="payroll-native-totals">
            <div><dt>Recorded</dt><dd>{formatMinutes(day.minutes.recorded)}</dd></div>
            <div><dt>Outside shift</dt><dd>{formatMinutes(day.minutes.outside)}</dd></div>
            <div><dt>Unpaid break</dt><dd>{formatMinutes(day.minutes.break)}</dd></div>
            <div><dt>Verified inactivity</dt><dd>{formatMinutes(day.minutes.inactivity)}</dd></div>
            <div><dt>Held</dt><dd>{formatMinutes(day.minutes.held)}</dd></div>
            <div><dt>Manual exclusions</dt><dd>{formatMinutes(day.minutes.manualExcluded)}</dd></div>
          </dl>
          {day.evidence ? <p className="admin-quiet">{day.evidence.sessions.length} sessions, {day.evidence.sampledFrames} frames analyzed.</p> : null}
          {day.evidence?.sessions.length ? <ul className="payroll-native-list">{day.evidence.sessions.map((session, i) => (
            <li key={i}>Session {i + 1}: {session.recorded ? `${time(session.recorded.startMs)} to ${time(session.recorded.endMs)}` : "Recorded time unavailable"}</li>
          ))}</ul> : null}
          {day.blockers.length ? <ul className="payroll-native-list">{day.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        </details>)}
      </AdminCard>
      <AdminCard title="Findings" detail="Missing coverage is not treated as inactivity"
        controls={<SelectField label="Finding status" value={status} onChange={(value) => { setStatus(value); setPages([null]); }}
          options={[{ value: "", label: "All findings" }, { value: "needs_review", label: "Needs review" }, { value: "needs_correction", label: "Needs correction" }]} />}>
        {findings.isPending ? <p role="status">Loading findings…</p> : null}
        {findings.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void findings.refetch()}>Retry</AdminButton>}>{findings.error.message}</Notice> : null}
        {findings.data?.items.length === 0 ? <Empty title="No findings on this page" body="Choose another filter to see the rest of the audit." /> : null}
        {findings.data?.items.map((finding) => <section className="payroll-native-row" key={finding.id}>
          <div className="payroll-native-finding-title"><h3>{FINDING_LABELS[finding.kind]}</h3><Pill tone={finding.status === "needs_review" || finding.status === "needs_correction" ? "warn" : "neutral"}>{statusLabel(finding.status)}</Pill></div>
          <p className="admin-quiet">{formatWorkOsFullDate(finding.date)} · {finding.span ? `${time(finding.span.startMs)} to ${time(finding.span.endMs)} · ` : ""}
            {finding.minutes === 0 && finding.durationMs > 0 ? "Under 1 minute" : formatMinutes(finding.minutes)}</p>
          <p>{finding.reason}</p>
          <Sources citations={finding.citations} />
          {finding.status === "needs_correction" ? <p className="admin-quiet">Correct the source record, then re-analyze this period.</p> : null}
          {mutable && !findings.error && record.status === "needs_review" && finding.status === "needs_review" ? (
            <AdminControls>
              {finding.requiredAction === "decide" ? <>
                <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "payable" })}>Keep payable</AdminButton>
                <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "excluded" })}>Exclude time</AdminButton>
              </> : finding.requiredAction === "acknowledge" ?
                <AdminButton onClick={() => setIntent({ kind: "finding", finding, action: "acknowledged" })}>Acknowledge</AdminButton> : null}
            </AdminControls>
          ) : null}
        </section>)}
        {findings.data && (pages.length > 1 || findings.data.nextCursor) ? <AdminControls>
          <span role="status" className="admin-quiet">Page {pages.length}; {findings.data.total} findings</span>
          <AdminButton disabled={pages.length === 1} onClick={() => setPages((current) => current.slice(0, -1))}>Previous</AdminButton>
          <AdminButton disabled={!findings.data.nextCursor} onClick={() => {
            const next = findings.data?.nextCursor;
            if (next) setPages((current) => [...current, next]);
          }}>Next</AdminButton>
        </AdminControls> : null}
      </AdminCard>
    </> : null}
    {intent && (intent.kind === "reopen" ? !writesDisabled && Boolean(record.approval) : intent.kind === "approve" ? canApprove : mutable) ? (
      <PayrollDecision record={record} userId={userId} intent={intent} onClose={() => setIntent(null)} />
    ) : null}
  </>;
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
    : intent.action === "payable" ? "Keep payable" : intent.action === "excluded" ? "Exclude time" : "Acknowledge finding";
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
      <AdminButton variant="primary" disabled={decision.isPending || changed || !note.trim()} onClick={() => decision.mutate(note.trim())}>{decision.isPending ? "Saving…" : title}</AdminButton>
    </>}>
    <div className="admin-grid">
      <p>{intent.kind === "approve" ? `Approve ${formatMinutes(record.totals.recommended)} and create an immutable receipt.`
        : intent.kind === "reopen" ? "The existing receipt is kept. The review will need a new approval."
          : intent.finding.reason}</p>
      {changed ? <Notice tone="warn">The review changed. Close this dialog and check the latest record before trying again.</Notice> : null}
      <label className="admin-field"><span>Reason</span><input value={note} maxLength={500} disabled={decision.isPending} onChange={(event) => setNote(event.target.value)} /></label>
      {decision.error ? <Notice tone="err">{decision.error.message}</Notice> : null}
    </div>
  </Drawer>;
}
