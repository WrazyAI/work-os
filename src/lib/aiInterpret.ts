import { listPersonTasks } from "@/lib/work-os";

export const INTERPRET_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const INTERPRET_TIMEOUT_MS = 45_000;
export const INTERPRET_RESPONSE_SCHEMA = {
  name: "work_os_candidate_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "taskMatches", "claims", "operations"],
    properties: {
      reply: { type: "string" },
      taskMatches: { type: "array", items: { type: "object", additionalProperties: false, required: ["taskId", "confidence"], properties: { taskId: { type: "string" }, confidence: { type: "number" } } }, maxItems: 20 },
      claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "statement", "taskId"], properties: { kind: { type: "string" }, statement: { type: "string" }, taskId: { type: ["string", "null"] } } }, maxItems: 20 },
      operations: { type: "array", items: { type: "object", additionalProperties: false, required: ["op", "statement", "taskId", "taskTitle", "taskGroupId", "limit", "page"], properties: { op: { type: "string" }, statement: { type: "string" }, taskId: { type: ["string", "null"] }, taskTitle: { type: ["string", "null"] }, taskGroupId: { type: ["string", "null"] }, limit: { type: ["integer", "null"] }, page: { type: ["string", "null"] } } }, maxItems: 20 },
    },
  },
} as const;

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task"
  | "add_task" | "archive_task" | "delete_task" | "modify_task_description" | "modify_task_status"
  | "add_subtask" | "modify_subtask" | "delete_subtask" | "display_pending_tasks" | "display_overdue_tasks"
  | "navigate_to_page";
export type CandidateClaimKind = "progress" | "completion" | "blocker" | "priority_change" | "new_work";

export interface CandidateOperation {
  op: CandidateOperationKind;
  statement: string;
  taskId?: string;
  taskTitle?: string;
  taskGroupId?: string;
  limit?: number;
  page?: string;
}

export interface CandidateWorkUpdate {
  originalInput: string;
  reply: string;
  taskMatches: Array<{ taskId: string; confidence: number }>;
  claims: Array<{ kind: CandidateClaimKind; statement: string; taskId?: string }>;
  operations: CandidateOperation[];
}

export type InterpretationFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed" | "nifty_failure";

const OPERATION_KINDS: CandidateOperationKind[] = ["record_progress", "record_blocker", "complete_task", "reopen_task", "create_task", "add_task", "archive_task", "delete_task", "modify_task_description", "modify_task_status", "add_subtask", "modify_subtask", "delete_subtask", "display_pending_tasks", "display_overdue_tasks", "navigate_to_page"];
const NAVIGATE_PAGES = ["day", "tasks", "review", "insights", "evidence", "settings"];
const CLAIM_KINDS: CandidateClaimKind[] = ["progress", "completion", "blocker", "priority_change", "new_work"];

function text(value: unknown, max = 4000): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : null;
}

function safeId(value: unknown, allowed: { has(id: string): boolean }): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

/**
 * Defensively normalizes whatever the model returned into the typed contract.
 * Task references that are not in the server-fetched allow-list are dropped,
 * so a hallucinated or cross-org id can never reach an operation.
 */
