import type { PlanningContext, PlanningTask } from "@/lib/work-os-planning-context";

const PLAN_MODEL = process.env.WORK_OS_PLAN_MODEL ?? process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const PLAN_TIMEOUT_MS = 45_000;
const MAX_CLARIFICATIONS = 2;

export type PlanClarificationReason = "missing_outcome" | "ambiguous_scope" | "missing_completion_criteria" | "unclear_task_match" | "conflicting_context";
export type PlanSourceRef = { provider: "work_os" | "nifty" | "employee"; type: "task" | "intent"; id: string; label?: string };
export type CandidateDailyCommitment = {
  clientId: string;
  linkedTaskId?: string;
  title: string;
  objective: string;
  successCriteria: string[];
  dependency?: string;
  blocker?: string;
  estimatedMinutes?: number;
  sourceRefs: PlanSourceRef[];
  confidence: number;
};
export type CandidateDailyPlan = {
  rawIntent: string;
  summary: string;
  commitments: CandidateDailyCommitment[];
  clarifications: Array<{ id: string; commitmentId?: string; question: string; reason: PlanClarificationReason }>;
  readiness: "ready" | "needs_one_clarification" | "needs_multiple_clarifications";
};
export type PlanInterpretationResult =
  | { ok: true; interpretation: CandidateDailyPlan; model: string; promptVersion: string; contextVersion: string }
  | { ok: false; reason: "ai_unconfigured" | "ai_unavailable" | "ai_malformed"; detail: string };

export type PlanDraftAnnotation = { target: string; quote: string; comment: string };
export type PlanDraftEdit = { clientId: string; title?: string; objective?: string; successCriteria?: string[] };
export type PlanRefineDraft = {
  summary: string;
  commitments: Array<{ clientId: string; title: string; objective: string; successCriteria: string[] }>;
};

const text = (value: unknown, max: number) => typeof value === "string" && value.trim()
  ? value.replace(/\s+/g, " ").trim().slice(0, max)
  : null;

function knownTasks(context: PlanningContext) {
  return new Map<string, PlanningTask>([...context.todayTasks, ...context.carryOver].map((task) => [task.id, task]));
}

/** Drops every model-emitted reference that was not fetched and scoped server-side. */
export function parsePlanInterpretation(raw: unknown, rawIntent: string, context: PlanningContext): CandidateDailyPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const tasks = knownTasks(context);
  const summary = text(source.summary, 500);
  if (!summary) return null;
  const commitments: CandidateDailyCommitment[] = [];
  for (const entry of Array.isArray(source.commitments) ? source.commitments.slice(0, 8) : []) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const clientId = text(row.clientId, 120);
    const title = text(row.title, 240);
    const objective = text(row.objective, 1_000);
    const confidence = typeof row.confidence === "number" && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : null;
    if (!clientId || !title || !objective || confidence === null) continue;
    const linkedTaskId = typeof row.linkedTaskId === "string" && tasks.has(row.linkedTaskId) ? row.linkedTaskId : undefined;
    const criteria = Array.isArray(row.successCriteria)
      ? row.successCriteria.map((item) => text(item, 300)).filter((item): item is string => !!item).slice(0, 5)
      : [];
    const refs: PlanSourceRef[] = linkedTaskId
      ? [{ provider: "work_os", type: "task", id: linkedTaskId, label: tasks.get(linkedTaskId)?.title }]
      : [{ provider: "employee", type: "intent", id: "raw_intent", label: "Employee planning input" }];
    const estimatedMinutes = typeof row.estimatedMinutes === "number" && Number.isInteger(row.estimatedMinutes) && row.estimatedMinutes >= 1 && row.estimatedMinutes <= 720
      ? row.estimatedMinutes
      : undefined;
    commitments.push({
      clientId,
      linkedTaskId,
      title,
      objective,
      successCriteria: criteria,
      dependency: text(row.dependency, 500) ?? undefined,
      blocker: text(row.blocker, 500) ?? undefined,
      estimatedMinutes,
      sourceRefs: refs,
      confidence,
    });
  }
  const allowedReasons: PlanClarificationReason[] = ["missing_outcome", "ambiguous_scope", "missing_completion_criteria", "unclear_task_match", "conflicting_context"];
  const commitmentIds = new Set(commitments.map((commitment) => commitment.clientId));
  const clarifications = (Array.isArray(source.clarifications) ? source.clarifications : []).slice(0, MAX_CLARIFICATIONS).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = text(row.id, 120);
    const question = text(row.question, 300);
    const reason = typeof row.reason === "string" && allowedReasons.includes(row.reason as PlanClarificationReason)
      ? row.reason as PlanClarificationReason
      : null;
    const commitmentId = typeof row.commitmentId === "string" && commitmentIds.has(row.commitmentId) ? row.commitmentId : undefined;
    return id && question && reason ? [{ id, question, reason, commitmentId }] : [];
  });
  const readiness = clarifications.length === 0 ? "ready" : clarifications.length === 1 ? "needs_one_clarification" : "needs_multiple_clarifications";
  return { rawIntent, summary, commitments, clarifications, readiness };
}

