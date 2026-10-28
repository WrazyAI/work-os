import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { intervalRevision, intervalSpeechSource, isoInstant } from "@/lib/work-os-activity-interval-projection";
import type { ActivityIntervalRecord } from "@/lib/work-os-activity-intervals";
import { buildRecapSpeechLines } from "@/lib/work-os-recap-speech";
import type { PersonRef, ReviewedRecap } from "@/modules/work-os/admin-otto/contracts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reviewed = (row: ActivityIntervalRecord) => row.review_status === "confirmed" || row.review_status === "amended";

/** Exact stored words, never a model paraphrase. Correction labels are part of
 * both the visible read-along and the spoken script, not just metadata. */
export function buildReviewedRecap(row: ActivityIntervalRecord, version: number, eventId: string, person: PersonRef): ReviewedRecap {
  if (!reviewed(row)) throw new WorkOsConflictError("This recap has not been reviewed.");
  const source = intervalSpeechSource({ ...row, final_detail: row.ai_detail });
  const original = { headline: source.headline ?? "", detail: source.detail ?? "", activities: source.activities };
  const feedback = row.review_status === "amended" ? String(row.employee_feedback ?? "") : null;
  const originalLines = buildRecapSpeechLines(source);
  const speechLines = row.review_status === "amended" ? [
    { text: "Original AI summary.", time: null }, ...originalLines,
    { text: "Employee correction.", time: null }, { text: feedback ?? "", time: null },
  ] : originalLines;
  const scriptHash = hash(speechLines);
  return {
    intervalId: String(row.id), eventId, person, reviewVersion: version,
    reviewKey: hash([row.organization_id, row.id, version, scriptHash]),
    sourceRevision: intervalRevision(row), scriptHash,
    reviewStatus: row.review_status as "confirmed" | "amended",
    reviewedAt: isoInstant(row.reviewed_at) ?? isoInstant(row.generated_at) ?? isoInstant(row.window_end) ?? "",
    windowStart: isoInstant(row.window_start) ?? "", windowEnd: isoInstant(row.window_end) ?? "",
    timezone: String(row.timezone ?? "UTC"), original, employeeFeedback: feedback,
    speechLines, coverage: ["AI-inferred activity, employee reviewed; not task completion or attendance."],
    recordUrl: `/work-os/admin/people/${encodeURIComponent(person.id)}?recap=${encodeURIComponent(String(row.id))}`,
  };
}

/** Content identity intentionally excludes version, event id and review time.
 * Only the immediately previous content is deduplicated, never an older A. */
function contentHash(row: ActivityIntervalRecord, recap: ReviewedRecap) {
  return hash({ organizationId: row.organization_id, intervalId: row.id, personId: row.person_id,
    sourceHash: row.source_hash ?? null, sourceRevision: recap.sourceRevision,
    windowStart: recap.windowStart, windowEnd: recap.windowEnd, timezone: recap.timezone,
    original: recap.original, reviewStatus: recap.reviewStatus, feedback: recap.employeeFeedback, script: recap.speechLines });
}

