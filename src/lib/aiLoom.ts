import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, LOOM_MODEL, recordAiUsage } from "@/lib/work-os-ai-model";
import { formatReportDate } from "@/lib/work-os-eod-facts";
import {
  LOOM_TRANSCRIPT_MAX_AI,
  LOOM_TRANSCRIPT_MAX_STORED,
  collectLoomBundle,
  findLoomReference,
  formatLoomDuration,
  loomUsableForDay,
  normalizeLoomTranscript,
  type LoomBundle,
} from "@/lib/work-os-loom";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const LOOM_ANALYSIS_TIMEOUT_MS = AI_TIMEOUTS.loom;

export interface LoomSuggestedTask {
  title: string;
  description: string | null;
  subtasks: string[];
}

export interface LoomAnalysis {
  summary: string;
  suggestedTasks: LoomSuggestedTask[];
  cautions: string[];
}

export type LoomAnalysisFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed" | "transcript_required";

export interface LoomAnalysisResult {
  ok: boolean;
  analysis?: LoomAnalysis;
  model?: string;
  reason?: LoomAnalysisFailure;
  detail?: string;
}

const LOOM_ANALYSIS_SCHEMA = {
  name: "work_os_loom_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "suggestedTasks", "cautions"],
    properties: {
      summary: { type: "string" },
      suggestedTasks: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "subtasks"],
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
            subtasks: { type: "array", items: { type: "string" }, maxItems: 8 },
          },
        },
      },
      cautions: { type: "array", items: { type: "string" }, maxItems: 6 },
    },
  },
} as const;

/** The facts the analyzer needs. A transcript pasted without a link has no
 * recording reference or public metadata, but the rest of the bundle shape is
 * the same, so both paths share one analysis prompt. */
export interface LoomAnalysisSource {
  reference?: LoomBundle["reference"] | null;
  metadata: LoomBundle["metadata"];
  temporal: LoomBundle["temporal"];
  transcript: LoomBundle["transcript"];
}

function loomFacts(bundle: LoomAnalysisSource) {
  const link = bundle.reference?.url ?? null;
  const lines = [
    `Recording: ${bundle.metadata?.title ?? "Untitled"}`,
    formatLoomDuration(bundle.metadata?.durationSeconds) ? `Length: ${formatLoomDuration(bundle.metadata?.durationSeconds)}` : null,
    `Link: ${link ?? "not provided (pasted transcript)"}`,
    `Recording date: ${bundle.temporal.createdLocalDate ?? (link ? "not exposed by Loom" : "unverified (no link provided)")}`,
    `Target day: ${bundle.temporal.targetDate} (${bundle.temporal.verdict.replaceAll("_", " ")})`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Reads one recording transcript into a neutral summary plus the work it
 * still describes as outstanding. Suggestions are inputs for the calling
 * agent's reconciliation, never filed directly. */
export async function analyzeLoomNarrative(
  bundle: LoomAnalysisSource,
  context?: { existingTaskTitles?: string[] },
): Promise<LoomAnalysisResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "AI analysis is not configured on this server" };
  const transcript = bundle.transcript.text?.slice(0, LOOM_TRANSCRIPT_MAX_AI) ?? "";
  if (!transcript) return { ok: false, reason: "transcript_required", detail: "A transcript is required to analyze the recording" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(LOOM_MODEL, {
        messages: [
          {
            role: "system",
            content: [
              "You analyze one employee Loom recording for Work OS.",
              "Report only what the recording states. Never invent work, completion, identifiers, or dates.",
              "suggestedTasks are candidate follow-up tasks the recording still describes as outstanding; an existing task list may be provided and anything already covered there must be omitted.",
              "Each suggested task gets a short imperative title and optional subtasks that are concrete steps, not restatements.",
              "cautions carry anything an agent must not assume (unclear ownership, missing completion evidence, recording date unverified).",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              recording: loomFacts(bundle),
              transcript,
              ...(context?.existingTaskTitles?.length ? { existingTasks: context.existingTaskTitles.slice(0, 60) } : {}),
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: AI_TOKEN_BUDGETS.loom,
        response_format: { type: "json_schema", json_schema: LOOM_ANALYSIS_SCHEMA },
      })),
      signal: AbortSignal.timeout(LOOM_ANALYSIS_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    recordAiUsage("loom", LOOM_MODEL, payload);
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, reason: "ai_malformed", detail: "no analysis JSON" };
    const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 800) : "";
    if (!summary) return { ok: false, reason: "ai_malformed", detail: "empty analysis summary" };
    const suggestedTasks: LoomSuggestedTask[] = (Array.isArray(raw.suggestedTasks) ? raw.suggestedTasks : []).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const title = typeof value.title === "string" ? value.title.trim().slice(0, 200) : "";
      if (!title) return [];
      return [{
        title,
        description: typeof value.description === "string" && value.description.trim() ? value.description.trim().slice(0, 600) : null,
        subtasks: (Array.isArray(value.subtasks) ? value.subtasks : []).flatMap((subtask) => typeof subtask === "string" && subtask.trim() ? [subtask.trim().slice(0, 200)] : []).slice(0, 8),
      }];
    }).slice(0, 12);
    const cautions = (Array.isArray(raw.cautions) ? raw.cautions : []).flatMap((caution) => typeof caution === "string" && caution.trim() ? [caution.trim().slice(0, 300)] : []).slice(0, 6);
    return { ok: true, analysis: { summary, suggestedTasks, cautions }, model: LOOM_MODEL };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "ai_malformed", detail: "invalid analysis JSON" };
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}

