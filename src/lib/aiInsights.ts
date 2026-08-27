import { getPersonalInsights, type InsightRange } from "@/lib/work-os-insights";
import type { WorkOsAccess } from "@/lib/work-os-api";

export const INSIGHTS_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const SYNTHESIS_TIMEOUT_MS = 45_000;
const MAX_SYNTHESIS_CHARS = 1200;

export type SynthesisFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed";

export function buildInsightSynthesisPrompt(data: {
  range: InsightRange;
  from: string;
  through: string;
  summary: string;
  wins: string[];
  attention: string[];
  nextFocus: string[];
  totals: Record<string, number>;
  days: Array<{ date: string; observedSeconds: number; planned: number; plannedCompleted: number; tasksCompleted: number }>;
}): string {
  const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}h`;
  const dayLines = data.days.map((day) =>
    `- ${day.date}: ${hours(day.observedSeconds)} observed, ${day.plannedCompleted}/${day.planned} planned tasks done, ${day.tasksCompleted} Nifty outcomes`,
  ).join("\n");
  return [
    `Write a personal work synthesis for ${data.from} → ${data.through} (${data.range}).`,
    "Ground every statement in the exact values below. Never invent numbers, tasks, or days.",
    "",
    `Deterministic summary: ${data.summary}`,
    `Wins: ${data.wins.join("; ") || "none recorded"}`,
    `Needs attention: ${data.attention.join("; ") || "nothing flagged"}`,
    `Next focus: ${data.nextFocus.join("; ") || "none recorded"}`,
    `Totals: ${hours(data.totals.observedSeconds)} observed, ${data.totals.plannedCompleted}/${data.totals.planned} planned tasks completed, ${data.totals.tasksCompleted} Nifty outcomes, ${data.totals.outputEvidence} output evidence items.`,
    "Daily record:",
    dayLines || "(no days recorded)",
    "",
    "Write plain prose (no headers, no markdown): one short paragraph acknowledging what went well, one acknowledging what needs attention, and one sentence of realistic next focus. Calm and supportive, never surveillance-flavored. Maximum 120 words.",
  ].filter(Boolean).join("\n");
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
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };
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
          { role: "system", content: "You are the Work OS assistant. You summarize personal work records in calm, plain language, strictly from the provided values. You never invent numbers. Output plain prose only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const synthesis = normalizeSynthesis(payload.choices?.[0]?.message?.content);
    if (!synthesis) return { ok: false, reason: "ai_malformed", detail: "empty or invalid synthesis" };
    return { ok: true, synthesis, model: INSIGHTS_MODEL };
  } catch (error) {
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}
