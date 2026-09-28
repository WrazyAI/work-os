import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { WorkOsConflictError } from "@/lib/work-os-api";
import { dateOnly } from "@/lib/work-os-internal";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { getWorkday } from "@/lib/work-os-workday";
import {
  personTimezone,
  prepareScreenshotWindow,
  retainedScreenshotImage,
  type ScreenshotWindowCandidate,
  type ScreenshotWindowPreparation,
} from "@/lib/work-os-screenshots";
import { localDateForTimezone, localDayBounds } from "@/modules/work-os/companion";

type Json = Record<string, unknown>;

export const ACTIVITY_INTERVAL_PROMPT_VERSION = "work-os-activity-interval-v1";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MAX_DETAIL_CHARS = 4_000;
const MAX_FEEDBACK_CHARS = 4_000;
const MODEL = process.env.WORK_OS_ACTIVITY_INTERVAL_MODEL
  || process.env.WORK_OS_SCREENSHOT_MODEL
  || process.env.WORK_OS_INTERPRET_MODEL
  || "gpt-5.6-luna";

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export type ActivityIntervalConfig = {
  enabled: boolean;
  maxMinutes: number;
  maxFrames: number;
  maxRawFrames: number;
  maxPerDay: number;
  model: string;
  promptVersion: string;
};

/** Bounded, deployment-overridable configuration. Invalid values fall back so a
 * bad environment value can never create an unbounded model or vision spend. */
export function activityIntervalConfig(env: NodeJS.ProcessEnv = process.env): ActivityIntervalConfig {
  const enabled = !["0", "false", "off"].includes(String(env.WORK_OS_ACTIVITY_INTERVALS_ENABLED ?? "1").trim().toLowerCase());
  return {
    enabled,
    maxMinutes: clampInt(env.WORK_OS_ACTIVITY_INTERVAL_MAX_MINUTES, 120, 30, 240),
    maxFrames: clampInt(env.WORK_OS_ACTIVITY_INTERVAL_MAX_FRAMES, 12, 1, 24),
    maxRawFrames: clampInt(env.WORK_OS_ACTIVITY_INTERVAL_MAX_RAW_FRAMES, 5, 0, 12),
    maxPerDay: clampInt(env.WORK_OS_ACTIVITY_INTERVAL_MAX_PER_DAY, 10, 1, 24),
    model: MODEL,
    promptVersion: ACTIVITY_INTERVAL_PROMPT_VERSION,
  };
}

function db() {
  return createAdminClient();
}

/* ------------------------------------------------------------------ */
/* Pure interval identity, window resolution, sampling, and parsing   */
/* ------------------------------------------------------------------ */

/** Deterministic identity for one prompt slot: the same due prompt always maps
 * to the same row, so a retried ensure can never create a second recap. */
export function activityIntervalSlotKey(sessionId: string | null | undefined, promptDueAt: string): string {
  const due = new Date(promptDueAt);
  return `${sessionId ?? "no-session"}:${Number.isFinite(due.getTime()) ? due.toISOString() : promptDueAt}`;
}

export type IntervalWindowInput = {
  promptDueAt: string;
  clockedInAt?: string | null;
  lastSubstantiveUpdateAt?: string | null;
  planConfirmedAt?: string | null;
  previousWindowEnd?: string | null;
  dayStartIso: string;
  maxMinutes?: number;
};

/** Resolves the authoritative interval: ends at the due prompt, starts after
 * the previous recap, the employee's last substantive update, the plan-confirm
 * baseline, or the configured maximum — whichever is latest — and never before
 * the local workday started. */