export interface LoomAgentFeed {
  bundle: LoomBundle | null;
  analysis: LoomAnalysis | null;
  /** True when the recording's own date forbids using it for the target day. */
  blocked: boolean;
  /** Why analysis is missing (invalid link, prior day, transcript absent, AI down). */
  reason: "invalid_link" | "prior_day" | "future" | "transcript_required" | LoomAnalysisFailure | null;
}

/** One call for agent surfaces: collect the recording (its own transcript
 * included), enforce the day rule, and analyze the transcript when usable. */
export async function analyzeLoomForAgent(input: {
  url: string;
  transcript?: string | null;
  /** Prose written beside the link; a fallback, not a replacement. */
  updateText?: string | null;
  targetDate: string;
  timezone: string;
  existingTaskTitles?: string[];
}): Promise<LoomAgentFeed> {
  const bundle = await collectLoomBundle(input);
  if (!bundle) return { bundle: null, analysis: null, blocked: false, reason: "invalid_link" };
  if (!loomUsableForDay(bundle.temporal)) {
    return { bundle, analysis: null, blocked: true, reason: bundle.temporal.verdict === "future" ? "future" : "prior_day" };
  }
  if (!bundle.transcript.present) return { bundle, analysis: null, blocked: false, reason: "transcript_required" };
  const result = await analyzeLoomNarrative(bundle, { existingTaskTitles: input.existingTaskTitles });
  if (!result.ok || !result.analysis) {
    return { bundle, analysis: null, blocked: false, reason: result.reason ?? "ai_unavailable" };
  }
  return { bundle, analysis: result.analysis, blocked: false, reason: null };
}

/** Human-readable line describing the recording for prompts and receipts. */
export function loomFeedLine(bundle: LoomAnalysisSource) {
  const length = formatLoomDuration(bundle.metadata?.durationSeconds);
  const recorded = bundle.temporal.createdLocalDate ? `recorded ${formatReportDate(bundle.temporal.createdLocalDate)}` : "recorded on an unverified date";
  const source = bundle.reference?.url ? ` — ${bundle.reference.url}` : " — pasted transcript (no link)";
  return `${bundle.metadata?.title ?? "Loom recording"}${length ? ` (${length})` : ""}${source} · ${recorded} · ${bundle.temporal.verdict.replaceAll("_", " ")} for ${formatReportDate(bundle.temporal.targetDate)}`;
}

