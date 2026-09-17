import { createHash } from "node:crypto";
import { INTERPRET_MODEL } from "@/lib/aiInterpret";
import { db } from "@/lib/work-os-internal";
import { zonedDateTimeToUtc } from "@/modules/work-os/companion";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const HOUR_SUMMARY_TIMEOUT_MS = 45_000;
const PROMPT_VERSION = "work-os-screenshot-hours-v1";
const MAX_HOURS = 16;
const MAX_FRAMES_PER_HOUR = 12;
const MAX_FRAME_SUMMARY = 180;

/** The provider endpoint must never send the API key or activity text over
 * cleartext transport; a loopback proxy is the only http exception. */
function providerUrl(): string | null {
  try {
    const url = new URL(OPENROUTER_URL);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase())) return url.toString();
  } catch {
    // fall through to unavailable
  }
  return null;
}

export interface ScreenshotHourFrame {
  summaryId: string;
  capturedAt: string;
  summary: string;
  visibleApp: string | null;
}

export interface ScreenshotHourGroup {
  hourStart: number;
  label: string;
  frameCount: number;
  apps: string[];
  firstAt: string;
  lastAt: string;
  frames: ScreenshotHourFrame[];
}

export interface EodScreenshotHour {
  hourStart: number;
  label: string;
  summary: string;
  frameCount: number;
  summaryId: string | null;
  visibleApp: string | null;
  /** False when the line is a truthful fallback (counts only, no synthesis). */
  synthesized: boolean;
}

/** "3–4 PM" in plain 12-hour language; both meridiems appear only when the
 * range crosses noon or midnight. Never a timezone or offset. */
export function formatHourRange(hourStart: number): string {
  const bounded = ((Math.trunc(hourStart) % 24) + 24) % 24;
  const part = (hour: number) => {
    const normalized = ((hour % 24) + 24) % 24;
    return { display: normalized % 12 === 0 ? 12 : normalized % 12, suffix: normalized < 12 ? "AM" : "PM" };
  };
  const from = part(bounded);
  const to = part(bounded + 1);
  return from.suffix === to.suffix
    ? `${from.display}–${to.display} ${to.suffix}`
    : `${from.display} ${from.suffix}–${to.display} ${to.suffix}`;
}

