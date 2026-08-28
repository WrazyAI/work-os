import { getPersonalInsights, type InsightRange } from "@/lib/work-os-insights";
import type { WorkOsAccess } from "@/lib/work-os-api";

export const INSIGHTS_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const SYNTHESIS_TIMEOUT_MS = 45_000;
const MAX_SYNTHESIS_CHARS = 1200;

export type SynthesisFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed";

export interface InsightSource {
  range: InsightRange;
  from: string;
  through: string;
  summary: string;
  wins: string[];
  attention: string[];
  nextFocus: string[];
  totals: Record<string, number>;
  days: Array<{ date: string; observedSeconds: number; planned: number; plannedCompleted: number; tasksCompleted: number }>;
}

export interface InsightSelection { winIds: string[]; attentionIds: string[]; nextFocusIds: string[] }

const INSIGHT_SELECTION_SCHEMA = {
  name: "work_os_insight_selection",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["winIds", "attentionIds", "nextFocusIds"],
    properties: {
      winIds: { type: "array", items: { type: "string" }, maxItems: 3 },
      attentionIds: { type: "array", items: { type: "string" }, maxItems: 3 },
      nextFocusIds: { type: "array", items: { type: "string" }, maxItems: 3 },
    },
  },
} as const;

function insightFacts(data: Pick<InsightSource, "wins" | "attention" | "nextFocus">) {
  return {
    wins: data.wins.map((text, index) => ({ id: `win:${index}`, text })),
    attention: data.attention.map((text, index) => ({ id: `attention:${index}`, text })),
    focus: data.nextFocus.map((text, index) => ({ id: `focus:${index}`, text })),
  };
}

function validSelection(value: unknown, prefix: string, allowed: Set<string>): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return null;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.startsWith(prefix) && allowed.has(id)))];
}

/** Validates model output against the current deterministic fact record. */
export function normalizeInsightSelection(raw: unknown, data: Pick<InsightSource, "wins" | "attention" | "nextFocus">): InsightSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const facts = insightFacts(data);
  const winIds = validSelection(value.winIds, "win:", new Set(facts.wins.map((fact) => fact.id)));
  const attentionIds = validSelection(value.attentionIds, "attention:", new Set(facts.attention.map((fact) => fact.id)));
  const nextFocusIds = validSelection(value.nextFocusIds, "focus:", new Set(facts.focus.map((fact) => fact.id)));
  return winIds && attentionIds && nextFocusIds ? { winIds, attentionIds, nextFocusIds } : null;
}

/** Uses the model only as a selector; all displayed language comes from exact stored facts. */
export function renderInsightSelection(selection: InsightSelection, data: Pick<InsightSource, "wins" | "attention" | "nextFocus">): string {
  const facts = insightFacts(data);
  const select = (ids: string[], group: Array<{ id: string; text: string }>) => ids.map((id) => group.find((fact) => fact.id === id)?.text).filter((text): text is string => Boolean(text));
  const wins = select(selection.winIds, facts.wins);
  const attention = select(selection.attentionIds, facts.attention);
  const nextFocus = select(selection.nextFocusIds, facts.focus);
  return [
    wins.length ? `What went well: ${wins.join(" ")}` : "What went well: No wins were selected from this record.",
    attention.length ? `Needs attention: ${attention.join(" ")}` : "Needs attention: Nothing was selected from this record.",
    nextFocus.length ? `Next focus: ${nextFocus.join(" ")}` : "Next focus: No next focus was selected from this record.",
  ].join(" ");
}

export function buildInsightSynthesisPrompt(data: InsightSource): string {
  const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}h`;
  const dayLines = data.days.map((day) =>
    `- ${day.date}: ${hours(day.observedSeconds)} observed, ${day.plannedCompleted}/${day.planned} planned tasks done, ${day.tasksCompleted} Nifty outcomes`,
  ).join("\n");
  return [
    `Write a personal work synthesis for ${data.from} → ${data.through} (${data.range}).`,
    "Ground every statement in the exact values below. Never invent numbers, tasks, or days.",
    "",
    `Deterministic summary: ${data.summary}`,
    `Wins: ${insightFacts(data).wins.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "none recorded"}`,
    `Needs attention: ${insightFacts(data).attention.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "nothing flagged"}`,
    `Next focus: ${insightFacts(data).focus.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "none recorded"}`,
    `Totals: ${hours(data.totals.observedSeconds)} observed, ${data.totals.plannedCompleted}/${data.totals.planned} planned tasks completed, ${data.totals.tasksCompleted} Nifty outcomes, ${data.totals.outputEvidence} output evidence items.`,
    "Daily record:",
    dayLines || "(no days recorded)",
    "",
    "Return ONLY JSON with winIds, attentionIds, and nextFocusIds. Select IDs from matching lists; do not emit prose, numbers, or facts.",
  ].filter(Boolean).join("\n");
}

/**
 * Every integer the model writes must appear somewhere in the grounding text
 * (the deterministic brief, totals, and daily record). Catches invented
 * figures while tolerating restated ones; years in grounding dates keep the
 * check honest for dated summaries.
 */
export function numbersGroundedIn(synthesis: string, groundingText: string): boolean {
  const tokens = (value: string) => value.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) ?? [];
  const grounded = new Set(tokens(groundingText));
  return tokens(synthesis).every((token) => grounded.has(token));
}

/** Normalizes the model output into a bounded plain-text synthesis. */
export function normalizeSynthesis(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length < 20) return null;
  return cleaned.slice(0, MAX_SYNTHESIS_CHARS);
}

export interface SynthesisResult {
  ok: boolean;
  synthesis?: string;
  model?: string;
  reason?: SynthesisFailure;
  detail?: string;
}

export async function synthesizeInsights(access: WorkOsAccess, range: InsightRange, through: string | null): Promise<SynthesisResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI synthesis is not configured on this server" };
  const data = await getPersonalInsights(access, range, through);
  const prompt = buildInsightSynthesisPrompt({
    range: data.range ?? range,
    from: data.from,
    through: data.through,
    summary: String(data.brief.summary ?? ""),
    wins: (data.brief.wins ?? []).map(String),
    attention: (data.brief.attention ?? []).map(String),
    nextFocus: (data.brief.nextFocus ?? []).map(String),
    totals: data.totals,
    days: data.days.map((day) => ({
      date: day.date, observedSeconds: day.observedSeconds, planned: day.planned,
      plannedCompleted: day.plannedCompleted, tasksCompleted: day.tasksCompleted,
    })),
  });
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: INSIGHTS_MODEL,
        messages: [
          { role: "system", content: "You are the Work OS assistant. Select only verified insight fact IDs. Never write prose, numbers, or unsupported facts." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, reason: "ai_malformed", detail: "no selection JSON" };
    const selection = normalizeInsightSelection(JSON.parse(content.slice(start, end + 1)), {
      wins: (data.brief.wins ?? []).map(String), attention: (data.brief.attention ?? []).map(String), nextFocus: (data.brief.nextFocus ?? []).map(String),
    });
    if (!selection) return { ok: false, reason: "ai_malformed", detail: "selection referenced invalid facts" };
    return { ok: true, synthesis: renderInsightSelection(selection, {
      wins: (data.brief.wins ?? []).map(String), attention: (data.brief.attention ?? []).map(String), nextFocus: (data.brief.nextFocus ?? []).map(String),
    }), model: INSIGHTS_MODEL };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "ai_malformed", detail: "invalid selection JSON" };
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}