export function parseInterpretation(raw: unknown, originalInput: string, allowedTasks: Array<{ id: string; title: string; taskGroupId?: string | null }>): CandidateWorkUpdate | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const allowed = new Map(allowedTasks.map((task) => [task.id, task.title]));
  const allowedTaskGroupIds = new Set(allowedTasks.map((task) => task.taskGroupId).filter((id): id is string => !!id));

  const taskMatches: CandidateWorkUpdate["taskMatches"] = [];
  if (Array.isArray(source.taskMatches)) {
    for (const match of source.taskMatches.slice(0, 20)) {
      if (!match || typeof match !== "object") continue;
      const entry = match as Record<string, unknown>;
      const taskId = safeId(entry.taskId ?? entry.task_id, allowed);
      const confidence = typeof entry.confidence === "number" && entry.confidence >= 0 && entry.confidence <= 1 ? entry.confidence : null;
      if (taskId && confidence !== null) taskMatches.push({ taskId, confidence });
    }
  }

  const claims: CandidateWorkUpdate["claims"] = [];
  if (Array.isArray(source.claims)) {
    for (const claim of source.claims.slice(0, 20)) {
      if (!claim || typeof claim !== "object") continue;
      const entry = claim as Record<string, unknown>;
      const kind = typeof entry.kind === "string" && CLAIM_KINDS.includes(entry.kind as CandidateClaimKind) ? entry.kind as CandidateClaimKind : null;
      const statement = text(entry.statement, 1000);
      if (!kind || !statement) continue;
      claims.push({ kind, statement, taskId: safeId(entry.taskId ?? entry.task_id, allowed) });
    }
  }

  const operations: CandidateOperation[] = [];
  if (Array.isArray(source.operations)) {
    for (const operation of source.operations.slice(0, 20)) {
      if (!operation || typeof operation !== "object") continue;
      const entry = operation as Record<string, unknown>;
      const op = typeof entry.op === "string" && OPERATION_KINDS.includes(entry.op as CandidateOperationKind) ? entry.op as CandidateOperationKind : null;
      const statement = text(entry.statement, 1000);
      if (!op || !statement) continue;
      const taskId = safeId(entry.taskId ?? entry.task_id, allowed);
      if ((op === "complete_task" || op === "reopen_task" || op === "record_progress" || op === "record_blocker" || op === "archive_task" || op === "delete_task" || op === "modify_task_description" || op === "modify_task_status" || op === "add_subtask" || op === "modify_subtask" || op === "delete_subtask") && !taskId) continue;
      const taskGroupId = text(entry.taskGroupId ?? entry.task_group_id, 160) ?? undefined;
      if (op === "modify_task_status" && (!taskGroupId || !allowedTaskGroupIds.has(taskGroupId))) continue;
      const page = op === "navigate_to_page" && typeof entry.page === "string" && NAVIGATE_PAGES.includes(entry.page) ? entry.page : undefined;
      if (op === "navigate_to_page" && !page) continue;
      operations.push({
        op,
        statement,
        taskId,
        taskTitle: ["create_task", "add_task", "add_subtask"].includes(op) ? text(entry.taskTitle ?? entry.task_title, 240) ?? statement.slice(0, 240) : undefined,
        taskGroupId,
        limit: typeof entry.limit === "number" && Number.isInteger(entry.limit) ? Math.min(100, Math.max(1, entry.limit)) : undefined,
        page,
      });
    }
  }

  return { originalInput, reply: text(source.reply, 600) ?? "", taskMatches, claims, operations };
}

export interface InterpretContext {
  todayBlock?: string;
  memoryBlock?: string;
  conversation?: Array<{ role: string; content: string }>;
}