export function resolveActivityIntervalWindow(input: IntervalWindowInput): { startIso: string; endIso: string } | null {
  const endMs = Date.parse(input.promptDueAt);
  if (!Number.isFinite(endMs)) return null;
  const maxMs = Math.max(1, Number(input.maxMinutes ?? 120)) * 60_000;
  const candidates = [endMs - maxMs, Date.parse(input.dayStartIso)];
  for (const value of [input.previousWindowEnd, input.lastSubstantiveUpdateAt, input.planConfirmedAt, input.clockedInAt]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    // A boundary at or after the due instant leaves no un-reviewed interval;
    // keeping it in the max makes the <60s guard return null.
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }
  const startMs = Math.max(...candidates);
  if (!Number.isFinite(startMs)) return null;
  if (endMs - startMs < 60_000) {
    // A prompt is not due within a minute of a substantive update in normal
    // cadence; if it somehow is, there is no interval worth reviewing.
    return null;
  }
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export type IntervalEvidenceEntry = {
  candidate: ScreenshotWindowCandidate;
  ordinal: number;
  selectionReason: string;
  rawImageShown: boolean;
};

export type IntervalEvidenceSelection = {
  selected: IntervalEvidenceEntry[];
  rawCount: number;
};

/** Deterministic, bounded evidence sampling. Keeps the first and last usable
 * frames, app/context transitions, and evenly spread coverage, so a recap
 * cannot be built from twelve near-identical frames of one editor. */
export function selectIntervalEvidence(
  candidates: ScreenshotWindowCandidate[],
  options: { maxFrames?: number; maxRawFrames?: number } = {},
): IntervalEvidenceSelection {
  const maxFrames = Math.max(1, Math.min(24, Math.floor(options.maxFrames ?? 12)));
  const maxRawFrames = Math.max(0, Math.min(12, Math.floor(options.maxRawFrames ?? 5)));
  const sorted = [...candidates].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (!sorted.length) return { selected: [], rawCount: 0 };

  const priority: Array<{ index: number; reason: string }> = [];
  const seen = new Set<number>();
  const add = (index: number, reason: string) => {
    if (index < 0 || index >= sorted.length || seen.has(index)) return;
    seen.add(index);
    priority.push({ index, reason });
  };
  add(0, "first");
  add(sorted.length - 1, "last");
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]?.visibleApp ?? null;
    const current = sorted[index]?.visibleApp ?? null;
    if (current !== previous) add(index, "app_transition");
  }
  if (priority.length < maxFrames) {
    const remaining = sorted.map((_, index) => index).filter((index) => !seen.has(index));
    const slots = maxFrames - priority.length;
    if (remaining.length <= slots) {
      for (const index of remaining) add(index, "distribution");
    } else {
      const step = remaining.length / slots;
      for (let slot = 0; slot < slots; slot += 1) add(remaining[Math.min(remaining.length - 1, Math.floor(slot * step))], "distribution");
    }
  }

  const chosen = priority
    .sort((left, right) => left.index - right.index)
    .slice(0, maxFrames)
    .map((entry, ordinal) => ({
      candidate: sorted[entry.index],
      ordinal,
      selectionReason: entry.reason,
      rawImageShown: false,
    }));

  // Representative raw images: edges, app transitions, then the least
  // confident retained frames, then even spread — never more than the cap.
  if (maxRawFrames > 0) {
    const retained = chosen.map((entry, position) => ({ entry, position })).filter(({ entry }) => entry.candidate.retained);
    const rawPriority: number[] = [];
    const rawSeen = new Set<number>();
    const addRaw = (position: number) => {
      if (position < 0 || position >= chosen.length || rawSeen.has(position) || !chosen[position].candidate.retained) return;
      rawSeen.add(position);
      rawPriority.push(position);
    };
    addRaw(0);
    addRaw(chosen.length - 1);
    for (let position = 1; position < chosen.length; position += 1) {
      if ((chosen[position].candidate.visibleApp ?? null) !== (chosen[position - 1].candidate.visibleApp ?? null)) addRaw(position);
    }
    const byConfidence = [...retained].sort((left, right) => left.entry.candidate.confidence - right.entry.candidate.confidence);
    for (const { position } of byConfidence) addRaw(position);
    for (let position = 0; position < chosen.length; position += 1) addRaw(position);
    for (const position of rawPriority.slice(0, maxRawFrames)) {
      chosen[position].rawImageShown = true;
      chosen[position].selectionReason = `${chosen[position].selectionReason}+raw`;
    }
  }

  return { selected: chosen, rawCount: chosen.filter((entry) => entry.rawImageShown).length };
}

/** Cache identity: exactly the selected evidence plus the prompt/model that
 * consumed it, so any change to frames, summaries, or prompts re-synthesizes. */
export function intervalSourceHash(selected: IntervalEvidenceEntry[], model: string, promptVersion: string) {
  return createHash("sha256").update(JSON.stringify({
    model,
    promptVersion,
    evidence: selected.map((entry) => ({
      id: entry.candidate.externalId,
      at: entry.candidate.capturedAt,
      summary: entry.candidate.summary,
      app: entry.candidate.visibleApp,
    })),
  })).digest("hex");
}

export type IntervalSynthesis = {
  headline: string;
  detail: string;
  activities: Array<{ description: string; evidenceIndexes: number[]; possibleTaskReference: string | null; confidence: number }>;
  workflow: Array<{ phase: string; evidenceIndexes: number[] }>;
  uncertainties: string[];
  apps: string[];
  coverage: { firstObservedAt: string | null; lastObservedAt: string | null; analyzedFrames: number; rawFramesShownToModel: number };
};

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanIndexes(value: unknown, maxIndex: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => Math.floor(Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= maxIndex))];
}

/** Validates the model's structured output. Malformed output fails synthesis
 * rather than persisting fabricated prose. */
