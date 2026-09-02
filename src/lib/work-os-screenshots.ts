import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir as fsMkdir } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageBackend } from "@/lib/db/storage";
import { fetchAllLogs } from "@/lib/worktivityAudit";
import { canAccessWorkOsPerson } from "@/lib/work-os-api";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import type { WtActivityLog } from "@/lib/worktivity";
import { localDateForTimezone, zonedDateTimeToUtc } from "@/modules/work-os/companion";

type Json = Record<string, unknown>;

const BUCKET = "work-os-screenshots";
const MODEL = process.env.WORK_OS_SCREENSHOT_MODEL || "gpt-5.4-mini";
const PROMPT_VERSION = "work-os-neutral-screenshot-v1";
const MAX_SCREENSHOTS_PER_DAY = 12;

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

async function mirrorSummary(access: ScreenshotScope, personId: string, eventId: string, occurredAt: string, summary: string, model: string) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("legacy_owner_id,created_by").eq("id", access.organizationId).single();
  if (organizationError) throw new Error(`load screenshot organization: ${organizationError.message}`);
  const ownerId = organization.legacy_owner_id || organization.created_by;
  const { error } = await db().from("work_evidence").upsert({
    user_id: ownerId, organization_id: access.organizationId, person_id: personId, evidence_event_id: eventId,
    evidence_date: occurredAt.slice(0, 10), source: "worktivity", title: "Worktivity screenshot context", summary,
    metrics: { evidenceClass: "activity_observation", model, promptVersion: PROMPT_VERSION }, raw: { evidenceEventId: eventId }, updated_at: new Date().toISOString(),
  }, { onConflict: "evidence_event_id" });
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

export function isExcludedScreenshot(log: WtActivityLog, config: { sensitiveApps: string[]; sensitiveDomains: string[] }) {
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

function sampleLogs(logs: WtActivityLog[]) {
  const screenshots = logs.filter((log) => log.Screenshot).sort((a, b) => a.CreateDate.localeCompare(b.CreateDate));
  if (screenshots.length <= MAX_SCREENSHOTS_PER_DAY) return screenshots;
  const step = screenshots.length / MAX_SCREENSHOTS_PER_DAY;
  return Array.from({ length: MAX_SCREENSHOTS_PER_DAY }, (_, index) => screenshots[Math.floor(index * step)]);
}

async function neutralSummary(url: string, log: WtActivityLog) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for screenshot summaries");
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
          contains_sensitive_content: { type: "boolean" },
        },
        required: ["summary", "visible_app", "work_context", "possible_task_reference", "confidence", "contains_sensitive_content"],
        additionalProperties: false,
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: [
            "Describe only what is visibly supported by this screenshot.",
            "This is supporting activity context, not proof of productivity or completion.",
            "Do not infer identity, intent, effort, pay eligibility, deception, task status, or output quality.",
            "Do not reproduce secrets, message contents, personal data, credentials, or customer details.",
            "Use unclear language when the image does not support a specific observation.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Metadata: app/title=${log.Title || "unknown"}; domain/app=${log.Url || "unknown"}; captured=${log.CreateDate}.` },
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
  };
}

