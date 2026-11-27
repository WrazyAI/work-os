"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollPayDateForThrough } from "@wrazy/work-os-shared/payroll/window";
import { Notice, Skeleton } from "../ui";
import { payrollApi, payrollKeys } from "./api";
import { PayrollReviewView } from "./PayrollReviewView";
import { payrollReviewHref, payrollWorkspaceHref } from "./paths";
import type { PayrollReview as Review } from "@/modules/work-os/payroll/contracts";

export default function PayrollReview({ personId, payDate, reviewId, displayName, initialFrom, initialThrough }: {
  personId: string; payDate: string; reviewId: string | null; displayName: string;
  initialFrom?: string; initialThrough?: string;
}) {
  const router = useRouter();
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
  const record = review.data;
  const running = isRunning(record);
  const runId = record?.run?.id;
  const refetchReview = review.refetch;
  const revision = record?.token.analysisRevision ?? 0;
  const days = useQuery({
    queryKey: [...payrollKeys.days(record?.id ?? "none"), revision],
    queryFn: () => payrollApi.days(record!.id),
    enabled: Boolean(record) && revision > 0,
  });
  const findings = useQuery({
    queryKey: payrollKeys.findings(record?.id ?? "none", revision, "", null),
    queryFn: ({ signal }) => payrollApi.findingsAll(record!.id, revision, signal),
    enabled: Boolean(record) && revision > 0,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["work-os", "admin", "payroll"] });
  useEffect(() => {
    if (!runId || !running) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await payrollApi.advance(runId);
        await refetchReview();
      } catch {
        // The cron or another tab may own the lease; the next poll retries.
      } finally { inFlight = false; }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [runId, running, refetchReview]);
  async function launch(from?: string, through?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      startKey.current ??= crypto.randomUUID();
      const periodPayDate = from && through ? payrollPayDateForThrough(through) : record?.period.payDate ?? payDate;
      const run = await payrollApi.start(personId, periodPayDate, startKey.current, from, through);
      startKey.current = null;
      if (record) {
        cache.setQueryData(payrollKeys.review(run.reviewId), { ...record, run });
        await refresh();
      } else {
        router.replace(payrollReviewHref(personId, periodPayDate, run.reviewId));
      }
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  const save = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  const command = () => ({ ...record!.token, requestKey: crypto.randomUUID() });
  const back = <nav className="payroll-actions payroll-review-nav" aria-label="Back to payroll">
    <Link href={payrollWorkspaceHref("audits", payDate)}>All audits</Link>
    <Link href={payrollWorkspaceHref("records", payDate)}>Payroll records</Link>
  </nav>;
  if (reviewId && review.isPending) return <>{back}<Skeleton className="m-6 h-64" /></>;
  if (reviewId && review.error) return <>{back}<Notice tone="err">{review.error.message} <button type="button" onClick={() => void review.refetch()}>Retry</button></Notice></>;
  if (!record) return <section className="payroll-shell">
    {back}
    <h2>{displayName}</h2>
    {initialFrom && initialThrough ? <>
      <p>No audit exists for {initialFrom} — {initialThrough}.</p>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <div className="payroll-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void launch(initialFrom, initialThrough)}>{busy ? "Starting…" : "Run audit for this window"}</button>
        <Link href={payrollWorkspaceHref("audits", payDate, true)}>New audit</Link>
      </div>
    </> : <>
      <p>No audit exists for this pay date.</p>
      <Link href={payrollWorkspaceHref("audits", payDate, true)}>New audit</Link>
    </>}
  </section>;

  return (
    <>
      {back}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <PayrollReviewView
        review={record} displayName={displayName} busy={busy}
        days={days.data?.items ?? []} findings={findings.data?.items ?? []}
        daysLoading={days.isPending} findingsLoading={findings.isPending}
        daysError={days.error?.message} findingsError={findings.error?.message}
        onRetryEvidence={() => void refresh()}
        onAdvance={() => void launch(record.period.from, record.period.through)}
        onApprove={() => {
          if (window.confirm(`Approve ${record.totals.recommended} minutes? This creates an immutable payroll record.`)) {
            void save(() => payrollApi.approve(record.id, { ...command(), note: "Payroll approved" }));
          }
        }}
        onReopen={() => {
          const reason = window.prompt("Reason for reopening this payroll approval?")?.trim();
          if (reason) void save(() => payrollApi.reopen(record.id, { ...command(), reason }));
        }}
        onCancel={() => {
          if (!record.run) return;
          if (window.confirm("Cancel this analysis? The last published revision stays reviewable.")) {
            void save(() => payrollApi.cancel(record.run!.id, record.token.rowVersion));
          }
        }}
        onDecide={findings.isSuccess && !findings.isPlaceholderData && !running && !record.approval
          && !record.evidenceChangedSinceApproval && record.status !== "approved" && record.status !== "stale" ? async (key, action, note, token) => {
          if (busy) return;
          setBusy(true);
          try {
            const updated = await payrollApi.decide(record.id, { ...token, requestKey: crypto.randomUUID(), findingIds: [key], action, note });
            cache.setQueryData(payrollKeys.review(record.id), updated);
            await refresh();
          } finally { setBusy(false); }
        } : undefined}
      />
      {record.approval ? <div className="payroll-actions payroll-review-nav">
        <Link href={`/work-os/admin/payroll/approvals/${encodeURIComponent(record.approval.id)}/print`}>Print approved record</Link>
      </div> : null}
    </>
  );
}

function isRunning(review: Review | undefined) {
  return review?.run?.progress.status === "queued" || review?.run?.progress.status === "running";
}
