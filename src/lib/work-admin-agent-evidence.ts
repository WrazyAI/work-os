import { randomUUID } from "node:crypto";
import { getStorageBackend, type StorageBackend } from "@/lib/db/storage";
import { getWorkOsEmployeeTaskDetails, type CompletionEvidenceUpload } from "@/lib/work-os-employee-tasks";
import { addTaskProgress } from "@/lib/work-os-tasks";
import { audit, db, loadShiftData, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";
import {
  COMPLETION_EVIDENCE_BUCKET,
  assertCompletionEvidenceBytes,
  completionEvidenceExtension,
  completionEvidenceObjectPath,
  isEmployeeAttachedEvidence,
  normalizeCompletionEvidenceType,
  sanitizeCompletionEvidenceFileName,
  taskEvidenceFromRow,
  validateCompletionEvidenceUpload,
} from "@/modules/work-os/completion-evidence";
import {
  WorkOsConflictError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";

/** Progress notes and completion evidence attached by an admin agent.
 *
 * Both writes are additive: they cannot create, remove, reassign, complete, or
 * decide work, so they do not go through the preview store. They are still
 * task-scoped and audited. `work_evidence.person_id` stays null, which keeps an
 * admin's upload out of every person's evidence list, EOD context, authored
 * records, and insights while the task detail (and the completion gate) still
 * sees the file. An admin token does not need a person mapping. */

const ADMIN_EVIDENCE_ORIGIN = "admin_task_evidence";
const ADMIN_PROGRESS_ORIGIN = "admin_progress";
const ADMIN_EVIDENCE_RAW_ORIGIN = "admin_task_completion";
const IDEMPOTENCY_KEY_MAX = 160;
const PROGRESS_SUMMARY_MAX = 2_000;
const PROGRESS_TITLE_MAX = 240;
const PROGRESS_FIELDS = new Set(["summary", "title"]);

export type AdminEvidenceActor = { tokenId: string; tokenName: string };

/** Tests need deterministic object storage; production never calls the setter
 * and always uses the configured R2/local adapter. */
type EvidenceStorage = Pick<StorageBackend, "upload" | "download" | "remove">;

let storageOverride: EvidenceStorage | null = null;

export function setAdminEvidenceStorageForTests(storage: EvidenceStorage | null): void {
  storageOverride = storage;
}

function evidenceStorage(): EvidenceStorage {
  return storageOverride ?? getStorageBackend();
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Object keys are derived from trusted UUIDs only, so a stored record can
 * never point outside its organization, task, or evidence scope. Unlike the
 * employee path there is deliberately no person segment: an admin attachment
 * belongs to the task. */
function pathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WorkOsValidationError(`Invalid admin evidence ${label}`);
  }
  return value;
}

export function adminEvidenceObjectPath(input: {
  organizationId: string;
  taskId: string;
  evidenceId: string;
  contentType: string;
}): string {
  const extension = completionEvidenceExtension(input.contentType);
  return `organizations/${pathSegment(input.organizationId, "organization id")}`
    + `/tasks/${pathSegment(input.taskId, "task id")}`
    + `/evidence/${pathSegment(input.evidenceId, "record id")}.${extension}`;
}

/** The row keeps the employee-attached completion contract (`evidenceClass`
 * and `employeeAttached`) so the task detail and the completion gate accept it,
 * while `origin`/`adminUserId`/`adminTokenId`/`attachedForPersonId` record that
 * an administrator uploaded it and for which task. `personId` is deliberately
 * absent: the row is task-scoped. */
export function adminEvidenceMetrics(input: {
  contentType: string;
  fileName: string;
  sizeBytes: number;
  note: string;
  adminUserId: string;
  adminTokenId: string;
  targetPersonId: string | null;
}): Json {
  return {
    evidenceClass: "output_evidence",
    employeeAttached: true,
    origin: ADMIN_EVIDENCE_ORIGIN,
    contentType: input.contentType,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    ...(input.note ? { note: input.note } : {}),
    adminUserId: input.adminUserId,
    adminTokenId: input.adminTokenId,
    ...(input.targetPersonId ? { attachedForPersonId: input.targetPersonId } : {}),
  };
}

/** Progress notes intentionally omit `evidenceClass` and a `url`, so they are
 * never mistaken for completion proof by the task detail or the gate. */
function adminProgressMetrics(input: {
  adminUserId: string;
  adminTokenId: string;
  targetPersonId: string | null;
}): Json {
  return {
    origin: ADMIN_PROGRESS_ORIGIN,
    adminUserId: input.adminUserId,
    adminTokenId: input.adminTokenId,
    ...(input.targetPersonId ? { attachedForPersonId: input.targetPersonId } : {}),
  };
}

/** A task shared by several people has no single "attached for" person, so the
 * attribution stays null rather than picking an arbitrary assignee. */
function targetPersonIdForTask(task: Json): string | null {
  const raw = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [];
  const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && !!id.trim()))].sort();
  return ids.length === 1 ? ids[0]! : null;
}

