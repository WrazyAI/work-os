import { createAdminClient } from "@/lib/supabase/admin";

export const EOD_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const EOD_TIMEOUT_MS = 60_000;

export type EodFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed";

export interface EodGrounding {
  date: string;
  personName: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  updates: Array<{ kind: string; text: string; at: string }>;
  completed: string[];
  carried: string[];
  blockers: string[];
  commitments?: Array<{ title: string; status: "selected" | "deferred" | "completed" }>;
}

const BOTTLENECK_PLACEHOLDER = "(needs your input — what prevented you from completing your task list?)";

export interface EodSelection {
  summaryFactIds: string[];
  completedFactIds: string[];
  carriedFactIds: string[];
  blockerFactIds: string[];
}

const EOD_SELECTION_SCHEMA = {
  name: "work_os_eod_selection",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summaryFactIds", "completedFactIds", "carriedFactIds", "blockerFactIds"],
    properties: {
      summaryFactIds: { type: "array", items: { type: "string" }, maxItems: 20 },
      completedFactIds: { type: "array", items: { type: "string" }, maxItems: 100 },
      carriedFactIds: { type: "array", items: { type: "string" }, maxItems: 100 },
      blockerFactIds: { type: "array", items: { type: "string" }, maxItems: 20 },
    },
  },
} as const;

function eodFacts(grounding: EodGrounding) {
  return {
    summary: grounding.updates.map((update, index) => ({ id: `update:${index}`, text: `[${update.kind}] ${update.text}` })),
    completed: grounding.completed.map((text, index) => ({ id: `completed:${index}`, text })),
    carried: grounding.carried.map((text, index) => ({ id: `carried:${index}`, text })),
    blocker: grounding.blockers.map((text, index) => ({ id: `blocker:${index}`, text })),
  };
}

/** Renders persisted plan state only; it is intentionally separate from task evidence. */
export function renderCommitmentReconciliation(commitments: EodGrounding["commitments"] = []): string[] {
  if (!commitments.length) return ["- No daily commitments were confirmed."];
  return commitments.map((commitment) => {
    const status = commitment.status === "completed" ? "marked complete in the plan" : commitment.status === "deferred" ? "deferred in the plan" : "still open in the plan";
    return `- ${commitment.title} (${status})`;
  });
}

function selectedFactIds(value: unknown, prefix: string, allowed: Set<string>): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return null;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.startsWith(prefix) && allowed.has(id)))];
}

/** Rejects model prose and unknown/foreign IDs; only record facts can be selected. */
export function parseEodSelection(raw: unknown, grounding: EodGrounding): EodSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const facts = eodFacts(grounding);
  const summaryFactIds = selectedFactIds(value.summaryFactIds, "update:", new Set(facts.summary.map((fact) => fact.id)));
  const completedFactIds = selectedFactIds(value.completedFactIds, "completed:", new Set(facts.completed.map((fact) => fact.id)));
  const carriedFactIds = selectedFactIds(value.carriedFactIds, "carried:", new Set(facts.carried.map((fact) => fact.id)));
  const blockerFactIds = selectedFactIds(value.blockerFactIds, "blocker:", new Set(facts.blocker.map((fact) => fact.id)));
  return summaryFactIds && completedFactIds && carriedFactIds && blockerFactIds
    ? { summaryFactIds, completedFactIds, carriedFactIds, blockerFactIds }
    : null;
}

/** Renders only the exact grounded facts selected by the model. */
export function renderEodSelection(selection: EodSelection, grounding: EodGrounding): string {
  const facts = eodFacts(grounding);
  const selected = (ids: string[], group: Array<{ id: string; text: string }>) => ids
    .map((id) => group.find((fact) => fact.id === id)?.text)
    .filter((text): text is string => Boolean(text));
  const summary = selected(selection.summaryFactIds, facts.summary);
  const completed = selected(selection.completedFactIds, facts.completed);
  const carried = selected(selection.carriedFactIds, facts.carried);
  const blockers = selected(selection.blockerFactIds, facts.blocker);
  return [
    "## Summary", ...(summary.length ? summary.map((text) => `- ${text}`) : ["- No recorded progress update."]),
    "", "## Completed", ...(completed.length ? completed.map((text) => `- ${text}`) : ["- Nothing completed yet"]),
    "", "## Carried forward", ...(carried.length ? carried.map((text) => `- ${text}`) : ["- Nothing pending"]),
    "", "## Daily commitment reconciliation", ...renderCommitmentReconciliation(grounding.commitments),
    "", "## Bottleneck", ...(blockers.length ? blockers.map((text) => `- ${text}`) : [BOTTLENECK_PLACEHOLDER]),
  ].join("\n");
}

