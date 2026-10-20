import { formatDuration, getPersonalInsights, type InsightRange } from "@/lib/work-os-insights";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, INSIGHTS_MODEL, recordAiUsage } from "@/lib/work-os-ai-model";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const SYNTHESIS_TIMEOUT_MS = AI_TIMEOUTS.insights;
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
  days: Array<{ date: string; observedSeconds: number; planned: number; plannedCompleted: number; tasksCompleted: number; trackedMinutes?: number }>;
  /** Range-level update mix; blocked/priority/unplanned stay visible. */
  updateKinds?: { progress: number; starting: number; completionClaim: number; blocked: number; priorityChange: number; unplannedWork: number } | null;
  /** Deterministic rhythm stats (goal/update consistency, streak, best day). */
  consistency?: { dayCount: number; daysWithGoal: number; daysWithUpdate: number; daysWithCompletion: number; currentStreak: number; commitmentRate: number | null; bestDay: { date: string; tasksCompleted: number } | null } | null;
  /** Totals for the equal-length window immediately before this one. */
  previousTotals?: Record<string, number> | null;
  /** Live day state + memory context; informational only, never selectable. */
  contextBlock?: string;
}

export interface InsightSelection { winIds: string[]; attentionIds: string[]; nextFocusIds: string[] }

const INSIGHT_SYNTHESIS_SCHEMA = {
  name: "work_os_insight_synthesis",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["highlight", "attention", "focus", "winIds", "attentionIds", "nextFocusIds"],
    properties: {
      highlight: { type: "string" },
      attention: { type: "string" },
      focus: { type: "string" },
      winIds: { type: "array", items: { type: "string" }, maxItems: 4 },
      attentionIds: { type: "array", items: { type: "string" }, maxItems: 4 },
      nextFocusIds: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
  },
} as const;

/** Where the displayed synthesis came from: the assistant's validated prose, or
 * the deterministic evidence rendering when validation fails. */
export type InsightSynthesisMode = "ai" | "evidence";

export interface InsightNarrative {
  highlight: string;
  attention: string;
  focus: string;
}

const NARRATIVE_SECTION_MIN = 30;
const NARRATIVE_SECTION_MAX = 460;

/** A narrative section is accepted only when it is a short paragraph with no
 * decimals (decimal hours are never allowed) and is checked against the record
 * by the caller with `numbersGroundedIn`. */
export function normalizeNarrativeSection(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length < NARRATIVE_SECTION_MIN || cleaned.length > NARRATIVE_SECTION_MAX) return null;
  if (/\d+\.\d+/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeInsightNarrative(raw: unknown): InsightNarrative | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const highlight = normalizeNarrativeSection(value.highlight);
  const attention = normalizeNarrativeSection(value.attention);
  const focus = normalizeNarrativeSection(value.focus);
  return highlight && attention && focus ? { highlight, attention, focus } : null;
}

/** Short paragraphs under bold, deterministic section labels. Rendered by the
 * companion's ChatMarkdown subset. */
export function composeInsightNarrative(narrative: InsightNarrative): string {
  return [
    "**What went well**", "", narrative.highlight,
    "", "**Needs attention**", "", narrative.attention,
    "", "**Next focus**", "", narrative.focus,
  ].join("\n");
}

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

/** Uses the model as a selector; all displayed language comes from exact stored facts. */
export function renderInsightSelection(selection: InsightSelection, data: Pick<InsightSource, "wins" | "attention" | "nextFocus">): string {
  const facts = insightFacts(data);
  const select = (ids: string[], group: Array<{ id: string; text: string }>) => ids.map((id) => group.find((fact) => fact.id === id)?.text).filter((text): text is string => Boolean(text));
  const wins = select(selection.winIds, facts.wins);
  const attention = select(selection.attentionIds, facts.attention);
  const nextFocus = select(selection.nextFocusIds, facts.focus);
  return composeInsightNarrative({
    highlight: wins.length ? wins.join(" ") : "No wins were selected from this record.",
    attention: attention.length ? attention.join(" ") : "Nothing was selected from this record.",
    focus: nextFocus.length ? nextFocus.join(" ") : "No next focus was selected from this record.",
  });
}

