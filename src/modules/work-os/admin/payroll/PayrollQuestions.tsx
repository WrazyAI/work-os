"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../api";
import type { PayrollQuestionTurn, PayrollReview } from "@/modules/work-os/payroll/contracts";

export function PayrollQuestions({ review }: { review: PayrollReview }) {
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ["work-os", "admin", "payroll", "questions", review.id, threadId],
    queryFn: () => adminFetch<{ items: PayrollQuestionTurn[] }>(`/api/work-os/admin/payroll/reviews/${review.id}/questions?threadId=${encodeURIComponent(threadId)}`),
    enabled: Boolean(threadId),
  });
  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true); setError(null);
    try {
      const turn = await adminFetch<PayrollQuestionTurn>(`/api/work-os/admin/payroll/reviews/${review.id}/questions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId, question: question.trim(), requestKey: crypto.randomUUID(),
          approvalId: review.approval?.id ?? null, rowVersion: review.token.rowVersion,
          analysisRevision: review.token.analysisRevision, sourceHash: review.token.sourceHash,
        }),
      });
      setThreadId(turn.threadId); setQuestion("");
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="payroll-panel">
      <h3>Ask about this period</h3>
      <p className="payroll-muted">Read-only. Answers cite the frozen record and never change hours or approvals.</p>
      {error ? <p className="payroll-blocker">{error}</p> : null}
      <div className="payroll-actions">
        <input value={question} maxLength={8000} onChange={(event) => setQuestion(event.target.value)} placeholder="Why is this time held?" />
        <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? "Working…" : "Ask"}</button>
      </div>
      {history.data?.items.map((turn) => (
        <article key={turn.id}>
          <p><strong>{turn.question}</strong></p>
          {turn.blocks.map((block, index) => <p key={index}>{block.text} {block.citations.length ? <small>({block.citations.map((citation) => `${citation.type}:${citation.id}`).join(", ")})</small> : null}</p>)}
          {turn.limitations.length ? <p className="payroll-muted">{turn.limitations.join(" ")}</p> : null}
        </article>
      ))}
      <p className="payroll-muted">A question cannot approve hours, export data, or fetch raw images.</p>
    </section>
  );
}
