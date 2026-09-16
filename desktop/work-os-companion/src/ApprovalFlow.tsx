import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Loader, SkipForward } from "lucide-react";
import {
  isMutatingToolOp,
  operationLabel,
  operationToolCall,
  type ApprovedOpContext,
  type ProposedOperation,
  type ToolCallResult,
} from "./interpretation";

export type ApprovalDecision = "undecided" | "approve" | "skip";

function operationKey(op: ProposedOperation, index: number): string {
  return op.proposalId ?? `${op.op}:${op.taskId ?? ""}:${index}`;
}

/** The settled batch once every pending action has a decision. Null while any
 * action is still undecided — nothing is filed before the last decision. */
export function settleDecisions(
  pending: readonly { op: ProposedOperation; index: number }[],
  decisions: Record<string, ApprovalDecision>,
): { approved: ProposedOperation[]; rejected: ProposedOperation[] } | null {
  const approved: ProposedOperation[] = [];
  const rejected: ProposedOperation[] = [];
  for (const { op, index } of pending) {
    const decision = decisions[operationKey(op, index)] ?? "undecided";
    if (decision === "undecided") return null;
    if (decision === "approve") approved.push(op);
    else rejected.push(op);
  }
  return { approved, rejected };
}

function questionFor(op: ProposedOperation): string {
  const target = op.taskTitle || op.statement;
  if (op.op === "complete_task") return `Mark “${target}” done?`;
  if (op.op === "reopen_task") return `Reopen “${target}”?`;
  if (op.op === "create_task" || op.op === "add_task") return `Add “${target}” to today?`;
  if (op.op === "record_blocker") return "Record this blocker?";
  if (op.op === "record_progress") return "Record this progress update?";
  if (op.op === "archive_task") return `Archive “${target}”?`;
  if (op.op === "delete_task" || op.op === "delete_subtask") return `Permanently delete “${target}”?`;
  return `${operationLabel(op.op)} ${target}?`;
}

function statusLabel(result: ToolCallResult): string {
  if (result.status === "recorded") return "Recorded";
  if (result.status === "queued") return "Queued";
  if (result.status === "denied") return "Skipped";
  if (result.status === "processing") return "Processing";
  return "Failed";
}

export function ApprovalResults({ results, onRetry }: { results: readonly ToolCallResult[]; onRetry?: (result: ToolCallResult) => void }) {
  if (!results.length) return null;
  return (
    <section className="approval-results" aria-label="Action results">
      <header><strong>Action results</strong><span>{results.length}</span></header>
      <div>
        {results.map((result, index) => (
          <article key={operationKey(result.op, index)} className={`is-${result.status}`}>
            <span aria-hidden="true">{result.status === "failed" ? <CircleAlert size={14} /> : result.status === "processing" ? <Loader size={14} /> : <Check size={14} />}</span>
            <div><strong>{operationLabel(result.op.op)} {result.op.taskTitle ?? "update"}</strong><p>{result.message}</p></div>
            <em>{statusLabel(result)}</em>
            {result.retryable && result.op.proposalId && onRetry ? <button type="button" className="approval-retry" onClick={() => onRetry(result)}>Retry</button> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

/** One decision at a time. Nothing is filed until every action is decided;
 * the last decision files the whole batch in a single review — there is no
 * second confirmation step. */
export function ApprovalFlow({
  operations,
  results = [],
  context,
  busy = false,
  onSubmit,
  onRetry,
}: {
  operations: readonly ProposedOperation[];
  results?: readonly ToolCallResult[];
  context: ApprovedOpContext;
  busy?: boolean;
  onSubmit: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
  onRetry?: (result: ToolCallResult) => void;
}) {
  const pending = useMemo(() => operations.map((op, index) => ({ op, index })).filter(({ op }) =>
    isMutatingToolOp(op) && !op.failure && !results.some((result) => result.op === op || (op.proposalId && result.op.proposalId === op.proposalId))), [operations, results]);
  const signature = pending.map(({ op, index }) => operationKey(op, index)).join("|");
  const [step, setStep] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setStep(0);
    setDecisions({});
    setSubmitted(false);
  }, [signature]);

  if (!pending.length) return <ApprovalResults results={results.filter((result) => isMutatingToolOp(result.op))} onRetry={onRetry} />;

  const decide = (decision: ApprovalDecision) => {
    if (submitted) return;
    const current = pending[step];
    if (!current) return;
    const next = { ...decisions, [operationKey(current.op, current.index)]: decision };
    setDecisions(next);
    const settled = settleDecisions(pending, next);
    if (settled) {
      setSubmitted(true);
      onSubmit(settled.approved.map((op) => ({ ...op, enabled: true })), settled.rejected.map((op) => ({ ...op, enabled: false })));
      return;
    }
    if (step < pending.length - 1) setStep((value) => value + 1);
  };

  const current = pending[step]!;
  const decision = decisions[operationKey(current.op, current.index)] ?? "undecided";
  const destructive = current.op.op === "delete_task" || current.op.op === "delete_subtask";
  const call = operationToolCall(current.op, context);
  const unresolvedTask = (current.op.op === "complete_task" || current.op.op === "reopen_task") && !current.op.taskId;

  return (
    <section className={`approval-flow${destructive ? " is-destructive" : ""}`} aria-label={`Action ${step + 1} of ${pending.length}`}>
      <header>
        <div><small>Review action</small><strong>{questionFor(current.op)}</strong></div>
        <span>{step + 1} / {pending.length}</span>
      </header>
      <div className="approval-flow-body">
        <p className="approval-statement">{current.op.statement}</p>
        {unresolvedTask ? <p className="approval-unresolved" role="status"><CircleAlert size={13} aria-hidden="true" /> This action has no task attached. Skip it, or ask again to rebuild the list.</p> : null}
        <details><summary><ChevronDown size={13} />Technical details</summary><code>{call.command}</code></details>
      </div>
      <footer>
        <div className="approval-step-nav">
          <button type="button" aria-label="Previous action" disabled={step === 0} onClick={() => setStep((value) => value - 1)}><ChevronLeft size={14} /></button>
          <button type="button" aria-label="Next action" disabled={step === pending.length - 1} onClick={() => setStep((value) => value + 1)}><ChevronRight size={14} /></button>
        </div>
        <div className="approval-actions">
          <button type="button" className={decision === "skip" ? "is-selected" : ""} disabled={busy} onClick={() => decide("skip")}><SkipForward size={14} />Skip</button>
          <button type="button" className={decision === "approve" ? "approval-approve is-selected" : "approval-approve"} disabled={busy || !current.op.statement.trim()} onClick={() => decide("approve")}><Check size={14} />Approve</button>
        </div>
      </footer>
    </section>
  );
}