/** The exact record the synthesis must stay inside; also the grounding text for
 * the invented-number check. Instruction lines are deliberately excluded so a
 * model cannot borrow a number from its own instructions. */
export function buildInsightGroundingText(data: InsightSource): string {
  const dayLines = data.days.map((day) =>
    `- ${day.date}: ${formatDuration(day.observedSeconds)} observed, ${day.trackedMinutes ?? 0}m tracked activity context, ${day.plannedCompleted}/${day.planned} planned tasks done, ${day.tasksCompleted} Nifty outcomes`,
  ).join("\n");
  const kinds = data.updateKinds;
  const patterns = data.consistency;
  return [
    `Deterministic summary: ${data.summary}`,
    `Wins: ${insightFacts(data).wins.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "none recorded"}`,
    `Needs attention: ${insightFacts(data).attention.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "nothing flagged"}`,
    `Next focus: ${insightFacts(data).focus.map((fact) => `${fact.id}: ${fact.text}`).join("; ") || "none recorded"}`,
    `Totals: ${formatDuration(data.totals.observedSeconds)} observed, ${data.totals.trackedMinutes ?? 0}m tracked activity context, ${data.totals.plannedCompleted}/${data.totals.planned} planned tasks completed, ${data.totals.tasksCompleted} Nifty outcomes, ${data.totals.outputEvidence} output evidence items, ${data.totals.outcomesOnTime ?? 0} outcomes on time, ${data.totals.outcomesLate ?? 0} outcomes late.`,
    ...(kinds ? [`Update mix: ${kinds.progress} progress, ${kinds.starting} starts, ${kinds.completionClaim} completion claims, ${kinds.blocked} blockers, ${kinds.priorityChange} priority changes, ${kinds.unplannedWork} unplanned work.`] : []),
    ...(patterns ? [`Rhythm: ${patterns.daysWithGoal}/${patterns.dayCount} days with a written goal, ${patterns.daysWithUpdate}/${patterns.dayCount} days with a substantive update, ${patterns.daysWithCompletion}/${patterns.dayCount} days with a completed outcome, ${patterns.currentStreak}-day closing streak${patterns.bestDay ? `, best day ${patterns.bestDay.date} with ${patterns.bestDay.tasksCompleted} completed` : ""}.`] : []),
    ...(data.previousTotals ? [`Earlier equal period: ${data.previousTotals.tasksCompleted ?? 0} Nifty outcomes, ${formatDuration(Number(data.previousTotals.observedSeconds ?? 0))} observed, ${data.previousTotals.plannedCompleted ?? 0}/${data.previousTotals.planned ?? 0} planned tasks completed.`] : []),
    "Daily record:",
    dayLines || "(no days recorded)",
  ].join("\n");
}