export function parseIntervalSynthesis(raw: unknown, maxIndex: number): IntervalSynthesis {
  const input = (raw ?? {}) as Json;
  const headline = cleanText(input.headline, 160);
  const detail = cleanText(input.detail, MAX_DETAIL_CHARS);
  if (!headline || !detail) throw new Error("activity interval synthesis returned no headline or detail");
  const activities = Array.isArray(input.activities) ? input.activities : [];
  const workflow = Array.isArray(input.workflow) ? input.workflow : [];
  const uncertainties = Array.isArray(input.uncertainties) ? input.uncertainties : [];
  const apps = Array.isArray(input.apps) ? input.apps : [];
  const coverage = (input.coverage ?? {}) as Json;
  return {
    headline,
    detail,
    activities: activities.slice(0, 12).map((entry: any) => ({
      description: cleanText(entry?.description, 300),
      evidenceIndexes: cleanIndexes(entry?.evidence_indexes ?? entry?.evidenceIndexes, maxIndex),
      possibleTaskReference: entry?.possible_task_reference || entry?.possibleTaskReference ? cleanText(entry?.possible_task_reference ?? entry?.possibleTaskReference, 160) : null,
      confidence: Math.max(0, Math.min(1, Number(entry?.confidence) || 0)),
    })).filter((entry) => entry.description),
    workflow: workflow.slice(0, 8).map((entry: any) => ({
      phase: cleanText(entry?.phase, 120),
      evidenceIndexes: cleanIndexes(entry?.evidence_indexes ?? entry?.evidenceIndexes, maxIndex),
    })).filter((entry) => entry.phase),
    uncertainties: uncertainties.slice(0, 6).map((entry: unknown) => cleanText(entry, 240)).filter(Boolean),
    apps: apps.slice(0, 12).map((entry: unknown) => cleanText(entry, 80)).filter(Boolean),
    coverage: {
      firstObservedAt: cleanText(coverage.first_observed_at ?? coverage.firstObservedAt, 40) || null,
      lastObservedAt: cleanText(coverage.last_observed_at ?? coverage.lastObservedAt, 40) || null,
      analyzedFrames: Math.max(0, Math.floor(Number(coverage.analyzed_frames ?? coverage.analyzedFrames) || 0)),
      rawFramesShownToModel: Math.max(0, Math.floor(Number(coverage.raw_frames_shown_to_model ?? coverage.rawFramesShownToModel) || 0)),
    },
  };
}

/** "2:17–3:17 PM" in plain 12-hour language; both meridiems appear only when
 * the range crosses noon or midnight. Never a timezone or offset. */
export function formatIntervalRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "—";
  const parts = (date: Date) => {
    try {
      const formatted = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
      const hour = formatted.find((part) => part.type === "hour")?.value ?? "";
      const minute = formatted.find((part) => part.type === "minute")?.value ?? "";
      const dayPeriod = formatted.find((part) => part.type === "dayPeriod")?.value ?? "";
      return { hour, minute: minute === "00" ? "" : minute, dayPeriod };
    } catch {
      return { hour: String(date.getUTCHours()), minute: "", dayPeriod: "" };
    }
  };
  const from = parts(start);
  const to = parts(end);
  const label = (value: { hour: string; minute: string; dayPeriod: string }) => `${value.hour}${value.minute ? `:${value.minute}` : ""}`;
  return from.dayPeriod === to.dayPeriod
    ? `${label(from)}–${label(to)} ${to.dayPeriod}`.trim()
    : `${label(from)} ${from.dayPeriod}–${label(to)} ${to.dayPeriod}`.trim();
}

/* ------------------------------------------------------------------ */
/* Model synthesis                                                     */
/* ------------------------------------------------------------------ */

export type IntervalSynthesisObservation = {
  index: number;
  at: string;
  app: string | null;
  summary: string;
  workContext: string | null;
  possibleTaskReference: string | null;
  confidence: number;
};

export type IntervalSynthesisImage = { index: number; at: string; app: string | null; dataUrl: string };

function intervalTool() {
  return {
    type: "function",
    function: {
      name: "recordActivityInterval",
      description: "Record an evidence-bounded recap of one work interval from the analyzed screenshots and their observations.",
      parameters: {
        type: "object",
        properties: {
          headline: { type: "string", description: "One short, concrete sentence naming the main work focus of the interval." },
          detail: { type: "string", description: "Two to five factual sentences describing the work observed across the interval, in temporal order. Describe only what the evidence supports; state uncertainty where evidence is incomplete." },
          activities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                evidence_indexes: { type: "array", items: { type: "integer" }, description: "1-based indexes of the observations that support this activity." },
                possible_task_reference: { type: ["string", "null"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["description", "evidence_indexes", "possible_task_reference", "confidence"],
              additionalProperties: false,
            },
          },
          workflow: {
            type: "array",
            description: "Ordered phases only when the ordered evidence supports the sequence, for example implementation then verification then UI inspection.",
            items: {
              type: "object",
              properties: {
                phase: { type: "string" },
                evidence_indexes: { type: "array", items: { type: "integer" } },
              },
              required: ["phase", "evidence_indexes"],
              additionalProperties: false,
            },
          },
          uncertainties: { type: "array", items: { type: "string" }, description: "What the evidence does not establish (for example whether a change was pushed or a task completed)." },
          apps: { type: "array", items: { type: "string" } },
          coverage: {
            type: "object",
            properties: {
              first_observed_at: { type: ["string", "null"] },
              last_observed_at: { type: ["string", "null"] },
              analyzed_frames: { type: "integer" },
              raw_frames_shown_to_model: { type: "integer" },
            },
            required: ["first_observed_at", "last_observed_at", "analyzed_frames", "raw_frames_shown_to_model"],
            additionalProperties: false,
          },
        },
        required: ["headline", "detail", "activities", "workflow", "uncertainties", "apps", "coverage"],
        additionalProperties: false,
      },
    },
  };
}

const INTERVAL_SYSTEM_PROMPT = [
  "You produce an evidence-bounded recap of one work interval for the employee who was working.",
  "Describe only what the screenshot observations and images visibly support. Distinguish observation from inference.",
  "Never claim productivity, effort level, honesty, attendance quality, pay eligibility, or performance.",
  "Never claim a task was completed, shipped, merged, deployed, or fixed from screenshots alone.",
  "Never infer private identity or reproduce credentials, message contents, personal data, or customer details.",
  "Use uncertainty language when evidence is incomplete, and do not pad the recap when the interval contains little information.",
  "The recap is useful to a manager later, so be concrete about apps, tools, artifacts, and the apparent work context.",
].join("\n");

