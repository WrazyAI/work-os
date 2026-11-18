import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, recordAiUsage } from "@/lib/work-os-ai-model";
import type { PayrollAiPolicy } from "@/lib/work-os-payroll-ai";
import type {
  PayrollCitation, PayrollScope, PayrollSourceManifest, PayrollWeekBrief, PayrollWeekSources,
} from "@/modules/work-os/payroll/contracts";

const PROMPT_VERSION = "payroll-week-brief-v1";
const MAX_RECAPS_PER_BATCH = 30;
const MAX_SOURCE_CHARS = 20_000;
const MAX_THEMES = 5;
const MAX_OPEN_ITEMS = 4;

export type BriefCheckpoint = {
  sourceHash: string; nextBatch: number; drafts: PayrollWeekBrief[];
  phase: "batches" | "combine" | "done";
};
export type PayrollBriefDeps = { fetch?: typeof fetch };

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const claimKey = (citation: PayrollCitation) => `${citation.type}:${citation.id}:${citation.revision}`;
const timeClaim = /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b/i;
const completionClaim = /\b(?:completed|finished|shipped|delivered)\b/i;

function hasOutcome(citations: PayrollCitation[]): boolean {
  return citations.some((citation) => citation.type === "task" || citation.type === "output");
}

export function selectPayrollWeekSources(manifest: PayrollSourceManifest, week: 1 | 2): PayrollWeekSources {
  const source = manifest.weekSources[week - 1];
  const recaps = source.recaps
    .filter((recap) => !recap.date || (recap.date >= source.from && recap.date <= source.through))
    .sort((left, right) => (left.date ?? "").localeCompare(right.date ?? "") || left.id.localeCompare(right.id));
  return { ...source, recaps };
}

/** A citation is valid only when it names a revision present in this week. */
export function validatePayrollCitations(citations: unknown, sources: PayrollWeekSources): PayrollCitation[] {
  if (!Array.isArray(citations)) return [];
  const recaps = new Map(sources.recaps.map((recap) => [recap.id, recap]));
  const outcomes = new Set(sources.outcomes.map((outcome) => claimKey(outcome.citation)));
  const seen = new Set<string>();
  const valid: PayrollCitation[] = [];
  for (const entry of citations) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const revision = Number(row.revision);
    if (!id || !Number.isSafeInteger(revision) || revision < 1) continue;
    let citation: PayrollCitation | null = null;
    if (row.type === "interval") {
      const recap = recaps.get(id);
      if (recap && revision === recap.reviewVersion) citation = { type: "interval", id, revision };
    } else if (row.type === "task" || row.type === "output") {
      const candidate = { type: row.type, id, revision } as PayrollCitation;
      if (outcomes.has(claimKey(candidate))) citation = candidate;
    }
    if (!citation) continue;
    const key = claimKey(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(citation);
  }
  return valid;
}

type SourceBlock = { citation: PayrollCitation; text: string };

function sourceBlocks(sources: PayrollWeekSources): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const recap of sources.recaps) {
    const citation = { type: "interval" as const, id: recap.id, revision: recap.reviewVersion };
    const text = `[interval:${recap.id}@${recap.reviewVersion}] ${recap.headline || "Recap"} — ${recap.detail}`;
    for (let offset = 0; offset < text.length; offset += MAX_SOURCE_CHARS) {
      blocks.push({ citation, text: text.slice(offset, offset + MAX_SOURCE_CHARS) });
    }
  }
  for (const outcome of sources.outcomes) {
    blocks.push({ citation: outcome.citation, text: `[${claimKey(outcome.citation)}] ${outcome.text}` });
  }
  return blocks;
}

function sourceBatches(blocks: SourceBlock[]): SourceBlock[][] {
  const batches: SourceBlock[][] = [];
  let current: SourceBlock[] = [];
  let chars = 0;
  let recaps = 0;
  for (const block of blocks) {
    const isRecap = block.citation.type === "interval";
    if (current.length && (chars + block.text.length > MAX_SOURCE_CHARS || (isRecap && recaps >= MAX_RECAPS_PER_BATCH))) {
      batches.push(current);
      current = [];
      chars = 0;
      recaps = 0;
    }
    current.push(block);
    chars += block.text.length;
    if (isRecap) recaps += 1;
  }
  if (current.length) batches.push(current);
  return batches;
}