export function buildInsightSynthesisPrompt(data: InsightSource): string {
  return [
    `Write a personal work synthesis for ${data.from} → ${data.through} (${data.range}).`,
    "Ground every statement in the exact values below. Never invent numbers, tasks, or days.",
    "Express every duration in hours and minutes, for example 2h 48m or 48m. Never use decimal hours such as 2.8h.",
    "Write one short paragraph per section: highlight (what went well), attention (what needs attention), and focus (the next focus).",
    "Use 2–3 sentences per paragraph. Bold the most important figure or phrase in each paragraph with **double asterisks**.",
    "Keep activity context labeled as observed context: it never proves task completion and is never a productivity score.",
    "",
    buildInsightGroundingText(data),
    ...(data.contextBlock ? ["", `Additional context (live day state plus confirmed, historical, and same-day tentative memory — informational only; never a selectable fact and never completion evidence):\n${data.contextBlock}`] : []),
    "",
    "Return ONLY JSON with highlight, attention, focus (short paragraphs), and winIds, attentionIds, nextFocusIds (IDs selected from the matching lists above).",
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
  mode?: InsightSynthesisMode;
  model?: string;
  reason?: SynthesisFailure;
  detail?: string;
}

export async function synthesizeInsights(access: WorkOsAccess, range: InsightRange, through: string | null): Promise<SynthesisResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI synthesis is not configured on this server" };
  const data = await getPersonalInsights(access, range, through);
  let contextBlock: string | undefined;
  if (memoryEnabled(access.featureFlags)) {
    const scope = { organizationId: access.organizationId, personId: access.personId as string, localDate: data.through };
    const focusQuery = [
      String(data.brief.summary ?? ""),
      ...(data.brief.wins ?? []).slice(0, 2),
      ...(data.brief.attention ?? []).slice(0, 2),
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
    const [todayBlock, memoryBlock] = await Promise.all([
      buildTodaySnapshot(scope),
      buildMemoryPromptBlock(scope, focusQuery || "recent work history and patterns", { limit: 8, from: data.from, analysisLocalDate: data.through }),
    ]);
    contextBlock = [todayBlock, memoryBlock].filter(Boolean).join("\n\n") || undefined;
  }
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
      plannedCompleted: day.plannedCompleted, tasksCompleted: day.tasksCompleted, trackedMinutes: Number((day as { trackedMinutes?: number }).trackedMinutes ?? 0),
    })),
    updateKinds: (data as { updateKinds?: InsightSource["updateKinds"] }).updateKinds ?? null,
    consistency: (data as { consistency?: InsightSource["consistency"] }).consistency ?? null,
    previousTotals: (data as { comparison?: { totals?: Record<string, number> } }).comparison?.totals ?? null,
    contextBlock,
  });
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(INSIGHTS_MODEL, {
        messages: [
          { role: "system", content: "You are the Work OS assistant. Ground every number in the record the user provides; never invent figures, tasks, days, or events. Express durations in hours and minutes (2h 48m, 48m) — never decimal hours such as 2.8h. Write short paragraphs (2–3 sentences) and bold the most important figure in each with **double asterisks**. Never call anything a productivity score, and never treat activity context as task completion. Return only the JSON object the user asks for." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: AI_TOKEN_BUDGETS.insights,
      })),
      signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    recordAiUsage("insights", INSIGHTS_MODEL, payload);
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, reason: "ai_malformed", detail: "no synthesis JSON" };
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    const facts = {
      wins: (data.brief.wins ?? []).map(String),
      attention: (data.brief.attention ?? []).map(String),
      nextFocus: (data.brief.nextFocus ?? []).map(String),
    };
    const selection = normalizeInsightSelection(parsed, facts);
    const groundingText = buildInsightGroundingText({
      range: data.range ?? range,
      from: data.from,
      through: data.through,
      summary: String(data.brief.summary ?? ""),
      wins: facts.wins,
      attention: facts.attention,
      nextFocus: facts.nextFocus,
      totals: data.totals,
      days: data.days.map((day) => ({
        date: day.date, observedSeconds: day.observedSeconds, planned: day.planned,
        plannedCompleted: day.plannedCompleted, tasksCompleted: day.tasksCompleted, trackedMinutes: Number((day as { trackedMinutes?: number }).trackedMinutes ?? 0),
      })),
      updateKinds: (data as { updateKinds?: InsightSource["updateKinds"] }).updateKinds ?? null,
      consistency: (data as { consistency?: InsightSource["consistency"] }).consistency ?? null,
      previousTotals: (data as { comparison?: { totals?: Record<string, number> } }).comparison?.totals ?? null,
    });
    const narrative = normalizeInsightNarrative(parsed);
    if (narrative
      && numbersGroundedIn(narrative.highlight, groundingText)
      && numbersGroundedIn(narrative.attention, groundingText)
      && numbersGroundedIn(narrative.focus, groundingText)) {
      return { ok: true, synthesis: composeInsightNarrative(narrative), mode: "ai", model: INSIGHTS_MODEL };
    }
    if (!selection) return { ok: false, reason: "ai_malformed", detail: "synthesis referenced invalid facts or figures" };
    return { ok: true, synthesis: renderInsightSelection(selection, facts), mode: "evidence", model: INSIGHTS_MODEL };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "ai_malformed", detail: "invalid synthesis JSON" };
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}
