import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir as fsMkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageBackend } from "@/lib/db/storage";
import { canAccessWorkOsPerson } from "@/lib/work-os-api";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { dateOnly } from "@/lib/work-os-internal";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { fetchScreenshotsForDay, framesWithinBounds, type WtActivityLog, type WtScreenshot } from "@/lib/worktivity";
import { fingerprintScreenshot } from "@/lib/worktivityScreenshotRuns";
import { saveFrameFingerprint } from "@/lib/worktivityFrameCache";
import { localDateForTimezone, localDayBounds, zonedDateTimeToUtc } from "@/modules/work-os/companion";

type Json = Record<string, unknown>;

/** The pipeline only needs these fields; both activity logs and screenshot
 * records carry them, so summaries can be produced from either source. */
type ScreenshotLog = Pick<WtActivityLog, "ID" | "Screenshot" | "CreateDate" | "Title" | "Url"> & { CaptureDate?: string | null; ActivityLevel?: number | null };

const captureAt = (log: ScreenshotLog) => log.CaptureDate || log.CreateDate;

const BUCKET = "work-os-screenshots";
const MODEL = process.env.WORK_OS_SCREENSHOT_MODEL || process.env.WORK_OS_INTERPRET_MODEL || "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_VERSION = "work-os-neutral-screenshot-v2";
const DEFAULT_SCREENSHOTS_PER_RUN = 12;
const MAX_SCREENSHOTS_PER_RUN = 48;
const SCHEDULED_HOURLY_CAP = Math.max(1, Math.min(MAX_SCREENSHOTS_PER_RUN, Number(process.env.WORK_OS_SCREENSHOT_HOURLY_CAP ?? 24) || 24));
const SCHEDULED_EOD_CAP = Math.max(1, Math.min(MAX_SCREENSHOTS_PER_RUN, Number(process.env.WORK_OS_SCREENSHOT_EOD_CAP ?? 24) || 24));
/** An interactive EOD preparation call must answer well inside the companion's
 * request budget, so each call analyzes only a small bounded batch and the
 * caller keeps asking while frames remain. */
const PREPARE_SCREENSHOTS_PER_REQUEST = 6;
/** A hung provider call must never hold an interactive preparation open. */
const SCREENSHOT_DOWNLOAD_TIMEOUT_MS = Math.max(2_000, Number(process.env.WORK_OS_SCREENSHOT_DOWNLOAD_TIMEOUT_MS ?? 15_000) || 15_000);
const SCREENSHOT_VISION_TIMEOUT_MS = Math.max(2_000, Number(process.env.WORK_OS_SCREENSHOT_VISION_TIMEOUT_MS ?? 20_000) || 20_000);
/** The observation is one small tool call; bound the completion budget so the
 * provider's credit pre-authorization checks the real cost. Without a limit the
 * request pre-authorizes the model's full context (e.g. 65536 tokens) and fails
 * with 402 whenever the account balance is lower, even though the call itself
 * costs a fraction of that. */
const SCREENSHOT_VISION_MAX_TOKENS = Math.max(256, Number(process.env.WORK_OS_SCREENSHOT_VISION_MAX_TOKENS ?? 1_200) || 1_200);

function db() {
  return createAdminClient();
}

