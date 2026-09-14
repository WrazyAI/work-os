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

export function ApprovalResults({ results }: { results: readonly ToolCallResult[] }) {
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
          </article>
        ))}
      </div>
    </section>
  );
}

/** One decision at a time. No provider write happens until the final review. */
export function ApprovalFlow({
  operations,
  results = [],
  taskOptions = [],
  context,
  busy = false,
  onEdit,
  onRemap,
  onSubmit,
}: {
  operations: readonly ProposedOperation[];
  results?: readonly ToolCallResult[];
  taskOptions?: readonly { id: string; title: string }[];
  context: ApprovedOpContext;
  busy?: boolean;
  onEdit?: (index: number, statement: string) => void;
  onRemap?: (index: number, taskId: string) => void;
  onSubmit: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
}) {
  const pending = useMemo(() => operations.map((op, index) => ({ op, index })).filter(({ op }) =>
    isMutatingToolOp(op) && !results.some((result) => result.op === op || (op.proposalId && result.op.proposalId === op.proposalId))), [operations, results]);
  const signature = pending.map(({ op, index }) => operationKey(op, index)).join("|");
  const [step, setStep] = useState(0);
  const [summary, setSummary] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});

  useEffect(() => {
    setStep(0);
    setSummary(false);
    setDecisions({});
  }, [signature]);

  if (!pending.length) return <ApprovalResults results={results.filter((result) => isMutatingToolOp(result.op))} />;

  const decide = (decision: ApprovalDecision) => {
    const current = pending[step];
    if (!current) return;
    setDecisions((value) => ({ ...value, [operationKey(current.op, current.index)]: decision }));
    if (step >= pending.length - 1) setSummary(true);
    else setStep((value) => value + 1);
  };

  const approved = pending.filter(({ op, index }) => decisions[operationKey(op, index)] === "approve").map(({ op }) => op);
  const rejected = pending.filter(({ op, index }) => decisions[operationKey(op, index)] === "skip").map(({ op }) => op);
  const undecided = pending.length - approved.length - rejected.length;

  if (summary) {
    return (
      <section className="approval-flow approval-summary" aria-label="Review action decisions">
        <header><div><small>Final review</small><strong>Confirm what Work OS should record</strong></div><span>{approved.length} approved</span></header>
        <div className="approval-summary-list">
          {pending.map(({ op, index }) => {
            const decision = decisions[operationKey(op, index)] ?? "undecided";
            return <button key={operationKey(op, index)} type="button" onClick={() => { setStep(index); setSummary(false); }}><span className={`approval-decision-dot is-${decision}`} /> <strong>{operationLabel(op.op)} {op.taskTitle ?? op.statement}</strong><em>{decision === "approve" ? "Approve" : decision === "skip" ? "Skip" : "Review"}</em></button>;
          })}
        </div>
        <footer>
          <button type="button" className="approval-back" onClick={() => { setStep(Math.max(0, pending.length - 1)); setSummary(false); }}><ChevronLeft size={14} />Back</button>
          <button type="button" className="approval-submit" disabled={busy || undecided > 0} onClick={() => onSubmit(approved.map((op) => ({ ...op, enabled: true })), rejected.map((op) => ({ ...op, enabled: false })))}>
            {approved.length ? `Approve & record ${approved.length} action${approved.length === 1 ? "" : "s"}` : "Dismiss proposals"}
          </button>
        </footer>
        {undecided > 0 ? <p className="approval-hint">Review {undecided} remaining action{undecided === 1 ? "" : "s"} before continuing.</p> : null}
      </section>
    );
  }

  const current = pending[step]!;
  const decision = decisions[operationKey(current.op, current.index)] ?? "undecided";
  const destructive = current.op.op === "delete_task" || current.op.op === "delete_subtask";
  const call = operationToolCall(current.op, context);
  const canRemap = ["complete_task", "reopen_task", "record_progress"].includes(current.op.op) && taskOptions.length > 0;

  return (
    <section className={`approval-flow${destructive ? " is-destructive" : ""}`} aria-label={`Action ${step + 1} of ${pending.length}`}>
      <header>
        <div><small>Review action</small><strong>{questionFor(current.op)}</strong></div>
        <span>{step + 1} / {pending.length}</span>
      </header>
      <div className="approval-flow-body">
        <label><span>Proposed wording</span><textarea value={current.op.statement} maxLength={1000} onChange={(event) => onEdit?.(current.index, event.target.value)} /></label>
        {canRemap ? <label><span>Apply to task</span><select value={current.op.taskId ?? ""} onChange={(event) => onRemap?.(current.index, event.target.value)}><option value="">No task selected</option>{taskOptions.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label> : null}
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
