import { useState } from "react";
import { ApprovalFlow, ApprovalResults } from "../../ApprovalFlow";
import { AvatarThinking } from "../../AvatarThinking";
import { ChatMarkdown } from "../../ChatMarkdown";
import { taskSelectionFromResult } from "../../chat/selection";
import { ChatSectionBoundary } from "../../ErrorBoundary";
import { isBatchToolOp, isDisplayToolOp, isMutatingToolOp, isPlanImportOp, sameToolCall, usesGroupedCard, type ProposedOperation, type ToolCallResult } from "../../interpretation";
import { NavigateButton } from "../../NavigateButton";
import { BatchApprovalCards } from "../../TaskBatchCard";
import { TaskSelectionCard, type TaskSelectionCardTask } from "../../TaskSelectionCard";

export function AssistantOperations({ interpretation, busy, toolContext, onReviewOperations, onMarkSelectedDone, onLoadSubtasks, onNavigateView, onRetryOperation }: {
  interpretation: { operations: Array<import("../../interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] };
  busy: boolean;
  toolContext: import("../../interpretation").ApprovedOpContext;
  onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
  onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void;
  onLoadSubtasks?: (taskId: string) => Promise<readonly { id: string; title: string; completed?: boolean }[]>;
  onNavigateView?: (page: import("../../interpretation").NavigatePage) => void;
  onRetryOperation?: (result: ToolCallResult) => void;
}) {
  const mutating = interpretation.operations.filter(isMutatingToolOp);
  const actionable = mutating.filter((op) => !op.failure);
  const unfiled = mutating.filter((op) => !!op.failure);
  const allMutationResults = (interpretation.results ?? []).filter((result) => isMutatingToolOp(result.op));
  const mutationResults = allMutationResults.filter((result) => !usesGroupedCard(result.op));
  const hasResults = allMutationResults.length > 0;
  const hasPendingMutations = actionable.some((op) => !usesGroupedCard(op) && !mutationResults.some((result) => sameToolCall(result.op, op)));
  const proposedTaskIds = interpretation.operations
    .filter((op) => op.op === "complete_task" && !op.failure && !mutationResults.some((result) => sameToolCall(result.op, op)))
    .map((op) => op.taskId)
    .filter((id): id is string => !!id);
  // The assistant sometimes returns the same view twice; render one card.
  const seenDisplayCards = new Set<string>();
  return <>
    {hasResults ? null : <strong>{!actionable.length && unfiled.length ? "Updates not filed" : actionable.length ? "Review proposed actions" : "Assistant shortcuts"}</strong>}
    {interpretation.reply ? <ChatMarkdown text={interpretation.reply} /> : null}
    {hasResults ? null : <p>{!actionable.length && unfiled.length ? "Nothing was recorded. The reasons are listed below." : actionable.length ? "Choose what to record. Nothing changes until the final confirmation." : "Loaded inline below. Viewing never needs approval."}</p>}
    <ChatSectionBoundary label="assistant actions">
      <div className="interpretation-list">
        {interpretation.operations.map((op, index) => {
          const result = interpretation.results?.find((item) => sameToolCall(item.op, op));
          if (isMutatingToolOp(op)) return null;
          if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={`${op.op}-${index}`} page={op.page} statement={op.statement} onNavigate={(page) => onNavigateView?.(page)} />;
          if (!isDisplayToolOp(op)) return null;
          if (result?.status === "failed") return <p key={`${op.op}-${index}`} className="tool-display-error">{result.message}</p>;
          const selection = taskSelectionFromResult(result);
          if (!selection) return null;
          const displayKey = `${op.op}:${selection.view}:${selection.tasks.map((task) => String(task.id ?? "")).join(",")}`;
          if (seenDisplayCards.has(displayKey)) return null;
          seenDisplayCards.add(displayKey);
          const selectionTasks: TaskSelectionCardTask[] = selection.tasks.map((task) => ({
            id: String(task.id ?? ""), title: typeof task.title === "string" ? task.title : "Untitled task",
            description: typeof task.description === "string" ? task.description : null,
            dueDate: typeof task.due_date === "string" ? task.due_date : null,
            projectName: typeof task.project_name === "string" ? task.project_name : null,
            priority: typeof task.priority === "string" ? task.priority : null,
            state: task.state === "overdue" || task.state === "pending" ? task.state : selection.view === "overdue" ? "overdue" : "pending",
            subtaskTotal: Number(task.subtask_total ?? 0) || 0,
            subtaskCompleted: Number(task.subtask_completed ?? 0) || 0,
          })).filter((task) => !!task.id);
          return <TaskSelectionCard key={`${op.op}-${index}`} presentation="table" title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={selectionTasks} onMarkSelectedDone={onMarkSelectedDone ?? (() => undefined)} onLoadSubtasks={onLoadSubtasks} proposedTaskIds={proposedTaskIds} approvalLocation="below" emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />;
        })}
        {mutationResults.length ? <ApprovalResults results={mutationResults} onRetry={onRetryOperation} /> : null}
        {hasPendingMutations && mutating.some((op) => !isBatchToolOp(op) && !isPlanImportOp(op)) ? <ApprovalFlow operations={mutating.filter((op) => !isBatchToolOp(op) && !isPlanImportOp(op))} results={interpretation.results} context={toolContext} busy={busy} onSubmit={(approved, rejected) => onReviewOperations?.(approved, rejected)} onRetry={onRetryOperation} /> : null}
        <BatchApprovalCards operations={actionable.filter((op) => isBatchToolOp(op) || isPlanImportOp(op))} results={interpretation.results ?? []} busy={busy} context={toolContext} onApprove={(op) => onReviewOperations?.([op], [])} onSkip={(op) => onReviewOperations?.([], [op])} onRetry={onRetryOperation} />
        {unfiled.map((op, index) => <p key={`unfiled-${index}`} className="tool-display-error">{op.taskTitle ? `${op.taskTitle}: ` : ""}{op.failure}</p>)}
      </div>
    </ChatSectionBoundary>
  </>;
}

export /** The working card for a pending update before the real trace starts. It owns
 * its start instant so the elapsed readout never resets on a re-render. */
function WorkingNowTrace({ label }: { label: string }) {
  const [startedAt] = useState(() => Date.now());
  return <AvatarThinking stages={[{ label }]} active={0} startedAt={startedAt} activeLabel="Thinking" />;
}