function normalized(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function encryptionKey() {
  const raw = process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("WORK_OS_SCREENSHOT_ENCRYPTION_KEY is required for retained screenshots");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("WORK_OS_SCREENSHOT_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptScreenshot(bytes: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptScreenshot(bytes: Uint8Array) {
  const input = Buffer.from(bytes);
  if (input.length < 29) throw new Error("encrypted screenshot payload is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), input.subarray(0, 12));
  decipher.setAuthTag(input.subarray(12, 28));
  return Buffer.concat([decipher.update(input.subarray(28)), decipher.final()]);
}

type ScreenshotScope = Pick<WorkOsAccess, "organizationId">;
type ScreenshotExecution = "feature" | "readiness_smoke";

/** A normal execution is available only when the real organization flag is
 * enabled.  A readiness smoke is deliberately the inverse: it can exercise
 * one real, consented image before activation, but is unavailable after the
 * feature is live.  Neither mode accepts a caller-supplied feature flag. */
export function allowsScreenshotExecution(featureEnabled: boolean, execution: ScreenshotExecution) {
  return execution === "feature" ? featureEnabled : !featureEnabled;
}

async function assertScreenshotExecutionAllowed(organizationId: string, execution: ScreenshotExecution) {
  const { data: organization, error } = await db().from("work_organizations")
    .select("feature_flags")
    .eq("id", organizationId)
    .single();
  if (error) throw new Error(`load screenshot feature policy: ${error.message}`);
  const featureEnabled = (organization.feature_flags as Json | null)?.screenshot_summaries === true;
  if (!allowsScreenshotExecution(featureEnabled, execution)) {
    throw new Error(execution === "feature"
      ? "screenshot summaries are disabled for this organization"
      : "screenshot readiness smoke is only allowed before feature activation");
  }
}

async function mirrorSummary(access: ScreenshotScope, personId: string, eventId: string, occurredAt: string, summary: string, model: string, timezone: string) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("legacy_owner_id,created_by").eq("id", access.organizationId).single();
  if (organizationError) throw new Error(`load screenshot organization: ${organizationError.message}`);
  const ownerId = organization.legacy_owner_id || organization.created_by;
  const capturedAt = new Date(occurredAt);
  const payload = {
    user_id: ownerId, organization_id: access.organizationId, person_id: personId, evidence_event_id: eventId,
    // Evidence dates follow the employee's local day, the same boundary the
    // fetch, terminal matching, and gallery use.
    evidence_date: Number.isFinite(capturedAt.getTime()) ? localDateForTimezone(capturedAt, timezone) : occurredAt.slice(0, 10),
    source: "worktivity", title: "Worktivity screenshot context", summary,
    metrics: { evidenceClass: "activity_observation", model, promptVersion: PROMPT_VERSION }, raw: { evidenceEventId: eventId }, updated_at: new Date().toISOString(),
  };
  // work_evidence carries only a partial unique index on evidence_event_id, so
  // ON CONFLICT cannot be used here — select then insert/update.
  const existing = await db().from("work_evidence").select("id")
    .eq("organization_id", access.organizationId).eq("evidence_event_id", eventId).maybeSingle();
  if (existing.error) throw new Error(`load screenshot mirror: ${existing.error.message}`);
  const { error } = existing.data
    ? await db().from("work_evidence").update(payload).eq("id", existing.data.id as string)
    : await db().from("work_evidence").insert(payload);
  if (error) throw new Error(`mirror screenshot evidence: ${error.message}`);
}

let ensureBucketPromise: Promise<void> | null = null;

async function ensureBucketOnce() {
  // With the object-storage adapter the bucket is provisioned outside the app
  // (R2 bucket via wrangler/dashboard; local driver just needs its directory).
  const backend = getStorageBackend();
  if (process.env.OBJECT_STORAGE_DRIVER === "local" || !process.env.R2_ACCOUNT_ID) {
    await fsMkdir(path.join(".storage-data", BUCKET), { recursive: true });
  }
  void backend;
}

function ensureBucket() {
  ensureBucketPromise ??= ensureBucketOnce().catch((error) => {
    ensureBucketPromise = null;
    throw error;
  });
  return ensureBucketPromise;
}

async function screenshotConfig(organizationId: string, personId: string) {
  const [{ data, error }, { data: onboarding, error: onboardingError }] = await Promise.all([
    db()
      .from("work_provider_connections")
      .select("config")
      .eq("organization_id", organizationId)
      .eq("provider", "worktivity")
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
    db().from("work_employee_onboarding").select("privacy_preferences")
      .eq("organization_id", organizationId).eq("person_id", personId).maybeSingle(),
  ]);
  if (error) throw new Error(`load Worktivity screenshot policy: ${error.message}`);
  if (onboardingError) throw new Error(`load employee screenshot exclusions: ${onboardingError.message}`);
  const config = (data?.config ?? {}) as Json;
  const privacy = (onboarding?.privacy_preferences ?? {}) as Json;
  return {
    sensitiveApps: [
      ...(Array.isArray(config.sensitive_apps) ? config.sensitive_apps.map(String) : []),
      ...(Array.isArray(privacy.sensitiveAppExclusions) ? privacy.sensitiveAppExclusions.map(String) : []),
    ].map(normalized),
    sensitiveDomains: Array.isArray(config.sensitive_domains) ? config.sensitive_domains.map(String).map(normalized) : [],
  };
}

export function isExcludedScreenshot(log: ScreenshotLog, config: { sensitiveApps: string[]; sensitiveDomains: string[] }) {
  const app = normalized(log.Title);
  const url = normalized(log.Url);
  return config.sensitiveApps.some((value) => value && app.includes(value)) ||
    config.sensitiveDomains.some((value) => value && url.includes(value));
}

export function canAccessRawScreenshot(input: { ownScreenshot: boolean; reviewable: boolean }) {
  return input.ownScreenshot || input.reviewable;
}

export function isRetainedScreenshotAvailable(summary: { storage_path?: string | null; deleted_at?: string | null; expires_at?: string | null }, now = Date.now()) {
  if (!summary.storage_path || summary.deleted_at || !summary.expires_at) return false;
  const expiresAt = new Date(summary.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function sampleScreenshots(shots: WtScreenshot[], cap = DEFAULT_SCREENSHOTS_PER_RUN) {
  const screenshots = shots.filter((shot) => shot.Screenshot).sort((a, b) => captureAt(a).localeCompare(captureAt(b)));
  if (screenshots.length <= cap) return screenshots;
  const step = screenshots.length / cap;
  return Array.from({ length: cap }, (_, index) => screenshots[Math.floor(index * step)]);
}

/** Frames that already have a terminal summary are never re-analyzed; failed
 * frames stay pending so the next scheduled run retries them. The window is the
 * employee's local day, matching how frames are attributed. */
async function terminallyAnalyzedFrames(organizationId: string, personId: string, bounds: { startIso: string; endIso: string }) {
  const events = await db().from("work_evidence_events").select("id,external_event_id")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("provider", "worktivity")
    .like("external_event_id", "screenshot:%")
    .gte("occurred_at", bounds.startIso).lt("occurred_at", bounds.endIso);
  if (events.error) throw new Error(`load analyzed screenshot frames: ${events.error.message}`);
  const byExternal = new Map((events.data ?? []).map((row: any) => [String(row.external_event_id), String(row.id)]));
  if (!byExternal.size) return new Set<string>();
  const summaries = await db().from("work_screenshot_summaries").select("evidence_event_id,processing_status")
    .in("evidence_event_id", [...byExternal.values()]);
  if (summaries.error) throw new Error(`load screenshot summary statuses: ${summaries.error.message}`);
  const terminal = new Set((summaries.data ?? [])
    .filter((row: any) => ["processed", "excluded"].includes(String(row.processing_status)))
    .map((row: any) => String(row.evidence_event_id)));
  const done = new Set<string>();
  for (const [external, eventId] of byExternal) if (terminal.has(eventId)) done.add(external);
  return done;
}

async function neutralSummary(url: string, log: ScreenshotLog) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for screenshot summaries");
  const tool = {
    type: "function",
    function: {
      name: "recordObservation",
      description: "Record a neutral observation about visible work context without judging productivity, pay, truthfulness, or task completion.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One factual sentence about visible application and apparent context. State uncertainty explicitly." },
          visible_app: { type: ["string", "null"] },
          work_context: { type: ["string", "null"] },
          possible_task_reference: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          contains_sensitive_content: {
            type: "boolean",
            description: "True only when the image visibly exposes credentials or secrets (passwords, API keys, tokens, private keys), personal or customer-identifying data, private message contents, financial or health records, or similarly regulated content. Ordinary work context is NOT sensitive: source code, terminal commands and output without secrets, application or browser UI, dashboards, documents being worked on, and general web pages must be false.",
          },
          sensitive_reason: {
            type: ["string", "null"],
            description: "One short phrase naming what is sensitive (for example 'API key visible' or 'customer email thread'). Null when contains_sensitive_content is false.",
          },
        },
        required: ["summary", "visible_app", "work_context", "possible_task_reference", "confidence", "contains_sensitive_content", "sensitive_reason"],
        additionalProperties: false,
      },
    },
  };
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(SCREENSHOT_VISION_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: SCREENSHOT_VISION_MAX_TOKENS,
      messages: [
        {
          role: "system",
          content: [
            "Describe only what is visibly supported by this screenshot.",
            "This is supporting activity context, not proof of productivity or completion.",
            "Do not infer identity, intent, effort, pay eligibility, deception, task status, or output quality.",
            "Do not reproduce secrets, message contents, personal data, credentials, or customer details.",
            "Flag contains_sensitive_content only for the explicit list in the tool description; routine code, terminals, application UI, and ordinary work documents are not sensitive.",
            "Use unclear language when the image does not support a specific observation.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Metadata: app/title=${log.Title || "unknown"}; domain/app=${log.Url || "unknown"}; captured=${captureAt(log)}.` },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "recordObservation" } },
    }),
  });
  if (!response.ok) throw new Error(`screenshot summary AI failed (${response.status}): ${(await response.text()).slice(0, 160)}`);
  const json = await response.json() as Json;
  const choices = json.choices as Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> | undefined;
  const args = choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("screenshot summary AI returned no structured observation");
  const result = JSON.parse(args) as Json;
  return {
    summary: String(result.summary || "The screenshot context was unclear."),
    visibleApp: result.visible_app ? String(result.visible_app) : null,
    workContext: result.work_context ? String(result.work_context) : null,
    possibleTaskReference: result.possible_task_reference ? String(result.possible_task_reference) : null,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    containsSensitiveContent: result.contains_sensitive_content === true,
    sensitiveReason: typeof result.sensitive_reason === "string" && result.sensitive_reason.trim()
      ? result.sensitive_reason.trim().slice(0, 160)
      : null,
  };
}

