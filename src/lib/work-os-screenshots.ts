import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllLogs } from "@/lib/worktivityAudit";
import { canAccessWorkOsPerson } from "@/lib/work-os-api";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import type { WtActivityLog } from "@/lib/worktivity";

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

async function mirrorSummary(access: WorkOsAccess, personId: string, eventId: string, occurredAt: string, summary: string, model: string) {
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

async function ensureBucket() {
  const supabase = db();
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (!error && data) {
    const updated = await supabase.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["application/octet-stream"] });
    if (updated.error) throw new Error(`harden screenshot bucket: ${updated.error.message}`);
    return;
  }
  const created = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["application/octet-stream"],
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    throw new Error(`create screenshot bucket: ${created.error.message}`);
  }
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

async function createEvidenceEvent(access: WorkOsAccess, personId: string, log: WtActivityLog) {
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

export async function summarizeWorktivityScreenshots(access: WorkOsAccess, personId: string, date: string) {
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
  for (const log of sampleLogs(logs)) {
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
    const uploaded = await db().storage.from(BUCKET).upload(storagePath, encrypted, { contentType: "application/octet-stream", upsert: true });
    if (uploaded.error) throw new Error(`store Worktivity screenshot: ${uploaded.error.message}`);
    let storageRetained = true;
    try {
      const observation = await neutralSummary(log.Screenshot as string, log);
      if (observation.containsSensitiveContent) {
        const removed = await db().storage.from(BUCKET).remove([storagePath]);
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
        if (storageRetained) await db().storage.from(BUCKET).remove([storagePath]);
        throw new Error(`record screenshot processing failure: ${failureRecordError?.message ?? "no row returned"}`);
      }
      results.push(data);
    }
  }
  return { date, logs: logs.length, sampled: results.length, summaries: results };
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
  const { data: encrypted, error: downloadError } = await db().storage.from(BUCKET).download(summary.storage_path);
  if (downloadError) throw new Error(`load retained screenshot: ${downloadError.message}`);
  const plaintext = decryptScreenshot(new Uint8Array(await encrypted.arrayBuffer()));
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
  const paths = (expired ?? []).map((item) => item.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const removed = await db().storage.from(BUCKET).remove(paths);
    if (removed.error) throw new Error(`delete expired screenshots: ${removed.error.message}`);
  }
  const ids = (expired ?? []).map((item) => item.id);
  if (ids.length) {
    const { error: updateError } = await db().from("work_screenshot_summaries")
      .update({ storage_path: null, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updateError) throw new Error(`mark expired screenshots deleted: ${updateError.message}`);
  }
  return { deleted: ids.length };
}
