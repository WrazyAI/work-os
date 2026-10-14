// Shared durable cache of per-frame Worktivity screenshot analyses.
//
// Two producers write here:
//   - the Work OS screenshot pipeline records the fingerprint of every frame it
//     downloads for recap/EOD evidence (exact sha256 + 64-bit perceptual dHash), and
//   - the Worktivity audit vision pass records the same fingerprint plus its
//     role-rubric classification for sampled frames.
// The audit vision pass reads the cache back, so a frame that was analyzed in an
// earlier run is neither downloaded nor classified again while its inputs are
// unchanged. Only derived analysis is stored: image bytes and pre-signed
// provider URLs (which expire within about a day) are never persisted here.
//
// Keying: one row per (employee_id, screenshot_id). Fingerprints are content
// facts and are reused whenever their algorithm version matches. A
// classification is reused only when its full cache key matches — prompt
// version, vision model, rubric hash, and the exact image content it judged —
// so a profile edit, a model change, or a changed frame forces a fresh call.
import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db/query";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScreenshotFingerprint } from "./worktivityScreenshotRuns";
import type { VisionCategory } from "./worktivityAuditTypes";

/** Bump when fingerprintScreenshot's algorithm changes so cached hashes are recomputed. */
export const FRAME_FINGERPRINT_VERSION = 1;

const PERCEPTUAL_HASH_LENGTH = 64;
const VISION_CATEGORIES: VisionCategory[] = ["work", "meeting", "idle", "nonwork", "unclear", "suspicious", "no-visual"];

export interface FrameClassification {
  app: string;
  category: VisionCategory;
  confidence: number;
  reason: string;
}

export interface FrameAnalysisRecord {
  employeeId: string;
  screenshotId: string;
  capturedAt: string;
  localDate: string | null;
  app: string | null;
  url: string | null;
  activityLevel: number | null;
  fingerprint: ScreenshotFingerprint | null;
  fingerprintVersion: number | null;
  fingerprintAt: string | null;
  classification: FrameClassification | null;
  classificationKey: string | null;
  classificationModel: string | null;
  classificationAt: string | null;
}

/** What the Work OS pipeline writes while it already has the image bytes in
 * hand. The upsert touches only these columns, so a classification written by
 * the audit for the same frame survives. */
export interface FrameFingerprintWrite {
  employeeId: string;
  screenshotId: string;
  capturedAt: string;
  localDate?: string | null;
  app?: string | null;
  url?: string | null;
  activityLevel?: number | null;
  fingerprint: ScreenshotFingerprint;
}

type FrameCacheClient = Pick<DbClient, "from">;

const ROW_COLUMNS = [
  "employee_id", "screenshot_id", "captured_at", "local_date", "app", "url", "activity_level",
  "exact_hash", "perceptual_hash", "fingerprint_version", "fingerprint_at",
  "classification", "classification_key", "classification_model", "classification_at",
].join(",");

/** Hash of the audit rubric text; a profile edit changes it and invalidates the
 * classifications made under the old rubric. */
export function rubricHash(rubric: string): string {
  return createHash("sha1").update(rubric).digest("hex");
}

/** Stable identity of one cached classification. Any input change means the
 * frame is classified again. */
export function classificationCacheKey(input: { promptVersion: number; model: string; rubricHash: string; exactHash: string | null }): string {
  return `v${input.promptVersion}|${input.model}|${input.rubricHash}|${input.exactHash ?? "unfingerprinted"}`;
}

/** A cached fingerprint usable by this deployment, or null. Rejects rows written
 * by an older algorithm version and rows that are missing or malformed. */
export function reusableFingerprint(record: FrameAnalysisRecord | null | undefined, version = FRAME_FINGERPRINT_VERSION): ScreenshotFingerprint | null {
  const fingerprint = record?.fingerprint;
  if (!fingerprint || record?.fingerprintVersion !== version) return null;
  if (!/^[a-f0-9]{64}$/.test(fingerprint.exactHash ?? "")) return null;
  if (typeof fingerprint.perceptualHash !== "string" || fingerprint.perceptualHash.length !== PERCEPTUAL_HASH_LENGTH) return null;
  return fingerprint;
}

/** A cached classification usable under exactly this cache key, or null. A
 * record without a valid content hash is never reused: the classification must
 * provably belong to a fingerprinted frame. */
export function reusableClassification(record: FrameAnalysisRecord | null | undefined, key: string): FrameClassification | null {
  if (!/^[a-f0-9]{64}$/.test(record?.fingerprint?.exactHash ?? "")) return null;
  const classification = record?.classification;
  if (!classification || record?.classificationKey !== key) return null;
  if (!classification.app || !VISION_CATEGORIES.includes(classification.category)) return null;
  if (!Number.isFinite(classification.confidence)) return null;
  if (typeof classification.reason !== "string" || !classification.reason) return null;
  return classification;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string" && value) return value;
  return null;
}

