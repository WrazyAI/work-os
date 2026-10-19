import { createAdminClient } from "@/lib/supabase/admin";
import { ensureHourlyScreenshotSummaries, type EodScreenshotHour } from "@/lib/work-os-screenshot-hours";
import { automationName, collapseAutomation, formatLocalTime, outsideShiftMarker, outsideWindowLabel } from "@/lib/work-os-eod-facts";
import { eodActivityWindowFor, withinEodActivityWindow } from "@/lib/work-os-eod-window";
import { localDayBounds } from "@/modules/work-os/companion";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, EOD_MODEL, aiRequestBody } from "@/lib/work-os-ai-model";

/** The employee's onboarding timezone, the same source the day label uses. */
async function screenshotTimezone(db: ReturnType<typeof createAdminClient>, organizationId: string, personId: string): Promise<string> {
  const { data, error } = await db.from("work_employee_onboarding").select("timezone")
    .eq("organization_id", organizationId).eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`load screenshot context timezone: ${error.message}`);
  return typeof data?.timezone === "string" && data.timezone ? data.timezone : "UTC";
}

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const EOD_TIMEOUT_MS = AI_TIMEOUTS.eod;

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
  /** Neutral, sampled activity observations. Hourly rows carry their own
   * readable time range in `text`, so `at` stays null there. */
  observed?: Array<{ at: string | null; text: string; app: string | null }>;
  /** Employee-attached Loom recordings for the day. The transcript stays in
   * the check-in claims; the digest is what the report may cite. */
  media?: Array<{ at: string; title: string; url: string; durationSeconds: number | null; digest: string | null; transcriptChars: number }>;
  contextBlock?: string;
}

export interface EodSelection {
  summaryFactIds: string[];
  completedFactIds: string[];
  carriedFactIds: string[];
  blockerFactIds: string[];
  observedFactIds: string[];
  mediaFactIds: string[];
}

const EOD_SELECTION_SCHEMA = {
  name: "work_os_eod_selection",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summaryFactIds", "completedFactIds", "carriedFactIds", "blockerFactIds", "observedFactIds", "mediaFactIds"],
    properties: {
      summaryFactIds: { type: "array", items: { type: "string" }, maxItems: 20 },
      completedFactIds: { type: "array", items: { type: "string" }, maxItems: 100 },
      carriedFactIds: { type: "array", items: { type: "string" }, maxItems: 100 },
      blockerFactIds: { type: "array", items: { type: "string" }, maxItems: 20 },
      observedFactIds: { type: "array", items: { type: "string" }, maxItems: 24 },
      mediaFactIds: { type: "array", items: { type: "string" }, maxItems: 12 },
    },
  },
} as const;

function eodFacts(grounding: EodGrounding) {
  return {
    summary: grounding.updates.map((update, index) => ({ id: `update:${index}`, text: `[${update.kind}] ${update.text}` })),
    completed: grounding.completed.map((text, index) => ({ id: `completed:${index}`, text })),
    carried: grounding.carried.map((text, index) => ({ id: `carried:${index}`, text })),
    blocker: grounding.blockers.map((text, index) => ({ id: `blocker:${index}`, text })),
    observed: (grounding.observed ?? []).map((observation, index) => ({
      id: `observed:${index}`,
      text: `${observation.text}${observation.app ? ` (observed in ${observation.app})` : ""}${observation.at ? ` at ${observation.at}` : ""}`,
    })),
    media: (grounding.media ?? []).map((item, index) => ({
      id: `media:${index}`,
      text: `${item.title}${formatLoomLength(item.durationSeconds)}${item.digest ? ` — ${item.digest}` : ""} (${item.url})`,
    })),
  };
}