function buildPrompt(
  input: string,
  tasks: Array<{ id: string; title: string; completed: boolean; taskGroupId?: string | null }>,
  planIntent: string | null,
  today: string,
  context?: InterpretContext,
): string {
  const taskList = tasks.map((task) => `- id: ${task.id} | title: ${task.title} | ${task.completed ? "completed" : "open"}`).join("\n") || "(no tasks)";
  const conversation = (context?.conversation ?? [])
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "Employee" : "Assistant"}: ${turn.content.replace(/\s+/g, " ").trim().slice(0, 1000)}`)
    .filter((line) => line.length > 10)
    .join("\n");
  return [
    `Today is ${today}. The employee wrote this update:`,
    `"""${input}"""`,
    planIntent ? `Their stated plan for today: "${planIntent}".` : "",
    context?.todayBlock ? `Live day state (current facts):\n${context.todayBlock}` : "",
    conversation ? `Recent conversation:\n${conversation}` : "",
    context?.memoryBlock ? `Recalled memory (dated history only — never current facts or completion evidence):\n${context.memoryBlock}` : "",
    "Their tasks:",
    taskList,
    "",
    "Convert the update into structured operations. Every mutation is proposed for employee approval; display tools never mutate. Rules:",
    "- Output ONLY JSON, no markdown, matching exactly:",
    '{"reply":"...","taskMatches":[{"taskId":"...","confidence":0.0}],"claims":[{"kind":"progress|completion|blocker|priority_change|new_work","statement":"...","taskId":"..."}],"operations":[{"op":"record_progress|record_blocker|complete_task|reopen_task|create_task|add_task|archive_task|delete_task|modify_task_description|modify_task_status|add_subtask|modify_subtask|delete_subtask|display_pending_tasks|display_overdue_tasks|navigate_to_page","statement":"...","taskId":"...","taskTitle":"...","taskGroupId":"...","limit":20,"page":"review"}]}',
    "- reply is 1-2 short, warm, plain sentences that acknowledge the update and point to the proposed next step. Never claim an action already happened or was approved.",
    "- Only reference taskIds from the list above; never invent ids.",
    "- Use display_pending_tasks or display_overdue_tasks when the employee asks to see those tasks. Set a limit from 1 to 100 and do not attach a taskId.",
    "- Use navigate_to_page when the employee should go somewhere in the app (page is one of: day, tasks, review, insights, evidence, settings). Attach it for time-sensitive destinations like a due EOD report so they get a direct button (page review).",
    "- Use task-management operations only for an explicit employee request. A status change must repeat an existing Nifty status-column ID the employee supplied; do not invent one.",
    "- completion claims become complete_task operations; blockers become record_blocker; new work becomes create_task with a short clear taskTitle.",
    "- Use record_progress for work-in-progress notes on a specific task.",
    "- Statements must be plain, jargon-free sentences a manager can read.",
    "- If the update is empty of work information, return empty arrays.",
  ].filter(Boolean).join("\n");
}

export interface InterpretResult {
  ok: boolean;
  interpretation?: CandidateWorkUpdate;
  model?: string;
  reason?: InterpretationFailure;
  detail?: string;
}

/** Calls the configured provider and returns a validated interpretation. */
export async function interpretWorkUpdate(
  body: { input?: unknown; planIntent?: unknown; today?: unknown },
  tasks: Array<{ id: string; title: string; completed: boolean; taskGroupId?: string | null }>,
  context?: InterpretContext,
): Promise<InterpretResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const input = text(body.input, 4000);
  if (!input) return { ok: false, reason: "ai_malformed", detail: "input is required" };
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI interpretation is not configured on this server" };

  const planIntent = text(body.planIntent, 500);
  const today = text(body.today, 10) ?? new Date().toISOString().slice(0, 10);
  let raw: unknown;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: INTERPRET_MODEL,
        messages: [
          { role: "system", content: "You are the Work OS assistant. You translate employee work updates into structured, reviewable operations. You never invent task ids and you output only valid JSON." },
          { role: "user", content: buildPrompt(input, tasks, planIntent, today, context) },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: "json_schema", json_schema: INTERPRET_RESPONSE_SCHEMA },
      }),
      signal: AbortSignal.timeout(INTERPRET_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return { ok: false, reason: "ai_malformed", detail: "no JSON in response" };
    raw = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "ai_malformed", detail: "invalid interpretation JSON" };
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }

  const interpretation = parseInterpretation(raw, input, tasks);
  if (!interpretation) return { ok: false, reason: "ai_malformed", detail: "response failed validation" };
  return { ok: true, interpretation, model: INTERPRET_MODEL };
}

/** How prominently a task should appear to the interpreter: open work that is
 * due today or overdue first, then other open work, then recently completed
 * tasks. Due-date ordering alone buries today's tasks behind years of older
 * ones. */
function interpretationTaskRank(task: Record<string, unknown>, today: string): number {
  if (task.completed === true) return 2;
  const due = typeof task.due_date === "string" ? task.due_date.slice(0, 10) : null;
  return due && due <= today ? 0 : 1;
}

function interpretationTaskActivity(task: Record<string, unknown>): string {
  return String(task.provider_updated_at ?? task.updated_at ?? task.provider_created_at ?? task.created_at ?? "");
}

/** Recency-first ordering shared by the interpreter context; exported for
 * tests so the bias stays pinned. */
export function orderInterpretationTasks(
  rows: Array<Record<string, unknown>>,
  today: string,
  limit = 300,
): Array<{ id: string; title: string; completed: boolean; taskGroupId?: string | null }> {
  return rows
    .filter((row) => typeof row.id === "string" && typeof row.title === "string")
    .sort((left, right) => interpretationTaskRank(left, today) - interpretationTaskRank(right, today)
      || interpretationTaskActivity(right).localeCompare(interpretationTaskActivity(left)))
    .slice(0, limit)
    .map((row) => ({
      id: row.id as string,
      title: row.title as string,
      completed: row.completed === true,
      taskGroupId: typeof row.task_group_id === "string" ? row.task_group_id : null,
    }));
}

/** Loads the employee's tasks for task matching and id validation, ordered
 * for how people actually talk to the assistant (today first). */
export async function loadInterpretationTasks(ownerId: string, personId: string) {
  const rows = await listPersonTasks(ownerId, personId, { limit: 500, includeCompleted: true }) as unknown as Array<Record<string, unknown>>;
  return orderInterpretationTasks(rows, new Date().toISOString().slice(0, 10));
}
