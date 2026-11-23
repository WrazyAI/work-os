"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice, Skeleton } from "../ui";
import { payrollApi, payrollKeys } from "./api";
import { PayrollAuditDays, PayrollAuditFinding, type PayrollFindingAction } from "./PayrollAuditEvidence";
import { PayrollReviewView } from "./PayrollReviewView";
import { PayrollQuestions } from "./PayrollQuestions";
import { payrollWorkspaceHref } from "./paths";
import type { PayrollReview as Review } from "@/modules/work-os/payroll/contracts";

export default function PayrollReview({ personId, payDate, reviewId, displayName }: {
  personId: string; payDate: string; reviewId: string | null; displayName: string;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startKey = useRef<string | null>(null);
  const review = useQuery({
    queryKey: payrollKeys.review(reviewId ?? "none"),
    queryFn: () => payrollApi.review(reviewId!),
    enabled: Boolean(reviewId),
    refetchInterval: (query) => isRunning(query.state.data) ? 3000 : false,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["work-os", "admin", "payroll"] });
  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      startKey.current ??= crypto.randomUUID();
      const run = await payrollApi.start(personId, payDate, startKey.current);
      if (review.data) cache.setQueryData(payrollKeys.review(run.reviewId), { ...review.data, run });
      startKey.current = null;
      await refresh();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  const back = <nav className="payroll-actions payroll-review-nav" aria-label="Back to payroll">
    <Link href={payrollWorkspaceHref("audits", payDate)}>All audits</Link>
    <Link href={payrollWorkspaceHref("records", payDate)}>Payroll records</Link>
  </nav>;
  if (reviewId && review.isPending) return <>{back}<Skeleton className="m-6 h-64" /></>;
  if (reviewId && review.error) return <>{back}<Notice tone="err">{review.error.message} <button type="button" onClick={() => void review.refetch()}>Retry</button></Notice></>;
  const record = review.data;
  if (!record) return <section className="payroll-shell">
    {back}
    <h2>{displayName}</h2>
    <p>No audit exists for this pay date.</p>
    <Link href={payrollWorkspaceHref("audits", payDate, true)}>New audit</Link>
  </section>;

  const command = () => ({ ...record.token, requestKey: crypto.randomUUID() });
  const running = isRunning(record);
  async function save(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); await refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <>
      {back}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <PayrollReviewView
        review={record} displayName={displayName} busy={busy}
        onAdvance={() => void start()}
        onApprove={() => {
          if (window.confirm(`Approve ${record.totals.recommended} minutes? This creates an immutable payroll record.`)) {
            void save(() => payrollApi.approve(record.id, { ...command(), note: "Payroll approved" }));
          }
        }}
        onReopen={() => {
          const reason = window.prompt("Reason for reopening this payroll approval?")?.trim();
          if (reason) void save(() => payrollApi.reopen(record.id, { ...command(), reason }));
        }}
      />
      {record.approval ? <div className="payroll-actions payroll-review-nav">
        <Link href={`/work-os/admin/payroll/approvals/${encodeURIComponent(record.approval.id)}/print`}>Print approved record</Link>
      </div> : null}
      {record.token.analysisRevision > 0 ? (
        <div className="payroll-review-detail">
          <PayrollAuditDetails
            key={`${record.id}:${record.token.analysisRevision}`}
            record={record}
            busy={busy}
            onDecide={!running && !record.approval && record.status === "needs_review" ? async (key, action, note) => {
              if (busy) return;
              setBusy(true);
              try {
                const updated = await payrollApi.decide(record.id, { ...command(), findingIds: [key], action, note });
                cache.setQueryData(payrollKeys.review(record.id), updated);
                await refresh();
              } finally { setBusy(false); }
            } : undefined}
          />
          <PayrollQuestions review={record} />
        </div>
      ) : null}
    </>
  );
}

function isRunning(review: Review | undefined) {
  return review?.run?.progress.status === "queued" || review?.run?.progress.status === "running";
}

function PayrollAuditDetails({ record, busy, onDecide }: {
  record: Review;
  busy: boolean;
  onDecide?: (key: string, action: PayrollFindingAction, note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [issue, setIssue] = useState<{ key: string; message: string } | null>(null);
  const cursor = pages.at(-1) ?? null;
  const days = useQuery({ queryKey: [...payrollKeys.days(record.id), record.token.analysisRevision], queryFn: () => payrollApi.days(record.id) });
  const findings = useQuery({
    queryKey: payrollKeys.findings(record.id, record.token.analysisRevision, status, cursor),
    queryFn: () => payrollApi.findings(record.id, status, cursor),
  });
  return (
    <>
      {days.isPending ? <p role="status">Loading daily evidence…</p> : days.error
        ? <Notice tone="err">{days.error.message} <button type="button" onClick={() => void days.refetch()}>Retry</button></Notice>
        : <PayrollAuditDays days={days.data?.items ?? []} timezone={record.period.timezone} />}
      <section className="payroll-panel payroll-audit-evidence" aria-label="Audit findings">
        <h2>Audit findings</h2>
        <div className="payroll-controls">
          <label>Finding status <select value={status} disabled={busy} onChange={(event) => {
            setStatus(event.target.value); setPages([null]); setIssue(null);
          }}>
            <option value="">All findings</option>
            <option value="needs_review">Needs review</option>
            <option value="needs_correction">Needs correction</option>
          </select></label>
        </div>
        {findings.isPending ? <p role="status">Loading findings…</p> : findings.error
          ? <Notice tone="err">{findings.error.message} <button type="button" onClick={() => void findings.refetch()}>Retry</button></Notice>
          : findings.data?.items.length ? <ol className="payroll-finding-list">
            {findings.data.items.map((finding) => <PayrollAuditFinding key={finding.id} finding={finding} timezone={record.period.timezone} busy={busy}
              onError={issue?.key === finding.key ? issue.message : undefined}
              onDecide={onDecide && ((key, action, note) => {
                setIssue(null);
                void onDecide(key, action, note).catch((error: Error) => setIssue({ key, message: error.message }));
              })} />)}
          </ol> : <p className="payroll-empty">{status ? "No findings match this status on this page." : "No findings on this page."}</p>}
        <div className="payroll-actions">
          {pages.length > 1 ? <button type="button" disabled={busy} onClick={() => setPages(pages.slice(0, -1))}>Previous findings</button> : null}
          {findings.data?.nextCursor ? <button type="button" disabled={busy} onClick={() => setPages([...pages, findings.data!.nextCursor])}>Next findings</button> : null}
          {findings.data ? <span role="status">Page {pages.length} · {findings.data.total} matching findings</span> : null}
        </div>
      </section>
    </>
  );
}