function isAdminEvidenceRow(row: Json): boolean {
  const metrics = isRecord(row.metrics) ? row.metrics : {};
  return row.source === "manual"
    && metrics.employeeAttached === true
    && metrics.evidenceClass === "output_evidence"
    && metrics.origin === ADMIN_EVIDENCE_ORIGIN;
}

function isAdminProgressRow(row: Json): boolean {
  const metrics = isRecord(row.metrics) ? row.metrics : {};
  return row.source === "agent" && metrics.origin === ADMIN_PROGRESS_ORIGIN;
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

/** The clean shape returned to the API and MCP: metadata only, never a storage
 * path or the raw row. The URL is the authenticated admin download route. */
export function adminEvidenceRecord(row: Json): Json {
  const evidence = taskEvidenceFromRow(row);
  return {
    id: evidence.id,
    title: evidence.title,
    note: evidence.note,
    fileName: evidence.fileName,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    createdAt: timestamp(row.created_at) ?? evidence.createdAt,
    taskId: typeof row.task_id === "string" ? row.task_id : null,
    url: `/api/agent/admin/v1/evidence/${encodeURIComponent(evidence.id)}/file`,
  };
}

function progressRecord(row: Json): Json {
  const metrics = isRecord(row.metrics) ? row.metrics : {};
  return {
    id: String(row.id ?? ""),
    title: typeof row.title === "string" ? row.title : "",
    summary: typeof row.summary === "string" ? row.summary : "",
    taskId: typeof row.task_id === "string" ? row.task_id : null,
    source: typeof row.source === "string" ? row.source : "agent",
    origin: typeof metrics.origin === "string" ? metrics.origin : ADMIN_PROGRESS_ORIGIN,
    createdAt: timestamp(row.created_at),
  };
}

async function loadTask(access: WorkOsAccess, taskId: string): Promise<Json> {
  const details = await getWorkOsEmployeeTaskDetails(access, taskId);
  return details.task as Json;
}

async function evidenceByKey(access: WorkOsAccess, idempotencyKey: string): Promise<Json | null> {
  const { data, error } = await db().from("work_evidence").select("*")
    .eq("organization_id", access.organizationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(`load admin task evidence: ${error.message}`);
  return (data ?? null) as Json | null;
}

function requireIdempotencyKey(value: string | null | undefined): string {
  const key = text(value);
  if (!key) throw new WorkOsValidationError("Idempotency-Key is required");
  if (key.length > IDEMPOTENCY_KEY_MAX) {
    throw new WorkOsValidationError(`Idempotency-Key must be ${IDEMPOTENCY_KEY_MAX} characters or fewer`);
  }
  return key;
}

/** Validate the progress body here so the REST route, the MCP tool, and any
 * direct caller share one contract. A `url`, `person_id`, `metrics`, or other
 * field is refused: a note may add context but must never masquerade as
 * completion proof or personal evidence. */
function validateAdminProgressInput(body: Json): { summary: string; title: string | null } {
  if (!isRecord(body)) throw new WorkOsValidationError("A progress note body is required");
  for (const key of Object.keys(body)) {
    if (!PROGRESS_FIELDS.has(key)) throw new WorkOsValidationError(`Field ${key} cannot be set through an admin progress note`);
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) throw new WorkOsValidationError("summary is required");
  if (summary.length > PROGRESS_SUMMARY_MAX) {
    throw new WorkOsValidationError(`summary must be ${PROGRESS_SUMMARY_MAX} characters or fewer`);
  }
  let title: string | null = null;
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== "string") throw new WorkOsValidationError("title must be a string or null");
    title = body.title.trim() || null;
    if (title && title.length > PROGRESS_TITLE_MAX) {
      throw new WorkOsValidationError(`title must be ${PROGRESS_TITLE_MAX} characters or fewer`);
    }
  }
  return { summary, title };
}