function formatLoomLength(seconds: number | null): string {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return "";
  const total = Math.round(seconds as number);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return ` (${minutes}:${String(rest).padStart(2, "0")})`;
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
  const observedFactIds = selectedFactIds(value.observedFactIds, "observed:", new Set(facts.observed.map((fact) => fact.id)));
  const mediaFactIds = selectedFactIds(value.mediaFactIds, "media:", new Set(facts.media.map((fact) => fact.id)));
  return summaryFactIds && completedFactIds && carriedFactIds && blockerFactIds && observedFactIds && mediaFactIds
    ? { summaryFactIds, completedFactIds, carriedFactIds, blockerFactIds, observedFactIds, mediaFactIds }
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
  const observed = selected(selection.observedFactIds, facts.observed);
  const media = selected(selection.mediaFactIds, facts.media);
  return [
    "## Summary", ...(summary.length ? summary.map((text) => `- ${text}`) : ["- No recorded progress update."]),
    "", "## Completed", ...(completed.length ? completed.map((text) => `- ${text}`) : ["- Nothing completed yet"]),
    "", "## Carried forward", ...(carried.length ? carried.map((text) => `- ${text}`) : ["- Nothing pending"]),
    ...(media.length
      ? ["", "## Recorded Loom updates", ...media.map((text) => `- ${text}`), "Recordings are employee-authored artifacts; they do not by themselves prove task completion."]
      : []),
    ...(observed.length
      ? ["", "## Observed activity context", ...observed.map((text) => `- ${text}`), "Activity context is descriptive; recorded GitHub activity is a provider fact and still does not prove attendance, productivity, or task completion."]
      : []),
    "", "## Daily commitment reconciliation", ...renderCommitmentReconciliation(grounding.commitments),
    ...(blockers.length ? ["", "## Bottleneck", ...blockers.map((text) => `- ${text}`)] : []),
  ].join("\n");
}