export function intervalSynthesisMessages(input: {
  windowLabel: string;
  observations: IntervalSynthesisObservation[];
  images: IntervalSynthesisImage[];
  counts: ScreenshotWindowPreparation["counts"];
}) {
  const observationText = input.observations.map((observation) =>
    `${observation.index}. ${observation.at} — app=${observation.app ?? "unknown"} — ${observation.summary}` +
    `${observation.workContext ? ` — context: ${observation.workContext}` : ""}` +
    `${observation.possibleTaskReference ? ` — possible task: ${observation.possibleTaskReference}` : ""}` +
    ` (confidence ${observation.confidence.toFixed(2)})`,
  ).join("\n");
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      `Interval: ${input.windowLabel}.`,
      `Frames recorded: ${input.counts.providerFrames}; analyzed: ${input.counts.processed}; excluded by policy: ${input.counts.excludedPolicy}; excluded as sensitive: ${input.counts.excludedSensitive}; unavailable: ${input.counts.unavailable}; still pending: ${input.counts.pending}.`,
      "Neutral observations (1-based indexes):",
      observationText || "(none)",
    ].join("\n"),
  }];
  for (const image of input.images) {
    content.push({ type: "text", text: `Frame ${image.index} — ${image.at} — app=${image.app ?? "unknown"}:` });
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return [
    { role: "system", content: INTERVAL_SYSTEM_PROMPT },
    { role: "user", content },
  ];
}

async function synthesizeInterval(input: {
  windowLabel: string;
  observations: IntervalSynthesisObservation[];
  images: IntervalSynthesisImage[];
  counts: ScreenshotWindowPreparation["counts"];
  model: string;
  timeoutMs: number;
}): Promise<IntervalSynthesis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for activity interval synthesis");
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(input.timeoutMs),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: intervalSynthesisMessages(input),
      tools: [intervalTool()],
      tool_choice: { type: "function", function: { name: "recordActivityInterval" } },
      temperature: 0.2,
      max_tokens: 1_400,
    }),
  });
  if (!response.ok) throw new Error(`activity interval AI failed (${response.status}): ${(await response.text()).slice(0, 160)}`);
  const json = await response.json() as Json;
  const choices = json.choices as Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> | undefined;
  const args = choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("activity interval AI returned no structured recap");
  return parseIntervalSynthesis(JSON.parse(args), input.observations.length);
}

/* ------------------------------------------------------------------ */
/* Persistence and orchestration                                       */
/* ------------------------------------------------------------------ */

export type ActivityIntervalRecord = Record<string, any>;

const ensureInFlight = new Map<string, Promise<{ status: string; interval?: ActivityIntervalRecord; reason?: string }>>();

function selectable(access: WorkOsAccess) {
  const config = activityIntervalConfig();
  if (!config.enabled) return { ok: false as const, reason: "feature_disabled" };
  if (access.featureFlags.screenshot_summaries !== true) return { ok: false as const, reason: "screenshot_summaries_disabled" };
  if (access.featureFlags.activity_intervals === false) return { ok: false as const, reason: "activity_intervals_disabled" };
  if (!access.personId) return { ok: false as const, reason: "person_required" };
  return { ok: true as const, config };
}

async function loadIntervalBySlot(organizationId: string, personId: string, slotKey: string) {
  const { data, error } = await db().from("work_activity_intervals").select("*")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("slot_key", slotKey).maybeSingle();
  if (error) throw new Error(`load activity interval: ${error.message}`);
  return data as ActivityIntervalRecord | null;
}

async function auditInterval(access: WorkOsAccess, action: string, intervalId: string, metadata: Json) {
  await db().from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action,
    target_type: "activity_interval",
    target_id: intervalId,
    metadata,
  }).then(() => undefined, () => undefined);
}