/** Everything written beside the link that is not the link itself: an
 * employee-pasted transcript when that is what it is, otherwise the update
 * sentence that must not stand in for the recording's own transcript. The
 * bundle uses it only when no better transcript exists. */
function transcriptFromUpdateText(text: string, videoId: string) {
  return text
    .replace(/https:\/\/[^\s<>"']+/gi, " ")
    .replace(new RegExp(videoId, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LOOM_TRANSCRIPT_MAX_STORED);
}

/** One call for the chat/plan agents: when the update references a Loom, run
 * the analyze tool and shape its output for the interpretation prompt. */
export async function buildLoomAttachment(input: {
  text: string;
  /** The employee's own transcript paste; it wins over Loom's auto-read copy. */
  transcript?: string | null;
  targetDate: string;
  timezone: string;
  existingTaskTitles?: string[];
}): Promise<{
  attachment: NonNullable<import("./aiInterpret").InterpretContext["loom"]>;
  bundle: LoomBundle;
  analysis: LoomAnalysis | null;
} | null> {
  const reference = findLoomReference(input.text);
  if (!reference) return null;
  const feed = await analyzeLoomForAgent({
    url: reference.url,
    transcript: input.transcript,
    updateText: transcriptFromUpdateText(input.text, reference.videoId),
    targetDate: input.targetDate,
    timezone: input.timezone,
    existingTaskTitles: input.existingTaskTitles,
  });
  if (!feed.bundle) return null;
  return {
    bundle: feed.bundle,
    analysis: feed.analysis,
    attachment: {
      verdict: feed.bundle.temporal.verdict,
      createdAt: feed.bundle.temporal.createdAt,
      createdLocalDate: feed.bundle.temporal.createdLocalDate,
      targetDate: feed.bundle.temporal.targetDate,
      line: loomFeedLine(feed.bundle),
      summary: feed.analysis?.summary ?? null,
      suggestedTasks: feed.analysis?.suggestedTasks ?? [],
      cautions: [
        ...(feed.analysis?.cautions ?? []),
        ...(feed.reason === "transcript_required" ? ["No transcript was available for this recording; do not infer work from its metadata."] : []),
      ],
      transcriptChars: feed.bundle.transcript.chars,
      transcriptSource: feed.bundle.transcript.source,
      blocked: feed.blocked,
    },
  };
}

/** A transcript pasted without a link is still a Loom source: it is the
 * employee's own copy of the recording's words. Its date, title, and length
 * cannot be verified, so no day verdict is claimed; the analyzer reads the same
 * transcript and the cautions say exactly what is unknown. */
export async function buildPastedLoomAttachment(input: {
  transcript: string;
  targetDate: string;
  existingTaskTitles?: string[];
}): Promise<{
  attachment: NonNullable<import("./aiInterpret").InterpretContext["loom"]>;
  analysis: LoomAnalysis | null;
} | null> {
  const text = normalizeLoomTranscript(input.transcript);
  if (!text) return null;
  const result = await analyzeLoomNarrative({
    reference: null,
    metadata: null,
    temporal: { verdict: "unknown", createdAt: null, createdLocalDate: null, targetDate: input.targetDate, timezone: "" },
    transcript: { present: true, chars: text.length, source: "employee_paste", text },
  }, { existingTaskTitles: input.existingTaskTitles });
  return {
    analysis: result.analysis ?? null,
    attachment: {
      verdict: "unknown",
      createdAt: null,
      createdLocalDate: null,
      targetDate: input.targetDate,
      line: "Loom transcript pasted by the employee — no recording link, so the recording date is unverified",
      summary: result.analysis?.summary ?? null,
      suggestedTasks: result.analysis?.suggestedTasks ?? [],
      cautions: [
        ...(result.analysis?.cautions ?? []),
        "No recording link was provided: the recording date, title, and length are unverified. Use only the transcript's words.",
        ...(result.ok ? [] : ["The transcript could not be analyzed; do not infer work from it."]),
      ],
      transcriptChars: text.length,
      transcriptSource: "employee_paste",
      blocked: false,
    },
  };
}