export function buildEodPrompt(grounding: EodGrounding): string {
  const facts = eodFacts(grounding);
  const fmt = (list: Array<{ id: string; text: string }>, empty: string) => list.length ? list.map((item) => `- ${item.id}: ${item.text}`).join("\n") : `- ${empty}`;
  return [
    `Write the end-of-day report for ${grounding.personName}, ${grounding.date}. Plain language for a manager — no jargon, no productivity scores, no invention.`,
    `Session: ${grounding.clockedInAt ?? "not clocked in"} → ${grounding.clockedOutAt ?? "still open"}.`,
    `Facts marked (outside shift) or (outside the workday) finished outside the employee's recorded working period; state them exactly as recorded and never present them as in-shift work.`,
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
    "Recorded Loom updates (the employee's own recordings; artifacts, never proof of task completion):",
    fmt(facts.media, "none"),
    "",
    "Observed activity context (recorded screenshot summaries and attributed GitHub activity; state recorded GitHub facts exactly as recorded, keep 'performed' vs 'triggered' distinct, and never treat them as proof of productivity, effort, or task completion):",
    fmt(facts.observed, "none"),
    "",
    grounding.contextBlock ? `Additional context (live day state plus confirmed, historical, and same-day tentative memory — informational only; never selectable facts and never completion evidence):\n${grounding.contextBlock}` : "",
    "Return ONLY a JSON object with summaryFactIds, completedFactIds, carriedFactIds, blockerFactIds, observedFactIds, and mediaFactIds.",
    "Each array must contain only IDs from its matching section above. Never invent prose, counts, or inferred facts.",
  ].join("\n");
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
  const [updatesResult, eventsResult, sessionResult, planResult, timezoneResult] = await Promise.all([
    db.from("work_check_ins").select("input_text,update_kind,occurred_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).eq("substantive", true).order("occurred_at", { ascending: true }),
    db.from("work_task_day_events").select("event_type,task_id,task_snapshot,exact_at,observed_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("local_date", date).order("observed_at", { ascending: true }),
    db.from("work_sessions").select("clocked_in_at,clocked_out_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("work_daily_plans").select("id").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).maybeSingle(),
    db.from("work_employee_onboarding").select("timezone").eq("organization_id", organizationId)
      .eq("person_id", personId).maybeSingle(),
  ]);
  if (updatesResult.error) throw new Error(`load EOD updates: ${updatesResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);
  if (planResult.error) throw new Error(`load EOD commitments: ${planResult.error.message}`);
  if (timezoneResult.error) throw new Error(`load EOD timezone: ${timezoneResult.error.message}`);
  const planId = planResult.data?.id ? String(planResult.data.id) : null;
  const planItemsResult = planId
    ? await db.from("work_daily_plan_items").select("title_snapshot,disposition,completion_state").eq("plan_id", planId)
    : { data: [], error: null };
  if (planItemsResult.error) throw new Error(`load EOD commitment items: ${planItemsResult.error.message}`);

  // Task facts stay date-scoped; the workday window labels the ones that
  // finished outside the shift instead of hiding them.
  const window = await eodActivityWindowFor(organizationId, personId, date);
  const updates = ((updatesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const text = String(row.input_text ?? "").trim();
      const at = String(row.occurred_at ?? "");
      return { kind: String(row.update_kind ?? "update"), text: text ? `${text}${outsideShiftMarker(at, window)}` : "", at };
    })
    .filter((row) => row.text);
  const timezone = typeof timezoneResult.data?.timezone === "string" && timezoneResult.data.timezone ? timezoneResult.data.timezone : "UTC";
  const completed: string[] = [];
  const carried: string[] = [];
  const blockers: string[] = [];
  const automationTitles: string[] = [];
  const automationOutsideTitles: string[] = [];
  const seenCompleted = new Set<string>();
  const seenCarried = new Set<string>();
  const events = ((eventsResult.data ?? []) as Array<Record<string, unknown>>);
  for (const event of events) {
    const snapshot = (event.task_snapshot ?? {}) as { title?: unknown };
    const title = typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title.trim() : "a task";
    // Distinct tasks can share a title (repeated routine runs); only repeat
    // events for the same task are the same fact.
    const key = String(event.task_id ?? "").trim() || title.toLowerCase().replace(/\s+/g, " ");
    const completedEvent = event.event_type === "completed";
    // Carried and deferred events both describe work that moves forward.
    const deferredEvent = ["deferred", "carried"].includes(String(event.event_type ?? ""));
    if (!completedEvent && !deferredEvent) continue;
    const rawAt = event.exact_at ?? event.observed_at;
    // Repeated events for the same task are one fact; routine runs collapse
    // into a single automation line instead of one entry per execution, and
    // they keep their window classification through the collapse.
    if (completedEvent) {
      if (seenCompleted.has(key)) continue;
      seenCompleted.add(key);
      if (automationName(title)) {
        (withinEodActivityWindow(rawAt, window) ? automationTitles : automationOutsideTitles).push(title);
        continue;
      }
    } else {
      if (seenCarried.has(key)) continue;
      seenCarried.add(key);
      if (automationName(title)) continue;
    }
    const time = formatLocalTime(rawAt, timezone);
    const stamped = `${time ? `${title} (${time})` : title}${outsideShiftMarker(rawAt, window)}`;
    if (completedEvent) completed.push(stamped);
    else carried.push(stamped);
  }
  const automation = collapseAutomation(automationTitles);
  if (automation.line) completed.push(automation.line.replace(/^-\s*/, ""));
  const automationOutside = collapseAutomation(automationOutsideTitles);
  if (automationOutside.line) completed.push(`${automationOutside.line.replace(/^-\s*/, "")}${outsideWindowLabel(window)}`);
  for (const update of updates) {
    if (update.kind === "blocked" && !blockers.includes(update.text)) blockers.push(update.text);
  }
  const session = (sessionResult.data ?? {}) as { clocked_in_at?: unknown; clocked_out_at?: unknown };
  const commitments = ((Array.isArray(planItemsResult.data) ? planItemsResult.data : []) as Array<Record<string, unknown>>).flatMap((item) => {
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
      body: JSON.stringify(aiRequestBody(EOD_MODEL, {
        messages: [
          { role: "system", content: "You are the Work OS assistant. Select only verified Work OS fact IDs. You never write report prose or invent facts." },
          { role: "user", content: buildEodPrompt(grounding) },
        ],
        temperature: 0.3,
        max_tokens: AI_TOKEN_BUDGETS.eodSelection,
        response_format: { type: "json_schema", json_schema: EOD_SELECTION_SCHEMA },
      })),
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

/** Matches a real `## Bottleneck` heading line and its body, up to the next
 * `## ` heading or the end of the report. */
const BOTTLENECK_SECTION = /(?:^|\n+)##[ \t]*Bottleneck[ \t]*\n[\s\S]*?(?=\n{1,2}##[ \t]|\s*$)/i;

function withoutBottleneck(markdown: string) {
  return markdown.replace(BOTTLENECK_SECTION, "").replace(/\s+$/, "");
}

/** Refines report wording from employee feedback without rewriting any Bottleneck section. */
export async function refineEodNarrative(grounding: EodGrounding, draft: string, feedback: string, annotations: EodAnnotation[] = []): Promise<EodDraftResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(EOD_MODEL, {
        messages: [
          { role: "system", content: "You refine Work OS EOD report wording. Apply the employee feedback, preserve truthful task and progress statements, and never add a Bottleneck section. Do not invent completion, evidence, timing, or outcomes." },
          { role: "user", content: `Known Work OS facts:\n${buildEodPrompt(grounding)}\n\nCurrent report:\n${withoutBottleneck(draft)}\n\nEmployee feedback:\n${feedback.trim() || "(none)"}\n${annotations.length ? `\nEmployee annotations on the draft:\n${formatEodAnnotations(annotations)}\n` : ""}\nReturn only the revised markdown report. Do not include a Bottleneck heading or content.` },
        ],
        temperature: 0.2,
        max_tokens: AI_TOKEN_BUDGETS.eodRevision,
      })),
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

/** Processed screenshot summaries for the report date, shaped for the EOD
 * composer's screenshot-context panel. Neutral activity context only. */
export async function gatherEodScreenshotContext(organizationId: string, personId: string, date: string, timezone?: string) {
  const supabase = createAdminClient();
  const resolvedTimezone = timezone ?? await screenshotTimezone(supabase, organizationId, personId);
  // Counts and hour lines cover the workday window, matching the report.
  const window = await eodActivityWindowFor(organizationId, personId, date);
  const bounds = window ? { startIso: window.startIso, endIso: window.endIso } : localDayBounds(date, resolvedTimezone);
  const events = await supabase.from("work_evidence_events").select("id,occurred_at")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("provider", "worktivity")
    .like("external_event_id", "screenshot:%")
    .gte("occurred_at", bounds.startIso).lt("occurred_at", bounds.endIso);
  if (events.error) throw new Error(`load screenshot events: ${events.error.message}`);
  const ids = (events.data ?? []).map((row: any) => String(row.id));
  if (!ids.length) return { processed: 0, excluded: 0, failed: 0, pending: 0, hours: [] as EodScreenshotHour[] };
  const rows = await supabase.from("work_screenshot_summaries").select("id,processing_status,evidence_event_id")
    .in("evidence_event_id", ids);
  if (rows.error) throw new Error(`load screenshot summaries: ${rows.error.message}`);
  const summaries = (rows.data ?? []) as Array<Record<string, any>>;
  const count = (status: string) => summaries.filter((row) => row.processing_status === status).length;
  // Frames with no terminal summary are still being analyzed or will be
  // retried; the draft states this honestly instead of implying zero frames.
  const terminal = new Set(summaries
    .filter((row) => ["processed", "excluded"].includes(String(row.processing_status)))
    .map((row) => String(row.evidence_event_id)));
  const pending = ids.filter((id) => !terminal.has(id)).length;
  // Hours, not frames: the draft reports one synthesized line per local hour.
  const hours = await ensureHourlyScreenshotSummaries({ organizationId, personId, date });
  return { processed: count("processed"), excluded: count("excluded"), failed: count("failed"), pending, hours };
}