export function buildEodPrompt(grounding: EodGrounding): string {
  const facts = eodFacts(grounding);
  const fmt = (list: Array<{ id: string; text: string }>, empty: string) => list.length ? list.map((item) => `- ${item.id}: ${item.text}`).join("\n") : `- ${empty}`;
  return [
    `Write the end-of-day report for ${grounding.personName}, ${grounding.date}. Plain language for a manager — no jargon, no productivity scores, no invention.`,
    `Session: ${grounding.clockedInAt ?? "not clocked in"} → ${grounding.clockedOutAt ?? "still open"}.`,
    "",
    "Updates recorded through the day:",
    fmt(facts.summary, "none"),
    "",
    "Tasks completed today:",
    fmt(facts.completed, "none"),
    "",
    "Carried over to tomorrow:",
    fmt(facts.carried, "none"),
    "",
    "Daily commitments (planning status only; this does not prove task completion):",
    fmt((grounding.commitments ?? []).map((commitment, index) => ({ id: `commitment:${index}`, text: `${commitment.title} (${commitment.status})` })), "none"),
    "",
    "Bottleneck facts (recorded blockers):",
    fmt(facts.blocker, "none"),
    "",
    "Return ONLY a JSON object with summaryFactIds, completedFactIds, carriedFactIds, and blockerFactIds.",
    "Each array must contain only IDs from its matching section above. Never invent prose, counts, or inferred facts.",
  ].join("\n");
}

