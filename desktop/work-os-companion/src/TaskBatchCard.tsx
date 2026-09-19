import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Pencil, RotateCcw } from "lucide-react";
import {
  batchEntryOutcome,
  batchItemCount,
  isBatchToolOp,
  isDestructiveBatchOp,
  isPlanImportOp,
  operationToolCall,
  summarizeBatchResults,
  toolCallKey,
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
 * first click.
 *
 * Once decided, the card settles: it collapses into an accordion that reports
 * what happened, its actions disappear, and it can never be approved twice. */

/** The card's lifecycle. `pending` is deliberately not settled: an in-flight
 * result must not collapse into a receipt or become re-approvable. */
type CardState = "review" | "filing" | "approved" | "skipped" | "pending" | "failed";

function cardStateFor(result: ToolCallResult | undefined, busy: boolean): CardState {
  if (!result) return busy ? "filing" : "review";
  if (result.status === "failed") return "failed";
  if (result.status === "denied") return "skipped";
  if (result.status === "processing" || result.status === "queued") return "pending";
  return "approved";
}

function isSettled(state: CardState): boolean {
  return state === "approved" || state === "skipped";
}

type EntryPill = { key: string; label: string; tone: "new" | "edit" | "status" | "state" | "tool"; separator?: boolean };

/** The tool's own verb, for the operations that are not an add or an edit. */
function toolPill(operation: ProposedOperation): EntryPill | null {
  switch (operation.op) {
    case "multi_task_archive": return { key: "tool", label: "Archive", tone: "tool" };
    case "multi_task_delete": return { key: "tool", label: "Delete", tone: "tool" };
    case "multi_task_log": return { key: "tool", label: "Log", tone: "tool" };
    case "multi_task_reassign": return { key: "tool", label: "Reassign", tone: "tool" };
    default: return null;
  }
}

/** What this entry does, computed from the current draft so a cleared field
 * stops claiming a change the employee took back. */
function taskPills(operation: ProposedOperation, task: ProposedBatchTask): EntryPill[] {
  const pills: EntryPill[] = [];
  const tool = toolPill(operation);
  if (tool) pills.push(tool);
  if (operation.op === "multi_task_add" && !task.taskId) pills.push({ key: "new", label: "NEW", tone: "new" });
  if (operation.op === "multi_task_edit") {
    if (task.title !== undefined || task.description !== undefined) pills.push({ key: "edit", label: "EDIT", tone: "edit" });
    if (task.taskGroupId !== undefined) {
      if (task.fromStatus && task.toStatus) {
        pills.push({ key: "status-from", label: task.fromStatus, tone: "status" });
        pills.push({ key: "status-arrow", label: "→", tone: "status", separator: true });
        pills.push({ key: "status-to", label: task.toStatus, tone: "status" });
      } else {
        pills.push({ key: "status", label: "STATUS", tone: "status" });
      }
    }
    if (task.completed !== undefined) pills.push({ key: "completion", label: task.completed ? "Done" : "Reopen", tone: "state" });
  }
  return pills;
}

function batchResults(result: ToolCallResult | undefined): BatchReviewResult[] | undefined {
  const data = result?.data as { batch?: { results?: BatchReviewResult[] } } | undefined;
  return data?.batch?.results;
}

function batchReceipt(result: ToolCallResult | undefined): string | null {
  if (!result) return null;
  const summary = summarizeBatchResults(batchResults(result));
  if (!summary.total) return result.message;
  const parts: string[] = [];
  if (summary.applied) parts.push(`${summary.applied} filed`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.failed) parts.push(`${summary.failed} needs attention`);
  if (summary.pending) parts.push(`${summary.pending} processing`);
  return parts.join(" · ") || result.message;
}

function batchSummary(operation: ProposedOperation, tasks: ProposedBatchTask[]): string {
  const count = tasks.length;
  const plural = (word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (operation.op === "multi_task_edit") return `Update ${plural("task")}`;
  if (operation.op === "multi_task_archive") return `Archive ${plural("task")}`;
  if (operation.op === "multi_task_delete") return `Delete ${plural("task")}`;
  if (operation.op === "multi_task_log") return `Log progress on ${plural("task")}`;
  if (operation.op === "multi_task_reassign") return `Reassign ${plural("task")}`;
  if (operation.op === "plan_import") return `Import ${operation.planImport?.clientName ? `${operation.planImport.clientName}’s plan` : "a plan template"}`;
  const newTasks = tasks.filter((task) => !task.taskId).length;
  const steps = tasks.reduce((total, task) => total + task.subtasks.length, 0);
  const parts: string[] = [];
  if (newTasks) parts.push(`${newTasks} task${newTasks === 1 ? "" : "s"}`);
  if (steps) parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
  return parts.length ? `Add ${parts.join(" with ")}` : "Add tasks";
}

function headingFor(operation: ProposedOperation): string {
  if (operation.op === "multi_task_delete") return "Review deletion";
  if (operation.op === "multi_task_archive") return "Review archiving";
  if (operation.op === "multi_task_log") return "Review progress notes";
  if (operation.op === "multi_task_reassign") return "Review reassignment";
  if (operation.op === "plan_import") return "Review plan import";
  return operation.op === "multi_task_edit" ? "Review changes" : "Review new tasks";
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
  const state = cardStateFor(result, busy);
  const settled = isSettled(state);
  const resultTasks = result?.op.tasks;
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  // A card that already has an outcome opens collapsed; if the outcome arrives
  // later the effect below collapses it then. The toggle stays available so the
  // results can still be read.
  const [expanded, setExpanded] = useState(() => !settled && !collapseWhenInactive);
  const [draft, setDraft] = useState<ProposedBatchTask[]>(resultTasks ?? operation.tasks ?? []);
  const results = batchResults(result);
  const contentId = useId();
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
    // Preserve the exact edited snapshot carried by the result for a later
    // accordion expansion; the parent operation may still be the original.
    setDraft(resultTasks ?? operation.tasks ?? []);
    setEditing(false);
    setArmed(false);
  }, [operation, resultTasks]);

  // Settle the card the moment its outcome lands: collapse it and drop every
  // editing affordance, so an approved or skipped batch can never look actionable.
  useEffect(() => {
    if (isSettled(cardStateFor(result, busy))) {
      setExpanded(false);
      setEditing(false);
      setArmed(false);
    }
  }, [result, busy]);

  const updateTask = (clientId: string, patch: Partial<ProposedBatchTask>) => {
    setDraft((current) => current.map((task) => task.clientId === clientId ? { ...task, ...patch } : task));
  };
  const updateSubtask = (taskClientId: string, subtaskClientId: string, patch: Partial<ProposedBatchSubtask>) => {
    setDraft((current) => current.map((task) => task.clientId === taskClientId
      ? { ...task, subtasks: task.subtasks.map((subtask) => subtask.clientId === subtaskClientId ? { ...subtask, ...patch } : subtask) }
      : task));
  };

  const title = batchSummary(operation, draft);
  const destructive = isDestructiveBatchOp(operation);
  const planImport = isPlanImportOp(operation);
  const showToggle = settled || collapseWhenInactive;

  return <section className={`task-batch-card${editing ? " is-editing" : ""}${state === "approved" ? " is-filed is-settled" : ""}${state === "skipped" ? " is-skipped is-settled" : ""}${destructive ? " is-destructive" : ""}`} aria-label={title} data-workos-tool-surface="batch" data-workos-tool-state={state} data-workos-batch-card={operation.batchId ?? operation.op} data-workos-batch-state={state}>
    <header className="task-batch-head">
      <div>
        <small>{headingFor(operation)}</small>
        <strong>{title}</strong>
      </div>
      <div className="task-batch-head-actions">
        {state === "approved" && <span className="task-batch-outcome ok" role="status">Filed</span>}
        {state === "skipped" && <span className="task-batch-outcome skipped" role="status">Skipped</span>}
        {state === "pending" && <span className="task-batch-outcome pending" role="status">Filing</span>}
        {state === "failed" && <span className="task-batch-outcome failed" role="status">Needs attention</span>}
        {settled && <span className="task-batch-receipt" role="status">{batchReceipt(result)}</span>}
        {showToggle && <button
          type="button"
          className="planning-icon-button"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? "Hide the changes" : "Show the changes"}
          title={expanded ? "Hide the changes" : "Show the changes"}
          onClick={() => setExpanded((current) => !current)}
        ><ChevronDown size={15} className={expanded ? "" : "task-batch-collapsed-mark"} /></button>}
        {state === "review" && expanded && <button
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
    <div id={contentId} role="region" aria-label={`${title} details`} hidden={!expanded}>
    {expanded && <p className="task-batch-hint">
      {state === "failed" ? result?.message ?? "Some items could not be filed. Nothing else was changed."
        : state === "skipped" ? result?.message ?? "Skipped. Nothing from this batch was filed."
          : state === "approved" ? result?.message ?? "Approved. Each item reports its own result below."
            : state === "pending" ? "Still being filed. This card settles on its own."
              : planImport ? "Importing creates the template's tasks in your workspace. Nothing is created until you confirm."
                : operation.op === "multi_task_delete" ? "Deleting removes these tasks permanently. Nothing is deleted until you confirm."
                  : operation.op === "multi_task_archive" ? "Archiving hides these tasks from your lists. Nothing changes until you confirm."
                    : editing ? "Edit any wording or status, then approve the whole card."
                      : "Check the tasks and steps, then approve them together."}
    </p>}
    {expanded && planImport && <div className="task-batch-import">
      <p><strong>{operation.planImport?.clientName ? `${operation.planImport.clientName}` : "No client name"}</strong></p>
      <p>{operation.planImport?.startDate ? `Starting ${operation.planImport.startDate}` : "Starting today"}</p>
      <p className="task-batch-import-note">The template's tasks and steps are created together and appear in your workspace once approved.</p>
    </div>}
    {expanded && !planImport && <ol className="task-batch-list">
      {draft.map((task, index) => {
        const outcome = batchEntryOutcome(results, task.clientId);
        const pills = taskPills(operation, task);
        return <li key={task.clientId}>
          <article>
            <b aria-hidden="true"><span className="planning-review-index">{String(index + 1).padStart(2, "0")}</span></b>
            <div>
              <div className="task-batch-entry-head">
                {editing
                  ? <input className="task-batch-title" value={task.title ?? task.displayTitle ?? ""} maxLength={240} aria-label={`Task ${index + 1} title`} onChange={(event) => updateTask(task.clientId, { title: event.target.value, displayTitle: undefined })} />
                  : <h3>{task.title ?? task.displayTitle ?? task.description ?? "Task"}</h3>}
                {pills.map((pill) => pill.separator
                  ? <span key={pill.key} className="task-batch-status-arrow" aria-hidden="true">{pill.label}</span>
                  : <span key={pill.key} className={`task-batch-pill ${pill.tone}`}>{pill.label}</span>)}
                {!pills.length && task.taskId && <span className="task-batch-chip">Existing task</span>}
                {outcome && <span className={`task-batch-outcome ${outcome.tone}`} role="status">{outcome.label}</span>}
              </div>
              {(editing || task.description) && (editing
                ? <textarea className="task-batch-description" value={task.description ?? ""} maxLength={2000} aria-label={operation.op === "multi_task_log" ? `Task ${index + 1} progress note` : `Task ${index + 1} description`} placeholder={operation.op === "multi_task_log" ? "What was done on this task" : "Add a description"} onChange={(event) => updateTask(task.clientId, { description: event.target.value })} />
                : <p>{task.description}</p>)}
              {task.completed !== undefined && <p className="task-batch-state"><Check size={13} aria-hidden="true" /> {task.completed ? "Mark this task done" : "Reopen this task"}</p>}
              {task.assigneePersonId && <p className="task-batch-state">{operation.op === "multi_task_reassign" ? "Assign to the named person" : "Change the assignee"}</p>}
              {destructive && state === "review" && <p className="task-batch-state">{operation.op === "multi_task_delete" ? "Delete permanently" : "Archive"}</p>}
              {proposedStatus.has(task.clientId) && (editing
                ? <label className="task-batch-status"><span>Status</span><select value={task.clearTaskGroupId ? "" : task.taskGroupId ?? ""} aria-label={`Task ${index + 1} status`} onChange={(event) => updateTask(task.clientId, event.target.value ? { taskGroupId: event.target.value, clearTaskGroupId: false } : { taskGroupId: undefined, clearTaskGroupId: true })}><option value={proposedStatus.get(task.clientId)}>Move to the proposed status</option><option value="">Leave the status unchanged</option></select></label>
                : <p className="task-batch-state">{task.taskGroupId ? "Move to the proposed status" : "Status unchanged"}</p>)}
              {outcome?.message && <p className="task-batch-entry-message">{outcome.message}</p>}
              {task.subtasks.length > 0 && <ol className="task-batch-steps">
                {task.subtasks.map((subtask, subtaskIndex) => {
                  const subtaskOutcome = batchEntryOutcome(results, subtask.clientId);
                  return <li key={subtask.clientId}>
                    <span className="task-batch-step-mark" aria-hidden="true">›</span>
                    <div>
                      <div className="task-batch-entry-head">
                        {editing
                          ? <input className="task-batch-title" value={subtask.title} maxLength={240} aria-label={`Task ${index + 1} step ${subtaskIndex + 1} title`} onChange={(event) => updateSubtask(task.clientId, subtask.clientId, { title: event.target.value })} />
                          : <strong>{subtask.title}</strong>}
                        <span className="task-batch-pill new">NEW</span>
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
    {state === "failed" && <p className="task-batch-error" role="status"><AlertTriangle size={14} /> <span>{result?.message}</span></p>}
    {expanded && <details className="task-batch-details">
      <summary>Technical details</summary>
      <code>{call.command}</code>
    </details>}
    {expanded && state === "review" && <footer className="task-batch-foot">
      {!armed ? <>
        <button type="button" className="secondary" disabled={busy} onClick={() => onSkip(operation)}>Skip</button>
        <button type="button" className="primary" disabled={busy || (!planImport && count === 0)} onClick={() => setArmed(true)}><Check size={15} /> {planImport ? "Approve import" : count ? `Approve all ${count} change${count === 1 ? "" : "s"}` : "No changes to approve"}</button>
      </> : <>
        <button type="button" className="secondary" disabled={busy} onClick={() => setArmed(false)}><ChevronDown size={15} className="task-batch-back-mark" /> Back</button>
        <button type="button" className="primary" disabled={busy} onClick={() => onApprove({ ...operation, tasks: draft })}>{busy ? "Filing…" : planImport ? "Confirm import" : `Confirm ${count} change${count === 1 ? "" : "s"}`}</button>
      </>}
    </footer>}
    {expanded && state === "failed" && result && <footer className="task-batch-foot">
      {onRetry && result.retryable !== false && <button type="button" className="secondary" disabled={busy} onClick={() => onRetry(result)}><RotateCcw size={15} /> Retry</button>}
      <button type="button" className="secondary" disabled={busy} onClick={() => onSkip(operation)}>Skip</button>
    </footer>}
    </div>
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
  const batches = operations.filter((op) => isBatchToolOp(op) || isPlanImportOp(op));
  if (!batches.length) return null;
  return <>{batches.map((op, index) => {
    // Match by the stable batch key, never by object identity: the hosts file a
    // copy of the operation and re-map the turn's operations afterwards, which
    // used to make an already-approved card look actionable again.
    const result = results.find((item) => toolCallKey(item.op) === toolCallKey(op));
    return <TaskBatchCard
      key={op.batchId ?? `${op.op}-${index}`}
      /* plan imports share the batch review path and its two-step approval */
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