async function transaction<T>(access: WorkOsAccess, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO work_admin_otto_clock (organization_id, sequence) VALUES ($1, 0) ON CONFLICT (organization_id) DO NOTHING", [access.organizationId]);
    await client.query("SELECT sequence FROM work_admin_otto_clock WHERE organization_id = $1 FOR UPDATE", [access.organizationId]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function loadLocked(client: PoolClient, access: WorkOsAccess, intervalId: string, ownOnly: boolean) {
  const { rows } = await client.query(`SELECT * FROM work_activity_intervals
    WHERE organization_id = $1 AND id = $2
      AND ($3::boolean OR person_id = $4::uuid) FOR UPDATE`,
  [access.organizationId, intervalId, !ownOnly && access.role === "admin", access.personId]);
  return rows[0] as ActivityIntervalRecord | undefined;
}

async function personFor(client: PoolClient, row: ActivityIntervalRecord): Promise<PersonRef> {
  const { rows } = await client.query(`SELECT p.id, p.display_name, p.active,
    (SELECT max(o.timezone) FROM work_employee_onboarding o
      WHERE o.organization_id = p.organization_id AND o.person_id = p.id) AS timezone
    FROM work_people p WHERE p.organization_id = $1 AND p.id = $2`, [row.organization_id, row.person_id]);
  if (!rows[0]) throw new Error("activity interval person not found");
  return {
    id: String(rows[0].id),
    displayName: String(rows[0].display_name ?? ""),
    active: rows[0].active === true,
    // The person's configured timezone when known; the recap's window timezone
    // is the fallback and remains the ReviewedRecap.timezone field.
    timezone: String(rows[0].timezone ?? row.timezone ?? "UTC"),
  };
}

type ReviewEvent = { version: number; content_hash: string; payload: ReviewedRecap };
async function latest(client: PoolClient, row: ActivityIntervalRecord): Promise<ReviewEvent | undefined> {
  const { rows } = await client.query("SELECT version, content_hash, payload FROM work_recap_reviews WHERE organization_id = $1 AND interval_id = $2 ORDER BY version DESC LIMIT 1", [row.organization_id, row.id]);
  return rows[0];
}

/** The lock-free read of an existing review. It joins the interval so the same
 * review-status and owner scoping decisions apply, and it never takes the
 * organization clock lock: detail, speech and record pages read constantly, and
 * that lock also serializes employee decisions across the organization. */
async function latestExisting(access: WorkOsAccess, intervalId: string): Promise<ReviewedRecap | null> {
  const { rows } = await getPool().query<{ payload: ReviewedRecap }>(`SELECT r.payload
    FROM work_recap_reviews r
    JOIN work_activity_intervals i
      ON i.organization_id = r.organization_id AND i.id = r.interval_id
    WHERE r.organization_id = $1 AND r.interval_id = $2
      AND i.review_status IN ('confirmed','amended')
      AND ($3::boolean OR i.person_id = $4::uuid)
    ORDER BY r.version DESC LIMIT 1`,
  [access.organizationId, intervalId, access.role === "admin", access.personId]);
  return rows[0]?.payload ?? null;
}

async function append(client: PoolClient, row: ActivityIntervalRecord, version: number, arrivalEligible: boolean): Promise<ReviewEvent> {
  // Historical version-1 identity is deterministic even across retried lazy reads.
  const digest = hash([row.organization_id, row.id, "historical-reviewed-v1"]);
  const eventId = arrivalEligible ? randomUUID() : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const recap = buildReviewedRecap(row, version, eventId, await personFor(client, row));
  const content = contentHash(row, recap);
  const { rows } = await client.query("UPDATE work_admin_otto_clock SET sequence = sequence + 1 WHERE organization_id = $1 RETURNING sequence", [row.organization_id]);
  await client.query(`INSERT INTO work_recap_reviews
    (id, organization_id, interval_id, person_id, version, event_sequence, review_key, source_revision, content_hash, script_hash, payload, reviewed_at, arrival_eligible)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
  [eventId, row.organization_id, row.id, row.person_id, version, rows[0].sequence, recap.reviewKey, recap.sourceRevision, content, recap.scriptHash, JSON.stringify(recap), recap.reviewedAt, arrivalEligible]);
  return { version, content_hash: content, payload: recap };
}

/** Organization-scoped explicit read. Admins may read team recaps without an
 * employee mapping; other callers remain scoped to their own person. Historical
 * snapshots never publish an arrival and do not mutate the employee interval. */
export async function loadReviewedRecap(access: WorkOsAccess, intervalId: string): Promise<ReviewedRecap | null> {
  if (access.role !== "admin" && !access.personId) return null;
  // Every detail, speech and record page reads a reviewed recap. Reading the
  // latest snapshot outside the transaction keeps those reads off the
  // organization clock lock; the lock is only needed to create a missing
  // version-1 snapshot, and its unique version constraint guards that write.
  const existing = await latestExisting(access, intervalId);
  if (existing) return existing;
  return transaction(access, async (client) => {
    const row = await loadLocked(client, access, intervalId, false);
    if (!row || !reviewed(row)) return null;
    return ((await latest(client, row)) ?? await append(client, row, 1, false)).payload;
  });
}

export async function decideReviewedRecap(access: WorkOsAccess, intervalId: string, input: {
  action: "confirm" | "amend"; feedback?: string; expectedReviewVersion?: number;
}): Promise<ActivityIntervalRecord> {
  if (!access.personId) throw new Error("Work OS person mapping required.");
  if (input.action !== "confirm" && input.action !== "amend") throw new WorkOsValidationError("action must be confirm or amend");
  if (input.expectedReviewVersion !== undefined && (!Number.isSafeInteger(input.expectedReviewVersion) || input.expectedReviewVersion < 0)) {
    throw new WorkOsValidationError("expectedReviewVersion must be a non-negative integer");
  }
  const feedback = input.action === "amend" ? String(input.feedback ?? "").replace(/\s+/g, " ").trim().slice(0, 4000) : null;
  if (input.action === "amend" && !feedback) throw new WorkOsValidationError("feedback is required to amend an activity recap");
  return transaction(access, async (client) => {
    const row = await loadLocked(client, access, intervalId, true);
    if (!row) throw new Error("activity interval not found");
    if (row.generation_status !== "ready" || !row.ai_detail) throw new WorkOsConflictError("This activity recap is not ready to review yet.");
    let previous = await latest(client, row);
    if (!previous && reviewed(row)) previous = await append(client, row, 1, false);
    const candidate = { ...row, review_status: input.action === "confirm" ? "confirmed" : "amended", employee_feedback: feedback };
    const projection = buildReviewedRecap(candidate, (previous?.version ?? 0) + 1, "pending", await personFor(client, row));
    // Exact retries (including a stale expected version) never reset next steps
    // or the review timestamp. Legacy clients may retry, but not overwrite.
    if (previous?.content_hash === contentHash(candidate, projection)) return row;
    const currentVersion = previous?.version ?? 0;
    if ((input.expectedReviewVersion !== undefined && input.expectedReviewVersion !== currentVersion)
      || (input.expectedReviewVersion === undefined && currentVersion > 0)) {
      throw new WorkOsConflictError("This recap changed. Reload it before reviewing again.", "review_version_conflict");
    }
    const finalDetail = input.action === "confirm" ? String(row.ai_detail)
      : `Original AI summary.\n${row.ai_detail}\n\nEmployee correction.\n${feedback}`;
    const { rows } = await client.query(`UPDATE work_activity_intervals SET
      review_status=$3, employee_feedback=$4, final_detail=$5, reviewed_at=clock_timestamp(),
      next_steps_status='pending', updated_at=clock_timestamp()
      WHERE organization_id=$1 AND id=$2 AND person_id=$6 RETURNING *`,
    [access.organizationId, intervalId, candidate.review_status, feedback, finalDetail, access.personId]);
    const saved = rows[0] as ActivityIntervalRecord;
    const event = await append(client, saved, currentVersion + 1, true);
    await client.query(`INSERT INTO work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
      VALUES ($1,$2,$3,'activity_interval',$4,$5::jsonb)`,
    [access.organizationId, access.ctx.user.id, `activity_interval.${saved.review_status}`, intervalId,
      JSON.stringify({ reviewVersion: event.version, eventId: event.payload.eventId, feedbackChars: feedback?.length ?? 0 })]);
    return saved;
  });
}