async function createEvidenceEvent(access: ScreenshotScope, personId: string, log: ScreenshotLog) {
  const { data, error } = await db().from("work_evidence_events").upsert({
    organization_id: access.organizationId,
    provider: "worktivity",
    external_event_id: `screenshot:${log.ID}`,
    person_id: personId,
    evidence_class: "activity_observation",
    title: `Worktivity screenshot context at ${captureAt(log)}`,
    summary: "Pending neutral screenshot summary.",
    attribution_method: "merged_worktivity_person",
    attribution_confidence: 1,
    occurred_at: captureAt(log),
    metadata: { worktivityLogId: log.ID, app: log.Title, domain: log.Url },
    raw: { worktivityLogId: log.ID },
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider,external_event_id" }).select("*").single();
  if (error) throw new Error(`create screenshot evidence event: ${error.message}`);
  return data;
}

/** The employee's timezone from onboarding, used for every local-day boundary
 * in this pipeline. Callers that already resolved a timezone pass it instead. */
export async function personTimezone(organizationId: string, personId: string, fallback = "UTC"): Promise<string> {
  const { data, error } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", organizationId).eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`load screenshot timezone: ${error.message}`);
  return typeof data?.timezone === "string" && data.timezone ? data.timezone : fallback;
}

type ScreenshotPolicyConfig = { sensitiveApps: string[]; sensitiveDomains: string[] };

/** Analyzes one Worktivity frame through the existing secure pipeline: policy
 * exclusion, encrypted retention, neutral observation, evidence event, and the
 * work_evidence mirror. Extracted so window-scoped preparation and the
 * day-scoped pipeline share exactly one behavior. A frame that fails is
 * recorded as failed (and stays retryable); it never throws past this point
 * unless the failure record itself cannot be written. */
async function processScreenshotLog(
  access: ScreenshotScope,
  personId: string,
  worktivityEmployeeId: string,
  date: string,
  log: ScreenshotLog,
  config: ScreenshotPolicyConfig,
  timezone: string,
) {
  const event = await createEvidenceEvent(access, personId, log);
  const sourceReference = `worktivity:screenshot:${log.ID}`;
  if (isExcludedScreenshot(log, config)) {
    const { data, error } = await db().from("work_screenshot_summaries").upsert({
      organization_id: access.organizationId,
      evidence_event_id: event.id,
      source_reference: sourceReference,
      processing_status: "excluded",
      visible_context: { exclusionKind: "policy" },
      failure_reason: "Excluded by sensitive app/domain policy.",
      prompt_version: PROMPT_VERSION,
      storage_path: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "evidence_event_id" }).select("*").single();
    if (error) throw new Error(`record excluded screenshot: ${error.message}`);
    return data;
  }
  let storagePath: string | null = null;
  let storageRetained = false;
  try {
    const imageResponse = await fetch(log.Screenshot as string, { signal: AbortSignal.timeout(SCREENSHOT_DOWNLOAD_TIMEOUT_MS) });
    if (!imageResponse.ok) throw new Error(`download Worktivity screenshot ${log.ID}: ${imageResponse.status}`);
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    storagePath = `${access.organizationId}/${personId}/${date}/${log.ID}-${digest.slice(0, 12)}.enc`;
    const encrypted = encryptScreenshot(bytes);
    const uploaded = await getStorageBackend().upload(BUCKET, storagePath, encrypted, { contentType: "application/octet-stream", upsert: true });
    if (uploaded.error) throw new Error(`store Worktivity screenshot: ${uploaded.error.message}`);
    storageRetained = true;
    const observation = await neutralSummary(log.Screenshot as string, log);
    if (observation.containsSensitiveContent) {
      const removed = await getStorageBackend().remove(BUCKET, [storagePath]);
      if (removed.error) throw new Error(`remove sensitive screenshot: ${removed.error.message}`);
      storageRetained = false;
      const { data, error } = await db().from("work_screenshot_summaries").upsert({
        organization_id: access.organizationId,
        evidence_event_id: event.id,
        storage_path: null,
        source_reference: sourceReference,
        summary: "Screenshot excluded after sensitive-content detection.",
        visible_context: { exclusionKind: "sensitive", sensitiveReason: observation.sensitiveReason },
        confidence: observation.confidence,
        processing_status: "excluded",
        model: MODEL,
        prompt_version: PROMPT_VERSION,
        failure_reason: observation.sensitiveReason
          ? `Excluded after sensitive-content detection: ${observation.sensitiveReason}.`
          : "Excluded after sensitive-content detection.",
        updated_at: new Date().toISOString(),
      }, { onConflict: "evidence_event_id" }).select("*").single();
      if (error) throw new Error(`record sensitive screenshot exclusion: ${error.message}`);
      await db().from("work_evidence_events").update({
        summary: "Screenshot excluded after sensitive-content detection.",
        metadata: { worktivityLogId: log.ID, needsReview: false, excludedSensitive: true, sensitiveReason: observation.sensitiveReason },
        updated_at: new Date().toISOString(),
      }).eq("id", event.id);
      return data;
    }
    const needsReview = observation.confidence < 0.6;
    const { data, error } = await db().from("work_screenshot_summaries").upsert({
      organization_id: access.organizationId,
      evidence_event_id: event.id,
      storage_path: storageRetained ? storagePath : null,
      source_reference: sourceReference,
      summary: observation.summary,
      visible_context: {
        visibleApp: observation.visibleApp,
        workContext: observation.workContext,
        possibleTaskReference: observation.possibleTaskReference,
        containsSensitiveContent: observation.containsSensitiveContent,
      },
      confidence: observation.confidence,
      encryption_metadata: { algorithm: "AES-256-GCM", contentType, originalExtension: extension },
      processing_status: "processed",
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "evidence_event_id" }).select("*").single();
    if (error) throw new Error(`save screenshot summary: ${error.message}`);
    // Feed the shared frame-analysis cache so a later admin audit reuses this
    // frame's fingerprint instead of downloading the image again. Best-effort:
    // a cache outage must never fail frame processing.
    if (worktivityEmployeeId) {
      try {
        await saveFrameFingerprint(db(), {
          employeeId: worktivityEmployeeId,
          screenshotId: log.ID,
          capturedAt: captureAt(log),
          localDate: date,
          app: log.Title ?? null,
          url: log.Url ?? null,
          activityLevel: log.ActivityLevel ?? null,
          fingerprint: await fingerprintScreenshot(bytes),
        });
      } catch (cacheError) {
        console.warn(`[worktivity] frame fingerprint cache write failed for ${log.ID}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
      }
    }
    await db().from("work_evidence_events").update({
      summary: observation.summary,
      metadata: { worktivityLogId: log.ID, app: log.Title, domain: log.Url, needsReview },
      updated_at: new Date().toISOString(),
    }).eq("id", event.id);
    // The capture instant, not the provider's create date, decides the
    // evidence day — the same value the evidence event is recorded with.
    await mirrorSummary(access, personId, event.id, captureAt(log), observation.summary, MODEL, timezone);
    return data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Screenshot analysis failed";
    const { data, error: failureRecordError } = await db().from("work_screenshot_summaries").upsert({
      organization_id: access.organizationId,
      evidence_event_id: event.id,
      storage_path: storageRetained ? storagePath : null,
      source_reference: sourceReference,
      processing_status: "failed",
      failure_reason: reason,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "evidence_event_id" }).select("*").single();
    if (failureRecordError || !data) {
      if (storageRetained && storagePath) await getStorageBackend().remove(BUCKET, [storagePath]);
      throw new Error(`record screenshot processing failure: ${failureRecordError?.message ?? "no row returned"}`);
    }
    return data;
  }
}

export async function summarizeWorktivityScreenshots(
  access: ScreenshotScope,
  personId: string,
  date: string,
  options: { execution?: ScreenshotExecution; maxScreenshots?: number; timezone?: string } = {},
) {
  const execution = options.execution ?? "feature";
  await assertScreenshotExecutionAllowed(access.organizationId, execution);
  const consent = await employeeTrackingConsent(access.organizationId, personId);
  if (!consent.tracking) throw new Error("current work-tracking consent is required before Worktivity evidence can be processed");
  if (!consent.screenshotAnalysis) throw new Error("employee screenshot-analysis consent is required");
  const { data: person, error: personError } = await db().from("work_people")
    .select("id, worktivity_employee_id")
    .eq("organization_id", access.organizationId)
    .eq("id", personId)
    .single();
  if (personError) throw new Error(`load Worktivity person: ${personError.message}`);
  if (!person.worktivity_employee_id) throw new Error("person has no Worktivity mapping");
  // Callers that derived the date from a schedule pass that same timezone; the
  // rest fall back to the employee's onboarding timezone.
  const timezone = options.timezone ?? await personTimezone(access.organizationId, personId);
  const bounds = localDayBounds(date, timezone);
  const [fetched, config, analyzed] = await Promise.all([
    fetchScreenshotsForDay(person.worktivity_employee_id, date, timezone),
    screenshotConfig(access.organizationId, personId),
    terminallyAnalyzedFrames(access.organizationId, personId, bounds),
  ]);
  // The day boundary is enforced again at the processing edge so no caller —
  // present or future — can ever analyze another frame under this date.
  const shots = framesWithinBounds(fetched, bounds);
  const terminalAfter = new Set(analyzed);
  const pending = shots.filter((shot) => !analyzed.has(`screenshot:${shot.ID}`));
  await ensureBucket();
  const results = [];
  const maxScreenshots = Math.max(1, Math.min(MAX_SCREENSHOTS_PER_RUN, Math.floor(options.maxScreenshots ?? DEFAULT_SCREENSHOTS_PER_RUN)));
  for (const log of sampleScreenshots(pending, maxScreenshots)) {
    const row = await processScreenshotLog(access, personId, person.worktivity_employee_id, date, log, config, timezone);
    if (String((row as any)?.processing_status ?? "") !== "failed") terminalAfter.add(`screenshot:${log.ID}`);
    results.push(row);
  }
  // Frames still lacking a terminal summary after this batch (failed frames are
  // retried, so they stay pending). Callers use this to keep an interactive
  // preparation going or to tell the user honestly what remains.
  const remaining = shots.filter((shot) => !terminalAfter.has(`screenshot:${shot.ID}`)).length;
  const failed = results.filter((row: any) => String(row?.processing_status ?? "") === "failed").length;
  return { date, logs: shots.length, sampled: results.length, summaries: results, pending: remaining, failed };
}

export type EodPreparation = {
  date: string;
  /** Frames analyzed by this batch (processed or excluded). */
  analyzed: number;
  /** Frames whose analysis failed in this batch and will be retried. */
  failed: number;
  /** Frames that still have no terminal summary after this batch. */
  pending: number;
  /** Frames Worktivity still serves for this day. */
  total: number;
  /** Frames this batch attempted. */
  sampled: number;
  /** True when the provider returned no retrievable frames for this day (for
   * example a day older than its retention); callers must stop waiting. */
  unavailable: boolean;
};

const prepareInFlight = new Map<string, Promise<EodPreparation>>();

/** Interactive, bounded preparation for one employee-day. Runs a small batch
 * inline (the EOD composer polls while frames remain), never writes the
 * scheduled hourly/EOD ledger markers, and dedupes concurrent calls for the
 * same person-day so two open composers cannot double-spend vision calls. */
export async function prepareEodScreenshots(
  access: ScreenshotScope,
  personId: string,
  date: string,
  options: { maxScreenshots?: number; execution?: ScreenshotExecution } = {},
): Promise<EodPreparation> {
  const key = `${access.organizationId}:${personId}:${date}`;
  const existing = prepareInFlight.get(key);
  if (existing) return existing;
  const run = (async (): Promise<EodPreparation> => {
    const batch = Math.max(1, Math.min(DEFAULT_SCREENSHOTS_PER_RUN, Math.floor(options.maxScreenshots ?? PREPARE_SCREENSHOTS_PER_REQUEST)));
    const result = await summarizeWorktivityScreenshots(access, personId, date, {
      execution: options.execution ?? "feature",
      maxScreenshots: batch,
    });
    const analyzed = result.summaries.filter((row: any) => ["processed", "excluded"].includes(String(row?.processing_status ?? ""))).length;
    const preparation: EodPreparation = {
      date,
      analyzed,
      failed: result.failed,
      pending: result.pending,
      total: result.logs,
      sampled: result.sampled,
      unavailable: result.logs === 0,
    };
    await db().from("work_audit_log").insert({
      organization_id: access.organizationId,
      actor_user_id: null,
      action: "screenshot.on_demand_prepared",
      target_type: "workday",
      target_id: key,
      metadata: { source: "eod_prepare", shiftDate: date, personId, batch, ...preparation },
    }).then(() => undefined, () => undefined);
    return preparation;
  })().finally(() => prepareInFlight.delete(key));
  prepareInFlight.set(key, run);
  return run;
}

export type ScreenshotWindowCandidate = {
  summaryId: string;
  evidenceEventId: string;
  /** `screenshot:<Worktivity frame id>`, the stable external event identity. */
  externalId: string;
  capturedAt: string;
  summary: string;
  visibleApp: string | null;
  workContext: string | null;
  possibleTaskReference: string | null;
  confidence: number;
  /** True when the encrypted frame is still retained and previewable. */
  retained: boolean;
};

export type ScreenshotWindowPreparation = {
  window: { startIso: string; endIso: string; timezone: string };
  /** Terminal, non-excluded frames usable as interval evidence, oldest first. */
  candidates: ScreenshotWindowCandidate[];
  counts: {
    providerFrames: number;
    processed: number;
    retained: number;
    excludedPolicy: number;
    excludedSensitive: number;
    /** Failed analysis, or a processed frame whose raw image left retention. */
    unavailable: number;
    pending: number;
    analyzedThisCall: number;
  };
};

const MAX_WINDOW_MS = 6 * 60 * 60_000;
const WINDOW_PREPARE_MAX_FRAMES = 12;

type WindowSummaryRecord = {
  eventId: string;
  occurredAt: string;
  summary: Record<string, any>;
};

/** Every screenshot evidence event recorded in [start, end), keyed by its
 * `screenshot:<id>` external id, with the terminal (or pending) summary row. */
async function windowSummaries(organizationId: string, personId: string, bounds: { startIso: string; endIso: string }) {
  const events = await db().from("work_evidence_events").select("id,external_event_id,occurred_at")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("provider", "worktivity")
    .like("external_event_id", "screenshot:%")
    .gte("occurred_at", bounds.startIso).lt("occurred_at", bounds.endIso);
  if (events.error) throw new Error(`load window screenshot events: ${events.error.message}`);
  const records = new Map<string, WindowSummaryRecord>();
  if (!events.data?.length) return records;
  const summaries = await db().from("work_screenshot_summaries")
    .select("id,evidence_event_id,processing_status,failure_reason,storage_path,expires_at,deleted_at,summary,visible_context,confidence")
    .in("evidence_event_id", (events.data as Array<Record<string, any>>).map((row) => String(row.id)));
  if (summaries.error) throw new Error(`load window screenshot summaries: ${summaries.error.message}`);
  const summaryByEvent = new Map((summaries.data ?? []).map((row: any) => [String(row.evidence_event_id), row]));
  for (const event of events.data as Array<Record<string, any>>) {
    records.set(String(event.external_event_id), {
      eventId: String(event.id),
      occurredAt: event.occurred_at instanceof Date ? event.occurred_at.toISOString() : String(event.occurred_at ?? ""),
      summary: summaryByEvent.get(String(event.id)) ?? { processing_status: "pending" },
    });
  }
  return records;
}

function terminalWindowIds(records: Map<string, WindowSummaryRecord>) {
  return new Set([...records.entries()]
    .filter(([, record]) => ["processed", "excluded"].includes(String(record.summary.processing_status)))
    .map(([external]) => external));
}

/** Window-scoped preparation through the existing secure screenshot pipeline.
 * Reuses terminally analyzed frames, processes only missing eligible frames
 * (bounded), and returns the exact persisted summary records available for an
 * activity interval. Never writes scheduled hourly/EOD ledger markers. */
export async function prepareScreenshotWindow(input: {
  organizationId: string;
  personId: string;
  windowStart: string;
  windowEnd: string;
  maxFrames?: number;
  timezone?: string;
}): Promise<ScreenshotWindowPreparation> {
  const startMs = Date.parse(input.windowStart);
  const endMs = Date.parse(input.windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("activity interval window timestamps must be valid ISO instants");
  if (endMs <= startMs) throw new Error("activity interval window must end after it starts");
  if (endMs - startMs > MAX_WINDOW_MS) throw new Error("activity interval window is longer than the supported maximum");
  const access: ScreenshotScope = { organizationId: input.organizationId };
  await assertScreenshotExecutionAllowed(access.organizationId, "feature");
  const consent = await employeeTrackingConsent(access.organizationId, input.personId);
  if (!consent.tracking) throw new Error("current work-tracking consent is required before Worktivity evidence can be processed");
  if (!consent.screenshotAnalysis) throw new Error("employee screenshot-analysis consent is required");
  const { data: person, error: personError } = await db().from("work_people")
    .select("id, worktivity_employee_id")
    .eq("organization_id", access.organizationId)
    .eq("id", input.personId)
    .single();
  if (personError) throw new Error(`load Worktivity person: ${personError.message}`);
  if (!person.worktivity_employee_id) throw new Error("person has no Worktivity mapping");
  const timezone = input.timezone ?? await personTimezone(access.organizationId, input.personId);
  const bounds = { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
  const dates = [localDateForTimezone(new Date(startMs), timezone)];
  const lastDate = localDateForTimezone(new Date(endMs - 1), timezone);
  if (lastDate !== dates[0]) dates.push(lastDate);

  const fetched = new Map<string, WtScreenshot>();
  for (const date of dates) {
    for (const frame of await fetchScreenshotsForDay(person.worktivity_employee_id, date, timezone)) fetched.set(frame.ID, frame);
  }
  const frames = framesWithinBounds([...fetched.values()], bounds)
    .sort((left, right) => captureAt(left).localeCompare(captureAt(right)));
  const config = await screenshotConfig(access.organizationId, input.personId);
  const existing = await windowSummaries(access.organizationId, input.personId, bounds);
  const pending = frames.filter((frame) => !terminalWindowIds(existing).has(`screenshot:${frame.ID}`));

  await ensureBucket();
  const maxFrames = Math.max(1, Math.min(MAX_SCREENSHOTS_PER_RUN, Math.floor(input.maxFrames ?? WINDOW_PREPARE_MAX_FRAMES)));
  let analyzedThisCall = 0;
  for (const log of sampleScreenshots(pending, maxFrames)) {
    const captureDate = localDateForTimezone(new Date(captureAt(log)), timezone);
    const row = await processScreenshotLog(access, input.personId, person.worktivity_employee_id, captureDate, log, config, timezone);
    if (String((row as any)?.processing_status ?? "") !== "failed") analyzedThisCall += 1;
  }

  const refreshed = await windowSummaries(access.organizationId, input.personId, bounds);
  const candidates: ScreenshotWindowCandidate[] = [];
  const counts = { providerFrames: frames.length, processed: 0, retained: 0, excludedPolicy: 0, excludedSensitive: 0, unavailable: 0, pending: 0, analyzedThisCall };
  for (const [external, record] of refreshed) {
    const row = record.summary;
    const status = String(row.processing_status);
    if (status === "excluded") {
      if (screenshotExclusionKind(row.visible_context, row.failure_reason) === "policy") counts.excludedPolicy += 1;
      else counts.excludedSensitive += 1;
      continue;
    }
    if (status === "failed") { counts.unavailable += 1; continue; }
    const context = (row.visible_context ?? {}) as Record<string, unknown>;
    const retained = isRetainedScreenshotAvailable(row);
    if (!retained) counts.unavailable += 1;
    counts.processed += 1;
    if (retained) counts.retained += 1;
    candidates.push({
      summaryId: String(row.id),
      evidenceEventId: record.eventId,
      capturedAt: record.occurredAt,
      summary: String(row.summary ?? ""),
      visibleApp: context.visibleApp != null ? String(context.visibleApp) : null,
      workContext: context.workContext != null ? String(context.workContext) : null,
      possibleTaskReference: context.possibleTaskReference != null ? String(context.possibleTaskReference) : null,
      confidence: Number(row.confidence ?? 0),
      retained,
      externalId: external,
    });
  }
  const terminalAfter = terminalWindowIds(refreshed);
  counts.pending = frames.filter((frame) => !terminalAfter.has(`screenshot:${frame.ID}`)).length;
  candidates.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  return { window: { ...bounds, timezone }, candidates, counts };
}

/** Internal decrypt-and-resize for the interval synthesizer. This is system
 * processing, not a human viewing a frame, so it is not written to the
 * screenshot access log (which records employee/manager preview views). */
export async function retainedScreenshotImage(summaryId: string) {
  const { data: summary, error } = await db().from("work_screenshot_summaries")
    .select("id,storage_path,expires_at,deleted_at,encryption_metadata")
    .eq("id", summaryId).maybeSingle();
  if (error) throw new Error(`load retained screenshot: ${error.message}`);
  if (!summary || !isRetainedScreenshotAvailable(summary)) return null;
  const { data: encrypted, error: downloadError } = await getStorageBackend().download(BUCKET, summary.storage_path as string);
  if (downloadError || !encrypted) return null;
  const plaintext = Buffer.from(decryptScreenshot(new Uint8Array(encrypted.arrayBuffer)));
  const contentType = String((summary.encryption_metadata as Json | null)?.contentType || "image/jpeg");
  try {
    const resized = await sharp(plaintext).rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return { bytes: resized, contentType: "image/jpeg" };
  } catch {
    return { bytes: plaintext, contentType };
  }
}

/**
 * Create at most one genuine encrypted summary before feature activation.
 * This is intentionally server-only (there is no route for it), uses the
 * real organization/person identifiers supplied by the operator, requires a
 * completed workday, and records system—not user—for audit attribution.
 */
export async function runWorkOsScreenshotReadinessSmoke(input: { organizationId: string; personId: string; date: string }) {
  if (!process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY || !process.env.CRON_SECRET) {
    throw new Error("screenshot readiness smoke is not ready: encryption key and cron secret are required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("readiness smoke date must be YYYY-MM-DD");
  const supabase = db();
  const [{ data: closedSession, error: sessionError }, { data: closedPlan, error: planError }] = await Promise.all([
    supabase.from("work_sessions").select("id").eq("organization_id", input.organizationId).eq("person_id", input.personId)
      .eq("shift_date", input.date).not("clocked_out_at", "is", null).limit(1).maybeSingle(),
    supabase.from("work_daily_plans").select("id").eq("organization_id", input.organizationId).eq("person_id", input.personId)
      .eq("shift_date", input.date).eq("status", "closed").limit(1).maybeSingle(),
  ]);
  if (sessionError) throw new Error(`load readiness-smoke session: ${sessionError.message}`);
  if (planError) throw new Error(`load readiness-smoke workday: ${planError.message}`);
  if (!closedSession && !closedPlan) throw new Error("readiness smoke requires a clocked-out session or closed workday");
  const result = await summarizeWorktivityScreenshots(
    { organizationId: input.organizationId }, input.personId, input.date,
    { execution: "readiness_smoke", maxScreenshots: 1 },
  );
  const targetId = `${input.organizationId}:${input.personId}:${input.date}`;
  const { error: auditError } = await supabase.from("work_audit_log").insert({
    organization_id: input.organizationId,
    actor_user_id: null,
    action: "screenshot.readiness_smoke_completed",
    target_type: "workday",
    target_id: targetId,
    metadata: { source: "server_readiness_smoke", personId: input.personId, shiftDate: input.date, sampled: result.sampled },
  });
  if (auditError) throw new Error(`audit screenshot readiness smoke: ${auditError.message}`);
  return result;
}

/** Bounded cron work: only mapped people with a completed session (or a prior
 * local workday) are candidates. The consent check inside summarization is the
 * final fail-closed gate. */
export async function syncDueWorkOsScreenshots(limit = 12) {
  if (!process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY || !process.env.CRON_SECRET) {
    throw new Error("screenshot due sync is not ready: encryption key and cron secret are required");
  }
  const supabase = db();
  const [{ data: clockedOut, error: clockedOutError }, { data: completedDays, error: completedDaysError }] = await Promise.all([
    supabase.from("work_sessions")
    .select("organization_id,person_id,shift_date,timezone,clocked_out_at, person:work_people!inner(worktivity_employee_id)")
      .not("clocked_out_at", "is", null).order("clocked_out_at", { ascending: false }).limit(limit * 3),
    supabase.from("work_daily_plans")
      .select("organization_id,person_id,shift_date, person:work_people!inner(worktivity_employee_id)")
      .eq("status", "closed").order("shift_date", { ascending: false }).limit(limit * 3),
  ]);
  if (clockedOutError) throw new Error(`load clocked-out screenshot candidates: ${clockedOutError.message}`);
  if (completedDaysError) throw new Error(`load completed-workday screenshot candidates: ${completedDaysError.message}`);
  const completedPersonIds = [...new Set((completedDays ?? []).map((row: any) => String(row.person_id)))];
  const completedOrganizationIds = [...new Set((completedDays ?? []).map((row: any) => String(row.organization_id)))];
  const { data: onboardingRows, error: onboardingError } = completedPersonIds.length
    ? await supabase.from("work_employee_onboarding").select("organization_id,person_id,timezone")
      .in("person_id", completedPersonIds).in("organization_id", completedOrganizationIds)
    : { data: [], error: null };
  if (onboardingError) throw new Error(`load completed-workday timezones: ${onboardingError.message}`);
  const timezoneByPerson = new Map((onboardingRows ?? []).map((row: any) => [`${row.organization_id}:${row.person_id}`, row.timezone]));
  const candidates = [
    ...(clockedOut ?? []).map((row: any) => ({ ...row, candidateSource: "clocked_out" })),
    ...(completedDays ?? []).map((row: any) => ({ ...row, timezone: timezoneByPerson.get(`${row.organization_id}:${row.person_id}`) ?? "UTC", candidateSource: "completed_workday" })),
  ].sort((left, right) => String(right.shift_date).localeCompare(String(left.shift_date)));
  const results: Array<{ organizationId: string; personId: string; date: string; status: string }> = [];
  const seenCandidates = new Set<string>();
  for (const row of candidates) {
    if (results.length >= limit) break;
    const shiftDate = dateOnly(row.shift_date);
    if (!shiftDate) continue;
    const candidateKey = `${row.organization_id}:${row.person_id}:${shiftDate}`;
    if (seenCandidates.has(candidateKey)) continue;
    seenCandidates.add(candidateKey);
    const { data: organization, error: organizationError } = await supabase.from("work_organizations").select("feature_flags")
      .eq("id", row.organization_id).maybeSingle();
    if (organizationError || (organization?.feature_flags as Json | null)?.screenshot_summaries !== true) continue;
    const person = Array.isArray(row.person) ? row.person[0] : row.person as Json | null;
    if (!person?.worktivity_employee_id) continue;
    const consent = await employeeTrackingConsent(row.organization_id as string, row.person_id as string);
    if (!consent.tracking || !consent.screenshotAnalysis) continue;
    const timezone = typeof row.timezone === "string" && row.timezone ? row.timezone : "UTC";
    if (row.candidateSource === "completed_workday" && shiftDate >= localDateForTimezone(new Date(), timezone)) continue;
    const nextDate = new Date(`${shiftDate}T12:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const startAt = zonedDateTimeToUtc(shiftDate, "00:00", timezone).toISOString();
    const endAt = zonedDateTimeToUtc(nextDate.toISOString().slice(0, 10), "00:00", timezone).toISOString();
    const { data: existing, error: existingError } = await supabase.from("work_evidence_events").select("id")
      .eq("organization_id", row.organization_id).eq("person_id", row.person_id).eq("provider", "worktivity")
      .like("external_event_id", "screenshot:%").gte("occurred_at", startAt).lt("occurred_at", endAt).limit(1);
    if (existingError || existing?.length) continue;
    const { data: ledger, error: completedError } = await supabase.from("work_audit_log").select("action,created_at")
      .eq("organization_id", row.organization_id)
      .in("action", ["screenshot.due_sync_completed", "screenshot.due_sync_unavailable"])
      .eq("target_type", "workday").eq("target_id", candidateKey)
      .order("created_at", { ascending: false }).limit(4);
    if (completedError) continue;
    const ledgerRows = (ledger ?? []) as Array<{ action: string; created_at: unknown }>;
    if (ledgerRows.some((entry) => entry.action === "screenshot.due_sync_completed")) continue;
    // A day that yielded nothing is retried with a cooldown instead of on every
    // tick: repeated empties would otherwise consume the run limit and starve
    // older candidates forever.
    const lastUnavailable = ledgerRows.find((entry) => entry.action === "screenshot.due_sync_unavailable")?.created_at;
    const lastUnavailableAt = lastUnavailable instanceof Date ? lastUnavailable.getTime() : Date.parse(String(lastUnavailable ?? ""));
    if (Number.isFinite(lastUnavailableAt) && Date.now() - lastUnavailableAt < 24 * 60 * 60_000) continue;
    const access: ScreenshotScope = { organizationId: row.organization_id as string };
    try {
      const run = await summarizeWorktivityScreenshots(access, row.person_id as string, shiftDate, { timezone });
      if (run.logs === 0) {
        // Never settle a day that yielded nothing: the provider may serve its
        // frames later (or a transient failure emptied the response), and a
        // completion marker would permanently skip it. Record the attempt so
        // the failure is visible without closing the day.
        const { error: auditError } = await supabase.from("work_audit_log").insert({
          organization_id: row.organization_id,
          actor_user_id: null,
          action: "screenshot.due_sync_unavailable",
          target_type: "workday",
          target_id: candidateKey,
          metadata: { source: "scheduled_due_sync", shiftDate, personId: row.person_id, reason: "no frames retrievable for the day" },
        });
        if (auditError) throw new Error(`audit unavailable screenshot due sync: ${auditError.message}`);
        results.push({ organizationId: row.organization_id as string, personId: row.person_id as string, date: shiftDate, status: "unavailable" });
        continue;
      }
      const { error: auditError } = await supabase.from("work_audit_log").insert({
        organization_id: row.organization_id,
        actor_user_id: null,
        action: "screenshot.due_sync_completed",
        target_type: "workday",
        target_id: candidateKey,
        metadata: { source: "scheduled_due_sync", shiftDate, personId: row.person_id, frames: run.logs, sampled: run.sampled },
      });
      if (auditError) throw new Error(`audit screenshot due sync: ${auditError.message}`);
      results.push({ organizationId: row.organization_id as string, personId: row.person_id as string, date: shiftDate, status: "processed" });
    } catch (cause) {
      results.push({ organizationId: row.organization_id as string, personId: row.person_id as string, date: shiftDate, status: cause instanceof Error ? cause.message : "failed" });
    }
  }
  return { attempted: results.length, results };
}

export type ScreenshotRunMode = "hourly" | "eod";

/** Decides whether a scheduled analysis run is due for one employee, on the
 * employee's local clock. Pure so the due math is unit-testable.
 * Rules: an end-of-day pass at shift end minus the lead (or right after an
 * early clock-out); otherwise hourly top-ups between window start and the
 * end-of-day boundary. A completed end-of-day pass settles the day. */
export function screenshotRunMode(input: {
  now: Date;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  intervalMinutes?: number | null;
  eodLeadMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  clockedOutAt?: string | null;
  lastHourlyAt?: string | null;
  eodCompleted?: boolean;
}): ScreenshotRunMode | null {
  if (input.eodCompleted) return null;
  const localDate = localDateForTimezone(input.now, input.timezone);
  const at = (time: string) => Date.parse(zonedDateTimeToUtc(localDate, time, input.timezone).toISOString());
  const shiftStartAt = at(input.shiftStart);
  const shiftEndAt = at(input.shiftEnd);
  if (!Number.isFinite(shiftStartAt) || !Number.isFinite(shiftEndAt)) return null;
  const now = input.now.getTime();
  const lead = Math.max(0, Number(input.eodLeadMinutes ?? 30) || 0) * 60_000;
  const eodAt = shiftEndAt - lead;
  const clockedOutAt = input.clockedOutAt ? Date.parse(input.clockedOutAt) : Number.NaN;
  if (Number.isFinite(clockedOutAt) && now >= clockedOutAt + 2 * 60_000) return "eod";
  if (now >= eodAt) return "eod";
  const windowStartAt = input.windowStart ? at(input.windowStart) : shiftStartAt;
  const windowEndAt = input.windowEnd ? at(input.windowEnd) : shiftEndAt;
  const hourlyUntil = Math.min(Number.isFinite(windowEndAt) ? windowEndAt : shiftEndAt, eodAt);
  if (now < windowStartAt || now >= hourlyUntil) return null;
  const interval = Math.max(15, Number(input.intervalMinutes ?? 60) || 60) * 60_000;
  const lastHourlyAt = input.lastHourlyAt ? Date.parse(input.lastHourlyAt) : Number.NaN;
  return !Number.isFinite(lastHourlyAt) || now >= lastHourlyAt + interval ? "hourly" : null;
}

const SCHEDULE_AUDIT_TARGET = (organizationId: string, personId: string, date: string) => `${organizationId}:${personId}:${date}`;

/** Bounded cron work for the per-employee schedule: hourly analysis during the
 * shift plus the end-of-day pass. Consent and the organization flag remain
 * fail-closed gates, and terminally analyzed frames are never re-processed. */
export async function runScheduledScreenshotAnalysis(limit = 8) {
  if (!process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY || !process.env.CRON_SECRET) {
    throw new Error("screenshot scheduled analysis is not ready: encryption key and cron secret are required");
  }
  const people = await db().from("work_people")
    .select("id,organization_id").eq("active", true).not("worktivity_employee_id", "is", null)
    .limit(Math.max(limit * 6, limit));
  if (people.error) throw new Error(`load scheduled screenshot candidates: ${people.error.message}`);
  const now = new Date();
  const results: Array<{ organizationId: string; personId: string; date: string; mode: ScreenshotRunMode; status: string; sampled?: number }> = [];
  for (const person of (people.data ?? []) as Array<{ id: string; organization_id: string }>) {
    if (results.length >= limit) break;
    const schedules = await db().from("work_schedules").select("*")
      .eq("organization_id", person.organization_id).eq("person_id", person.id).eq("active", true)
      .order("effective_from", { ascending: false }).limit(4);
    if (schedules.error) continue;
    const timezone = String((schedules.data ?? [])[0]?.timezone ?? "UTC");
    const localDate = localDateForTimezone(now, timezone);
    const schedule = (schedules.data ?? []).find((row: any) => {
      const from = dateOnly(row.effective_from);
      const to = dateOnly(row.effective_to);
      return (!from || from <= localDate) && (!to || to >= localDate);
    });
    if (!schedule || schedule.screenshot_analysis_enabled === false) continue;
    const exception = await db().from("work_schedule_exceptions").select("kind,shift_start,shift_end")
      .eq("organization_id", person.organization_id).eq("person_id", person.id).eq("exception_date", localDate).maybeSingle();
    if (exception.error || exception.data?.kind === "leave") continue;
    const shiftStart = String(exception.data?.shift_start ?? schedule.shift_start).slice(0, 5);
    const shiftEnd = String(exception.data?.shift_end ?? schedule.shift_end).slice(0, 5);
    const session = await db().from("work_sessions").select("clocked_out_at")
      .eq("organization_id", person.organization_id).eq("person_id", person.id).eq("shift_date", localDate)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const target = SCHEDULE_AUDIT_TARGET(person.organization_id, person.id, localDate);
    const audits = await db().from("work_audit_log").select("action,created_at")
      .eq("organization_id", person.organization_id).eq("target_type", "workday").eq("target_id", target)
      .in("action", ["screenshot.hourly_completed", "screenshot.eod_completed"])
      .order("created_at", { ascending: false }).limit(50);
    if (audits.error) continue; // never re-run a day whose ledger cannot be read
    const auditRows = (audits.data ?? []) as Array<{ action: string; created_at: unknown }>;
    const eodCompleted = auditRows.some((row) => row.action === "screenshot.eod_completed");
    const lastHourly = auditRows.find((row) => row.action === "screenshot.hourly_completed")?.created_at;
    const mode = screenshotRunMode({
      now, timezone, shiftStart, shiftEnd,
      intervalMinutes: schedule.screenshot_analysis_interval_minutes,
      eodLeadMinutes: schedule.screenshot_analysis_eod_lead_minutes,
      windowStart: schedule.screenshot_analysis_start ? String(schedule.screenshot_analysis_start).slice(0, 5) : null,
      windowEnd: schedule.screenshot_analysis_end ? String(schedule.screenshot_analysis_end).slice(0, 5) : null,
      clockedOutAt: (session.data?.clocked_out_at as string | null) ?? null,
      lastHourlyAt: lastHourly instanceof Date ? lastHourly.toISOString() : (lastHourly as string | null) ?? null,
      eodCompleted,
    });
    if (!mode) continue;
    const organization = await db().from("work_organizations").select("feature_flags,legacy_owner_id,created_by")
      .eq("id", person.organization_id).maybeSingle();
    if (organization.error || (organization.data?.feature_flags as Json | null)?.screenshot_summaries !== true) continue;
    const consent = await employeeTrackingConsent(person.organization_id, person.id);
    if (!consent.tracking || !consent.screenshotAnalysis) continue;
    const actorId = (organization.data?.legacy_owner_id || organization.data?.created_by) as string | null;
    if (!actorId) continue;
    const access = {
      ctx: { user: { id: actorId }, profile: { id: actorId } },
      organizationId: person.organization_id,
      organizationOwnerId: actorId,
      role: "admin",
      personId: person.id,
      membershipId: `system-screenshot-schedule:${person.id}`,
      featureFlags: {},
    } as unknown as WorkOsAccess;
    try {
      const cap = mode === "eod" ? SCHEDULED_EOD_CAP : SCHEDULED_HOURLY_CAP;
      const run = await summarizeWorktivityScreenshots(access, person.id, localDate, { maxScreenshots: cap, timezone });
      const { error: auditError } = await db().from("work_audit_log").insert({
        organization_id: person.organization_id,
        actor_user_id: null,
        action: mode === "eod" ? "screenshot.eod_completed" : "screenshot.hourly_completed",
        target_type: "workday",
        target_id: target,
        metadata: { source: "scheduled_screenshot_sync", mode, shiftDate: localDate, personId: person.id, frames: run.logs, sampled: run.sampled, cap },
      });
      if (auditError) throw new Error(`audit scheduled screenshot sync: ${auditError.message}`);
      results.push({ organizationId: person.organization_id, personId: person.id, date: localDate, mode, status: "processed", sampled: run.sampled });
    } catch (cause) {
      results.push({ organizationId: person.organization_id, personId: person.id, date: localDate, mode, status: cause instanceof Error ? cause.message : "failed" });
    }
  }
  return { attempted: results.length, results };
}

export async function accessWorkOsScreenshot(access: WorkOsAccess, summaryId: string, reason: string) {
  if (!reason.trim()) throw new Error("reason is required to access a retained screenshot");
  const { data: summary, error } = await db().from("work_screenshot_summaries")
    .select("*, evidence:work_evidence_events(person_id, correction_status, metadata)")
    .eq("organization_id", access.organizationId)
    .eq("id", summaryId)
    .single();
  if (error) throw new Error(`load screenshot summary: ${error.message}`);
  const evidence = summary.evidence as Json;
  if (!evidence.person_id || !(await canAccessWorkOsPerson(access, String(evidence.person_id)))) {
    throw new Error("forbidden");
  }
  const ownScreenshot = access.personId && evidence.person_id === access.personId;
  const metadata = (evidence.metadata ?? {}) as Json;
  const reviewable = evidence.correction_status === "disputed" || metadata.needsReview === true;
  if (!canAccessRawScreenshot({ ownScreenshot: !!ownScreenshot, reviewable })) throw new Error("raw screenshot access is limited to flagged or disputed review");
  if (!isRetainedScreenshotAvailable(summary)) {
    throw new Error("retained screenshot is no longer available");
  }
  const { data: encrypted, error: downloadError } = await getStorageBackend().download(BUCKET, summary.storage_path);
  if (downloadError || !encrypted) throw new Error(`load retained screenshot: ${downloadError?.message ?? "not found"}`);
  const plaintext = decryptScreenshot(new Uint8Array(encrypted.arrayBuffer));
  const contentType = String((summary.encryption_metadata as Json | null)?.contentType || "image/jpeg");
  const { error: logError } = await db().from("work_screenshot_access_log").insert({
    organization_id: access.organizationId,
    screenshot_summary_id: summaryId,
    accessed_by: access.ctx.user.id,
    reason: reason.trim(),
  });
  if (logError) throw new Error(`audit screenshot access: ${logError.message}`);
  return { url: `data:${contentType};base64,${plaintext.toString("base64")}`, expiresInSeconds: 0 };
}

export async function deleteExpiredWorkOsScreenshots() {
  const { data: expired, error } = await db().from("work_screenshot_summaries")
    .select("id, storage_path")
    .is("deleted_at", null)
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error) throw new Error(`load expired screenshots: ${error.message}`);
  const paths = (expired ?? []).map((item: any) => item.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const removed = await getStorageBackend().remove(BUCKET, paths);
    if (removed.error) throw new Error(`delete expired screenshots: ${removed.error.message}`);
  }
  const ids = (expired ?? []).map((item: any) => item.id);
  if (ids.length) {
    const { error: updateError } = await db().from("work_screenshot_summaries")
      .update({ storage_path: null, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updateError) throw new Error(`mark expired screenshots deleted: ${updateError.message}`);
    // Activity Interval Reviews keep their text after the raw image expires;
    // the interval only records that its evidence left retention.
    const { data: affected, error: affectedError } = await db().from("work_activity_interval_evidence")
      .select("interval_id").in("screenshot_summary_id", ids);
    if (affectedError) throw new Error(`load interval evidence for retention: ${affectedError.message}`);
    const intervalIds = [...new Set((affected ?? []).map((row: any) => String(row.interval_id)))];
    if (intervalIds.length) {
      const { error: intervalError } = await db().from("work_activity_intervals")
        .update({ evidence_expired_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in("id", intervalIds).is("evidence_expired_at", null);
      if (intervalError) throw new Error(`mark activity interval evidence expired: ${intervalError.message}`);
    }
  }
  // Derived hourly rollups follow the images out: a frame retained for 30 days
  // has a local date at or before this cutoff, so every hour that can no longer
  // be rebuilt from retained frames is removed here.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const { error: hoursError } = await db().from("work_screenshot_hourly_summaries").delete().lte("local_date", cutoff);
  if (hoursError) throw new Error(`delete expired hourly screenshot summaries: ${hoursError.message}`);
  return { deleted: ids.length };
}

export type ScreenshotExclusionKind = "policy" | "sensitive";

/** Classifies an excluded frame from its stored context, with a fallback for
 * rows written before exclusion kinds were recorded. */
export function screenshotExclusionKind(visibleContext: unknown, failureReason: unknown): ScreenshotExclusionKind {
  const kind = visibleContext && typeof visibleContext === "object" ? (visibleContext as { exclusionKind?: unknown }).exclusionKind : null;
  if (kind === "policy" || kind === "sensitive") return kind;
  return /sensitive app\/domain policy/i.test(String(failureReason ?? "")) ? "policy" : "sensitive";
}

export type EodScreenshotItem = {
  summaryId: string;
  capturedAt: string;
  visibleApp: string | null;
  summary: string;
  confidence: number;
};

export type EodScreenshotGallery = {
  processed: number;
  excludedPolicy: number;
  excludedSensitive: number;
  unavailable: number;
  /** Recorded frames still awaiting a terminal analysis (failed frames retry,
   * so they count as pending until they succeed or are excluded). */
  pending: number;
  /** Frames recorded for the day so far. */
  total: number;
  viewable: EodScreenshotItem[];
};

/** Viewable frames for one local day plus an honest breakdown of the rest.
 * Only retained, unexpired images are listed; sensitive and policy exclusions
 * have no image left to show. */
export async function listEodScreenshots(organizationId: string, personId: string, date: string, timezone?: string): Promise<EodScreenshotGallery> {
  const gallery: EodScreenshotGallery = { processed: 0, excludedPolicy: 0, excludedSensitive: 0, unavailable: 0, pending: 0, total: 0, viewable: [] };
  const bounds = localDayBounds(date, timezone ?? await personTimezone(organizationId, personId));
  const events = await db().from("work_evidence_events").select("id,occurred_at")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("provider", "worktivity")
    .like("external_event_id", "screenshot:%")
    .gte("occurred_at", bounds.startIso).lt("occurred_at", bounds.endIso);
  if (events.error) throw new Error(`load screenshot gallery events: ${events.error.message}`);
  const occurredBy = new Map((events.data ?? []).map((row: any) => {
    const at = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at ?? "");
    return [String(row.id), at];
  }));
  const ids = [...occurredBy.keys()];
  gallery.total = ids.length;
  if (!ids.length) return gallery;
  const rows = await db().from("work_screenshot_summaries")
    .select("id,processing_status,failure_reason,storage_path,expires_at,deleted_at,summary,visible_context,confidence,evidence_event_id")
    .in("evidence_event_id", ids);
  if (rows.error) throw new Error(`load screenshot gallery: ${rows.error.message}`);
  const terminal = new Set<string>();
  for (const row of (rows.data ?? []) as Array<Record<string, any>>) {
    const context = (row.visible_context ?? {}) as Record<string, unknown>;
    if (row.processing_status === "excluded") {
      terminal.add(String(row.evidence_event_id));
      if (screenshotExclusionKind(context, row.failure_reason) === "policy") gallery.excludedPolicy += 1;
      else gallery.excludedSensitive += 1;
      continue;
    }
    if (row.processing_status === "failed") { gallery.unavailable += 1; continue; }
    terminal.add(String(row.evidence_event_id));
    if (!isRetainedScreenshotAvailable(row)) { gallery.unavailable += 1; continue; }
    gallery.processed += 1;
    gallery.viewable.push({
      summaryId: String(row.id),
      capturedAt: occurredBy.get(String(row.evidence_event_id)) ?? "",
      visibleApp: context.visibleApp != null ? String(context.visibleApp) : null,
      summary: String(row.summary ?? ""),
      confidence: Number(row.confidence ?? 0),
    });
  }
  gallery.viewable.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  gallery.pending = ids.filter((id) => !terminal.has(id)).length;
  return gallery;
}

export type ScreenshotPreviewSize = "thumb" | "preview" | "full";

/** Decrypts one retained screenshot and returns displayable bytes. Own frames
 * are viewable for the employee's own EOD draft; everyone else follows the
 * flagged/disputed review rule. Every view is audited. */
export async function previewWorkOsScreenshot(access: WorkOsAccess, summaryId: string, size: ScreenshotPreviewSize) {
  const { data: summary, error } = await db().from("work_screenshot_summaries")
    .select("*, evidence:work_evidence_events(person_id, correction_status, metadata)")
    .eq("organization_id", access.organizationId)
    .eq("id", summaryId)
    .single();
  if (error) throw new Error(`load screenshot preview: ${error.message}`);
  const evidence = summary.evidence as Json;
  if (!evidence?.person_id || !(await canAccessWorkOsPerson(access, String(evidence.person_id)))) throw new Error("forbidden");
  const ownScreenshot = access.personId && evidence.person_id === access.personId;
  const metadata = (evidence.metadata ?? {}) as Json;
  const reviewable = evidence.correction_status === "disputed" || metadata.needsReview === true;
  if (!canAccessRawScreenshot({ ownScreenshot: !!ownScreenshot, reviewable })) throw new Error("raw screenshot access is limited to flagged or disputed review");
  if (!isRetainedScreenshotAvailable(summary)) throw new Error("retained screenshot is no longer available");
  const { data: encrypted, error: downloadError } = await getStorageBackend().download(BUCKET, summary.storage_path);
  if (downloadError || !encrypted) throw new Error(`load retained screenshot: ${downloadError?.message ?? "not found"}`);
  const plaintext = Buffer.from(decryptScreenshot(new Uint8Array(encrypted.arrayBuffer)));
  const contentType = String((summary.encryption_metadata as Json | null)?.contentType || "image/jpeg");
  const { error: logError } = await db().from("work_screenshot_access_log").insert({
    organization_id: access.organizationId,
    screenshot_summary_id: summaryId,
    accessed_by: access.ctx.user.id,
    reason: ownScreenshot ? "EOD draft review (own screenshots)" : "Evidence review preview",
  });
  if (logError) throw new Error(`audit screenshot access: ${logError.message}`);
  if (size === "full") return { bytes: plaintext, contentType };
  const width = size === "thumb" ? 200 : 720;
  try {
    const resized = await sharp(plaintext).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: size === "thumb" ? 70 : 78 }).toBuffer();
    return { bytes: resized, contentType: "image/webp" };
  } catch {
    return { bytes: plaintext, contentType };
  }
}
