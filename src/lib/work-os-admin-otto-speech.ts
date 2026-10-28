import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import {
  jsonError,
  WorkOsConflictError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import { isWorkOsMigrationRequired } from "@/lib/work-os";
import {
  revalidateAdminOttoAccess,
  requireAdminOttoAccess,
} from "@/lib/work-os-admin-otto-access";
import { getAdminOttoRecap } from "@/lib/work-os-admin-otto-reads";
import {
  DEFAULT_RECAP_VOICE,
  RECAP_SPEECH_MAX_CHARS,
  RECAP_VOICES,
  recapSpeechConfigured,
  recapSpeechFailureCopy,
  synthesizeRecapSpeech,
  type RecapSpeechFailure,
  type RecapSpeechLine,
  type RecapSpeechResult,
} from "@/lib/work-os-recap-speech";
import { TRANSCRIBE_FAILURE_COPY } from "@/lib/work-os-voice-failure-copy";
import {
  readVoiceUpload,
  transcribeAudio,
  voiceInputConfigured,
} from "@/lib/aiTranscribe";
import type {
  OttoScope,
  ReviewedRecap,
  SpeechLine,
} from "@/modules/work-os/admin-otto/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REVIEW_KEY_CHARS = 256;
const TEXT_FIELDS = ["text", "prompt", "script", "lines"] as const;

const FAILURE_STATUS: Record<RecapSpeechFailure, number> = {
  not_configured: 503,
  empty: 422,
  too_long: 422,
  provider_error: 502,
  timeout: 504,
  malformed: 502,
};

export type AdminSpeechLease = {
  token: string;
  release(): Promise<void>;
};

/** What the reviewed-audio route needs from the rest of the app. The defaults
 * are the live modules; tests supply deterministic stubs. */
export type AdminSpeechDeps = {
  authorize: (request: Request) => Promise<{ access?: WorkOsAccess; response?: NextResponse }>;
  loadReviewed: (access: WorkOsAccess, intervalId: string) => Promise<ReviewedRecap | null>;
  revalidate: (request: Request, expected: OttoScope) => Promise<WorkOsAccess>;
  synthesize: (input: { lines: RecapSpeechLine[]; voice: string }) => Promise<RecapSpeechResult>;
  claimSlot: (access: WorkOsAccess) => Promise<AdminSpeechLease>;
  configured: () => boolean;
};

export type AdminTranscribeDeps = {
  authorize: (request: Request) => Promise<{ access?: WorkOsAccess; response?: NextResponse }>;
  configured: () => boolean;
  readUpload: typeof readVoiceUpload;
  transcribe: typeof transcribeAudio;
};

const liveDeps: AdminSpeechDeps = {
  authorize: (request) => requireAdminOttoAccess(request, "voice"),
  loadReviewed: (access, intervalId) => getAdminOttoRecap(access, intervalId),
  revalidate: (request, expected) => revalidateAdminOttoAccess(request, expected),
  synthesize: (input) => synthesizeRecapSpeech(input),
  claimSlot: (access) => claimAdminSpeechSlot(access),
  configured: recapSpeechConfigured,
};

const liveTranscribeDeps: AdminTranscribeDeps = {
  authorize: (request) => requireAdminOttoAccess(request, "voice"),
  configured: voiceInputConfigured,
  readUpload: readVoiceUpload,
  transcribe: (input) => transcribeAudio(input),
};

function noStore(status: number, body: Record<string, unknown>) {
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function fail(error: string, status: number, reason?: string) {
  return noStore(status, { error, ...(reason ? { reason } : {}) });
}

async function wired(response: Response) {
  const body = await response.json().catch(() => ({ error: "Request failed" }));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function conflict(recap: ReviewedRecap) {
  return noStore(409, {
    error: "This recap changed. Refresh it before listening.",
    reason: "review_changed",
    recap,
  });
}

function unavailable() {
  return fail("That recap is no longer available.", 404);
}

function scope(access: WorkOsAccess): OttoScope {
  return { userId: access.ctx.user.id, organizationId: access.organizationId, mode: "admin" };
}

/** Stored canonical lines only. Anything else (client text, an inferred recap,
 * a foreign id) never reaches the provider. */
function canonicalLines(recap: ReviewedRecap): RecapSpeechLine[] {
  return recap.speechLines
    .map((line: SpeechLine) => ({
      text: typeof line.text === "string" ? line.text : "",
      time: typeof line.time === "string" && line.time ? line.time : null,
    }))
    .filter((line) => line.text.trim().length > 0);
}

function scriptHash(lines: RecapSpeechLine[]) {
  return createHash("sha256")
    .update(JSON.stringify(lines.map(({ text, time }) => ({ text, time }))))
    .digest("hex");
}

function boundedVoice(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return DEFAULT_RECAP_VOICE;
  if (typeof value !== "string") return null;
  const voice = value.trim();
  return (RECAP_VOICES as readonly string[]).includes(voice) ? voice : null;
}

function objectBody(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A reviewed-audio error must never carry a provider URL, key, payload or
 * internal database detail. Known failures use the shared employee copy. */
function speechFailure(reason: RecapSpeechFailure) {
  return fail(recapSpeechFailureCopy(reason), FAILURE_STATUS[reason], reason);
}

function safeUnknown(error: unknown) {
  if (error instanceof WorkOsConflictError || error instanceof WorkOsValidationError) {
    return wired(jsonError(error));
  }
  if (isWorkOsMigrationRequired(error)) {
    return fail("Work OS database migration required.", 503, "migration_required");
  }
  console.error("[admin-otto-speech] request failed", error instanceof Error ? error.message : error);
  return fail("Reading that recap is unavailable right now. Try again.", 500, "internal_error");
}

/** POST /api/work-os/admin/otto/recaps/:intervalId/speech
 *
 * The body carries a reviewed version key and a voice, never text. Desired
 * order: authorize, validate the exact reviewed version, serve a cached clip
 * or synthesize the stored canonical lines, then reauthorize and reload the
 * version before any bytes leave the process. */
export async function handleAdminRecapSpeech(
  request: Request,
  intervalId: string,
  deps: AdminSpeechDeps = liveDeps,
): Promise<NextResponse> {
  try {
    const auth = await deps.authorize(request);
    if (auth.response) return wired(auth.response);
    const access = auth.access;
    if (!access) return fail("authentication required", 401);
    if (!request.headers.get("authorization") && !hasExpectedPublicOrigin(request)) {
      return fail("invalid origin", 403, "invalid_origin");
    }

    if (!deps.configured()) return speechFailure("not_configured");

    const body = await request.json().catch(() => null);
    if (!objectBody(body)) return fail("Body must be a JSON object", 400, "invalid_body");
    if (body.schemaVersion !== undefined && body.schemaVersion !== 1) {
      return fail("Unsupported schema version", 400, "invalid_schema_version");
    }
    if (TEXT_FIELDS.some((field) => field in body)) {
      return fail("Speech reads only the reviewed recap.", 400, "text_not_allowed");
    }

    const reviewKey = typeof body.reviewKey === "string" ? body.reviewKey.trim() : "";
    if (!reviewKey || reviewKey.length > MAX_REVIEW_KEY_CHARS) {
      return fail("A reviewed recap is required.", 400, "invalid_review_key");
    }
    const voice = boundedVoice(body.voice);
    if (!voice) return fail("That voice is not available.", 400, "invalid_voice");

    // Malformed ids are gone exactly like unknown ones; no database question
    // is asked about a string that cannot be an id.
    if (!UUID.test(intervalId)) return unavailable();
    const id = intervalId.toLowerCase();

    const recap = await deps.loadReviewed(access, id);
    if (!recap || !recap.person.active) return unavailable();
    if (recap.reviewKey !== reviewKey) return conflict(recap);

    const lines = canonicalLines(recap);
    if (!lines.length) return speechFailure("empty");
    const total = lines.reduce((count, line) => count + line.text.length, 0);
    if (total > RECAP_SPEECH_MAX_CHARS) return speechFailure("too_long");
    // The stored script hash is derived from these exact stored lines. A
    // mismatched record is stale/inconsistent, never spoken under the old key.
    if (scriptHash(lines) !== recap.scriptHash) return conflict(recap);

    let result: RecapSpeechResult;
    try {
      result = await speakReviewedRecap(
        {
          organizationId: access.organizationId,
          intervalId: id,
          reviewKey: recap.reviewKey,
          scriptHash: recap.scriptHash,
          voice,
          lines,
        },
        {
          synthesize: deps.synthesize,
          // Only an uncached synthesis claims a lease; the cache path never
          // consumes a start or bills a second provider call.
          claimSlot: () => deps.claimSlot(access),
        },
      );
    } catch (error) {
      if (error instanceof AdminSpeechQuotaError) {
        return NextResponse.json({
          schemaVersion: 1,
          error: "Too many recaps are being read aloud. Try again shortly.",
          reason: "quota_exceeded",
        }, {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(error.retryAfterSeconds),
          },
        });
      }
      throw error;
    }
    if (!result.ok) return speechFailure(result.reason);

    // Reauthorize and reload after the slow path (and after a cache read):
    // a revoked role, deactivated membership, correction or removed recap
    // must never leave prepared audio playable.
    let fresh: WorkOsAccess;
    try {
      fresh = await deps.revalidate(request, scope(access));
    } catch (error) {
      if (error instanceof Response) return wired(error);
      throw error;
    }
    const current = await deps.loadReviewed(fresh, id);
    if (!current || !current.person.active) return unavailable();
    if (current.reviewKey !== recap.reviewKey || current.scriptHash !== recap.scriptHash) {
      return conflict(current);
    }

    const bytes = new Uint8Array(result.audio.byteLength);
    bytes.set(result.audio);
    return new NextResponse(new Blob([bytes], { type: result.mimeType }), {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "cache-control": "no-store",
        "x-work-os-recap-voice": result.voice,
        "x-work-os-recap-review-key": current.reviewKey,
        "x-work-os-recap-script-hash": current.scriptHash,
        "x-work-os-recap-lines": encodeURIComponent(JSON.stringify(lines)),
      },
    }) as NextResponse;
  } catch (error) {
    return safeUnknown(error);
  }
}

/* ── Reviewed-audio cache and single-flight synthesis ─────────────────── */

const CACHE_LIMIT = 32;
const cache = new Map<string, RecapSpeechResult & { ok: true }>();
const inFlight = new Map<string, Promise<RecapSpeechResult>>();

function cacheKey(input: {
  organizationId: string;
  intervalId: string;
  reviewKey: string;
  scriptHash: string;
  voice: string;
}) {
  return [input.organizationId, input.intervalId, input.reviewKey, input.scriptHash, input.voice].join("\u0000");
}

export function __resetAdminSpeechCache() {
  cache.clear();
  inFlight.clear();
}

/** New reviewed-audio cache, kept separate from the employee `speakRecap`
 * signature and namespace. The key binds organization, interval, immutable
 * review key, script hash and voice; only successful clips are cached. */
export async function speakReviewedRecap(
  input: {
    organizationId: string;
    intervalId: string;
    reviewKey: string;
    scriptHash: string;
    voice: string;
    lines: SpeechLine[];
  },
  deps: {
    synthesize?: (input: { lines: RecapSpeechLine[]; voice: string }) => Promise<RecapSpeechResult>;
    claimSlot?: () => Promise<AdminSpeechLease>;
  } = {},
): Promise<RecapSpeechResult> {
  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;

  // Each caller performs its own quota admission before sharing a synthesis.
  // A denied admin therefore never inherits or blocks another admin's clip.
  const lease = deps.claimSlot ? await deps.claimSlot() : null;
  try {
    const raced = cache.get(key);
    if (raced) return raced;
    const existing = inFlight.get(key);
    if (existing) return await existing;

    const pending = (async (): Promise<RecapSpeechResult> => {
      try {
        const second = cache.get(key);
        if (second) return second;
        const lines = input.lines.map(({ text, time }) => ({ text, time: time ?? null }));
        const result = await (deps.synthesize ?? synthesizeRecapSpeech)({ lines, voice: input.voice });
        if (result.ok) {
          cache.set(key, result);
          while (cache.size > CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
        }
        return result;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
    return await pending;
  } finally {
    if (lease) await lease.release().catch(() => undefined);
  }
}

/* ── Shared per-admin synthesis quota ─────────────────────────────────── */

export const SPEECH_ACTIVE_LEASE_LIMIT = 2;
export const SPEECH_LEASE_MS = 90_000;
export const SPEECH_STARTS_PER_MINUTE = 10;
export const SPEECH_LEASE_RETENTION_MS = 24 * 60 * 60 * 1000;

export class AdminSpeechQuotaError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many recaps are being read aloud. Try again shortly.");
    this.name = "AdminSpeechQuotaError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1));
  }
}

/** Claim one shared synthesis slot in the database. Two active leases (90s
 * each) per admin, ten starts in the rolling minute, cached hits excluded by
 * the caller. The membership row is locked first so simultaneous server
 * processes admit in commit order; all times come from the database clock. */
export async function claimAdminSpeechSlot(access: WorkOsAccess): Promise<AdminSpeechLease> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const membership = await client.query(
      "select id from work_org_members where organization_id = $1 and id = $2 and active = true for update",
      [access.organizationId, access.membershipId],
    );
    if (!membership.rows[0]) throw new Error("Work OS membership not found.");

    const clock = await client.query<{ now: Date }>("select clock_timestamp() as now");
    const now = clock.rows[0].now;

    // Bounded ephemeral retention: old completed/expired rows are removed
    // during admission, while active and recent leases are retained. All
    // cutoffs use the database clock so server clocks cannot disagree.
    await client.query(`delete from work_admin_otto_speech_leases
      where organization_id = $1 and membership_id = $2
        and (
          (released_at is not null and released_at < $3::timestamptz - ($4::int * interval '1 second'))
          or (released_at is null and expires_at < $3::timestamptz - ($4::int * interval '1 second'))
        )`,
    [access.organizationId, access.membershipId, now, Math.ceil(SPEECH_LEASE_RETENTION_MS / 1000)]);

    // Expired leases are recovered here: a process that died mid-synthesis
    // never blocks the admin after the lease's own bound.
    await client.query(`update work_admin_otto_speech_leases
      set released_at = $3::timestamptz
      where organization_id = $1 and membership_id = $2
        and released_at is null and expires_at <= $3::timestamptz`,
    [access.organizationId, access.membershipId, now]);

    const active = await client.query<{ active: number; retry_after: number }>(`select
        count(*)::int as active,
        coalesce(ceil(extract(epoch from (min(expires_at) - $3::timestamptz))), 0)::int as retry_after
      from work_admin_otto_speech_leases
      where organization_id = $1 and membership_id = $2
        and released_at is null and expires_at > $3::timestamptz`,
    [access.organizationId, access.membershipId, now]);
    if ((active.rows[0]?.active ?? 0) >= SPEECH_ACTIVE_LEASE_LIMIT) {
      throw new AdminSpeechQuotaError(active.rows[0]?.retry_after ?? 1);
    }

    await client.query(`delete from work_admin_otto_speech_starts
      where organization_id = $1 and membership_id = $2 and started_at <= $3::timestamptz - interval '1 minute'`,
    [access.organizationId, access.membershipId, now]);
    const starts = await client.query<{ starts: number; retry_after: number }>(`select
        count(*)::int as starts,
        coalesce(ceil(extract(epoch from (min(started_at) + interval '1 minute' - $3::timestamptz))), 0)::int as retry_after
      from work_admin_otto_speech_starts
      where organization_id = $1 and membership_id = $2 and started_at > $3::timestamptz - interval '1 minute'`,
    [access.organizationId, access.membershipId, now]);
    if ((starts.rows[0]?.starts ?? 0) >= SPEECH_STARTS_PER_MINUTE) {
      throw new AdminSpeechQuotaError(starts.rows[0]?.retry_after ?? 1);
    }

    const token = randomUUID();
    await client.query(`insert into work_admin_otto_speech_leases
      (id, organization_id, membership_id, expires_at)
      values ($1, $2, $3, $4::timestamptz + ($5::int * interval '1 second'))`,
    [token, access.organizationId, access.membershipId, now, Math.ceil(SPEECH_LEASE_MS / 1000)]);
    await client.query(`insert into work_admin_otto_speech_starts
      (id, organization_id, membership_id, started_at)
      values ($1, $2, $3, $4::timestamptz)`,
    [randomUUID(), access.organizationId, access.membershipId, now]);
    await client.query("commit");

    return {
      token,
      release: async () => {
        const releaseClient = await getPool().connect();
        try {
          await releaseClient.query(`update work_admin_otto_speech_leases
            set released_at = clock_timestamp()
            where organization_id = $1 and id = $2 and released_at is null`,
          [access.organizationId, token]);
        } finally {
          releaseClient.release();
        }
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* ── Admin transcription adapter ─────────────────────────────────────── */

/** POST /api/work-os/admin/otto/transcribe
 *
 * Same upload guards and failure copy as the employee route, but admin+voice
 * authorization and no personal mapping requirement. Audio is forwarded to the
 * provider and dropped; nothing is persisted. */
export async function handleAdminOttoTranscribe(
  request: Request,
  deps: AdminTranscribeDeps = liveTranscribeDeps,
): Promise<NextResponse> {
  try {
    const auth = await deps.authorize(request);
    if (auth.response) return wired(auth.response);
    if (!auth.access) return fail("authentication required", 401);
    if (!request.headers.get("authorization") && !hasExpectedPublicOrigin(request)) {
      return fail("invalid origin", 403, "invalid_origin");
    }
    if (!deps.configured()) {
      return fail(TRANSCRIBE_FAILURE_COPY.not_configured.error, TRANSCRIBE_FAILURE_COPY.not_configured.status, "not_configured");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("Expected multipart/form-data.", 400, "invalid_body");
    }
    const upload = await deps.readUpload(form);
    if (!upload.ok) {
      const copy = TRANSCRIBE_FAILURE_COPY[upload.reason];
      return fail(copy.error, copy.status, upload.reason);
    }
    const result = await deps.transcribe({
      bytes: upload.bytes,
      mime: upload.mime,
      language: form.get("language"),
    });
    if (!result.ok) {
      const copy = TRANSCRIBE_FAILURE_COPY[result.reason];
      // Deliberately no provider `detail` in the admin envelope.
      return fail(copy.error, copy.status, result.reason);
    }
    return noStore(200, { text: result.text, model: result.model });
  } catch (error) {
    if (error instanceof Response) return wired(error);
    if (isWorkOsMigrationRequired(error)) {
      return fail("Work OS database migration required.", 503, "migration_required");
    }
    console.error("[admin-otto-transcribe] request failed", error instanceof Error ? error.message : error);
    return fail("Transcription is unavailable right now. Try again.", 500, "internal_error");
  }
}