async function createEvidenceEvent(access: ScreenshotScope, personId: string, log: WtActivityLog) {
  const { data, error } = await db().from("work_evidence_events").upsert({
    organization_id: access.organizationId,
    provider: "worktivity",
    external_event_id: `screenshot:${log.ID}`,
    person_id: personId,
    evidence_class: "activity_observation",
    title: `Worktivity screenshot context at ${log.CreateDate}`,
    summary: "Pending neutral screenshot summary.",
    attribution_method: "merged_worktivity_person",
    attribution_confidence: 1,
    occurred_at: log.CreateDate,
    metadata: { worktivityLogId: log.ID, app: log.Title, domain: log.Url },
    raw: { worktivityLogId: log.ID },
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider,external_event_id" }).select("*").single();
  if (error) throw new Error(`create screenshot evidence event: ${error.message}`);
  return data;
}

export async function summarizeWorktivityScreenshots(
  access: ScreenshotScope,
  personId: string,
  date: string,
  options: { execution?: ScreenshotExecution; maxScreenshots?: number } = {},
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
  const [logs, config] = await Promise.all([
    fetchAllLogs({ employeeId: person.worktivity_employee_id, start: date, end: date }),
    screenshotConfig(access.organizationId, personId),
  ]);
  await ensureBucket();
  const results = [];
  const maxScreenshots = Math.max(1, Math.min(MAX_SCREENSHOTS_PER_DAY, Math.floor(options.maxScreenshots ?? MAX_SCREENSHOTS_PER_DAY)));
  for (const log of sampleLogs(logs).slice(0, maxScreenshots)) {
    const event = await createEvidenceEvent(access, personId, log);
    const sourceReference = `worktivity:activity-log:${log.ID}`;
    if (isExcludedScreenshot(log, config)) {
      const { data, error } = await db().from("work_screenshot_summaries").upsert({
        organization_id: access.organizationId,
        evidence_event_id: event.id,
        source_reference: sourceReference,
        processing_status: "excluded",
        failure_reason: "Excluded by sensitive app/domain policy.",
        prompt_version: PROMPT_VERSION,
        storage_path: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "evidence_event_id" }).select("*").single();
      if (error) throw new Error(`record excluded screenshot: ${error.message}`);
      results.push(data);
      continue;
    }
    const imageResponse = await fetch(log.Screenshot as string);
    if (!imageResponse.ok) throw new Error(`download Worktivity screenshot ${log.ID}: ${imageResponse.status}`);
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `${access.organizationId}/${personId}/${date}/${log.ID}-${digest.slice(0, 12)}.enc`;
    const encrypted = encryptScreenshot(bytes);
    const uploaded = await getStorageBackend().upload(BUCKET, storagePath, encrypted, { contentType: "application/octet-stream", upsert: true });
    if (uploaded.error) throw new Error(`store Worktivity screenshot: ${uploaded.error.message}`);
    let storageRetained = true;
    try {
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
          visible_context: {},
          confidence: observation.confidence,
          processing_status: "excluded",
          model: MODEL,
          prompt_version: PROMPT_VERSION,
          failure_reason: "Excluded after sensitive-content detection.",
          updated_at: new Date().toISOString(),
        }, { onConflict: "evidence_event_id" }).select("*").single();
        if (error) throw new Error(`record sensitive screenshot exclusion: ${error.message}`);
        await db().from("work_evidence_events").update({
          summary: "Screenshot excluded after sensitive-content detection.",
          metadata: { worktivityLogId: log.ID, needsReview: false, excludedSensitive: true },
          updated_at: new Date().toISOString(),
        }).eq("id", event.id);
        results.push(data);
        continue;
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
      await db().from("work_evidence_events").update({
        summary: observation.summary,
        metadata: { worktivityLogId: log.ID, app: log.Title, domain: log.Url, needsReview },
        updated_at: new Date().toISOString(),
      }).eq("id", event.id);
      await mirrorSummary(access, personId, event.id, log.CreateDate, observation.summary, MODEL);
      results.push(data);
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
        if (storageRetained) await getStorageBackend().remove(BUCKET, [storagePath]);
        throw new Error(`record screenshot processing failure: ${failureRecordError?.message ?? "no row returned"}`);
      }
      results.push(data);
    }
  }
  return { date, logs: logs.length, sampled: results.length, summaries: results };
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
    const shiftDate = String(row.shift_date);
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
    const { data: completed, error: completedError } = await supabase.from("work_audit_log").select("id")
      .eq("organization_id", row.organization_id).eq("action", "screenshot.due_sync_completed")
      .eq("target_type", "workday").eq("target_id", candidateKey).limit(1);
    if (completedError || completed?.length) continue;
    const access: ScreenshotScope = { organizationId: row.organization_id as string };
    try {
      await summarizeWorktivityScreenshots(access, row.person_id as string, shiftDate);
      const { error: auditError } = await supabase.from("work_audit_log").insert({
        organization_id: row.organization_id,
        actor_user_id: null,
        action: "screenshot.due_sync_completed",
        target_type: "workday",
        target_id: candidateKey,
        metadata: { source: "scheduled_due_sync", shiftDate, personId: row.person_id },
      });
      if (auditError) throw new Error(`audit screenshot due sync: ${auditError.message}`);
      results.push({ organizationId: row.organization_id as string, personId: row.person_id as string, date: shiftDate, status: "processed" });
    } catch (cause) {
      results.push({ organizationId: row.organization_id as string, personId: row.person_id as string, date: shiftDate, status: cause instanceof Error ? cause.message : "failed" });
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
  }
  return { deleted: ids.length };
}
