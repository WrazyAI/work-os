import { listPersonTasks } from "@/lib/work-os";

export const INTERPRET_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const INTERPRET_TIMEOUT_MS = 45_000;
const INTERPRET_RESPONSE_SCHEMA = {
  name: "work_os_candidate_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["taskMatches", "claims", "operations"],
    properties: {
      taskMatches: { type: "array", items: { type: "object", additionalProperties: false, required: ["taskId", "confidence"], properties: { taskId: { type: "string" }, confidence: { type: "number" } } }, maxItems: 20 },
      claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "statement"], properties: { kind: { type: "string" }, statement: { type: "string" }, taskId: { type: "string" } } }, maxItems: 20 },
      operations: { type: "array", items: { type: "object", additionalProperties: false, required: ["op", "statement"], properties: { op: { type: "string" }, statement: { type: "string" }, taskId: { type: "string" }, taskTitle: { type: "string" } } }, maxItems: 20 },
    },
  },
} as const;

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task";
export type CandidateClaimKind = "progress" | "completion" | "blocker" | "priority_change" | "new_work";

export interface CandidateOperation {
  op: CandidateOperationKind;
  statement: string;
  taskId?: string;
  taskTitle?: string;
}

export interface CandidateWorkUpdate {
  originalInput: string;
  taskMatches: Array<{ taskId: string; confidence: number }>;
  claims: Array<{ kind: CandidateClaimKind; statement: string; taskId?: string }>;
  operations: CandidateOperation[];
}

export type InterpretationFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed" | "nifty_failure";

const OPERATION_KINDS: CandidateOperationKind[] = ["record_progress", "record_blocker", "complete_task", "reopen_task", "create_task"];
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
export function parseInterpretation(raw: unknown, originalInput: string, allowedTasks: Array<{ id: string; title: string }>): CandidateWorkUpdate | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const allowed = new Map(allowedTasks.map((task) => [task.id, task.title]));

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
      if ((op === "complete_task" || op === "reopen_task" || op === "record_progress") && !taskId) continue;
      operations.push({
        op,
        statement,
        taskId,
        taskTitle: op === "create_task" ? text(entry.taskTitle ?? entry.task_title, 240) ?? statement.slice(0, 240) : undefined,
      });
    }
  }

  return { originalInput, taskMatches, claims, operations };
}

function buildPrompt(input: string, tasks: Array<{ id: string; title: string; completed: boolean }>, planIntent: string | null, today: string): string {
  const taskList = tasks.map((task) => `- id: ${task.id} | title: ${task.title} | ${task.completed ? "completed" : "open"}`).join("\n") || "(no tasks)";
  return [
    `Today is ${today}. The employee wrote this update:`,
    `"""${input}"""`,
    planIntent ? `Their stated plan for today: "${planIntent}".` : "",
    "Their tasks:",
    taskList,
    "",
    "Convert the update into structured operations. Rules:",
    "- Output ONLY JSON, no markdown, matching exactly:",
    '{"taskMatches":[{"taskId":"...","confidence":0.0}],"claims":[{"kind":"progress|completion|blocker|priority_change|new_work","statement":"...","taskId":"..."}],"operations":[{"op":"record_progress|record_blocker|complete_task|reopen_task|create_task","statement":"...","taskId":"...","taskTitle":"..."}]}',
    "- Only reference taskIds from the list above; never invent ids.",
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
export async function interpretWorkUpdate(body: { input?: unknown; planIntent?: unknown; today?: unknown }, tasks: Array<{ id: string; title: string; completed: boolean }>): Promise<InterpretResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const input = text(body.input, 4000);
  if (!input) return { ok: false, reason: "ai_malformed", detail: "input is required" };
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };

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
          { role: "user", content: buildPrompt(input, tasks, planIntent, today) },
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

/** Loads the employee's open tasks for task matching and id validation. */
export async function loadInterpretationTasks(ownerId: string, personId: string): Promise<Array<{ id: string; title: string; completed: boolean }>> {
  const rows = await listPersonTasks(ownerId, personId, { limit: 200, includeCompleted: true }) as unknown as Array<Record<string, unknown>>;
  return rows
    .filter((row) => typeof row.id === "string" && typeof row.title === "string")
    .map((row) => ({ id: row.id as string, title: row.title as string, completed: row.completed === true }));
}
