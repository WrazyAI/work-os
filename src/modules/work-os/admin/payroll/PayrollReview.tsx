"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Notice, Skeleton } from "../ui";
import { payrollApi, payrollKeys } from "./api";
import { PayrollReviewView } from "./PayrollReviewView";

export default function PayrollReview({ personId, payDate }: { personId: string; payDate: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roster = useQuery({ queryKey: payrollKeys.roster(payDate), queryFn: () => payrollApi.roster(payDate) });
  const entry = roster.data?.items.find((item) => item.personId === personId);
  const reviewId = entry?.reviewId ?? null;
  const review = useQuery({ queryKey: payrollKeys.review(reviewId ?? "none"), queryFn: () => payrollApi.review(reviewId!), enabled: Boolean(reviewId) });
  const days = useQuery({ queryKey: payrollKeys.days(reviewId ?? "none"), queryFn: () => payrollApi.days(reviewId!), enabled: Boolean(reviewId) });
  const findings = useQuery({ queryKey: payrollKeys.findings(reviewId ?? "none"), queryFn: () => payrollApi.findings(reviewId!), enabled: Boolean(reviewId) });
  const run = review.data?.run;
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.progress.status) || document.visibilityState !== "visible") return;
    const timer = setInterval(() => { void review.refetch(); }, 2000);
    return () => clearInterval(timer);
  }, [run, review]);
  const refresh = () => void Promise.all([roster.refetch(), review.refetch(), days.refetch(), findings.refetch()]);
  const command = () => ({ rowVersion: review.data!.token.rowVersion, analysisRevision: review.data!.token.analysisRevision, sourceHash: review.data!.token.sourceHash, requestKey: crypto.randomUUID() });
  const decide = async (findingKey: string, action: "payable" | "excluded" | "acknowledged") => {
    if (!reviewId) return;
    setBusy(true); setError(null);
    try { await payrollApi.decide(reviewId, { ...command(), findingIds: [findingKey], action, note: `Admin ${action} decision` }); refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true); setError(null);
    try { await payrollApi.start(personId, payDate, crypto.randomUUID()); refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!reviewId) return;
    setBusy(true); setError(null);
    try { await payrollApi.approve(reviewId, { ...command(), note: "Payroll approved" }); refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  const reopen = async () => {
    if (!reviewId) return;
    const reason = window.prompt("Reason for reopening this payroll approval?")?.trim();
    if (!reason) return;
    setBusy(true); setError(null);
    try { await payrollApi.reopen(reviewId, { ...command(), reason }); refresh(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  if (roster.isLoading || review.isLoading) return <Skeleton className="m-6 h-64" />;
  if (!entry || !review.data) {
    return (
      <div className="payroll-shell">
        <h1>Payroll review</h1>
        <p className="payroll-empty">No analysis exists for this pay date.</p>
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <button type="button" disabled={busy} onClick={() => void start()}>Analyze payroll</button>
      </div>
    );
  }
  return (
    <>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <PayrollReviewView review={review.data} onApprove={approve} onReopen={reopen} onDecide={(key, action) => void decide(key, action)} onAdvance={() => void start()} />
      <details className="payroll-panel">
        <summary>Daily record and decision queue</summary>
        <ul>{(days.data?.items ?? []).map((day) => <li key={day.id ?? day.date}>{day.date} · recommended {day.minutes.recommended} min · held {day.minutes.held} min</li>)}</ul>
        <ul>{(findings.data?.items ?? []).map((finding) => <li key={finding.key}>{finding.kind} · {finding.status} · {finding.reason}</li>)}</ul>
      </details>
    </>
  );
}
