import type { ReactNode } from "react";
import { ApprovalFlow, ApprovalResults } from "../ApprovalFlow";
import { NavigateButton } from "../NavigateButton";
import { ChatSectionBoundary } from "../ErrorBoundary";
import type { ApprovedOpContext, ProposedOperation, ToolCallResult } from "../interpretation";
import { isBatchToolOp, isPlanImportOp, isDisplayToolOp, isMutatingToolOp } from "../interpretation";
import { BatchApprovalCards } from "../TaskBatchCard";
import { TaskSelectionCard, type TaskSelectionCardSubtask, type TaskSelectionCardTask } from "../TaskSelectionCard";
import { ChatTurn } from "./ChatTurn";
import { taskSelectionFromResult } from "./selection";
import type { CopyableTurn } from "./turnCopy";

/** One persisted conversation turn, with everything it rendered.
 *
 * The in-app dock renders history through this component so a turn keeps its
 * task cards, approval actions, and copy payload after a reload, and so the
 * live interpretation never doubles as the persisted record (which is how a
 * reply rendered twice). The floating companion renders the same shapes inline
 * from its own entries; keep the two in step (design §25.11). */

export interface HistoryTurnOperation extends ProposedOperation {
  /** Set when the proposal could not be filed; rendered as an inline reason. */
  failure?: string;
}

export interface HistoryTurnData extends CopyableTurn {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string | null;
  receipt?: string | null;
  /** Elapsed thinking trace labels, when the turn carried one. */
  trace?: { labels: string[]; elapsedMs: number; result?: string } | null;
  operations?: HistoryTurnOperation[];
  toolResults?: ToolCallResult[];
}

export function historyDisplayTasks(selection: { view?: "pending" | "overdue"; tasks?: Array<Record<string, unknown>> }): TaskSelectionCardTask[] {
  return Array.isArray(selection.tasks)
    ? selection.tasks.map((task) => ({
        id: String(task.id ?? ""),
        title: typeof task.title === "string" ? task.title : "Untitled Nifty task",
        description: typeof task.description === "string" ? task.description : null,
        dueDate: typeof task.due_date === "string" ? task.due_date : null,
        projectName: typeof task.project_name === "string" ? task.project_name : null,
        priority: typeof task.priority === "string" ? task.priority : null,
        state: task.state === "overdue" || task.state === "pending" ? (task.state as string) : selection.view === "overdue" ? "overdue" : "pending",
        subtaskTotal: Number(task.subtask_total ?? 0) || 0,
        subtaskCompleted: Number(task.subtask_completed ?? 0) || 0,
      })).filter((task) => !!task.id)
    : [];
}