function briefTool() {
  const citation = {
    type: "object", additionalProperties: false, required: ["type", "id", "revision"],
    properties: { type: { type: "string" }, id: { type: "string" }, revision: { type: "integer" } },
  };
  return {
    type: "function",
    function: {
      name: "recordWeekBrief",
      description: "Record a cited progress brief from the supplied week's recap and outcome sources only.",
      parameters: {
        type: "object", additionalProperties: false,
        required: ["title", "summary", "citations", "themes", "openItems", "gaps"],
        properties: {
          title: { type: "string" }, summary: { type: "string" },
          citations: { type: "array", items: citation },
          themes: {
            type: "array", maxItems: MAX_THEMES,
            items: { type: "object", additionalProperties: false, required: ["heading", "detail", "citations"], properties: { heading: { type: "string" }, detail: { type: "string" }, citations: { type: "array", items: citation } } },
          },
          openItems: {
            type: "array", maxItems: MAX_OPEN_ITEMS,
            items: { type: "object", additionalProperties: false, required: ["text", "citations"], properties: { text: { type: "string" }, citations: { type: "array", items: citation } } },
          },
          gaps: { type: "array", maxItems: MAX_OPEN_ITEMS, items: { type: "string" } },
        },
      },
    },
  };
}

function emptyBrief(week: 1 | 2, sourceHash: string): PayrollWeekBrief {
  return { week, status: "missing", title: "", summary: "No recaps recorded for these dates", summaryCitations: [], themes: [], openItems: [], gaps: [], sourceHash };
}
function failedBrief(week: 1 | 2, sourceHash: string, reason: string): PayrollWeekBrief {
  return { week, status: "failed", title: "", summary: "", summaryCitations: [], themes: [], openItems: [], gaps: [reason.slice(0, 300)], sourceHash };
}
function combineDrafts(week: 1 | 2, sourceHash: string, drafts: PayrollWeekBrief[]): PayrollWeekBrief {
  const summary = drafts.map((draft) => draft.summary).filter(Boolean).join(" ").slice(0, 900);
  if (!summary) return failedBrief(week, sourceHash, "The brief model returned no grounded summary.");
  return {
    week, status: "ready", title: clean(drafts.find((draft) => draft.title)?.title, 160) || `Week ${week} progress brief`,
    summary,
    summaryCitations: [...new Map(drafts.flatMap((draft) => draft.summaryCitations).map((citation) => [claimKey(citation), citation])).values()],
    themes: drafts.flatMap((draft) => draft.themes).slice(0, MAX_THEMES),
    openItems: drafts.flatMap((draft) => draft.openItems).slice(0, MAX_OPEN_ITEMS),
    gaps: [...new Set(drafts.flatMap((draft) => draft.gaps))].slice(0, MAX_OPEN_ITEMS),
    sourceHash,
  };
}
function parseDraft(week: 1 | 2, sourceHash: string, parsed: Record<string, unknown>, sources: PayrollWeekSources): PayrollWeekBrief | null {
  const summary = clean(parsed.summary, 900);
  if (!summary || timeClaim.test(summary)) return null;
  const summaryCitations = validatePayrollCitations(parsed.citations, sources);
  if (completionClaim.test(summary) && !hasOutcome(summaryCitations)) return null;
  const themes = (Array.isArray(parsed.themes) ? parsed.themes : []).flatMap((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const heading = clean(row?.heading, 120);
    const detail = clean(row?.detail, 400);
    if (!heading || !detail || timeClaim.test(`${heading} ${detail}`)) return [];
    const citations = validatePayrollCitations(row?.citations, sources);
    if (completionClaim.test(`${heading} ${detail}`) && !hasOutcome(citations)) return [];
    return citations.length ? [{ heading, detail, citations }] : [];
  }).slice(0, MAX_THEMES);
  const openItems = (Array.isArray(parsed.openItems) ? parsed.openItems : []).flatMap((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const text = clean(row?.text, 240);
    const citations = validatePayrollCitations(row?.citations, sources);
    return text && citations.length ? [{ text, citations }] : [];
  }).slice(0, MAX_OPEN_ITEMS);
  const gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : []).map((entry) => clean(entry, 200)).filter(Boolean).slice(0, MAX_OPEN_ITEMS);
  return {
    week, status: "generating", title: clean(parsed.title, 160) || `Week ${week} progress brief`,
    summary, summaryCitations: validatePayrollCitations(parsed.citations, sources), themes, openItems, gaps, sourceHash,
  };
}

