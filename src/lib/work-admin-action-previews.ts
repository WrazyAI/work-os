import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";
import type { AdminPreview, AdminPreviewAction } from "@/modules/work-os/admin-agent/contracts";

/** Durable preview state for the admin agent surface. A consequential write is
 * described once (`createAdminPreview`), then executed at most once
 * (`confirmAdminPreview`) after the target state is re-read and compared with
 * the state the preview was computed from. The stored fingerprint, not a
 * client claim, decides whether the preview is still valid. */

/** Previews outlive a chat turn but not much else; a fifteen-minute window is
 * long enough for an agent to read a 202 and confirm, short enough that a
 * forgotten preview cannot be applied much later. */
export const ADMIN_PREVIEW_TTL_MS = 15 * 60_000;
/** A confirm marks the row before `apply()` runs, so a crash between the two
 * leaves a claim without a result. After this window a retry may take the
 * claim over instead of being told the confirm is still in flight. */
const ADMIN_PREVIEW_IN_FLIGHT_MS = 60_000;
const PREVIEW_IDEMPOTENCY_KEY_MAX = 160;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkAdminPreviewErrorCode =
  | "preview_expired"
  | "preview_stale"
  | "preview_in_flight"
  | "preview_not_found";

const PREVIEW_STATUS: Record<WorkAdminPreviewErrorCode, 404 | 409 | 410> = {
  preview_not_found: 404,
  preview_stale: 409,
  preview_in_flight: 409,
  preview_expired: 410,
};

const PREVIEW_MESSAGES: Record<WorkAdminPreviewErrorCode, string> = {
  preview_not_found: "Preview not found",
  preview_stale: "The target changed after this preview was created; create a new preview",
  preview_in_flight: "This preview is being applied; retry shortly",
  preview_expired: "This preview expired before it was confirmed; create a new preview",
};

/** The admin error mapper recognizes this class by name, so the auth module
 * never imports this store (and cannot form an import cycle). */
export class WorkAdminPreviewError extends Error {
  code: WorkAdminPreviewErrorCode;
  status: 404 | 409 | 410;

  constructor(code: WorkAdminPreviewErrorCode, message = PREVIEW_MESSAGES[code]) {
    super(message);
    this.name = "WorkAdminPreviewError";
    this.code = code;
    this.status = PREVIEW_STATUS[code];
  }
}

/** Arrays of primitives are treated as sets: an assignee or label list is the
 * same state in a different order. Arrays that hold objects keep their order,
 * because there the sequence is the structure. The fingerprint cannot ask the
 * action which arrays it considers unordered — confirm only has the stored row
 * — so the rule has to be decided once, here, and applied identically on both
 * sides. */
function canonicalState(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalState(item));
    const primitive = value.every((item) => item === null || typeof item !== "object");
    if (primitive) items.sort();
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalState(record[key])}`).join(",")}}`;
}

/** A stable string form of the state a preview was computed from: object keys
 * are sorted at every depth and unordered value arrays are normalised, so a
 * driver that reorders keys or ids cannot fake a change (or hide one). */
export function stableStateJson(state: Json | unknown): string {
  return canonicalState(state);
}

/** SHA-256 over `stableStateJson`. The column stores this digest as a JSON
 * string (`state_fingerprint jsonb not null`). */
export function previewFingerprint(state: Json | unknown): string {
  return createHash("sha256").update(stableStateJson(state)).digest("hex");
}

export type CreateAdminPreviewInput = {
  organizationId: string;
  userId: string;
  /** Null for session/Otto previews: they have no token row, and the partial
   * unique index on `(token_id, idempotency_key)` deliberately ignores them. */
  tokenId?: string | null;
  source: "api" | "otto";
  action: AdminPreviewAction;
  targetType: string;
  targetId: string | null;
  request: Json;
  preview: Omit<AdminPreview, "id">;
  /** The real target state the preview was computed from; only the fingerprint
   * of it is persisted. */
  state: Json;
  /** Defaults to now + 15 minutes. A past value is stored as given so tests and
   * clock skew exercise the expiry path instead of being rejected here. */
  expiresAt?: Date;
  /** Creation key. For API previews the partial unique index makes a retry with
   * the same key replay the same preview and a different request a 409. */
  idempotencyKey?: string | null;
};

export type AdminPreviewConfirmDeps = {
  /** Re-reads the target through the same reader the preview used. */
  readState: () => Promise<Json>;
  /** Executes the stored action. Called only after the claim commits. */
  apply: () => Promise<{ status: number; body: Json }>;
};

export type AdminPreviewConfirmResult = { status: number; body: Json; replayed: boolean };

