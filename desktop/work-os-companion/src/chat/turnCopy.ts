/** Plain-text payload for a chat turn's copy control.
 *
 * The hidden copy button on every bubble and receipt copies the message prose
 * plus a short, truthful summary of the cards the turn rendered, so a turn that
 * is only a task list or a set of action results is still copyable. Everything
 * here is derived from the same data the cards render — nothing is invented. */

export interface CopyableTurnResult {
  status: string;
  message?: string | null;
  op: { op: string; taskTitle?: string | null; statement?: string | null };
  data?: unknown;
}

export interface CopyableTurn {
  role: "user" | "assistant" | "system";
  text?: string | null;
  receipt?: string | null;
  operations?: Array<{ op: string; taskTitle?: string | null; statement?: string | null }>;
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
  const provider = (result.data as { provider_result?: { view?: string; tasks?: Array<Record<string, unknown>> } } | undefined)?.provider_result;
  if (!provider || !Array.isArray(provider.tasks) || !provider.tasks.length) return [];
  const view = provider.view === "overdue" ? "Overdue tasks" : "Pending tasks";
  const lines = provider.tasks.map((task) => {
    const title = typeof task.title === "string" ? task.title : "Untitled task";
    const state = typeof task.state === "string" ? task.state : view === "Overdue tasks" ? "overdue" : "pending";
    const due = typeof task.due_date === "string" && task.due_date ? `, due ${task.due_date.slice(0, 10)}` : "";
    return `- ${title} (${state}${due})`;
  });
  return [`${view}:`, ...lines];
}

function actionLines(result: CopyableTurnResult): string[] {
  const title = result.op.taskTitle ?? result.op.statement ?? "update";
  const status = STATUS_LABEL[result.status] ?? result.status;
  const detail = result.status === "failed" && result.message ? `: ${result.message}` : "";
  return [`- ${title} — ${status}${detail}`];
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
  const displayed = results.filter((result) => taskLines(result).length > 0);
  if (displayed.length) {
    const blocks = displayed.map((result) => taskLines(result).join("\n"));
    sections.push(blocks.join("\n\n"));
  }
  const actions = results.filter((result) => taskLines(result).length === 0);
  if (actions.length) {
    sections.push(["Actions recorded:", ...actions.flatMap((result) => actionLines(result))].join("\n"));
  }
  const text = sections.join("\n\n").trim();
  return text.length ? text : null;
}