export async function addAdminAgentProgress(
  access: WorkOsAccess,
  taskId: string,
  body: Json,
  idempotencyKey: string,
  actor: AdminEvidenceActor,
): Promise<Json> {
  const { summary, title } = validateAdminProgressInput(body);
  const task = await loadTask(access, taskId);
  const localTaskId = String(task.id);
  const key = requireIdempotencyKey(idempotencyKey);
  const existing = await evidenceByKey(access, key);
  if (existing) {
    if (String(existing.task_id ?? "") !== localTaskId || !isAdminProgressRow(existing)) {
      throw new WorkOsConflictError("That progress reference belongs to another task", "evidence_conflict");
    }
    return progressRecord(existing);
  }

  const ownerId = await organizationOwnerId(access.organizationId);
  const targetPersonId = targetPersonIdForTask(task);
  const taskTitle = text(task.title) ?? "Task";
  const evidence = await addTaskProgress(ownerId, localTaskId, {
    title: title ?? `Progress: ${taskTitle}`,
    summary,
    person_id: null,
    source: "agent",
    idempotency_key: key,
    metrics: adminProgressMetrics({
      adminUserId: access.ctx.user.id,
      adminTokenId: actor.tokenId,
      targetPersonId,
    }),
  });
  await audit(access, "admin.task.progress", "work_os_task", localTaskId, {
    evidenceId: String((evidence as Json).id ?? ""),
    tokenId: actor.tokenId,
    tokenName: actor.tokenName,
    targetPersonId,
  });
  return progressRecord(evidence as Json);
}