export function buildPlanningPrompt(rawIntent: string, context: PlanningContext, conversation: Array<{ role: "user" | "assistant"; text: string }>) {
  return JSON.stringify({
    employeeInput: rawIntent,
    recentConversation: conversation.slice(-8),
    context,
    rules: [
      "Preserve the employee's meaning. Do not create, update, complete, or remove any task.",
      "Only link a task using an id from the supplied context. Do not invent task, PR, deadline, blocker, or provider references.",
      "A commitment describes success for today, not a permanent rewrite of a task.",
      "Ask zero questions for a clear plan, one useful question for ordinary ambiguity, and never more than two questions.",
      "Ask only when missing information prevents a useful daily commitment. Use plain language.",
    ],
    output: {
      summary: "string",
      commitments: [{ clientId: "string", linkedTaskId: "optional server task id", title: "string", objective: "string", successCriteria: ["string"], dependency: "optional string", blocker: "optional string", estimatedMinutes: 30, confidence: 0.8 }],
      clarifications: [{ id: "string", commitmentId: "optional clientId", question: "string", reason: "missing_outcome|ambiguous_scope|missing_completion_criteria|unclear_task_match|conflicting_context" }],
    },
  });
}

export async function interpretDailyPlan(input: { rawIntent: unknown; conversation?: unknown }, context: PlanningContext): Promise<PlanInterpretationResult> {
  const rawIntent = text(input.rawIntent, 4_000);
  if (!rawIntent) return { ok: false, reason: "ai_malformed", detail: "input is required" };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI planning is not configured on this server" };
  const conversation = Array.isArray(input.conversation)
    ? input.conversation.flatMap((entry) => entry && typeof entry === "object" && ((entry as Record<string, unknown>).role === "user" || (entry as Record<string, unknown>).role === "assistant") && text((entry as Record<string, unknown>).text, 1_000)
      ? [{ role: (entry as { role: "user" | "assistant" }).role, text: text((entry as Record<string, unknown>).text, 1_000)! }]
      : []).slice(-8)
    : [];
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PLAN_MODEL,
        temperature: 0.2,
        max_tokens: 1_400,
        messages: [
          { role: "system", content: "You are the Work OS planning assistant. Return only valid JSON and do not perform mutations." },
       { role: "user", content: buildPlanningPrompt(rawIntent, context, conversation) },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parsePlanInterpretation(JSON.parse(content), rawIntent, context);
    return parsed
      ? { ok: true, interpretation: parsed, model: PLAN_MODEL, promptVersion: "work-os-plan-v1", contextVersion: "planning-context-v1" }
      : { ok: false, reason: "ai_malformed", detail: "response failed validation" };
  } catch (error) {
    return { ok: false, reason: error instanceof SyntaxError ? "ai_malformed" : "ai_unavailable", detail: error instanceof Error ? error.message : "planning provider failed" };
  }
}

