import type { ReactNode } from "react";
import { Check, CircleAlert, Terminal, X } from "lucide-react";
import { operationLabel, operationToolCall, proposalApprovalCommand, type ApprovedOpContext, type ProposedOperation, type ToolCallResult } from "./interpretation";
import "./tool-approval-card.css";

export function ToolApprovalCard({ op, context, result, onToggle, onDeny, children }: {
  op: ProposedOperation;
  context: ApprovedOpContext;
  result?: ToolCallResult;
  onToggle?: () => void;
  onDeny?: () => void;
  children?: ReactNode;
}) {
  const call = operationToolCall(op, context);
  const approvalCommand = proposalApprovalCommand(op);
  const completed = !!result;
  return (
    <section className={`tool-approval-card ${result ? `is-${result.status}` : ""}`} aria-label={`${call.tool} approval`}>
      <header>
        <span className="tool-approval-icon" aria-hidden="true"><Terminal size={14} /></span>
        <div><small>Assistant tool call</small><strong>{call.tool}</strong></div>
        {result ? <span className="tool-approval-state">{result.status === "recorded" ? <Check size={13} /> : result.status === "failed" ? <CircleAlert size={13} /> : <Terminal size={13} />}{result.status === "recorded" ? "Recorded" : result.status === "queued" ? "Queued" : result.status === "denied" ? "Denied" : "Failed"}</span> : <span className="tool-approval-actions"><label className="tool-approval-choice"><input type="checkbox" checked={op.enabled} onChange={onToggle} />Approve</label><button type="button" onClick={onDeny}>Deny</button></span>}
      </header>
       <p>{operationLabel(op.op)} {op.taskTitle ?? "this update"}</p>
       <code>{call.command}</code>
       {approvalCommand ? <><small className="tool-approval-transport">Approval transport</small><code>{approvalCommand}</code></> : null}
      {children}
      <footer>{result ? result.message : op.enabled ? "Waiting for your approval. This command will not run until you select Approve & record." : <><X size={13} /> Denied. This command will not run.</>}</footer>
    </section>
  );
}
