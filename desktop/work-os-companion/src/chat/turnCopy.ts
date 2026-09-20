/** Plain-text payload for a chat turn's copy control.
 *
 * The hidden copy button on every bubble and receipt copies the message prose
 * plus a short, truthful summary of the cards the turn rendered, so a turn that
 * is only a task list or a set of action results is still copyable. Everything
 * here is derived from the same data the cards render — nothing is invented. */

import { isDisplayToolOp, isMutatingToolOp, sameToolCall, type ProposedOperation } from "../interpretation";
import { taskSelectionFromResult } from "./selection";

export interface CopyableOperation {
  op: ProposedOperation["op"];
  taskId?: string;
  taskTitle?: string;
  statement?: string;
  proposalId?: string;
  batchId?: string;
  failure?: string;
}

export interface CopyableTurnResult {
  status: string;
  message?: string | null;
  op: CopyableOperation;
  data?: unknown;
}

export interface CopyableTurn {
  role: "user" | "assistant" | "system";
  text?: string | null;
  receipt?: string | null;
  operations?: readonly CopyableOperation[];
  toolResults?: readonly CopyableTurnResult[];
}

const STATUS_LABEL: Record<string, string> = {
  recorded: "Recorded",
  queued: "Queued",
  denied: "Skipped",
  processing: "Processing",
  failed: "Failed",
};

function taskLines(result: CopyableTurnResult): string[] {
  const selection = taskSelectionFromResult(result);
  if (!selection || !selection.tasks.length) return [];
  const view = selection.view === "overdue" ? "Overdue tasks" : "Pending tasks";
  const lines = selection.tasks.map((task) => {
    const title = typeof task.title === "string" ? task.title : "Untitled task";
    const state = typeof task.state === "string" ? task.state : view === "Overdue tasks" ? "overdue" : "pending";
    const due = typeof task.due_date === "string" && task.due_date ? `, due ${task.due_date.slice(0, 10)}` : "";
    return `- ${title} (${state}${due})`;
  });
  return [`${view}:`, ...lines];
}

function operationTitle(operation: CopyableOperation): string {
  return operation.taskTitle ?? operation.statement ?? "update";
}

function actionLine(title: string, status: string, detail = ""): string {
  return `- ${title} — ${status}${detail}`;
}

function actionLines(result: CopyableTurnResult): string[] {
  const status = STATUS_LABEL[result.status] ?? result.status;
  const detail = result.status === "failed" && result.message ? `: ${result.message}` : "";
  return [actionLine(operationTitle(result.op), status, detail)];
}

function pendingActionLines(operations: readonly CopyableOperation[], results: readonly CopyableTurnResult[]): string[] {
  return operations
    .filter((operation) => isMutatingToolOp(operation) && !results.some((result) => sameToolCall(result.op, operation)))
    .map((operation) => actionLine(operationTitle(operation), operation.failure ? "Failed" : "Awaiting review", operation.failure ? `: ${operation.failure}` : ""));
}

/** Returns the copy text, or null when the turn has nothing worth copying. */
export function turnCopyText(turn: CopyableTurn): string | null {
  if (turn.role === "system") return null;
  const sections: string[] = [];
  const rawText = typeof turn.text === "string" ? turn.text : "";
  const rawReceipt = typeof turn.receipt === "string" ? turn.receipt : "";
  const prose = (rawText || rawReceipt).trim();
  if (prose) sections.push(prose);

  const results = turn.toolResults ?? [];
  const displayResults = results.filter((result) => isDisplayToolOp(result.op));
  const displayBlocks = displayResults.map((result) => ({ result, lines: taskLines(result) })).filter(({ lines }) => lines.length > 0);
  if (displayBlocks.length) {
    sections.push(displayBlocks.map(({ lines }) => lines.join("\n")).join("\n\n"));
  }
  const actions = [...results.filter((result) => !isDisplayToolOp(result.op)), ...displayResults.filter((result) => taskLines(result).length === 0)];
  const pending = pendingActionLines(turn.operations ?? [], results);
  const actionCopy = [...actions.flatMap((result) => actionLines(result)), ...pending];
  if (actionCopy.length) {
    sections.push([pending.length ? "Actions:" : "Actions recorded:", ...actionCopy].join("\n"));
  }
  const text = sections.join("\n\n").trim();
  return text.length ? text : null;
}
