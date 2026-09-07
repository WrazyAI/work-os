import type { ReactNode } from "react";
import { Check, CircleAlert, Terminal, X } from "lucide-react";
import { operationLabel, operationToolCall, proposalApprovalCommand, type ApprovedOpContext, type ProposedOperation, type ToolCallResult } from "./interpretation";
import "./tool-approval-card.css";

export function ToolApprovalCard({ op, context, result, index, total, onToggle, onDeny, children }: {
  op: ProposedOperation;
  context: ApprovedOpContext;
  result?: ToolCallResult;
  index?: number;
  total?: number;
  onToggle?: () => void;
  onDeny?: () => void;
  children?: ReactNode;
}) {
  const call = operationToolCall(op, context);
  const approvalCommand = proposalApprovalCommand(op);
  const state = result ? result.status : op.enabled ? "pending" : "denied";
  return (
    <section className={`tool-approval-card is-${state}`} aria-label={`${call.tool} approval`}>
      <header>
        <span className="tool-approval-icon" aria-hidden="true"><Terminal size={14} /></span>
        <div><small>{result ? "Tool call result" : "Assistant tool call"}</small><strong>{call.tool}</strong></div>
        {typeof total === "number" && total > 1 && typeof index === "number" ? <span className="tool-approval-step" aria-label={`Tool ${index + 1} of ${total}`}>{index + 1} of {total}</span> : null}
        {result
          ? <span className="tool-approval-state">{result.status === "recorded" ? <Check size={13} /> : result.status === "failed" ? <CircleAlert size={13} /> : <Terminal size={13} />}{result.status === "recorded" ? "Recorded" : result.status === "queued" ? "Queued" : result.status === "denied" ? "Denied" : "Failed"}</span>
          : <span className="tool-approval-actions"><label className="tool-approval-choice"><input type="checkbox" checked={op.enabled} onChange={onToggle} />Approve</label><button type="button" onClick={onDeny}>Deny</button></span>}
      </header>
      <p className="tool-approval-action"><span>Action</span><strong>{operationLabel(op.op)} {op.taskTitle ?? "this update"}</strong></p>
      {children}
      <details className="tool-approval-command"><summary>Exact command</summary><code>{call.command}</code></details>
      {approvalCommand ? <details className="tool-approval-transport"><summary>Approval transport</summary><code>{approvalCommand}</code></details> : null}
      <footer>{result ? result.message : op.enabled ? "Waiting for your approval. This command will not run until you select Approve & record." : <><X size={13} /> Denied. This command will not run.</>}</footer>
    </section>
  );
}
