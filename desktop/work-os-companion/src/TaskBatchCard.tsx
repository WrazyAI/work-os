import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Pencil, RotateCcw } from "lucide-react";
import {
  batchItemCount,
  isBatchToolOp,
  operationToolCall,
  type ApprovedOpContext,
  type BatchReviewResult,
  type ProposedBatchSubtask,
  type ProposedBatchTask,
  type ProposedOperation,
  type ToolCallResult,
} from "./interpretation";

/** One card for a whole batch: the agent's tasks and steps, editable in place,
 * approved together in two deliberate steps. Unlike the shared approval card
 * (one action per screen), a batch is one decision over several items — so it
 * shows the shape of the whole change, labels every item, and only arms on the
 * first click. */

type EntryOutcome = { tone: "ok" | "pending" | "failed"; label: string; message: string };

function outcomeFor(results: BatchReviewResult[] | undefined, clientId: string): EntryOutcome | null {
  const mine = (results ?? []).filter((item) => item.client_id === clientId);
  if (!mine.length) return null;
  if (mine.some((item) => item.status === "failed" || item.status === "needs_review")) {
    const failed = mine.find((item) => item.status === "failed" || item.status === "needs_review")!;
    return { tone: "failed", label: "Needs attention", message: failed.message };
  }
  if (mine.some((item) => item.status === "skipped")) {
    return { tone: "failed", label: "Not filed", message: "Its task was not created, so this step was left alone." };
  }
  if (mine.some((item) => item.status === "applying" || item.status === "processing")) {
    return { tone: "pending", label: "Filing", message: "The server is still applying this item." };
  }
  if (mine.every((item) => item.status === "applied")) return { tone: "ok", label: "Filed", message: "" };
  return { tone: "pending", label: "Pending", message: "" };
}

function batchResults(result: ToolCallResult | undefined): BatchReviewResult[] | undefined {
  const data = result?.data as { batch?: { results?: BatchReviewResult[] } } | undefined;
  return data?.batch?.results;
}

