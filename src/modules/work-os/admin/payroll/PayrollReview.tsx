"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice, Skeleton } from "../ui";
import { payrollApi, payrollKeys } from "./api";
import { PayrollReviewView } from "./PayrollReviewView";
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
  const record = review.data;
  const revision = record?.token.analysisRevision ?? 0;
  const days = useQuery({
    queryKey: [...payrollKeys.days(record?.id ?? "none"), revision],
    queryFn: () => payrollApi.days(record!.id),
    enabled: Boolean(record) && revision > 0,
  });
  const findings = useQuery({
    queryKey: payrollKeys.findings(record?.id ?? "none", revision, "", null),
    queryFn: () => payrollApi.findingsAll(record!.id),
    enabled: Boolean(record) && revision > 0,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["work-os", "admin", "payroll"] });
  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      startKey.current ??= crypto.randomUUID();
      const run = await payrollApi.start(personId, payDate, startKey.current);
      if (record) cache.setQueryData(payrollKeys.review(run.reviewId), { ...record, run });
      startKey.current = null;
      await refresh();
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
    <p>No audit exists for this pay date.</p>
    <Link href={payrollWorkspaceHref("audits", payDate, true)}>New audit</Link>
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
        onRetryEvidence={() => void Promise.all([days.refetch(), findings.refetch()])}
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
        onDecide={!isRunning(record) && !record.approval && record.status === "needs_review" ? async (key, action, note) => {
          if (busy) return;
          setBusy(true);
          try {
            const updated = await payrollApi.decide(record.id, { ...command(), findingIds: [key], action, note });
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