/** Guarantees the required bottleneck section exists with an explicit placeholder if the model omitted it. */
export function ensureBottleneckSection(markdown: unknown): string | null {
  if (typeof markdown !== "string" || !markdown.trim()) return null;
  const trimmed = markdown.replace(/\s+$/, "");
  if (/##\s*Bottleneck/i.test(trimmed)) return trimmed;
  return `${trimmed}\n\n## Bottleneck\n${BOTTLENECK_PLACEHOLDER}`;
}

export type EodAnnotation = { quote: string; comment: string };

const MAX_EOD_ANNOTATIONS = 12;
const MAX_EOD_QUOTE = 500;
const MAX_EOD_COMMENT = 1_000;

/** Bounds and cleans employee annotations before they reach the prompt. */
export function sanitizeEodAnnotations(value: unknown): EodAnnotation[] {
  if (!Array.isArray(value)) return [];
  const result: EodAnnotation[] = [];
  for (const item of value) {
    if (result.length >= MAX_EOD_ANNOTATIONS) break;
    if (!item || typeof item !== "object") continue;
    const row = item as { quote?: unknown; comment?: unknown };
    const quote = typeof row.quote === "string" ? row.quote.replace(/\s+/g, " ").trim().slice(0, MAX_EOD_QUOTE) : "";
    const comment = typeof row.comment === "string" ? row.comment.replace(/\s+/g, " ").trim().slice(0, MAX_EOD_COMMENT) : "";
    if (!quote || comment.length < 3) continue;
    result.push({ quote, comment });
  }
  return result;
}

/** One prompt line per annotation so the model can apply each fix in place. */
export function formatEodAnnotations(annotations: EodAnnotation[]): string {
  return annotations.map((annotation) => `- On "${annotation.quote}": ${annotation.comment}`).join("\n");
}

export async function gatherEodGrounding(organizationId: string, personId: string, date: string, personName: string): Promise<EodGrounding> {
  const db = createAdminClient();
  const [updatesResult, eventsResult, sessionResult, planResult] = await Promise.all([
    db.from("work_check_ins").select("input_text,update_kind,occurred_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).eq("substantive", true).order("occurred_at", { ascending: true }),
    db.from("work_task_day_events").select("event_type,task_snapshot").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("local_date", date).order("observed_at", { ascending: true }),
    db.from("work_sessions").select("clocked_in_at,clocked_out_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("work_daily_plans").select("items:work_daily_plan_items(title_snapshot,disposition,completion_state)")
      .eq("organization_id", organizationId).eq("person_id", personId).eq("shift_date", date).maybeSingle(),
  ]);
  if (updatesResult.error) throw new Error(`load EOD updates: ${updatesResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);
  if (planResult.error) throw new Error(`load EOD commitments: ${planResult.error.message}`);

  const updates = ((updatesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({ kind: String(row.update_kind ?? "update"), text: String(row.input_text ?? ""), at: String(row.occurred_at ?? "") }))
    .filter((row) => row.text);
  const completed: string[] = [];
  const carried: string[] = [];
  const blockers: string[] = [];
  for (const event of (eventsResult.data ?? []) as Array<Record<string, unknown>>) {
    const snapshot = (event.task_snapshot ?? {}) as { title?: unknown };
    const title = typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title.trim() : "a task";
    if (event.event_type === "completed") completed.push(title);
    if (event.event_type === "deferred") carried.push(title);
  }
  for (const update of updates) {
    if (update.kind === "blocked" && !blockers.includes(update.text)) blockers.push(update.text);
  }
  const session = (sessionResult.data ?? {}) as { clocked_in_at?: unknown; clocked_out_at?: unknown };
  const commitments = ((Array.isArray(planResult.data?.items) ? planResult.data.items : []) as Array<Record<string, unknown>>).flatMap((item) => {
    const title = typeof item.title_snapshot === "string" && item.title_snapshot.trim() ? item.title_snapshot.trim() : null;
    if (!title || !["selected", "deferred"].includes(String(item.disposition))) return [];
    const status = item.completion_state === "completed" ? "completed" : item.disposition === "deferred" ? "deferred" : "selected";
    return [{ title, status: status as "selected" | "deferred" | "completed" }];
  });
  return {
    date,
    personName,
    clockedInAt: typeof session.clocked_in_at === "string" ? session.clocked_in_at : null,
    clockedOutAt: typeof session.clocked_out_at === "string" ? session.clocked_out_at : null,
    updates,
    completed,
    carried,
    blockers,
    commitments,
  };
}

export interface EodDraftResult {
  ok: boolean;
  markdown?: string;
  model?: string;
  reason?: EodFailure;
  detail?: string;
}

export async function draftEodNarrative(grounding: EodGrounding): Promise<EodDraftResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EOD_MODEL,
        messages: [
          { role: "system", content: "You are the Work OS assistant. Select only verified Work OS fact IDs. You never write report prose or invent facts." },
          { role: "user", content: buildEodPrompt(grounding) },
        ],
        temperature: 0.3,
        max_tokens: 1400,
        response_format: { type: "json_schema", json_schema: EOD_SELECTION_SCHEMA },
      }),
      signal: AbortSignal.timeout(EOD_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, reason: "ai_malformed", detail: "no selection JSON" };
    const selection = parseEodSelection(JSON.parse(content.slice(start, end + 1)), grounding);
    if (!selection) return { ok: false, reason: "ai_malformed", detail: "selection referenced invalid facts" };
    return { ok: true, markdown: renderEodSelection(selection, grounding), model: EOD_MODEL };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "ai_malformed", detail: "invalid selection JSON" };
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}

function withoutBottleneck(markdown: string) {
  return markdown.replace(/\n+##\s*Bottleneck[\s\S]*$/i, "").replace(/\s+$/, "");
}

/** Refines report wording from employee feedback without touching their separate bottleneck answer. */
export async function refineEodNarrative(grounding: EodGrounding, draft: string, feedback: string, annotations: EodAnnotation[] = []): Promise<EodDraftResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EOD_MODEL,
        messages: [
          { role: "system", content: "You refine Work OS EOD report wording. Apply the employee feedback, preserve truthful task and progress statements, and never add a Bottleneck section. Do not invent completion, evidence, timing, or outcomes." },
          { role: "user", content: `Known Work OS facts:\n${buildEodPrompt(grounding)}\n\nCurrent report:\n${withoutBottleneck(draft)}\n\nEmployee feedback:\n${feedback.trim() || "(none)"}\n${annotations.length ? `\nEmployee annotations on the draft:\n${formatEodAnnotations(annotations)}\n` : ""}\nReturn only the revised markdown report. Do not include a Bottleneck heading or content.` },
        ],
        temperature: 0.2,
        max_tokens: 1800,
      }),
      signal: AbortSignal.timeout(EOD_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const markdown = withoutBottleneck(String(payload.choices?.[0]?.message?.content ?? ""));
    if (!markdown) return { ok: false, reason: "ai_malformed", detail: "empty refined report" };
    return { ok: true, markdown, model: EOD_MODEL };
  } catch (error) {
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}