export function buildPlanRefinePrompt(rawIntent: string, draft: PlanRefineDraft, annotations: PlanDraftAnnotation[], edits: PlanDraftEdit[], context: PlanningContext) {
  return JSON.stringify({
    employeeInput: rawIntent,
    currentDraft: draft,
    annotationFeedback: annotations,
    employeeEdits: edits,
    context,
    rules: [
      "Revise the current draft minimally to honor the annotation feedback and employee edits. Preserve the employee's meaning. Do not create, update, complete, or remove any task.",
      "Keep every commitment that received no feedback exactly as written unless an edit or annotation requires a change.",
      "Only link a task using an id from the supplied context. Do not invent task, PR, deadline, blocker, or provider references.",
      "A commitment describes success for today, not a permanent rewrite of a task.",
      "Ask zero questions for a clear plan, one useful question for ordinary ambiguity, and never more than two questions.",
      "Ask only when missing information prevents a useful daily commitment. Use plain language.",
    ],
    output: {
      summary: "string",
      commitments: [{ clientId: "string", linkedTaskId: "optional server task id", title: "string", objective: "string", successCriteria: ["string"], dependency: "optional string", blocker: "optional string", estimatedMinutes: 30, confidence: 0.8 }],
      clarifications: [{ id: "string", commitmentId: "optional clientId", question: "string", reason: "missing_outcome|ambiguous_scope|missing_completion_criteria|unclear_task_match|conflicting_context" }],
    },
  });
}

export async function refinePlanDraft(input: { rawIntent: unknown; draft: unknown; annotations?: unknown; edits?: unknown }, context: PlanningContext): Promise<PlanInterpretationResult> {
  const rawIntent = text(input.rawIntent, 4_000);
  if (!rawIntent) return { ok: false, reason: "ai_malformed", detail: "input is required" };
  if (!input.draft || typeof input.draft !== "object") return { ok: false, reason: "ai_malformed", detail: "draft is required for refinement" };
  const source = input.draft as Record<string, unknown>;
  const summary = text(source.summary, 500);
  if (!summary) return { ok: false, reason: "ai_malformed", detail: "draft.summary is required for refinement" };
  const draftCommitments = (Array.isArray(source.commitments) ? source.commitments : []).slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const clientId = text(row.clientId, 120);
    const title = text(row.title, 240);
    const objective = text(row.objective, 1_000);
    if (!clientId || !title || !objective) return [];
    return [{
      clientId,
      title,
      objective,
      successCriteria: Array.isArray(row.successCriteria)
        ? row.successCriteria.map((item) => text(item, 300)).filter((item): item is string => !!item).slice(0, 5)
        : [],
    }];
  });
  if (!draftCommitments.length) return { ok: false, reason: "ai_malformed", detail: "draft must contain at least one commitment" };
  const annotations = (Array.isArray(input.annotations) ? input.annotations : []).slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const target = text(row.target, 120);
    const quote = text(row.quote, 500);
    const comment = text(row.comment, 1_000);
    return target && quote && comment && comment.length >= 3 ? [{ target, quote, comment }] : [];
  });
  const edits = (Array.isArray(input.edits) ? input.edits : []).slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const clientId = text(row.clientId, 120);
    if (!clientId) return [];
    const title = text(row.title, 240);
    const objective = text(row.objective, 1_000);
    const successCriteria = Array.isArray(row.successCriteria)
      ? row.successCriteria.map((item) => text(item, 300)).filter((item): item is string => !!item).slice(0, 5)
      : undefined;
    if (!title && !objective && !successCriteria?.length) return [];
    return [{ clientId, ...(title ? { title } : {}), ...(objective ? { objective } : {}), ...(successCriteria?.length ? { successCriteria } : {}) }];
  });
  if (!annotations.length && !edits.length) return { ok: false, reason: "ai_malformed", detail: "at least one annotation or edit is required for refinement" };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI planning is not configured on this server" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PLAN_MODEL,
        temperature: 0.2,
        max_tokens: 1_400,
        messages: [
          { role: "system", content: "You are the Work OS planning assistant. Return only valid JSON and do not perform mutations." },
          { role: "user", content: buildPlanRefinePrompt(rawIntent, { summary, commitments: draftCommitments }, annotations, edits, context) },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parsePlanInterpretation(JSON.parse(content), rawIntent, context);
    return parsed
      ? { ok: true, interpretation: parsed, model: PLAN_MODEL, promptVersion: "work-os-plan-refine-v1", contextVersion: "planning-context-v1" }
      : { ok: false, reason: "ai_malformed", detail: "response failed validation" };
  } catch (error) {
    return { ok: false, reason: error instanceof SyntaxError ? "ai_malformed" : "ai_unavailable", detail: error instanceof Error ? error.message : "planning provider failed" };
  }
}