function batchSummary(operation: ProposedOperation, tasks: ProposedBatchTask[]): string {
  const newTasks = tasks.filter((task) => !task.taskId).length;
  const steps = tasks.reduce((total, task) => total + task.subtasks.length, 0);
  if (operation.op === "multi_task_edit") return `Update ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (newTasks) parts.push(`${newTasks} task${newTasks === 1 ? "" : "s"}`);
  if (steps) parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
  return parts.length ? `Add ${parts.join(" with ")}` : "Add tasks";
}

export function TaskBatchCard({
  operation,
  result,
  busy = false,
  context,
  collapseWhenInactive = false,
  onApprove,
  onSkip,
  onRetry,
}: {
  operation: ProposedOperation;
  result?: ToolCallResult;
  busy?: boolean;
  context: ApprovedOpContext;
  collapseWhenInactive?: boolean;
  onApprove: (operation: ProposedOperation) => void;
  onSkip: (operation: ProposedOperation) => void;
  onRetry?: (result: ToolCallResult) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [expanded, setExpanded] = useState(!collapseWhenInactive);
  const [draft, setDraft] = useState<ProposedBatchTask[]>(operation.tasks ?? []);
  const filed = !!result && result.status !== "failed";
  const failed = result?.status === "failed";
  const results = batchResults(result);
  const count = useMemo(() => batchItemCount({ op: operation.op, tasks: draft }), [draft, operation.op]);
  // The status control must survive being cleared: it is offered whenever the
  // batch proposed a status move, so the employee can put it back. Only a real
  // proposed column counts — an entry without one must not show the control.
  const proposedStatus = useMemo(
    () => new Map((operation.tasks ?? []).filter((task) => !!task.taskGroupId).map((task) => [task.clientId, task.taskGroupId as string])),
    [operation],
  );
  const call = operationToolCall(operation, context);

  // A batch that arrives un-filed must match the operation it belongs to; a
  // re-interpretation replaces the payload, so re-seed rather than show stale
  // wording under a new statement.
  useEffect(() => {
    setDraft(operation.tasks ?? []);
    setEditing(false);
    setArmed(false);
  }, [operation]);

  const updateTask = (clientId: string, patch: Partial<ProposedBatchTask>) => {
    setDraft((current) => current.map((task) => task.clientId === clientId ? { ...task, ...patch } : task));
  };
  const updateSubtask = (taskClientId: string, subtaskClientId: string, patch: Partial<ProposedBatchSubtask>) => {
    setDraft((current) => current.map((task) => task.clientId === taskClientId
      ? { ...task, subtasks: task.subtasks.map((subtask) => subtask.clientId === subtaskClientId ? { ...subtask, ...patch } : subtask) }
      : task));
  };

  const title = batchSummary(operation, draft);

  return <section className={`task-batch-card${editing ? " is-editing" : ""}${filed ? " is-filed" : ""}`} aria-label={title}>
    <header className="task-batch-head">
      <div>
        <small>{operation.op === "multi_task_edit" ? "Review changes" : "Review new tasks"}</small>
        <strong>{title}</strong>
      </div>
      <div className="task-batch-head-actions">
        {collapseWhenInactive && <button
          type="button"
          className="planning-icon-button"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide the changes" : "Show the changes"}
          title={expanded ? "Hide the changes" : "Show the changes"}
          onClick={() => setExpanded((current) => !current)}
        ><ChevronDown size={15} className={expanded ? "" : "task-batch-collapsed-mark"} /></button>}
        {!filed && !failed && expanded && <button
          type="button"
          className={`planning-icon-button${editing ? " is-active" : ""}`}
          aria-pressed={editing}
          aria-label={editing ? "Finish editing" : "Edit these changes"}
          title={editing ? "Finish editing" : "Edit these changes"}
          disabled={busy}
          onClick={() => setEditing((current) => !current)}
        >{editing ? <Check size={15} /> : <Pencil size={15} />}</button>}
      </div>
    </header>
    {expanded && <p className="task-batch-hint">
      {failed ? "Some items could not be filed. Nothing else was changed."
        : filed ? "Approved. Each item reports its own result below."
          : editing ? "Edit any wording or status, then approve the whole card."
            : "Check the tasks and steps, then approve them together."}
    </p>}
    {expanded && <ol className="task-batch-list">
      {draft.map((task, index) => {
        const outcome = outcomeFor(results, task.clientId);
        return <li key={task.clientId}>
          <article>
            <b aria-hidden="true"><span className="planning-review-index">{String(index + 1).padStart(2, "0")}</span></b>
            <div>
              <div className="task-batch-entry-head">
                {editing
                  ? <input className="task-batch-title" value={task.title ?? ""} maxLength={240} aria-label={`Task ${index + 1} title`} onChange={(event) => updateTask(task.clientId, { title: event.target.value })} />
                  : <h3>{task.title ?? task.description ?? "Task"}</h3>}
                {task.taskId && <span className="task-batch-chip">Existing task</span>}
                {outcome && <span className={`task-batch-outcome ${outcome.tone}`} role="status">{outcome.label}</span>}
              </div>
              {(editing || task.description) && (editing
                ? <textarea className="task-batch-description" value={task.description ?? ""} maxLength={2000} aria-label={`Task ${index + 1} description`} placeholder="Add a description" onChange={(event) => updateTask(task.clientId, { description: event.target.value })} />
                : <p>{task.description}</p>)}
              {task.completed !== undefined && <p className="task-batch-state"><Check size={13} aria-hidden="true" /> {task.completed ? "Mark this task done" : "Reopen this task"}</p>}
              {proposedStatus.has(task.clientId) && (editing
                ? <label className="task-batch-status"><span>Status</span><select value={task.taskGroupId ?? ""} aria-label={`Task ${index + 1} status`} onChange={(event) => updateTask(task.clientId, { taskGroupId: event.target.value })}><option value={proposedStatus.get(task.clientId)}>Move to the proposed status</option><option value="">Leave the status unchanged</option></select></label>
                : <p className="task-batch-state">{task.taskGroupId ? "Move to the proposed status" : "Status unchanged"}</p>)}
              {outcome?.message && <p className="task-batch-entry-message">{outcome.message}</p>}
              {task.subtasks.length > 0 && <ol className="task-batch-steps">
                {task.subtasks.map((subtask, subtaskIndex) => {
                  const subtaskOutcome = outcomeFor(results, subtask.clientId);
                  return <li key={subtask.clientId}>
                    <span className="task-batch-step-mark" aria-hidden="true">›</span>
                    <div>
                      <div className="task-batch-entry-head">
                        {editing
                          ? <input className="task-batch-title" value={subtask.title} maxLength={240} aria-label={`Task ${index + 1} step ${subtaskIndex + 1} title`} onChange={(event) => updateSubtask(task.clientId, subtask.clientId, { title: event.target.value })} />
                          : <strong>{subtask.title}</strong>}
                        {subtaskOutcome && <span className={`task-batch-outcome ${subtaskOutcome.tone}`} role="status">{subtaskOutcome.label}</span>}
                      </div>
                      {(editing || subtask.description) && (editing
                        ? <textarea className="task-batch-description" value={subtask.description ?? ""} maxLength={2000} aria-label={`Task ${index + 1} step ${subtaskIndex + 1} description`} placeholder="Add a description" onChange={(event) => updateSubtask(task.clientId, subtask.clientId, { description: event.target.value })} />
                        : <p>{subtask.description}</p>)}
                      {subtaskOutcome?.message && <p className="task-batch-entry-message">{subtaskOutcome.message}</p>}
                    </div>
                  </li>;
                })}
              </ol>}
            </div>
          </article>
        </li>;
      })}
    </ol>}
    {failed && <p className="task-batch-error" role="status"><AlertTriangle size={14} /> <span>{result?.message}</span></p>}
    {expanded && <details className="task-batch-details">
      <summary>Technical details</summary>
      <code>{call.command}</code>
    </details>}
    {expanded && !filed && !failed && <footer className="task-batch-foot">
      {!armed ? <>
        <button type="button" className="secondary" disabled={busy} onClick={() => onSkip(operation)}>Skip</button>
        <button type="button" className="primary" disabled={busy} onClick={() => setArmed(true)}><Check size={15} /> Approve all {count} change{count === 1 ? "" : "s"}</button>
      </> : <>
        <button type="button" className="secondary" disabled={busy} onClick={() => setArmed(false)}><ChevronDown size={15} className="task-batch-back-mark" /> Back</button>
        <button type="button" className="primary" disabled={busy} onClick={() => onApprove({ ...operation, tasks: draft })}>{busy ? "Filing…" : `Confirm ${count} change${count === 1 ? "" : "s"}`}</button>
      </>}
    </footer>}
    {expanded && failed && result && <footer className="task-batch-foot">
      {onRetry && result.retryable !== false && <button type="button" className="secondary" disabled={busy} onClick={() => onRetry(result)}><RotateCcw size={15} /> Retry</button>}
      <button type="button" className="secondary" disabled={busy} onClick={() => onSkip(operation)}>Skip</button>
    </footer>}
  </section>;
}

/** Renders one card per batch operation and leaves every other operation to the
 * shared approval card. Both chat surfaces mount this so a batch looks and
 * behaves the same in the dock and in the floating companion. */
export function BatchApprovalCards({
  operations,
  results,
  busy = false,
  context,
  collapseWhenInactive = false,
  onApprove,
  onSkip,
  onRetry,
}: {
  operations: ProposedOperation[];
  results: ToolCallResult[];
  busy?: boolean;
  context: ApprovedOpContext;
  collapseWhenInactive?: boolean;
  onApprove: (operation: ProposedOperation) => void;
  onSkip: (operation: ProposedOperation) => void;
  onRetry?: (result: ToolCallResult) => void;
}) {
  const batches = operations.filter(isBatchToolOp);
  if (!batches.length) return null;
  return <>{batches.map((op, index) => {
    const result = results.find((item) => item.op === op);
    return <TaskBatchCard
      key={op.batchId ?? `${op.op}-${index}`}
      operation={op}
      result={result}
      busy={busy}
      context={context}
      collapseWhenInactive={collapseWhenInactive}
      onApprove={onApprove}
      onSkip={onSkip}
      onRetry={onRetry}
    />;
  })}</>;
}