async function markIntervalUnavailable(row: ActivityIntervalRecord, reason: string, coverage: Json) {
  const { data, error } = await db().from("work_activity_intervals").update({
    generation_status: "unavailable",
    failure_reason: reason,
    coverage,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).select("*").single();
  if (error) throw new Error(`mark activity interval unavailable: ${error.message}`);
  return data as ActivityIntervalRecord;
}

async function persistEvidence(intervalId: string, organizationId: string, selected: IntervalEvidenceEntry[]) {
  const { error: deleteError } = await db().from("work_activity_interval_evidence").delete().eq("interval_id", intervalId);
  if (deleteError) throw new Error(`replace activity interval evidence: ${deleteError.message}`);
  if (!selected.length) return;
  const { error } = await db().from("work_activity_interval_evidence").insert(selected.map((entry) => ({
    interval_id: intervalId,
    organization_id: organizationId,
    screenshot_summary_id: entry.candidate.summaryId,
    evidence_event_id: entry.candidate.evidenceEventId,
    captured_at: entry.candidate.capturedAt,
    ordinal: entry.ordinal,
    used_in_model: true,
    raw_image_shown: entry.rawImageShown,
    selection_reason: entry.selectionReason,
    visible_app_snapshot: entry.candidate.visibleApp?.slice(0, 160) ?? null,
    frame_summary_snapshot: entry.candidate.summary.slice(0, 500) ?? null,
  })));
  if (error) throw new Error(`save activity interval evidence: ${error.message}`);
}

/** Ensures the recap for one authoritative prompt slot. Idempotent per slot,
 * coalesces concurrent calls, never touches employee check-ins or the
 * substantive-update cadence, and never rewrites a reviewed recap. */
export async function ensureActivityInterval(access: WorkOsAccess, input: { promptDueAt?: string; at?: Date } = {}) {
  const gate = selectable(access);
  if (!gate.ok) return { status: "unavailable" as const, reason: gate.reason };
  const { config } = gate;
  const personId = access.personId as string;
  const at = input.at ?? new Date();

  const consent = await employeeTrackingConsent(access.organizationId, personId);
  if (!consent.tracking || !consent.screenshotAnalysis) return { status: "unavailable" as const, reason: "consent_required" };

  const workday = await getWorkday(access, at);
  const prompt = workday.prompt;
  const session = workday.session;
  if (!session || !["follow_up", "hourly_fallback"].includes(String(prompt.kind)) || !prompt.nextPromptAt) {
    return { status: "no_prompt" as const, reason: "no_activity_prompt_due" };
  }
  const dueMs = Date.parse(prompt.nextPromptAt);
  const requestedMs = input.promptDueAt ? Date.parse(input.promptDueAt) : Number.NaN;
  // The server's recomputed due time is authoritative; the client value is only
  // accepted as a matching slot hint (within clock-skew tolerance).
  const promptDueAt = Number.isFinite(requestedMs) && Math.abs(requestedMs - dueMs) <= 90_000
    ? new Date(requestedMs).toISOString()
    : prompt.nextPromptAt;
  if (Date.parse(promptDueAt) > at.getTime() + 60_000) return { status: "no_prompt" as const, reason: "prompt_not_due" };

  const promptKind = String(prompt.kind) as "follow_up" | "hourly_fallback";
  const slotKey = activityIntervalSlotKey(String(session.id), promptDueAt);
  const existing = await loadIntervalBySlot(access.organizationId, personId, slotKey);
  if (existing && ["confirmed", "amended"].includes(String(existing.review_status))) {
    return { status: "ready" as const, interval: existing };
  }

  const coalesceKey = `${access.organizationId}:${personId}:${slotKey}`;
  const inFlight = ensureInFlight.get(coalesceKey);
  if (inFlight) return inFlight;

  const run = (async () => {
    const timezone = String(session.timezone ?? "UTC");
    const shiftDate = dateOnly(session.shift_date) ?? localDateForTimezone(at, timezone);
    const dayBounds = localDayBounds(shiftDate, timezone);
    const previous = await db().from("work_activity_intervals").select("window_end")
      .eq("organization_id", access.organizationId).eq("person_id", personId)
      .eq("work_session_id", String(session.id))
      .neq("slot_key", slotKey)
      .order("window_end", { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw new Error(`load previous activity interval: ${previous.error.message}`);
    const window = resolveActivityIntervalWindow({
      promptDueAt,
      clockedInAt: session.clocked_in_at as string | null,
      lastSubstantiveUpdateAt: session.last_substantive_update_at as string | null,
      planConfirmedAt: workday.plan?.confirmed_at as string | null,
      previousWindowEnd: (previous.data?.window_end as string | null) ?? null,
      dayStartIso: dayBounds.startIso,
      maxMinutes: config.maxMinutes,
    });
    if (!window) return { status: "no_prompt" as const, reason: "no_reviewable_interval" };

    let row = existing;
    if (!row) {
      const dayCount = await db().from("work_activity_intervals").select("id", { count: "exact", head: true })
        .eq("organization_id", access.organizationId).eq("person_id", personId).eq("local_date", shiftDate);
      if (dayCount.error) throw new Error(`count activity intervals: ${dayCount.error.message}`);
      if ((dayCount.count ?? 0) >= config.maxPerDay) return { status: "unavailable" as const, reason: "daily_cap" };
      const inserted = await db().from("work_activity_intervals").insert({
        organization_id: access.organizationId,
        person_id: personId,
        work_session_id: String(session.id),
        local_date: shiftDate,
        slot_key: slotKey,
        prompt_kind: promptKind,
        prompt_due_at: promptDueAt,
        window_start: window.startIso,
        window_end: window.endIso,
        timezone,
        generation_status: "preparing",
      }).select("*").single();
      if (inserted.error) {
        if (!/duplicate|unique/i.test(inserted.error.message)) throw new Error(`create activity interval: ${inserted.error.message}`);
        row = await loadIntervalBySlot(access.organizationId, personId, slotKey);
      } else {
        row = inserted.data as ActivityIntervalRecord;
      }
      if (!row) return { status: "failed" as const, reason: "activity_interval_create_failed" };
    }
    if (["confirmed", "amended"].includes(String(row.review_status))) return { status: "ready" as const, interval: row };

    let preparation: ScreenshotWindowPreparation;
    try {
      preparation = await prepareScreenshotWindow({
        organizationId: access.organizationId,
        personId,
        windowStart: row.window_start as string,
        windowEnd: row.window_end as string,
        maxFrames: config.maxFrames,
        timezone,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "screenshot window preparation failed";
      const updated = await markIntervalUnavailable(row, reason, {});
      return { status: "unavailable" as const, reason, interval: updated };
    }

    const selection = selectIntervalEvidence(preparation.candidates, { maxFrames: config.maxFrames, maxRawFrames: config.maxRawFrames });
    if (!selection.selected.length) {
      const updated = await markIntervalUnavailable(row, "no_usable_frames", { ...preparation.counts, providerFrames: preparation.counts.providerFrames });
      return { status: "unavailable" as const, reason: "no_usable_frames", interval: updated };
    }
    const sourceHash = intervalSourceHash(selection.selected, config.model, config.promptVersion);
    if (String(row.generation_status) === "ready" && row.source_hash === sourceHash && row.ai_detail) {
      return { status: "ready" as const, interval: row };
    }

    const observations: IntervalSynthesisObservation[] = selection.selected.map((entry) => ({
      index: entry.ordinal + 1,
      at: entry.candidate.capturedAt,
      app: entry.candidate.visibleApp,
      summary: entry.candidate.summary,
      workContext: entry.candidate.workContext,
      possibleTaskReference: entry.candidate.possibleTaskReference,
      confidence: entry.candidate.confidence,
    }));
    const images: IntervalSynthesisImage[] = [];
    const loadedRaw = new Set<number>();
    for (const entry of selection.selected) {
      if (!entry.rawImageShown) continue;
      try {
        const image = await retainedScreenshotImage(entry.candidate.summaryId);
        if (!image) continue;
        loadedRaw.add(entry.ordinal);
        images.push({
          index: entry.ordinal + 1,
          at: entry.candidate.capturedAt,
          app: entry.candidate.visibleApp,
          dataUrl: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`,
        });
      } catch {
        // A missing representative image degrades to observations only; it
        // never blocks the recap.
      }
    }
    // Evidence rows must state the truth: a frame only counts as shown to the
    // model when its bytes actually loaded.
    for (const entry of selection.selected) entry.rawImageShown = loadedRaw.has(entry.ordinal);

    const windowLabel = formatIntervalRange(row.window_start as string, row.window_end as string, timezone);
    let synthesis: IntervalSynthesis;
    try {
      synthesis = await synthesizeInterval({
        windowLabel,
        observations,
        images,
        counts: preparation.counts,
        model: config.model,
        timeoutMs: clampInt(process.env.WORK_OS_ACTIVITY_INTERVAL_TIMEOUT_MS, 45_000, 5_000, 120_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "activity interval synthesis failed";
      const { data } = await db().from("work_activity_intervals").update({
        generation_status: "failed",
        failure_reason: reason.slice(0, 500),
        source_hash: sourceHash,
        model: config.model,
        prompt_version: config.promptVersion,
        coverage: { ...preparation.counts, rawImagesLoaded: images.length },
        updated_at: new Date().toISOString(),
      }).eq("id", row.id).select("*").single();
      await auditInterval(access, "activity_interval.failed", String(row.id), { reason: reason.slice(0, 200), slotKey });
      return { status: "failed" as const, reason, interval: (data as ActivityIntervalRecord | null) ?? row };
    }

    const coverage = {
      ...preparation.counts,
      rawImagesLoaded: images.length,
      modelCoverage: synthesis.coverage,
    };
    const { data: saved, error: saveError } = await db().from("work_activity_intervals").update({
      generation_status: "ready",
      headline: synthesis.headline,
      ai_detail: synthesis.detail,
      final_detail: synthesis.detail,
      structured_summary: synthesis as unknown as Json,
      coverage,
      source_hash: sourceHash,
      model: config.model,
      prompt_version: config.promptVersion,
      revision: String(row.generation_status) === "ready" ? Number(row.revision ?? 1) + 1 : 1,
      generated_at: new Date().toISOString(),
      failure_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("review_status", "inferred").select("*").single();
    if (saveError) throw new Error(`save activity interval: ${saveError.message}`);
    await persistEvidence(String(row.id), access.organizationId, selection.selected);
    await auditInterval(access, "activity_interval.generated", String(row.id), {
      slotKey,
      frames: preparation.counts.providerFrames,
      analyzed: preparation.counts.processed,
      selected: selection.selected.length,
      rawImages: images.length,
      revision: saved?.revision ?? 1,
    });
    return { status: "ready" as const, interval: saved as ActivityIntervalRecord };
  })().finally(() => ensureInFlight.delete(coalesceKey));
  ensureInFlight.set(coalesceKey, run);
  return run;
}

export async function markActivityIntervalNotified(access: WorkOsAccess, slotKey: string, at = new Date()) {
  if (!access.personId) return;
  await db().from("work_activity_intervals").update({ notified_at: at.toISOString(), updated_at: at.toISOString() })
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).eq("slot_key", slotKey).is("notified_at", null)
    .then(() => undefined, () => undefined);
}

export type ActivityIntervalEvidenceView = {
  summaryId: string | null;
  capturedAt: string;
  visibleApp: string | null;
  frameSummary: string | null;
  usedInModel: boolean;
  rawImageShown: boolean;
  selectionReason: string | null;
  retained: boolean;
};

export type ActivityIntervalView = {
  id: string;
  windowStart: string;
  windowEnd: string;
  label: string;
  promptKind: "follow_up" | "hourly_fallback";
  generationStatus: string;
  reviewStatus: "inferred" | "confirmed" | "amended";
  headline: string | null;
  detail: string | null;
  employeeFeedback: string | null;
  failureReason: string | null;
  generatedAt: string | null;
  reviewedAt: string | null;
  evidenceExpired: boolean;
  evidenceCount: number;
  evidence: ActivityIntervalEvidenceView[];
};

/** Compact card shape for the prompt turn and tool responses; the evidence
 * list for the Tasks stream comes from listActivityIntervals. */
export function activityIntervalCardView(row: ActivityIntervalRecord) {
  return {
    id: String(row.id),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    label: formatIntervalRange(String(row.window_start), String(row.window_end), String(row.timezone ?? "UTC")),
    promptKind: String(row.prompt_kind),
    generationStatus: String(row.generation_status),
    reviewStatus: String(row.review_status),
    headline: row.headline ? String(row.headline) : null,
    detail: row.final_detail ? String(row.final_detail) : row.ai_detail ? String(row.ai_detail) : null,
    employeeFeedback: row.employee_feedback ? String(row.employee_feedback) : null,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  };
}

function intervalView(row: ActivityIntervalRecord, evidence: ActivityIntervalEvidenceView[]): ActivityIntervalView {
  return {
    id: String(row.id),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    label: formatIntervalRange(String(row.window_start), String(row.window_end), String(row.timezone ?? "UTC")),
    promptKind: String(row.prompt_kind) as ActivityIntervalView["promptKind"],
    generationStatus: String(row.generation_status),
    reviewStatus: String(row.review_status) as ActivityIntervalView["reviewStatus"],
    headline: row.headline ? String(row.headline) : null,
    detail: row.final_detail ? String(row.final_detail) : row.ai_detail ? String(row.ai_detail) : null,
    employeeFeedback: row.employee_feedback ? String(row.employee_feedback) : null,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    evidenceExpired: Boolean(row.evidence_expired_at) || evidence.some((entry) => !entry.retained),
    evidenceCount: evidence.filter((entry) => entry.usedInModel).length,
    evidence,
  };
}

/** Employee's recent activity stream, newest interval first. Raw image bytes
 * and storage paths never appear in the payload. */
export async function listActivityIntervals(
  access: WorkOsAccess,
  options: { date?: string; days?: number } = {},
): Promise<{ date: string; intervals: ActivityIntervalView[] }> {
  if (!access.personId) throw new Error("Work OS person mapping required.");
  const timezone = await personTimezone(access.organizationId, access.personId);
  const date = options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : localDateForTimezone(new Date(), timezone);
  const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 1)));
  const from = new Date(`${date}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromDate = from.toISOString().slice(0, 10);
  const rows = await db().from("work_activity_intervals").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId)
    .gte("local_date", fromDate).lte("local_date", date)
    .order("window_end", { ascending: false }).limit(80);
  if (rows.error) throw new Error(`list activity intervals: ${rows.error.message}`);
  const intervals = (rows.data ?? []) as ActivityIntervalRecord[];
  if (!intervals.length) return { date, intervals: [] };
  const evidenceRows = await db().from("work_activity_interval_evidence")
    .select("interval_id,screenshot_summary_id,captured_at,ordinal,used_in_model,raw_image_shown,selection_reason,visible_app_snapshot,frame_summary_snapshot")
    .in("interval_id", intervals.map((row) => String(row.id)))
    .order("ordinal", { ascending: true });
  if (evidenceRows.error) throw new Error(`list activity interval evidence: ${evidenceRows.error.message}`);
  const summaryIds = [...new Set((evidenceRows.data ?? []).map((row: any) => row.screenshot_summary_id).filter(Boolean).map(String))];
  const retained = new Map<string, boolean>();
  if (summaryIds.length) {
    const summaries = await db().from("work_screenshot_summaries").select("id,storage_path,expires_at,deleted_at").in("id", summaryIds);
    if (summaries.error) throw new Error(`load activity interval screenshots: ${summaries.error.message}`);
    for (const summary of (summaries.data ?? []) as Array<Record<string, any>>) {
      const expires = summary.expires_at ? Date.parse(String(summary.expires_at)) : Number.NaN;
      retained.set(String(summary.id), Boolean(summary.storage_path) && !summary.deleted_at && Number.isFinite(expires) && expires > Date.now());
    }
  }
  const evidenceByInterval = new Map<string, ActivityIntervalEvidenceView[]>();
  for (const row of (evidenceRows.data ?? []) as Array<Record<string, any>>) {
    const list = evidenceByInterval.get(String(row.interval_id)) ?? [];
    const summaryId = row.screenshot_summary_id ? String(row.screenshot_summary_id) : null;
    list.push({
      summaryId,
      capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at ?? ""),
      visibleApp: row.visible_app_snapshot ? String(row.visible_app_snapshot) : null,
      frameSummary: row.frame_summary_snapshot ? String(row.frame_summary_snapshot) : null,
      usedInModel: row.used_in_model !== false,
      rawImageShown: row.raw_image_shown === true,
      selectionReason: row.selection_reason ? String(row.selection_reason) : null,
      retained: summaryId ? retained.get(summaryId) === true : false,
    });
    evidenceByInterval.set(String(row.interval_id), list);
  }
  return { date, intervals: intervals.map((row) => intervalView(row, evidenceByInterval.get(String(row.id)) ?? [])) };
}

/** Provenance prefix for every downstream consumer (EOD activity context and
 * future manager reporting). The recap never becomes employee-authored truth. */
export function intervalProvenanceLabel(status: string): string {
  if (status === "confirmed") return "employee confirmed";
  if (status === "amended") return "employee amended";
  return "AI-inferred, not reviewed";
}

export type ActivityIntervalActivityLine = {
  startIso: string;
  endIso: string;
  label: string;
  provenance: "inferred" | "confirmed" | "amended";
  detail: string;
  headline: string | null;
  /** Local hour starts the interval covers, so hourly rollups are not repeated. */
  hourStarts: number[];
};

function localHour(iso: string, timezone: string): number | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", hour: "numeric", hour12: false }).format(at);
    const hour = Number(formatted);
    return Number.isInteger(hour) ? hour % 24 : null;
  } catch {
    return at.getUTCHours();
  }
}

/** Hour starts a half-open [start, end) interval touches on the employee's
 * local clock. 2:17–3:17 PM covers hours 14 and 15. */
export function intervalHourStarts(startIso: string, endIso: string, timezone: string): number[] {
  const start = localHour(startIso, timezone);
  const end = localHour(endIso, timezone);
  if (start == null || end == null) return [];
  const endDate = new Date(endIso);
  const endIsHourBoundary = endDate.getMinutes() === 0 && endDate.getSeconds() === 0 && endDate.getMilliseconds() === 0;
  const last = endIsHourBoundary ? (end + 23) % 24 : end;
  const hours: number[] = [];
  let cursor = start;
  for (let guard = 0; guard < 24; guard += 1) {
    hours.push(cursor);
    if (cursor === last) break;
    cursor = (cursor + 1) % 24;
  }
  return hours;
}

/** Ready recaps for one local day, oldest first, with the exact text and
 * provenance downstream reports must show. */
export async function listActivityIntervalActivityLines(organizationId: string, personId: string, date: string): Promise<ActivityIntervalActivityLine[]> {
  const { data, error } = await db().from("work_activity_intervals")
    .select("window_start,window_end,timezone,review_status,generation_status,headline,final_detail,ai_detail")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("local_date", date)
    .eq("generation_status", "ready")
    .order("window_start", { ascending: true });
  if (error) throw new Error(`load activity interval lines: ${error.message}`);
  return ((data ?? []) as ActivityIntervalRecord[]).flatMap((row) => {
    const detail = String(row.final_detail ?? row.ai_detail ?? "").trim();
    if (!detail) return [];
    const timezone = String(row.timezone ?? "UTC");
    return [{
      startIso: String(row.window_start),
      endIso: String(row.window_end),
      label: formatIntervalRange(String(row.window_start), String(row.window_end), timezone),
      provenance: String(row.review_status) as ActivityIntervalActivityLine["provenance"],
      detail,
      headline: row.headline ? String(row.headline) : null,
      hourStarts: intervalHourStarts(String(row.window_start), String(row.window_end), timezone),
    }];
  });
}

export type ActivityIntervalDecision = "confirm" | "amend";

/** Employee review decision. Preserves the original AI inference, freezes the
 * evidence revision, never creates a work_check_ins row, and never advances the
 * substantive-update cadence. */
export async function decideActivityInterval(
  access: WorkOsAccess,
  intervalId: string,
  input: { action: ActivityIntervalDecision; feedback?: string },
): Promise<ActivityIntervalRecord> {
  if (!access.personId) throw new Error("Work OS person mapping required.");
  const { data: row, error } = await db().from("work_activity_intervals").select("*")
    .eq("organization_id", access.organizationId).eq("id", intervalId).maybeSingle();
  if (error) throw new Error(`load activity interval: ${error.message}`);
  if (!row) throw new Error("activity interval not found");
  if (String(row.person_id) !== access.personId) throw new Error("forbidden");
  if (String(row.generation_status) !== "ready" || !row.ai_detail) {
    throw new WorkOsConflictError("This activity recap is not ready to review yet.");
  }
  if (input.action === "confirm") {
    const { data, error: updateError } = await db().from("work_activity_intervals").update({
      review_status: "confirmed",
      final_detail: row.ai_detail,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", intervalId).select("*").single();
    if (updateError) throw new Error(`confirm activity interval: ${updateError.message}`);
    await auditInterval(access, "activity_interval.confirmed", intervalId, {});
    return data as ActivityIntervalRecord;
  }
  const feedback = cleanText(input.feedback, MAX_FEEDBACK_CHARS);
  if (!feedback) throw new Error("feedback is required to amend an activity recap");
  const finalDetail = `${row.ai_detail}\n\nEmployee addition: ${feedback}`.slice(0, MAX_DETAIL_CHARS + MAX_FEEDBACK_CHARS);
  const { data, error: updateError } = await db().from("work_activity_intervals").update({
    review_status: "amended",
    employee_feedback: feedback,
    final_detail: finalDetail,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", intervalId).select("*").single();
  if (updateError) throw new Error(`amend activity interval: ${updateError.message}`);
  await auditInterval(access, "activity_interval.amended", intervalId, { feedbackChars: feedback.length });
  return data as ActivityIntervalRecord;
}