function hourInTimezone(iso: string, timezone: string): number | null {
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

/** Groups processed frames by the employee's local hour, oldest first. */
export function screenshotHourGroups(frames: ScreenshotHourFrame[], timezone: string): ScreenshotHourGroup[] {
  const byHour = new Map<number, ScreenshotHourFrame[]>();
  for (const frame of frames) {
    const hour = hourInTimezone(frame.capturedAt, timezone);
    if (hour == null) continue;
    const list = byHour.get(hour) ?? [];
    list.push(frame);
    byHour.set(hour, list);
  }
  return [...byHour.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(0, MAX_HOURS)
    .map(([hourStart, list]) => {
      const sorted = [...list].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
      const apps = [...new Set(sorted.map((frame) => (frame.visibleApp ?? "").trim()).filter(Boolean))];
      return {
        hourStart,
        label: formatHourRange(hourStart),
        frameCount: sorted.length,
        apps,
        firstAt: sorted[0]?.capturedAt ?? "",
        lastAt: sorted[sorted.length - 1]?.capturedAt ?? "",
        frames: sorted,
      };
    });
}

/** The exact per-hour material sent to the model. The cache hash is built
 * from this same string, so any prompt-affecting change (app, capture time,
 * summary text, frame order, or the frame cap) invalidates the cached line. */
function hourPromptMaterial(group: ScreenshotHourGroup) {
  return JSON.stringify({
    hourStart: group.hourStart,
    label: group.label,
    frames: group.frames.slice(0, MAX_FRAMES_PER_HOUR).map((frame) => ({
      id: frame.summaryId,
      app: frame.visibleApp ?? null,
      at: frame.capturedAt,
      summary: frame.summary.slice(0, MAX_FRAME_SUMMARY),
    })),
  });
}

export function screenshotHourHash(group: ScreenshotHourGroup): string {
  return createHash("sha256").update(hourPromptMaterial(group)).digest("hex");
}

const HOUR_SUMMARY_SCHEMA = {
  name: "work_os_screenshot_hours",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hours"],
    properties: {
      hours: {
        type: "array",
        maxItems: MAX_HOURS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["hourStart", "summary"],
          properties: {
            hourStart: { type: "integer" },
            summary: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/** One call per day: summarize each hour's frames into one neutral line.
 * Returns null when the provider is unavailable so callers can fall back. */
export async function summarizeScreenshotHours(groups: ScreenshotHourGroup[]): Promise<Map<number, string> | null> {
  const key = process.env.OPENROUTER_API_KEY;
  const url = providerUrl();
  if (!key || !url || !groups.length) return null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: INTERPRET_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "You summarize sampled work screenshots for one employee's end-of-day report.",
              "For each hour, write one plain sentence (at most two short ones) describing what the frames show happening in that hour.",
              "Use only what the frame summaries state. Never invent applications, tasks, outcomes, people, or intent.",
              "Never claim productivity, effort, attendance, or completion, and never say the day was good or bad.",
              "Write in plain 12-hour language when a time appears in your sentence; never mention a timezone.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              hours: groups.map((group) => JSON.parse(hourPromptMaterial(group))),
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_schema", json_schema: HOUR_SUMMARY_SCHEMA },
      }),
      signal: AbortSignal.timeout(HOUR_SUMMARY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const raw = JSON.parse(content.slice(start, end + 1)) as { hours?: unknown };
    const summaries = new Map<number, string>();
    for (const candidate of Array.isArray(raw.hours) ? raw.hours : []) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Record<string, unknown>;
      const hourStart = Number(value.hourStart);
      const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 800) : "";
      if (Number.isInteger(hourStart) && summary) summaries.set(hourStart, summary);
    }
    return summaries.size ? summaries : null;
  } catch {
    return null;
  }
}

/** Truthful line for an hour with no synthesis available: counts and apps only. */
function fallbackSummary(group: ScreenshotHourGroup): string {
  const frames = group.frameCount === 1 ? "1 frame" : `${group.frameCount} frames`;
  const apps = group.apps.slice(0, 3).join(", ");
  return apps ? `${frames} analyzed across ${apps}.` : `${frames} analyzed.`;
}

/** The UTC instant range covering one local calendar day, so late-evening
 * local frames stored on the next UTC date still belong to the report day. */
function localDayUtcBounds(date: string, timezone: string) {
  const nextDate = new Date(new Date(`${date}T12:00:00Z`).getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10);
  try {
    const start = zonedDateTimeToUtc(date, "00:00:00", timezone || "UTC").toISOString();
    const end = zonedDateTimeToUtc(nextDate, "00:00:00", timezone || "UTC").toISOString();
    if (Date.parse(start) < Date.parse(end)) return { start, end };
  } catch {
    // fall through to the UTC day
  }
  return { start: `${date}T00:00:00.000Z`, end: `${nextDate}T00:00:00.000Z` };
}

async function personTimezone(organizationId: string, personId: string) {
  const { data, error } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", organizationId).eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`load screenshot hour timezone: ${error.message}`);
  return typeof data?.timezone === "string" && data.timezone ? data.timezone : "UTC";
}

interface HourCacheRow {
  hour_start: number;
  summary: string;
  source_hash: string;
  model: string | null;
}

/** Loads the day's processed frames, then reuses or (re)synthesizes one line
 * per local hour. Exactly one model call happens, and only for hours whose
 * frame set changed; unchanged hours are served from the cache table. */
export async function ensureHourlyScreenshotSummaries(input: {
  organizationId: string;
  personId: string;
  date: string;
  timezone?: string;
}): Promise<EodScreenshotHour[]> {
  const timezone = input.timezone ?? await personTimezone(input.organizationId, input.personId);
  const bounds = localDayUtcBounds(input.date, timezone);
  const events = await db().from("work_evidence_events").select("id,occurred_at")
    .eq("organization_id", input.organizationId).eq("person_id", input.personId).eq("provider", "worktivity")
    .like("external_event_id", "screenshot:%")
    .gte("occurred_at", bounds.start).lt("occurred_at", bounds.end);
  if (events.error) throw new Error(`load screenshot hour events: ${events.error.message}`);
  const occurredBy = new Map((events.data ?? []).map((row: any) => [String(row.id), String(row.occurred_at ?? "")]));
  const eventIds = [...occurredBy.keys()];
  const now = Date.now();
  const frames: ScreenshotHourFrame[] = [];
  if (eventIds.length) {
    const rows = await db().from("work_screenshot_summaries")
      .select("id,summary,visible_context,processing_status,evidence_event_id,storage_path,deleted_at,expires_at")
      .in("evidence_event_id", eventIds);
    if (rows.error) throw new Error(`load screenshot hour frames: ${rows.error.message}`);
    for (const row of (rows.data ?? []) as Array<Record<string, any>>) {
      if (row.processing_status !== "processed") continue;
      // Rollups follow their source images: once a frame is deleted or
      // expired it stops feeding synthesis, and an hour whose frames are all
      // gone disappears below.
      const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : Number.NaN;
      if (!row.storage_path || row.deleted_at || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
      const summary = String(row.summary ?? "").trim();
      if (!summary) continue;
      const context = (row.visible_context ?? {}) as Record<string, unknown>;
      frames.push({
        summaryId: String(row.id),
        capturedAt: occurredBy.get(String(row.evidence_event_id)) ?? "",
        summary,
        visibleApp: context.visibleApp != null ? String(context.visibleApp) : null,
      });
    }
  }

  const groups = screenshotHourGroups(frames, timezone);
  const hashes = new Map(groups.map((group) => [group.hourStart, screenshotHourHash(group)]));
  const cachedResult = await db().from("work_screenshot_hourly_summaries")
    .select("hour_start,summary,source_hash,model")
    .eq("organization_id", input.organizationId).eq("person_id", input.personId).eq("local_date", input.date);
  if (cachedResult.error) throw new Error(`load hourly screenshot summaries: ${cachedResult.error.message}`);
  const cached = new Map<number, HourCacheRow>(((cachedResult.data ?? []) as HourCacheRow[]).map((row) => [Number(row.hour_start), row]));

  // Synthesize hours whose frames changed, and retry counts-only fallbacks.
  const changed = groups.filter((group) => {
    const existing = cached.get(group.hourStart);
    if (!existing) return true;
    if (existing.model == null) return true;
    return existing.source_hash !== hashes.get(group.hourStart);
  });
  const synthesized = changed.length ? await summarizeScreenshotHours(changed) : new Map<number, string>();
  const wanted = new Set(groups.map((group) => group.hourStart));
  const staleHours = [...cached.keys()].filter((hour) => !wanted.has(hour));
  if (staleHours.length) {
    const { error } = await db().from("work_screenshot_hourly_summaries").delete()
      .eq("organization_id", input.organizationId).eq("person_id", input.personId).eq("local_date", input.date)
      .in("hour_start", staleHours);
    if (error) throw new Error(`delete stale hourly screenshot summaries: ${error.message}`);
  }

  const upserts: Array<Record<string, unknown>> = [];
  const resolved = new Map<number, { summary: string; model: string | null }>();
  const persist = (group: ScreenshotHourGroup, summary: string, model: string | null) => {
    resolved.set(group.hourStart, { summary, model });
    upserts.push({
      organization_id: input.organizationId,
      person_id: input.personId,
      local_date: input.date,
      hour_start: group.hourStart,
      summary,
      frame_count: group.frameCount,
      source_hash: hashes.get(group.hourStart),
      model,
      prompt_version: PROMPT_VERSION,
      updated_at: new Date().toISOString(),
    });
  };
  for (const group of groups) {
    const existing = cached.get(group.hourStart);
    const hash = hashes.get(group.hourStart);
    const fresh = synthesized?.get(group.hourStart);
    if (fresh) {
      // A successful synthesis always records the hash for the frames it saw,
      // even when the sentence happens to read the same.
      if (existing?.source_hash !== hash || existing?.summary !== fresh || existing?.model == null) persist(group, fresh, INTERPRET_MODEL);
      else resolved.set(group.hourStart, { summary: fresh, model: INTERPRET_MODEL });
      continue;
    }
    if (existing && existing.model != null && existing.source_hash === hash) {
      resolved.set(group.hourStart, { summary: existing.summary, model: existing.model });
      continue;
    }
    // Synthesis is unavailable for changed or fallback frames: show a
    // truthful counts-only line with the current hash (never stale text), and
    // leave `model` null so the next call retries the model.
    const summary = fallbackSummary(group);
    if (existing?.summary !== summary || existing?.source_hash !== hash || existing?.model != null) persist(group, summary, null);
    else resolved.set(group.hourStart, { summary, model: null });
  }
  if (upserts.length) {
    const { error } = await db().from("work_screenshot_hourly_summaries")
      .upsert(upserts, { onConflict: "organization_id,person_id,local_date,hour_start" });
    if (error) throw new Error(`save hourly screenshot summaries: ${error.message}`);
  }

  return groups.map((group) => {
    const entry = resolved.get(group.hourStart);
    const representative = group.frames[0] ?? null;
    return {
      hourStart: group.hourStart,
      label: group.label,
      summary: entry?.summary ?? fallbackSummary(group),
      frameCount: group.frameCount,
      summaryId: representative?.summaryId ?? null,
      visibleApp: representative?.visibleApp ?? group.apps[0] ?? null,
      synthesized: !!entry?.model,
    };
  });
}