export function HistoryTurnExtras({
  turn,
  busy,
  toolContext,
  onReviewOperations,
  onMarkSelectedDone,
  onLoadSubtasks,
  onNavigateView,
  onRetryOperation,
  onReviewSelection,
  collapseCards = false,
  renderTrace,
}: {
  turn: HistoryTurnData;
  busy?: boolean;
  toolContext?: ApprovedOpContext;
  onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
  onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void;
  onLoadSubtasks?: (taskId: string) => Promise<readonly TaskSelectionCardSubtask[]>;
  onNavigateView?: (page: NonNullable<ProposedOperation["page"]>) => void;
  onRetryOperation?: (result: ToolCallResult) => void;
  onReviewSelection?: () => void;
  /** Cards from turns that are not the newest collapse to their summary line. */
  collapseCards?: boolean;
  renderTrace?: () => ReactNode;
}) {
  const seenCards = new Set<string>();
  const results = turn.toolResults ?? [];
  const operations = turn.operations ?? [];
  const displayCards = results.flatMap((result, index) => {
    const selection = taskSelectionFromResult(result);
    if (!selection) return [];
    const displayKey = `${result.op.op}:${selection.view}:${(selection.tasks ?? []).map((task) => String(task.id ?? "")).join(",")}`;
    if (seenCards.has(displayKey)) return [];
    seenCards.add(displayKey);
    const tasks = historyDisplayTasks(selection);
    return [
      <TaskSelectionCard
        key={`${result.op.op}-${index}`}
        title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"}
        tasks={tasks}
        onMarkSelectedDone={onMarkSelectedDone ?? (() => undefined)}
        onLoadSubtasks={onLoadSubtasks}
        collapseWhenInactive={collapseCards}
        onReview={onReviewSelection}
        maxHeight={250}
        emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"}
        emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."}
      />,
    ];
  });
  const mutationResults = results.filter((result) => isMutatingToolOp(result.op));
  // A mutating operation is only pending until a result settles it. Without
  // this gate `ApprovalFlow` (which falls back to `ApprovalResults` when
  // nothing is pending) doubled the recorded summary line after every
  // decision. `AssistantOperations` already gates the same way.
  const hasPendingMutations = operations.some((operation) =>
    isMutatingToolOp(operation)
    && !isBatchToolOp(operation)
    && !isPlanImportOp(operation)
    && !operation.failure
    && !results.some((result) => result.op === operation || (operation.proposalId !== undefined && result.op.proposalId === operation.proposalId)),
  );
  const unfiled = operations.filter((operation) => !!operation.failure && !results.some((result) => result.op === operation));
  return (
    <ChatSectionBoundary label="chat turn actions">
      <>
        {renderTrace?.()}
        {displayCards}
        {operations.length ? (
          <div className="chat-operations">
            {operations.map((op, index) => {
              const result = results.find((item) => item.op === op || (op.proposalId !== undefined && item.op.proposalId === op.proposalId));
              if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={index} page={op.page} statement={op.statement} onNavigate={(page) => onNavigateView?.(page)} />;
              if (isDisplayToolOp(op)) return result?.status === "failed" ? <p key={index} className="tool-display-error">{result.message}</p> : null;
              return null;
            })}
            {mutationResults.length ? <ApprovalResults results={mutationResults} onRetry={onRetryOperation} /> : null}
            {hasPendingMutations ? (
              <ApprovalFlow
                operations={operations.filter((op) => isMutatingToolOp(op) && !isBatchToolOp(op) && !isPlanImportOp(op))}
                results={results}
                context={toolContext ?? { shiftDate: null, personId: null, promptKind: "optional" }}
                busy={busy ?? false}
                onSubmit={(approved, rejected) => onReviewOperations?.(approved, rejected)}
                onRetry={onRetryOperation}
              />
            ) : null}
            <BatchApprovalCards
              operations={operations.filter((op) => isMutatingToolOp(op) && (isBatchToolOp(op) || isPlanImportOp(op)) && !op.failure)}
              results={results}
              busy={busy ?? false}
              context={toolContext ?? { shiftDate: null, personId: null, promptKind: "optional" }}
              collapseWhenInactive={collapseCards}
              onApprove={(op) => onReviewOperations?.([op], [])}
              onSkip={(op) => onReviewOperations?.([], [op])}
              onRetry={onRetryOperation}
            />
            {unfiled.map((op, index) => <p key={`unfiled-${index}`} className="tool-display-error">{op.taskTitle ? `${op.taskTitle}: ` : ""}{op.failure}</p>)}
          </div>
        ) : null}
      </>
    </ChatSectionBoundary>
  );
}

export function HistoryTurn(props: {
  turn: HistoryTurnData;
  busy?: boolean;
  toolContext?: ApprovedOpContext;
  onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
  onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void;
  onLoadSubtasks?: (taskId: string) => Promise<readonly TaskSelectionCardSubtask[]>;
  onNavigateView?: (page: NonNullable<ProposedOperation["page"]>) => void;
  onRetryOperation?: (result: ToolCallResult) => void;
  onReviewSelection?: () => void;
  collapseCards?: boolean;
  renderTrace?: () => ReactNode;
}) {
  const { turn, ...extras } = props;
  const isReceipt = !turn.text.trim() && typeof turn.receipt === "string" && turn.receipt.trim().length > 0;
  return (
    <ChatTurn
      role={turn.role}
      text={isReceipt ? turn.receipt ?? undefined : turn.text}
      meta={turn.meta}
      receipt={isReceipt}
      copySource={turn}
    >
      <HistoryTurnExtras turn={turn} {...extras} />
    </ChatTurn>
  );
}