type StoredPreview = {
  action?: AdminPreviewAction;
  summary?: string;
  changes?: AdminPreview["changes"];
  warnings?: string[];
  state?: Json;
  expiresAt?: string;
};

type PreviewRow = {
  id: string;
  organization_id: string;
  user_id: string;
  token_id: string | null;
  source: "api" | "otto";
  action: AdminPreviewAction;
  target_type: string;
  target_id: string | null;
  request: Json;
  preview: StoredPreview;
  state_fingerprint: string;
  result_status: number | null;
  result_body: Json | null;
  idempotency_key: string | null;
  expires_at: string | Date;
  confirmed_at: string | Date | null;
  created_at: string | Date;
};

const COLUMNS = `id, organization_id, user_id, token_id, source, action, target_type, target_id,
  request, preview, state_fingerprint, result_status, result_body, idempotency_key,
  expires_at, confirmed_at, created_at`;

/** Ownership is organization + user, plus the token that created it. A session
 * admin may read their own account's previews; a different user or workspace
 * sees a 404 rather than a hint that the id exists. */
const OWNER_PREDICATE = `organization_id = $2 and (user_id = $3 or token_id = $4::uuid)`;

function normalizeUuid(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function timestamp(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toAdminPreview(row: PreviewRow): AdminPreview {
  const stored = row.preview ?? {};
  return {
    id: row.id,
    action: stored.action ?? row.action,
    summary: typeof stored.summary === "string" ? stored.summary : "",
    changes: Array.isArray(stored.changes) ? stored.changes : [],
    warnings: Array.isArray(stored.warnings) ? stored.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    state: stored.state ?? {},
    expiresAt: timestamp(row.expires_at) ?? new Date(0).toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "23505";
}

async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function findByIdempotencyKey(tokenId: string, key: string): Promise<PreviewRow | null> {
  const { rows } = await getPool().query<PreviewRow>(
    `select ${COLUMNS} from work_admin_action_previews where token_id = $1 and idempotency_key = $2`,
    [tokenId, key],
  );
  return rows[0] ?? null;
}

/** The same key on the same request is a retry: replay the stored preview so a
 * lost 202 never turns into a second preview. The same key on anything else is
 * a caller mistake and answers `409 idempotency_conflict`, never a raw unique
 * violation from the partial index. */
function replayOrConflict(existing: PreviewRow, input: CreateAdminPreviewInput): AdminPreview {
  const same = existing.organization_id === input.organizationId
    && existing.action === input.action
    && existing.target_type === input.targetType
    && (existing.target_id ?? null) === (input.targetId ?? null)
    && stableStateJson(existing.request) === stableStateJson(input.request);
  if (same) return toAdminPreview(existing);
  throw new WorkOsConflictError(
    "Idempotency-Key was already used with a different preview",
    "idempotency_conflict",
  );
}

export async function createAdminPreview(input: CreateAdminPreviewInput): Promise<AdminPreview> {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + ADMIN_PREVIEW_TTL_MS);
  const tokenId = normalizeUuid(input.tokenId);
  const key = normalizeKey(input.idempotencyKey);
  if (key && key.length > PREVIEW_IDEMPOTENCY_KEY_MAX) {
    throw new WorkOsValidationError(`Idempotency-Key must be ${PREVIEW_IDEMPOTENCY_KEY_MAX} characters or fewer`);
  }
  const preview: StoredPreview = {
    action: input.action,
    summary: input.preview.summary,
    changes: input.preview.changes,
    warnings: input.preview.warnings,
    state: input.preview.state,
    // The preview body must agree with the row: a caller-supplied placeholder
    // expiry is replaced by the one actually enforced.
    expiresAt: expiresAt.toISOString(),
  };

  if (tokenId && key) {
    const existing = await findByIdempotencyKey(tokenId, key);
    if (existing) return replayOrConflict(existing, input);
  }

  try {
    const { rows } = await getPool().query<PreviewRow>(
      `insert into work_admin_action_previews
        (organization_id, user_id, token_id, source, action, target_type, target_id,
         request, preview, state_fingerprint, idempotency_key, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,to_jsonb($10::text),$11,$12)
       returning ${COLUMNS}`,
      [
        input.organizationId,
        input.userId,
        tokenId,
        input.source,
        input.action,
        input.targetType,
        input.targetId,
        input.request,
        preview,
        previewFingerprint(input.state),
        key,
        expiresAt,
      ],
    );
    return toAdminPreview(rows[0]);
  } catch (error) {
    // Two retries of the same create can race past the select above; the index
    // is the tie-breaker, so resolve the duplicate instead of surfacing 500.
    if (isUniqueViolation(error) && tokenId && key) {
      const existing = await findByIdempotencyKey(tokenId, key);
      if (existing) return replayOrConflict(existing, input);
    }
    throw error;
  }
}

export async function getAdminPreview(
  access: WorkOsAccess,
  previewId: string,
  tokenId?: string | null,
): Promise<AdminPreview | null> {
  const id = normalizeUuid(previewId);
  if (!id) return null;
  const { rows } = await getPool().query<PreviewRow>(
    `select ${COLUMNS} from work_admin_action_previews where id = $1 and ${OWNER_PREDICATE}`,
    [id, access.organizationId, access.ctx.user.id, normalizeUuid(tokenId)],
  );
  return rows[0] ? toAdminPreview(rows[0]) : null;
}

type ClaimOutcome =
  | { kind: "replay"; result: AdminPreviewConfirmResult }
  | { kind: "claimed"; previousKey: string | null };

/** Confirm a preview exactly once.
 *
 * The claim (`confirmed_at` + the confirm key) commits before `apply()` runs,
 * so a concurrent confirm can never execute the action twice: it either
 * replays the stored result or is told the apply is in flight. When `apply()`
 * throws, the claim is released so a retry can re-read state and try again. */
export async function confirmAdminPreview(
  access: WorkOsAccess,
  previewId: string,
  idempotencyKey: string | null,
  deps: AdminPreviewConfirmDeps,
  tokenId?: string | null,
): Promise<AdminPreviewConfirmResult> {
  const id = normalizeUuid(previewId);
  if (!id) throw new WorkAdminPreviewError("preview_not_found");
  const key = normalizeKey(idempotencyKey);
  if (key && key.length > PREVIEW_IDEMPOTENCY_KEY_MAX) {
    throw new WorkOsValidationError(`Idempotency-Key must be ${PREVIEW_IDEMPOTENCY_KEY_MAX} characters or fewer`);
  }
  const ownerTokenId = normalizeUuid(tokenId);
  const claimedAt = new Date().toISOString();

  const claim = await transaction<ClaimOutcome>(async (client) => {
    const { rows } = await client.query<PreviewRow>(
      `select ${COLUMNS} from work_admin_action_previews where id = $1 and ${OWNER_PREDICATE} for update`,
      [id, access.organizationId, access.ctx.user.id, ownerTokenId],
    );
    const row = rows[0];
    if (!row) throw new WorkAdminPreviewError("preview_not_found");

    const confirmedAt = timestamp(row.confirmed_at);
    if (confirmedAt !== null) {
      if (row.result_status !== null) {
        return {
          kind: "replay",
          result: {
            status: Number(row.result_status),
            body: (row.result_body ?? null) as Json,
            replayed: true,
          },
        };
      }
      const age = Date.now() - new Date(confirmedAt).getTime();
      if (age < ADMIN_PREVIEW_IN_FLIGHT_MS) {
        throw new WorkAdminPreviewError("preview_in_flight");
      }
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new WorkAdminPreviewError("preview_expired");
    }

    // Re-read the target while the row is locked and compare against the state
    // the preview described. A mismatch writes nothing at all.
    const currentFingerprint = previewFingerprint(await deps.readState());
    if (currentFingerprint !== String(row.state_fingerprint)) {
      throw new WorkAdminPreviewError("preview_stale");
    }

    // Keep a creation key intact: it is what makes a retried create replay this
    // preview instead of minting a second one.
    await client.query(
      `update work_admin_action_previews
         set confirmed_at = $2, idempotency_key = coalesce(idempotency_key, $3)
       where id = $1`,
      [id, claimedAt, key],
    );
    return { kind: "claimed", previousKey: row.idempotency_key };
  });

  if (claim.kind === "replay") return claim.result;

  let result: { status: number; body: Json };
  try {
    result = await deps.apply();
  } catch (error) {
    // Release only our own claim; a takeover by a later retry keeps its claim.
    await getPool().query(
      `update work_admin_action_previews
         set confirmed_at = null, idempotency_key = $2
       where id = $1 and confirmed_at = $3`,
      [id, claim.previousKey, claimedAt],
    ).catch(() => undefined);
    throw error;
  }

  try {
    await getPool().query(
      `update work_admin_action_previews set result_status = $2, result_body = $3 where id = $1`,
      [id, result.status, result.body],
    );
  } catch (error) {
    // The action already ran; reporting a failure here would invite a retry of
    // a completed write. A missing stored result only loses the replay body.
    console.error("[work-os] store admin preview result failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return { status: result.status, body: result.body, replayed: false };
}