function recordFromRow(row: Record<string, unknown>): FrameAnalysisRecord {
  const rawClassification = row.classification && typeof row.classification === "object"
    ? row.classification as Record<string, unknown>
    : null;
  const hasFingerprint = typeof row.exact_hash === "string" && typeof row.perceptual_hash === "string";
  return {
    employeeId: String(row.employee_id ?? ""),
    screenshotId: String(row.screenshot_id ?? ""),
    capturedAt: isoOrNull(row.captured_at) ?? "",
    localDate: typeof row.local_date === "string" ? row.local_date : isoOrNull(row.local_date)?.slice(0, 10) ?? null,
    app: row.app == null ? null : String(row.app),
    url: row.url == null ? null : String(row.url),
    activityLevel: row.activity_level == null ? null : Number(row.activity_level),
    fingerprint: hasFingerprint
      ? { exactHash: String(row.exact_hash), perceptualHash: String(row.perceptual_hash) }
      : null,
    fingerprintVersion: row.fingerprint_version == null ? null : Number(row.fingerprint_version),
    fingerprintAt: isoOrNull(row.fingerprint_at),
    classification: rawClassification
      ? {
        app: String(rawClassification.app ?? ""),
        category: String(rawClassification.category ?? "unclear") as VisionCategory,
        confidence: Number(rawClassification.confidence ?? 0),
        reason: String(rawClassification.reason ?? ""),
      }
      : null,
    classificationKey: row.classification_key == null ? null : String(row.classification_key),
    classificationModel: row.classification_model == null ? null : String(row.classification_model),
    classificationAt: isoOrNull(row.classification_at),
  };
}

export interface FrameAnalysisStore {
  /** Existing records for one employee's frames captured in [startIso, endIso), keyed by screenshot id. */
  load(employeeId: string, startIso: string, endIso: string): Promise<Map<string, FrameAnalysisRecord>>;
  /** Full-row upserts from the audit pass; returns the number of rows written. */
  save(records: FrameAnalysisRecord[]): Promise<number>;
}

/** Store used by the audit vision pass. `load`/`save` are best-effort at the
 * call site: a cache outage degrades to re-analysis, never a failed audit. */
export function createFrameAnalysisStore(client: FrameCacheClient = createAdminClient()): FrameAnalysisStore {
  return {
    async load(employeeId, startIso, endIso) {
      const { data, error } = await client.from("worktivity_frame_analyses")
        .select(ROW_COLUMNS)
        .eq("employee_id", employeeId)
        .gte("captured_at", startIso)
        .lt("captured_at", endIso);
      if (error) throw new Error(`load frame analyses: ${error.message}`);
      const records = new Map<string, FrameAnalysisRecord>();
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const record = recordFromRow(row);
        if (record.screenshotId) records.set(record.screenshotId, record);
      }
      return records;
    },

    async save(records) {
      if (!records.length) return 0;
      const undated = records.find((record) => !record.capturedAt);
      if (undated) throw new Error(`frame analysis for ${undated.screenshotId} has no capture time`);
      const now = new Date().toISOString();
      const rows = records.map((record) => ({
        employee_id: record.employeeId,
        screenshot_id: record.screenshotId,
        captured_at: record.capturedAt,
        local_date: record.localDate,
        app: record.app,
        url: record.url,
        activity_level: record.activityLevel,
        exact_hash: record.fingerprint?.exactHash ?? null,
        perceptual_hash: record.fingerprint?.perceptualHash ?? null,
        fingerprint_version: record.fingerprint ? record.fingerprintVersion ?? FRAME_FINGERPRINT_VERSION : null,
        fingerprint_at: record.fingerprint ? record.fingerprintAt ?? now : null,
        classification: record.classification,
        classification_key: record.classificationKey,
        classification_model: record.classificationModel,
        classification_at: record.classification ? record.classificationAt ?? now : null,
        updated_at: now,
      }));
      const { error } = await client.from("worktivity_frame_analyses")
        .upsert(rows, { onConflict: "employee_id,screenshot_id" });
      if (error) throw new Error(`save frame analyses: ${error.message}`);
      return rows.length;
    },
  };
}

/** Partial upsert for a frame whose image bytes the caller already had; it never
 * touches the classification columns. */
export async function saveFrameFingerprint(client: FrameCacheClient, write: FrameFingerprintWrite): Promise<void> {
  if (!write.employeeId || !write.screenshotId) throw new Error("frame fingerprint needs an employee and screenshot id");
  if (!write.capturedAt) throw new Error(`frame fingerprint for ${write.screenshotId} has no capture time`);
  const { error } = await client.from("worktivity_frame_analyses").upsert({
    employee_id: write.employeeId,
    screenshot_id: write.screenshotId,
    captured_at: write.capturedAt,
    local_date: write.localDate ?? null,
    app: write.app ?? null,
    url: write.url ?? null,
    activity_level: write.activityLevel ?? null,
    exact_hash: write.fingerprint.exactHash,
    perceptual_hash: write.fingerprint.perceptualHash,
    fingerprint_version: FRAME_FINGERPRINT_VERSION,
    fingerprint_at: new Date().toISOString(),
  }, { onConflict: "employee_id,screenshot_id" });
  if (error) throw new Error(`save frame fingerprint: ${error.message}`);
}

/** Retention: provider screenshots only exist for about a month, so older cached
 * analyses can never serve another audit. Rows that somehow lack a capture time
 * can never satisfy the cutoff filter, so they are removed here too. Returns the
 * number of rows removed. */
export async function pruneFrameAnalyses(client: FrameCacheClient, olderThanIso: string): Promise<number> {
  const stale = await client.from("worktivity_frame_analyses")
    .delete()
    .lt("captured_at", olderThanIso);
  if (stale.error) throw new Error(`prune frame analyses: ${stale.error.message}`);
  const undated = await client.from("worktivity_frame_analyses")
    .delete()
    .is("captured_at", null);
  if (undated.error) throw new Error(`prune undated frame analyses: ${undated.error.message}`);
  return (Array.isArray(stale.data) ? stale.data.length : 0) + (Array.isArray(undated.data) ? undated.data.length : 0);
}