export async function attachAdminAgentEvidence(
  access: WorkOsAccess,
  taskId: string,
  input: CompletionEvidenceUpload,
  actor: AdminEvidenceActor,
): Promise<{ evidence: Json }> {
  const task = await loadTask(access, taskId);
  const localTaskId = String(task.id);
  const validated = validateCompletionEvidenceUpload({
    contentType: input.contentType,
    fileName: input.fileName,
    size: input.bytes.byteLength,
    note: input.note,
  });
  assertCompletionEvidenceBytes(input.bytes, validated.contentType);
  const key = requireIdempotencyKey(input.idempotencyKey);

  const existing = await evidenceByKey(access, key);
  if (existing) {
    if (String(existing.task_id ?? "") !== localTaskId || !isAdminEvidenceRow(existing)) {
      throw new WorkOsConflictError("That evidence reference belongs to another task", "evidence_conflict");
    }
    return { evidence: adminEvidenceRecord(existing) };
  }

  const ownerId = await organizationOwnerId(access.organizationId);
  const evidenceId = randomUUID();
  const objectPath = adminEvidenceObjectPath({
    organizationId: access.organizationId,
    taskId: localTaskId,
    evidenceId,
    contentType: validated.contentType,
  });
  const now = new Date();
  const targetPersonId = targetPersonIdForTask(task);
  // The date follows the person the file was attached for; a shared or
  // unassigned task has no person timezone, so UTC is the honest default.
  const { timezone } = targetPersonId
    ? await loadShiftData(access, targetPersonId, now)
    : { timezone: "UTC" };
  const taskTitle = text(task.title) ?? "Task";
  const uploaded = await evidenceStorage().upload(
    COMPLETION_EVIDENCE_BUCKET,
    objectPath,
    Buffer.from(input.bytes),
    { contentType: validated.contentType },
  );
  if (uploaded.error) throw new Error(`save admin task evidence: ${uploaded.error.message}`);

  const row = {
    id: evidenceId,
    user_id: ownerId,
    organization_id: access.organizationId,
    person_id: null,
    task_id: localTaskId,
    evidence_date: localDateForTimezone(now, timezone),
    source: "manual",
    title: `${taskTitle.slice(0, 220)} — completion evidence`,
    summary: validated.note || `Administrator-attached file: ${validated.fileName}.`,
    url: `/api/agent/admin/v1/evidence/${evidenceId}/file`,
    metrics: adminEvidenceMetrics({
      contentType: validated.contentType,
      fileName: validated.fileName,
      sizeBytes: validated.size,
      note: validated.note,
      adminUserId: access.ctx.user.id,
      adminTokenId: actor.tokenId,
      targetPersonId,
    }),
    raw: {
      origin: ADMIN_EVIDENCE_RAW_ORIGIN,
      adminUserId: access.ctx.user.id,
      adminTokenId: actor.tokenId,
    },
    idempotency_key: key,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const inserted = await db().from("work_evidence").insert(row).select("*").single();
  if (inserted.error) {
    // Never leave an object the ledger does not know about.
    try {
      const removed = await evidenceStorage().remove(COMPLETION_EVIDENCE_BUCKET, [objectPath]);
      if (removed.error) {
        console.warn("[work-os] admin evidence rollback failed", { evidenceId, message: removed.error.message });
      }
    } catch (rollbackError) {
      console.warn("[work-os] admin evidence rollback failed", {
        evidenceId,
        message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    // A concurrent retry can win the (organization, key) insert race. Return
    // that row instead of surfacing a duplicate-key failure.
    const raced = await evidenceByKey(access, key);
    if (raced && String(raced.task_id ?? "") === localTaskId && isAdminEvidenceRow(raced)) {
      return { evidence: adminEvidenceRecord(raced) };
    }
    throw new Error(`save admin task evidence record: ${inserted.error.message}`);
  }

  await audit(access, "admin.task.evidence", "work_os_task", localTaskId, {
    evidenceId,
    tokenId: actor.tokenId,
    tokenName: actor.tokenName,
    targetPersonId,
    fileName: validated.fileName,
    contentType: validated.contentType,
    sizeBytes: validated.size,
  });
  return { evidence: adminEvidenceRecord(inserted.data as Json) };
}

/** One authenticated task evidence file for the admin API. The organization
 * filter answers `null` (a route 404) for a missing or cross-organization row.
 * Both employee-attached and admin-attached completion files resolve, each
 * through the object path its uploader wrote. A row that is not completion
 * evidence (a screenshot or a provider artifact) is not served here. */
export async function getAdminAgentEvidenceFile(
  access: WorkOsAccess,
  evidenceId: string,
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string } | null> {
  if (!text(evidenceId)) return null;
  const { data, error } = await db().from("work_evidence")
    .select("id,organization_id,person_id,task_id,source,title,summary,metrics,created_at")
    .eq("organization_id", access.organizationId)
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw new Error(`load admin evidence file: ${error.message}`);
  if (!data) return null;
  const row = data as Json;
  const taskId = text(row.task_id);
  if (!taskId || !isEmployeeAttachedEvidence(row)) return null;
  const evidence = taskEvidenceFromRow(row);
  const contentType = normalizeCompletionEvidenceType(evidence.contentType);
  if (!contentType) return null;

  const personId = text(row.person_id);
  const objectPath = personId
    ? completionEvidenceObjectPath({
      organizationId: access.organizationId,
      personId,
      taskId,
      evidenceId: evidence.id,
      contentType,
    })
    : adminEvidenceObjectPath({
      organizationId: access.organizationId,
      taskId,
      evidenceId: evidence.id,
      contentType,
    });
  const downloaded = await evidenceStorage().download(COMPLETION_EVIDENCE_BUCKET, objectPath);
  if (downloaded.error) {
    if (/does not exist|not found/i.test(downloaded.error.message)) return null;
    throw new Error(`load admin evidence file: ${downloaded.error.message}`);
  }
  if (!downloaded.data) return null;
  return {
    bytes: new Uint8Array(downloaded.data.arrayBuffer),
    contentType,
    fileName: sanitizeCompletionEvidenceFileName(evidence.fileName, contentType),
  };
}