export async function advancePayrollWeekBrief(
  scope: PayrollScope, sources: PayrollWeekSources, policy: PayrollAiPolicy,
  checkpoint: BriefCheckpoint | null, signal?: AbortSignal, deps: PayrollBriefDeps = {},
): Promise<{ brief: PayrollWeekBrief; checkpoint: BriefCheckpoint; complete: boolean }> {
  const sourceHash = sources.sourceHash;
  const blocks = sourceBlocks(sources);
  if (!blocks.length) {
    return { brief: emptyBrief(sources.week, sourceHash), checkpoint: { sourceHash, nextBatch: 0, drafts: [], phase: "done" }, complete: true };
  }
  const batches = sourceBatches(blocks);
  const state: BriefCheckpoint = checkpoint && checkpoint.sourceHash === sourceHash && checkpoint.phase !== "done"
    ? { ...checkpoint, drafts: [...checkpoint.drafts] }
    : { sourceHash, nextBatch: 0, drafts: [], phase: "batches" };
  if (state.phase === "combine" || state.nextBatch >= batches.length) {
    return { brief: combineDrafts(sources.week, sourceHash, state.drafts), checkpoint: { ...state, phase: "done" }, complete: true };
  }
  if (signal?.aborted) return { brief: failedBrief(sources.week, sourceHash, "Brief generation was cancelled."), checkpoint: state, complete: false };
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { brief: failedBrief(sources.week, sourceHash, "OPENROUTER_API_KEY is not configured."), checkpoint: state, complete: false };
  const sourceText = batches[state.nextBatch].map((block) => block.text).join("\n\n");
  const timeout = AbortSignal.timeout(AI_TIMEOUTS.payrollBrief);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: combined,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(policy.textModel, {
        max_tokens: AI_TOKEN_BUDGETS.payrollBrief,
        reasoning: { effort: policy.effort },
        messages: [
          {
            role: "system",
            content: [
              "Write a concise progress brief for an administrator using only the supplied recap and recorded-outcome sources.",
              "Do not state or imply hours, minutes, pay, productivity, attendance, or completed work unless an outcome source explicitly records it.",
              "Never invent a source, person, date, task or completion.",
              "Every summary, theme and open item must cite at least one supplied source with its exact id and revision.",
              "Use at most five themes, four open items and four gaps. Keep the summary to two or three sentences.",
            ].join("\n"),
          },
          { role: "user", content: `Week ${sources.week} (${sources.from} through ${sources.through}). Sources:\n\n${sourceText}` },
        ],
        tools: [briefTool()],
        tool_choice: { type: "function", function: { name: "recordWeekBrief" } },
      })),
    });
  } catch (error) {
    return { brief: failedBrief(sources.week, sourceHash, error instanceof Error ? error.message : "Brief model failed."), checkpoint: state, complete: false };
  }
  if (!response.ok) return { brief: failedBrief(sources.week, sourceHash, `Brief model returned HTTP ${response.status}.`), checkpoint: state, complete: false };
  let json: Record<string, unknown>;
  try { json = await response.json() as Record<string, unknown>; }
  catch { return { brief: failedBrief(sources.week, sourceHash, "Brief model response was not JSON."), checkpoint: state, complete: false }; }
  recordAiUsage("payroll_week_brief", policy.textModel, json);
  const choices = Array.isArray(json.choices) ? json.choices as Array<Record<string, unknown>> : [];
  if (String(choices[0]?.finish_reason ?? "") === "length") return { brief: failedBrief(sources.week, sourceHash, "Brief model response was truncated."), checkpoint: state, complete: false };
  const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
  const fn = (calls[0]?.function ?? {}) as Record<string, unknown>;
  const args = typeof fn.arguments === "string" ? fn.arguments : null;
  if (!args) return { brief: failedBrief(sources.week, sourceHash, "Brief model returned no structured arguments."), checkpoint: state, complete: false };
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(args) as Record<string, unknown>; }
  catch { return { brief: failedBrief(sources.week, sourceHash, "Brief model arguments were malformed."), checkpoint: state, complete: false }; }
  const draft = parseDraft(sources.week, sourceHash, parsed, sources);
  if (!draft) return { brief: failedBrief(sources.week, sourceHash, "Brief model output was not grounded in the supplied sources."), checkpoint: state, complete: false };
  const drafts = [...state.drafts, draft];
  const nextBatch = state.nextBatch + 1;
  const next: BriefCheckpoint = { sourceHash, nextBatch, drafts, phase: nextBatch >= batches.length ? "combine" : "batches" };
  if (nextBatch >= batches.length) return { brief: combineDrafts(sources.week, sourceHash, drafts), checkpoint: { ...next, phase: "done" }, complete: true };
  return { brief: draft, checkpoint: next, complete: false };
}

export { PROMPT_VERSION as PAYROLL_BRIEF_PROMPT_VERSION };
