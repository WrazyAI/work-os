import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { NextRequest, NextResponse } from "next/server";
import type { ReviewedRecap, SpeechLine } from "../src/modules/work-os/admin-otto/contracts";
import {
  RECAP_AUDIO_DOWNLOAD_TIMEOUT_MS,
  RECAP_SYNTHESIS_TIMEOUT_MS,
  __resetRecapSpeechCache,
  speakRecap,
  synthesizeRecapSpeech,
  type RecapSpeechLine,
} from "../src/lib/work-os-recap-speech.ts";
import { TRANSCRIBE_MAX_BYTES, readVoiceUpload } from "../src/lib/aiTranscribe.ts";
import { buildReviewedRecap } from "../src/lib/work-os-reviewed-recaps.ts";
import { getAdminOttoRecap } from "../src/lib/work-os-admin-otto-reads.ts";
import { proxy } from "../src/proxy.ts";
import {
  adminAccess,
  fixture,
  intervalA,
  migration,
  org,
  otherOrg,
  personA,
  personB,
  prerequisites,
} from "./helpers/work-os-admin-otto-reads-fixture.mts";

process.env.DATABASE_URL ??= "postgres://pglite-test/work-os";

const disposableUrl = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";

type Db = Awaited<ReturnType<typeof fixture>>["db"];
type SpeechModule = typeof import("../src/lib/work-os-admin-otto-speech");
const speech = (): Promise<SpeechModule> => import("../src/lib/work-os-admin-otto-speech");
type AdminSpeechDeps = import("../src/lib/work-os-admin-otto-speech").AdminSpeechDeps;
type AdminTranscribeDeps = import("../src/lib/work-os-admin-otto-speech").AdminTranscribeDeps;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical = (lines: SpeechLine[]) => lines.map(({ text, time }) => ({ text, time }));

const defaultLines: SpeechLine[] = [
  { text: "Read the review queue.", time: null },
  { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
];

function reviewedRecap(overrides: Partial<ReviewedRecap> = {}): ReviewedRecap {
  const lines = (overrides.speechLines ?? defaultLines).map(({ text, time }) => ({ text, time }));
  return {
    intervalId: intervalA,
    eventId: randomUUID(),
    person: { id: personA, displayName: "Alex Rivera", active: true, timezone: "UTC" },
    reviewVersion: 1,
    reviewKey: "review-key-1",
    sourceRevision: 1,
    reviewStatus: "confirmed",
    reviewedAt: "2026-10-22T18:00:00.000Z",
    windowStart: "2026-10-22T17:00:00.000Z",
    windowEnd: "2026-10-22T18:00:00.000Z",
    timezone: "UTC",
    original: { headline: "Read the review queue", detail: "Read the review queue.", activities: ["Reviewed the cursor-pagination code"] },
    employeeFeedback: null,
    coverage: ["AI-inferred activity, employee reviewed; not task completion or attendance."],
    ...overrides,
    speechLines: lines,
    scriptHash: overrides.scriptHash ?? hash(canonical(lines)),
  };
}

async function seedPerson(db: Db, input: { id: string; name: string; active?: boolean; organizationId?: string }) {
  const organizationId = input.organizationId ?? org;
  await db.query(`insert into work_people (id, organization_id, display_name, active, nifty_member_id)
    values ($1,$2,$3,$4,null)`, [input.id, organizationId, input.name, input.active ?? true]);
  await db.query(`insert into work_employee_onboarding (organization_id, person_id, timezone)
    values ($1,$2,'UTC')`, [organizationId, input.id]);
}

async function seedRecap(db: Db, personId: string, input: {
  id?: string; organizationId?: string; reviewStatus?: string; feedback?: string | null;
  headline?: string; detail?: string;
}) {
  const id = input.id ?? randomUUID();
  const organizationId = input.organizationId ?? org;
  await db.query(`insert into work_activity_intervals
    (id,organization_id,person_id,generation_status,review_status,headline,ai_detail,final_detail,
     employee_feedback,structured_summary,source_hash,revision,local_date,prompt_kind,window_start,
     window_end,timezone,generated_at,reviewed_at,updated_at)
    values ($1,$2,$3,'ready',$4,$5,$6,$6,$7,'{"activities":[{"description":"7:21 PM Reviewed the code"}]}',
      'source',1,'2026-10-22','hourly_fallback','2026-10-22T17:00:00.000Z','2026-10-22T18:00:00.000Z',
      'UTC','2026-10-22T18:00:00.000Z','2026-10-22T18:05:00.000Z','2026-10-22T18:05:00.000Z')`,
  [id, organizationId, personId, input.reviewStatus ?? "confirmed", input.headline ?? "Reviewed the queue",
    input.detail ?? "Read the review queue.", input.feedback ?? null]);
  return id;
}

function speechDeps(recap: ReviewedRecap, overrides: Partial<AdminSpeechDeps> = {}) {
  const synthCalls: Array<{ lines: SpeechLine[]; voice: string }> = [];
  const claims: string[] = [];
  const releases: string[] = [];
  const loads: string[] = [];
  const base: AdminSpeechDeps = {
    authorize: async () => ({ access: adminAccess }),
    configured: () => true,
    loadReviewed: async (_access, intervalId) => { loads.push(intervalId); return recap; },
    revalidate: async () => adminAccess,
    claimSlot: async () => {
      const token = randomUUID();
      claims.push(token);
      return { token, release: async () => { releases.push(token); } };
    },
    synthesize: async (input) => {
      synthCalls.push({ lines: input.lines.map(({ text, time }) => ({ text, time })), voice: input.voice });
      return { ok: true, audio: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", voice: input.voice };
    },
    ...overrides,
  };
  return { deps: base, synthCalls, claims, releases, loads };
}

function speechRequest(body: unknown, init: RequestInit = {}) {
  return new Request(`https://app.example.test/api/work-os/admin/otto/recaps/${intervalA}/speech`, {
    method: "POST",
    headers: { authorization: "Bearer desktop", "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

async function json(response: Response): Promise<{
  schemaVersion?: number;
  reason?: string;
  error?: string;
  detail?: unknown;
  recap?: ReviewedRecap;
  delegated?: string;
}> {
  return response.json() as Promise<{
    schemaVersion?: number;
    reason?: string;
    error?: string;
    detail?: unknown;
    recap?: ReviewedRecap;
    delegated?: string;
  }>;
}

function serializedPool(db: Db) {
  let tail: Promise<void> = Promise.resolve();
  const adapter = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => {
      let releaseLock: (() => void) | null = null;
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (/^\s*begin\b/i.test(sql)) {
            let release!: () => void;
            const next = new Promise<void>((resolve) => { release = resolve; });
            const previous = tail;
            tail = previous.then(() => next);
            await previous;
            releaseLock = release;
            return db.query(sql, values);
          }
          if (/^\s*(commit|rollback)\b/i.test(sql)) {
            try {
              return await db.query(sql, values);
            } finally {
              releaseLock?.();
              releaseLock = null;
            }
          }
          return db.query(sql, values);
        },
        release: () => { releaseLock?.(); releaseLock = null; },
      };
    },
  };
  globalThis.__workOsPgPool = adapter as unknown as Pool;
}

test("unreviewed_and_foreign_recap_never_synthesized", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    await seedPerson(f.db, { id: personB, name: "Maria Chen", active: false });
    const reviewed = await seedRecap(f.db, personA, { headline: "Reviewed Alex's queue" });
    const inferred = await seedRecap(f.db, personA, { reviewStatus: "inferred" });
    const inactive = await seedRecap(f.db, personB, { headline: "Reviewed Maria's queue" });
    await seedPerson(f.db, { id: "20000000-0000-4000-8000-000000000004", name: "Other Person", organizationId: otherOrg });
    const foreign = await seedRecap(f.db, "20000000-0000-4000-8000-000000000004", {
      organizationId: otherOrg, headline: "Other org recap",
    });

    const { handleAdminRecapSpeech } = await speech();
    const { deps, synthCalls } = speechDeps(reviewedRecap(), {
      loadReviewed: (access, intervalId) => getAdminOttoRecap(access, intervalId),
    });

    for (const intervalId of [inferred, foreign, inactive]) {
      const response = await handleAdminRecapSpeech(
        speechRequest({ reviewKey: "review-key-1", voice: "Kore" }),
        intervalId,
        deps,
      );
      assert.equal(response.status, 404, `${intervalId} must be unavailable`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(synthCalls.length, 0, "nothing unreviewed, foreign or inactive reaches the provider");
    assert.ok(reviewed);
  } finally { await f.close(); }
});

test("amended_words_and_labels_match_prompter", async () => {
  const row = {
    id: intervalA,
    organization_id: org,
    person_id: personA,
    generation_status: "ready",
    review_status: "amended",
    headline: "Reviewed the queue",
    ai_detail: "Read the review queue.",
    final_detail: "Original AI summary.\nRead the review queue.\n\nEmployee correction.\nI also cleared the deploy.",
    employee_feedback: "I also cleared the deploy.",
    structured_summary: { activities: [{ description: "7:21 PM Reviewed the code" }] },
    revision: 2,
    window_start: "2026-10-22T17:00:00.000Z",
    window_end: "2026-10-22T18:00:00.000Z",
    timezone: "UTC",
    reviewed_at: "2026-10-22T18:05:00.000Z",
    generated_at: "2026-10-22T18:00:00.000Z",
  };
  const projected = buildReviewedRecap(row, 2, randomUUID(), {
    id: personA, displayName: "Alex Rivera", active: true, timezone: "UTC",
  });
  assert.equal(projected.reviewStatus, "amended");
  assert.deepEqual(projected.speechLines.slice(0, 1), [{ text: "Original AI summary.", time: null }]);
  assert.ok(projected.speechLines.some((line) => line.text === "Employee correction."));
  assert.ok(projected.speechLines.some((line) => line.text === "I also cleared the deploy."));

  const { handleAdminRecapSpeech } = await speech();
  const { deps, synthCalls } = speechDeps(projected);
  const response = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: projected.reviewKey, voice: "Kore" }),
    intervalA,
    deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(synthCalls[0].lines, canonical(projected.speechLines));
  assert.equal(synthCalls[0].voice, "Kore");
  assert.deepEqual(
    JSON.parse(decodeURIComponent(response.headers.get("x-work-os-recap-lines") ?? "")),
    projected.speechLines,
  );
  assert.equal(response.headers.get("x-work-os-recap-review-key"), projected.reviewKey);
  assert.equal(response.headers.get("x-work-os-recap-script-hash"), projected.scriptHash);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("same_generation_revision_new_review_cache_miss", async () => {
  const { speakReviewedRecap, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const gen1 = reviewedRecap({ reviewKey: "review-a", scriptHash: hash(canonical(defaultLines)) });
  const gen2 = reviewedRecap({
    reviewKey: "review-b",
    speechLines: [{ text: "Read the updated review queue.", time: null }],
  });
  const calls: string[] = [];
  const synth = async (input: { lines: RecapSpeechLine[]; voice: string }) => {
    calls.push(input.lines.map((line) => line.text).join(" "));
    return { ok: true as const, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
  };
  const input = (recap: ReviewedRecap) => ({
    organizationId: org, intervalId: recap.intervalId, reviewKey: recap.reviewKey,
    scriptHash: recap.scriptHash, voice: "Kore", lines: recap.speechLines,
  });
  await speakReviewedRecap(input(gen1), { synthesize: synth });
  await speakReviewedRecap(input(gen2), { synthesize: synth });
  await speakReviewedRecap(input(gen1), { synthesize: synth });
  await speakReviewedRecap({ ...input(gen1), voice: "Charon" }, { synthesize: synth });
  assert.equal(calls.length, 3, "a new review key or voice is a new clip; the same generation/voice is reused");
  assert.match(calls[0], /Read the review queue/);
  assert.match(calls[1], /updated review queue/);
});

test("correction_during_synthesis_returns_conflict", async () => {
  const { handleAdminRecapSpeech } = await speech();
  const oldRecap = reviewedRecap({ reviewKey: "review-old", scriptHash: hash(canonical(defaultLines)) });
  const newLines: SpeechLine[] = [{ text: "Read the corrected recap.", time: null }];
  const newRecap = reviewedRecap({ reviewKey: "review-new", speechLines: newLines });
  let loads = 0;
  const { deps, synthCalls } = speechDeps(oldRecap, {
    loadReviewed: async () => {
      loads += 1;
      return loads === 1 ? oldRecap : newRecap;
    },
  });
  const response = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: oldRecap.reviewKey, voice: "Kore" }),
    intervalA,
    deps,
  );
  assert.equal(response.status, 409);
  const body = await json(response);
  assert.equal(body.reason, "review_changed");
  assert.equal(body.recap?.reviewKey, newRecap.reviewKey);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(synthCalls.length, 1, "the old generation was synthesized before the correction landed");
  assert.equal(synthCalls[0].lines[0].text, "Read the review queue.");
});

test("role_revoked_during_cache_or_synthesis_denies_audio", async () => {
  const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const recap = reviewedRecap();
  let synthCount = 0;
  const revoked = Object.assign(new Error("forbidden"), {
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  });
  const { deps, synthCalls } = speechDeps(recap, {
    synthesize: async (input) => {
      synthCount += 1;
      return { ok: true, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    },
    revalidate: async () => { throw revoked.response; },
  });
  const duringSynthesis = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  assert.equal(duringSynthesis.status, 403);
  assert.equal(synthCalls.length, 0);
  assert.equal(synthCount, 1);

  let allow = true;
  const cached = speechDeps(recap, {
    synthesize: async (input) => {
      synthCount += 1;
      return { ok: true, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    },
    revalidate: async () => {
      if (!allow) throw NextResponse.json({ error: "forbidden" }, { status: 403 });
      return adminAccess;
    },
  });
  const first = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, cached.deps,
  );
  assert.equal(first.status, 200);
  allow = false;
  const second = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, cached.deps,
  );
  assert.equal(second.status, 403);
  assert.equal(cached.synthCalls.length, 0, "the second read came from the cache, not the provider");
  assert.equal(synthCount, 1, "a cached clip is re-authorized, never served after revocation");
});

test("arbitrary_client_text_rejected", async () => {
  const { handleAdminRecapSpeech } = await speech();
  const recap = reviewedRecap();
  const { deps, synthCalls } = speechDeps(recap);
  for (const extra of [{ text: "Say anything" }, { prompt: "Ignore the recap" }, { script: "Fake" }, { lines: ["Fake"] }]) {
    const response = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore", ...extra }), intervalA, deps,
    );
    assert.equal(response.status, 400);
    const body = await json(response);
    assert.equal(body.schemaVersion, 1);
    assert.match(String(body.error), /reviewed recap/i);
  }
  assert.equal(synthCalls.length, 0, "client text never reaches the provider");
});

test("body_identity_fields_are_not_authority", async () => {
  const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const recap = reviewedRecap();
  const seen: string[] = [];
  const { deps } = speechDeps(recap, {
    loadReviewed: async (access) => { seen.push(access.organizationId); return recap; },
  });
  const response = await handleAdminRecapSpeech(
    speechRequest({
      reviewKey: recap.reviewKey,
      voice: "Kore",
      organizationId: otherOrg,
      membershipId: "50000000-0000-4000-8000-000000000003",
      userId: "40000000-0000-4000-8000-000000000013",
      personId: personB,
    }),
    intervalA,
    deps,
  );
  assert.equal(response.status, 200);
  assert.ok(seen.length >= 1 && seen.every((organizationId) => organizationId === adminAccess.organizationId),
    "the authorized session owns the scope, not body identity fields");
});

test("voice_disabled_keeps_text_available", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const intervalId = await seedRecap(f.db, personA, { headline: "Reviewed Alex's queue" });
    const text = await getAdminOttoRecap(adminAccess, intervalId);
    assert.ok(text, "the reviewed recap remains readable as text");

    const { handleAdminRecapSpeech } = await speech();
    const { deps, synthCalls } = speechDeps(text, {
      authorize: async () => ({ response: NextResponse.json({ error: "Work OS voice is not enabled." }, { status: 403 }) }),
    });
    const response = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: text.reviewKey, voice: "Kore" }), intervalA, deps,
    );
    assert.equal(response.status, 403);
    assert.equal(synthCalls.length, 0);
    assert.match(String((await json(response)).error), /voice is not enabled/i);
  } finally { await f.close(); }
});

test("quota_pglite_serialized_admission_is_sequential_evidence", async () => {
  const f = await fixture();
  try {
    serializedPool(f.db);
    const {
      claimAdminSpeechSlot, AdminSpeechQuotaError,
    } = await speech();
    const [first, second, third] = await Promise.allSettled([
      claimAdminSpeechSlot(adminAccess),
      claimAdminSpeechSlot(adminAccess),
      claimAdminSpeechSlot(adminAccess),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "fulfilled");
    assert.equal(third.status, "rejected");
    if (third.status === "rejected") {
      assert.ok(third.reason instanceof AdminSpeechQuotaError);
      assert.ok(third.reason.retryAfterSeconds >= 1);
    }
    const active = await f.db.query<{ n: number }>(
      "select count(*)::int as n from work_admin_otto_speech_leases where released_at is null and expires_at > clock_timestamp()",
    );
    assert.equal(active.rows[0].n, 2, "PGlite serializes the transaction in JS; this is sequential evidence, not row-lock/process proof");
    if (first.status === "fulfilled") await first.value.release();
    if (second.status === "fulfilled") await second.value.release();
    const afterRelease = await claimAdminSpeechSlot(adminAccess);
    await afterRelease.release();

    // A crashed process leaves an active lease behind; expiry recovers it.
    await f.db.query(`insert into work_admin_otto_speech_leases
      (id, organization_id, membership_id, expires_at, released_at)
      values ($1,$2,$3, clock_timestamp() - interval '1 second', null)`,
    [randomUUID(), org, "50000000-0000-4000-8000-000000000001"]);
    const recovered = await claimAdminSpeechSlot(adminAccess);
    const recoveredRows = await f.db.query<{ released_at: Date | null }>(
      "select released_at from work_admin_otto_speech_leases where id = $1", [recovered.token],
    );
    assert.equal(recoveredRows.rows[0].released_at, null);
    await recovered.release();

    // Ten starts in the rolling minute refuse the next uncached synthesis.
    await f.db.query("delete from work_admin_otto_speech_leases");
    await f.db.query("delete from work_admin_otto_speech_starts");
    for (let index = 0; index < 10; index += 1) {
      await f.db.query(`insert into work_admin_otto_speech_starts
        (id, organization_id, membership_id, started_at)
        values ($1,$2,$3, clock_timestamp())`,
      [randomUUID(), org, "50000000-0000-4000-8000-000000000001"]);
    }
    await assert.rejects(
      () => claimAdminSpeechSlot(adminAccess),
      (error: unknown) => error instanceof AdminSpeechQuotaError && error.retryAfterSeconds >= 1,
    );
    await f.db.query("delete from work_admin_otto_speech_starts");
    const fresh = await claimAdminSpeechSlot(adminAccess);
    await fresh.release();
  } finally {
    globalThis.__workOsPgPool = undefined;
    await f.close();
  }
});

test("quota_prunes_only_old_completed_or_expired_leases", async () => {
  const f = await fixture();
  try {
    serializedPool(f.db);
    const { claimAdminSpeechSlot } = await speech();
    const oldReleased = randomUUID();
    const oldExpired = randomUUID();
    const recentReleased = randomUUID();
    const active = randomUUID();
    await f.db.query(`insert into work_admin_otto_speech_leases
      (id, organization_id, membership_id, expires_at, released_at)
      values
        ($1,$5,$6, clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'),
        ($2,$5,$6, clock_timestamp() - interval '2 days', null),
        ($3,$5,$6, clock_timestamp() + interval '1 minute', clock_timestamp() - interval '1 hour'),
        ($4,$5,$6, clock_timestamp() + interval '1 minute', null)`,
    [oldReleased, oldExpired, recentReleased, active, org, "50000000-0000-4000-8000-000000000001"]);
    const lease = await claimAdminSpeechSlot(adminAccess);
    const left = await f.db.query<{ id: string }>(
      "select id from work_admin_otto_speech_leases where organization_id = $1 order by id", [org],
    );
    const ids = left.rows.map((row) => row.id);
    assert.ok(!ids.includes(oldReleased), "released leases past retention are pruned");
    assert.ok(!ids.includes(oldExpired), "unreleased leases expired past retention are pruned");
    assert.ok(ids.includes(recentReleased), "recently released leases are retained");
    assert.ok(ids.includes(active), "active leases are never pruned");
    await lease.release();
  } finally {
    globalThis.__workOsPgPool = undefined;
    await f.close();
  }
});

test("lease_is_released_when_synthesis_fails_or_throws", async () => {
  const f = await fixture();
  try {
    serializedPool(f.db);
    const { handleAdminRecapSpeech, __resetAdminSpeechCache, claimAdminSpeechSlot } = await speech();
    __resetAdminSpeechCache();
    const recap = reviewedRecap();
    const failed = speechDeps(recap, {
      claimSlot: (access) => claimAdminSpeechSlot(access),
      synthesize: async () => ({ ok: false, reason: "provider_error" }),
    });
    const failedResponse = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, failed.deps,
    );
    assert.equal(failedResponse.status, 502);
    const afterFailure = await f.db.query<{ released_at: Date | null }>(
      "select released_at from work_admin_otto_speech_leases where organization_id = $1", [org],
    );
    assert.ok(afterFailure.rows.length > 0 && afterFailure.rows.every((row) => row.released_at !== null),
      "a provider failure releases its lease");

    const thrown = speechDeps(recap, {
      claimSlot: (access) => claimAdminSpeechSlot(access),
      synthesize: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
    });
    const thrownResponse = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, thrown.deps,
    );
    assert.equal(thrownResponse.status, 500);
    const afterThrow = await f.db.query<{ released_at: Date | null }>(
      "select released_at from work_admin_otto_speech_leases where organization_id = $1", [org],
    );
    assert.ok(afterThrow.rows.every((row) => row.released_at !== null), "a thrown/cancelled synthesis releases its lease");
    const next = await claimAdminSpeechSlot(adminAccess);
    await next.release();
  } finally {
    globalThis.__workOsPgPool = undefined;
    await f.close();
  }
});

test("singleflight_waiters_each_reauthorize", async () => {
  const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const recap = reviewedRecap();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let claims = 0;
  let claimsReady!: () => void;
  const bothClaimed = new Promise<void>((resolve) => { claimsReady = resolve; });
  let synth = 0;
  let reauth = 0;
  const { deps } = speechDeps(recap, {
    claimSlot: async () => {
      claims += 1;
      if (claims === 2) claimsReady();
      return { token: randomUUID(), release: async () => undefined };
    },
    synthesize: async (input) => {
      synth += 1;
      await gate;
      return { ok: true, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    },
    revalidate: async () => {
      reauth += 1;
      if (reauth === 2) throw NextResponse.json({ error: "forbidden" }, { status: 403 });
      return adminAccess;
    },
  });
  const first = handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  const second = handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  await bothClaimed;
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(synth, 1, "one shared synthesis serves both handlers");
  assert.equal(reauth, 2, "every waiter reauthorizes after the shared synthesis");
  assert.equal(claims, 2, "every caller performs its own quota admission");
});

test("cross_admin_quota_denial_does_not_share_leader_failure", async () => {
  const { handleAdminRecapSpeech, AdminSpeechQuotaError, __resetAdminSpeechCache } = await speech();
  const recap = reviewedRecap();
  const accessA = { ...adminAccess, membershipId: "50000000-0000-4000-8000-0000000000a1" } as typeof adminAccess;
  const accessB = { ...adminAccess, membershipId: "50000000-0000-4000-8000-0000000000b1" } as typeof adminAccess;

  __resetAdminSpeechCache();
  let bRevalidated = 0;
  const denied = speechDeps(recap, {
    authorize: async () => ({ access: accessA }),
    claimSlot: async () => { throw new AdminSpeechQuotaError(9); },
    revalidate: async () => adminAccess,
  });
  const allowed = speechDeps(recap, {
    authorize: async () => ({ access: accessB }),
    claimSlot: async () => ({ token: randomUUID(), release: async () => undefined }),
    revalidate: async () => { bRevalidated += 1; return accessB; },
  });
  const [deniedResponse, allowedResponse] = await Promise.all([
    handleAdminRecapSpeech(speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, denied.deps),
    handleAdminRecapSpeech(speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, allowed.deps),
  ]);
  assert.equal(deniedResponse.status, 429);
  assert.equal(allowedResponse.status, 200);
  assert.equal(allowed.synthCalls.length, 1, "the other admin's quota admits the synthesis");
  assert.equal(bRevalidated, 1, "the successful waiter reauthorizes");

  __resetAdminSpeechCache();
  let aRevalidated = 0;
  let bothClaims = 0;
  let bothSynth = 0;
  let bothClaimsReady!: () => void;
  const bothClaimed = new Promise<void>((resolve) => { bothClaimsReady = resolve; });
  let releaseSynth!: () => void;
  const synthGate = new Promise<void>((resolve) => { releaseSynth = resolve; });
  const bothA = speechDeps(recap, {
    authorize: async () => ({ access: accessA }),
    claimSlot: async () => {
      bothClaims += 1;
      if (bothClaims === 2) bothClaimsReady();
      return { token: randomUUID(), release: async () => undefined };
    },
    synthesize: async (input) => {
      bothSynth += 1;
      await synthGate;
      return { ok: true, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    },
    revalidate: async () => { aRevalidated += 1; return accessA; },
  });
  const bothB = speechDeps(recap, {
    authorize: async () => ({ access: accessB }),
    claimSlot: async () => {
      bothClaims += 1;
      if (bothClaims === 2) bothClaimsReady();
      return { token: randomUUID(), release: async () => undefined };
    },
    synthesize: async (input) => {
      bothSynth += 1;
      await synthGate;
      return { ok: true, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    },
    revalidate: async () => { bRevalidated += 1; return accessB; },
  });
  const bothRequests = [
    handleAdminRecapSpeech(speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, bothA.deps),
    handleAdminRecapSpeech(speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, bothB.deps),
  ];
  await bothClaimed;
  releaseSynth();
  const both = await Promise.all(bothRequests);
  assert.deepEqual(both.map((response) => response.status), [200, 200]);
  assert.equal(bothClaims, 2, "both admins admit before the shared synthesis");
  assert.equal(aRevalidated, 1);
  assert.equal(bRevalidated, 2);
  assert.equal(bothA.synthCalls.length + bothB.synthCalls.length, 0);
  assert.equal(bothSynth, 1, "the shared clip is synthesized once");
});

test("quota_denial_returns_429_and_retry_after", async () => {
  const { handleAdminRecapSpeech, AdminSpeechQuotaError, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const recap = reviewedRecap();
  const { deps, synthCalls } = speechDeps(recap, {
    claimSlot: async () => { throw new AdminSpeechQuotaError(7); },
  });
  const response = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal((await json(response)).reason, "quota_exceeded");
  assert.equal(synthCalls.length, 0);
});

test("cached_hit_does_not_consume_quota", async () => {
  const f = await fixture();
  try {
    serializedPool(f.db);
    const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
    __resetAdminSpeechCache();
    const recap = reviewedRecap();
    let claims = 0;
    const { claimAdminSpeechSlot } = await speech();
    const deps = speechDeps(recap, {
      claimSlot: async (access) => { claims += 1; return claimAdminSpeechSlot(access); },
    }).deps;
    const first = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
    );
    assert.equal(first.status, 200);
    const second = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
    );
    assert.equal(second.status, 200);
    assert.equal(claims, 1, "a cached clip is not a synthesis start");
    const starts = await f.db.query<{ n: number }>(
      "select count(*)::int as n from work_admin_otto_speech_starts",
    );
    assert.equal(starts.rows[0].n, 1);
  } finally {
    globalThis.__workOsPgPool = undefined;
    await f.close();
  }
});

test("cache_is_bounded_and_dedupes_in_flight_synthesis", async () => {
  const { speakReviewedRecap, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const synth = async (input: { lines: RecapSpeechLine[]; voice: string }) => {
    calls += 1;
    if (calls === 1) await gate;
    return { ok: true as const, audio: new Uint8Array([calls]), mimeType: "audio/wav", voice: input.voice };
  };
  const input = (index: number) => ({
    organizationId: org, intervalId: intervalA, reviewKey: `review-${index}`,
    scriptHash: "hash", voice: "Kore", lines: defaultLines,
  });
  const shared = speakReviewedRecap(input(0), { synthesize: synth });
  const same = Promise.all(Array.from({ length: 4 }, () => speakReviewedRecap(input(0), { synthesize: synth })));
  release();
  const [first, duplicates] = await Promise.all([shared, same]);
  assert.equal(first.ok, true);
  assert.equal(calls, 1, "one in-flight synthesis serves every identical request");
  assert.ok(duplicates.every((result) => result.ok));

  for (let index = 1; index <= 32; index += 1) {
    await speakReviewedRecap(input(index), { synthesize: synth });
  }
  const before = calls;
  await speakReviewedRecap(input(0), { synthesize: synth });
  assert.equal(calls, before + 1, "the 33rd successful clip evicts the oldest cached clip");
});

test("admin_without_person_mapping_can_speak_reviewed_recap", async () => {
  const { handleAdminRecapSpeech } = await speech();
  const recap = reviewedRecap();
  const access = { ...adminAccess, personId: null } as typeof adminAccess;
  const { deps, synthCalls } = speechDeps(recap, {
    authorize: async () => ({ access }),
  });
  const response = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  assert.equal(response.status, 200);
  assert.equal(synthCalls.length, 1);
  assert.equal(response.headers.get("x-work-os-recap-voice"), "Kore");
});

test("provider_failures_are_safe_and_never_leak_url_or_key", async () => {
  process.env.FAL_API_KEY = "fal-secret-value";
  try {
    const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
    __resetAdminSpeechCache();
    const recap = reviewedRecap();
    const { deps } = speechDeps(recap, {
      synthesize: async () => ({ ok: false, reason: "provider_error" }),
    });
    const response = await handleAdminRecapSpeech(
      speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }), intervalA, deps,
    );
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(body, /fal\.run|fal-secret-value|TOP_UP/i);
    assert.doesNotMatch(body, /https?:\/\//);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    delete process.env.FAL_API_KEY;
  }
});

test("script_over_6000_is_refused_before_synthesis", async () => {
  const { handleAdminRecapSpeech } = await speech();
  const long = reviewedRecap({
    speechLines: [{ text: "x".repeat(6001), time: null }],
  });
  const { deps, synthCalls } = speechDeps(long);
  const response = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: long.reviewKey, voice: "Kore" }), intervalA, deps,
  );
  assert.equal(response.status, 422);
  assert.match(String((await json(response)).error), /too long/i);
  assert.equal(synthCalls.length, 0);
});

test("audio_download_has_bounded_timeout", async () => {
  assert.equal(RECAP_SYNTHESIS_TIMEOUT_MS, 60_000);
  assert.equal(RECAP_AUDIO_DOWNLOAD_TIMEOUT_MS, 15_000);
  process.env.FAL_API_KEY = "test-key";
  try {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href.startsWith("https://fal.run/")) {
        return new Response(JSON.stringify({ audio: { url: "https://fal.media/out.wav" } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const result = await synthesizeRecapSpeech({
      lines: [{ text: "Read the review queue.", time: null }], voice: "Kore", fetchImpl,
    });
    assert.deepEqual(result, { ok: false, reason: "timeout" });
    assert.ok(calls[0].init?.signal instanceof AbortSignal);
    assert.ok(calls[1].init?.signal instanceof AbortSignal);
  } finally {
    delete process.env.FAL_API_KEY;
  }
});

function transcribeDeps(overrides: Partial<AdminTranscribeDeps> = {}) {
  const uploads: unknown[] = [];
  const transcripts: unknown[] = [];
  const base: AdminTranscribeDeps = {
    authorize: async () => ({ access: adminAccess }),
    configured: () => true,
    readUpload: async (form) => {
      uploads.push(form);
      return { ok: true, bytes: new Uint8Array([1, 2]), mime: "audio/webm" };
    },
    transcribe: async (input) => {
      transcripts.push(input);
      return { ok: true, text: "Read the queue.", model: "fal-ai/cohere-transcribe" };
    },
    ...overrides,
  };
  return { deps: base, uploads, transcripts };
}

function transcribeRequest(init: RequestInit = {}) {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }));
  return new Request("https://app.example.test/api/work-os/admin/otto/transcribe", {
    method: "POST", body: form, headers: { authorization: "Bearer desktop", ...(init.headers ?? {}) }, ...init,
  });
}

test("employee_and_admin_cache_namespaces_do_not_collide", async () => {
  const { speakReviewedRecap, __resetAdminSpeechCache } = await speech();
  process.env.FAL_API_KEY = "test-key";
  __resetAdminSpeechCache();
  __resetRecapSpeechCache();
  try {
    const recap = reviewedRecap();
    let adminSynth = 0;
    const adminInput = {
      organizationId: org, intervalId: intervalA, reviewKey: recap.reviewKey,
      scriptHash: recap.scriptHash, voice: "Kore", lines: recap.speechLines,
    };
    const adminSynthImpl = async (input: { lines: RecapSpeechLine[]; voice: string }) => {
      adminSynth += 1;
      return { ok: true as const, audio: new Uint8Array([1]), mimeType: "audio/wav", voice: input.voice };
    };
    await speakReviewedRecap(adminInput, { synthesize: adminSynthImpl });
    __resetRecapSpeechCache();
    await speakReviewedRecap(adminInput, { synthesize: adminSynthImpl });
    assert.equal(adminSynth, 1, "resetting the employee cache leaves the admin clip usable");

    let employeeFetches = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).startsWith("https://fal.run/")) {
        employeeFetches += 1;
        return Response.json({ audio: { url: "https://fal.media/collision.wav" } });
      }
      return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch;
    const employeeInput = { intervalId: intervalA, revision: 2, voice: "Kore", lines: defaultLines, fetchImpl };
    await speakRecap(employeeInput);
    __resetAdminSpeechCache();
    await speakRecap(employeeInput);
    assert.equal(employeeFetches, 1, "resetting the admin cache leaves the employee clip usable");
  } finally {
    __resetAdminSpeechCache();
    __resetRecapSpeechCache();
    delete process.env.FAL_API_KEY;
  }
});

test("admin_transcription_real_upload_guard_rejects_oversize", async () => {
  const { handleAdminOttoTranscribe } = await speech();
  let transcribed = 0;
  const { deps } = transcribeDeps({
    readUpload: readVoiceUpload,
    transcribe: async () => {
      transcribed += 1;
      return { ok: true, text: "should not run", model: "fal-ai/cohere-transcribe" };
    },
  });
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(TRANSCRIBE_MAX_BYTES + 1)], { type: "audio/webm" }));
  const request = new Request("https://app.example.test/api/work-os/admin/otto/transcribe", {
    method: "POST", body: form, headers: { authorization: "Bearer desktop" },
  });
  const response = await handleAdminOttoTranscribe(request, deps);
  assert.equal(response.status, 413);
  assert.match(String((await json(response)).error), /under two minutes/i);
  assert.equal(transcribed, 0, "the real size guard refuses before the provider");
});

test("admin_transcription_reuses_upload_limits_without_person", async () => {
  const { handleAdminOttoTranscribe } = await speech();
  const { deps, transcripts } = transcribeDeps();
  const access = { ...adminAccess, personId: null } as typeof adminAccess;
  deps.authorize = async () => ({ access });
  const response = await handleAdminOttoTranscribe(transcribeRequest(), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    schemaVersion: 1, text: "Read the queue.", model: "fal-ai/cohere-transcribe",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(transcripts.length, 1);
});

test("admin_transcription_failures_use_current_copy_and_no_provider_detail", async () => {
  const { handleAdminOttoTranscribe } = await speech();
  const tooLarge = transcribeDeps({
    readUpload: async () => ({ ok: false, reason: "too_large" }),
  });
  const response = await handleAdminOttoTranscribe(transcribeRequest(), tooLarge.deps);
  assert.equal(response.status, 413);
  const body = await json(response);
  assert.equal(body.schemaVersion, 1);
  assert.match(String(body.error), /under two minutes/i);
  assert.equal(body.detail, undefined);

  const provider = transcribeDeps({
    transcribe: async () => ({ ok: false, reason: "provider_error", detail: "fal 402 TOP_UP secret" }),
  });
  const failed = await handleAdminOttoTranscribe(transcribeRequest(), provider.deps);
  assert.equal(failed.status, 502);
  const text = await failed.text();
  assert.doesNotMatch(text, /TOP_UP|fal 402|secret/i);
});

test("admin_transcription_requires_voice_and_expected_cookie_origin", async () => {
  const { handleAdminOttoTranscribe } = await speech();
  const disabled = transcribeDeps({
    authorize: async () => ({ response: NextResponse.json({ error: "Voice is not enabled." }, { status: 403 }) }),
  });
  assert.equal((await handleAdminOttoTranscribe(transcribeRequest(), disabled.deps)).status, 403);

  const cookieWithoutOrigin = new Request("https://app.example.test/api/work-os/admin/otto/transcribe", {
    method: "POST", body: new FormData(),
  });
  const guarded = await handleAdminOttoTranscribe(cookieWithoutOrigin, transcribeDeps().deps);
  assert.equal(guarded.status, 403);
  assert.match(String((await json(guarded)).error), /origin/i);

  const bearerWithoutOrigin = new Request("https://app.example.test/api/work-os/admin/otto/transcribe", {
    method: "POST", body: new FormData(), headers: { authorization: "Bearer desktop" },
  });
  const bearer = await handleAdminOttoTranscribe(bearerWithoutOrigin, transcribeDeps().deps);
  assert.equal(bearer.status, 200);
});

test("speech_route_requires_expected_origin_for_cookie_requests", async () => {
  const { handleAdminRecapSpeech } = await speech();
  const recap = reviewedRecap();
  const { deps, synthCalls } = speechDeps(recap);
  const cookieNoOrigin = new Request(`https://app.example.test/api/work-os/admin/otto/recaps/${intervalA}/speech`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewKey: recap.reviewKey, voice: "Kore" }),
  });
  const denied = await handleAdminRecapSpeech(cookieNoOrigin, intervalA, deps);
  assert.equal(denied.status, 403);
  assert.equal(synthCalls.length, 0);

  const cookieWrongOrigin = new Request(cookieNoOrigin.url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ reviewKey: recap.reviewKey, voice: "Kore" }),
  });
  assert.equal((await handleAdminRecapSpeech(cookieWrongOrigin, intervalA, deps)).status, 403);
  assert.equal(synthCalls.length, 0);
});

test("route_handlers_execute_and_pass_interval_id", async () => {
  const { load } = routeFixture();
  const speechRoute = load("src/app/api/work-os/admin/otto/recaps/[intervalId]/speech/route.ts") as {
    POST: (request: Request, context: { params: Promise<{ intervalId: string }> }) => Promise<Response>;
  };
  const transcribeRoute = load("src/app/api/work-os/admin/otto/transcribe/route.ts") as {
    POST: (request: Request) => Promise<Response>;
  };
  const speechResponse = await speechRoute.POST(speechRequest({ reviewKey: "review", voice: "Kore" }), {
    params: Promise.resolve({ intervalId: intervalA }),
  });
  assert.equal(speechResponse.status, 200);
  assert.equal((await json(speechResponse)).delegated, "speech");
  assert.equal(routeFixtureCalls.speech, intervalA);

  const transcribeResponse = await transcribeRoute.POST(transcribeRequest());
  assert.equal(transcribeResponse.status, 200);
  assert.equal((await json(transcribeResponse)).delegated, "transcribe");
  assert.equal(routeFixtureCalls.transcribe, 1);
});

const routeFixtureCalls = { speech: "", transcribe: 0 };

function routeFixture() {
  const nativeRequire = createRequire(import.meta.url);
  const stubs: Record<string, Record<string, unknown>> = {
    "src/lib/work-os-admin-otto-speech.ts": {
      handleAdminRecapSpeech: async (_request: Request, intervalId: string) => {
        routeFixtureCalls.speech = intervalId;
        return NextResponse.json({ schemaVersion: 1, delegated: "speech" }, {
          headers: { "Cache-Control": "no-store" },
        });
      },
      handleAdminOttoTranscribe: async () => {
        routeFixtureCalls.transcribe += 1;
        return NextResponse.json({ schemaVersion: 1, delegated: "transcribe" }, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(relative: string): Record<string, unknown> {
    const file = relative.endsWith(".ts") ? relative : `${relative}.ts`;
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file)!;
    assert.ok(existsSync(path.join(path.resolve("."), file)), `missing production module: ${file}`);
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(path.join(path.resolve("."), file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const require = (specifier: string) => specifier.startsWith("@/")
      ? load(`src/${specifier.slice(2)}`)
      : specifier.startsWith(".")
        ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
        : nativeRequire(specifier);
    new Function("require", "exports", "module", js)(require, exports, { exports });
    return exports;
  }
  return { load };
}

test("cors_exposes_reviewed_audio_headers_for_desktop", async () => {
  const preflight = await proxy(new NextRequest(
    `https://app.example.test/api/work-os/admin/otto/recaps/${intervalA}/speech`,
    {
      method: "OPTIONS",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    },
  ));
  assert.equal(preflight.status, 204);
  const exposed = preflight.headers.get("access-control-expose-headers") ?? "";
  assert.match(exposed, /X-Work-OS-Recap-Review-Key/i);
  assert.match(exposed, /X-Work-OS-Recap-Script-Hash/i);

  const ordinary = await proxy(new NextRequest(
    `https://app.example.test/api/work-os/admin/otto/recaps/${intervalA}/speech`,
    {
      method: "POST",
      headers: {
        origin: "tauri://localhost",
        cookie: "better-auth.session_token=test",
        "content-type": "application/json",
      },
    },
  ));
  assert.equal(ordinary.status, 200);
  const ordinaryExposed = ordinary.headers.get("access-control-expose-headers") ?? "";
  assert.match(ordinaryExposed, /X-Work-OS-Recap-Review-Key/i);
  assert.match(ordinaryExposed, /X-Work-OS-Recap-Script-Hash/i);
});

type AuthRow = Record<string, unknown>;

/** Executes the real admin access helper and the real route handlers, stubbing
 * only the external auth/database boundary. No server credentials or live I/O. */
function accessAuthFixture(options: { role?: string; voice?: boolean } = {}) {
  const tokenHash = createHash("sha256").update("valid-desktop").digest("hex");
  const tables: Record<string, AuthRow[]> = {
    profiles: [{
      id: "actor-1", email: "admin@example.test", display_name: "Admin", avatar_url: null,
      role: "owner", created_at: "2026-01-01T00:00:00Z",
    }],
    work_org_members: [{
      id: "member-auth", organization_id: "org-auth", user_id: "actor-1",
      role: options.role ?? "admin", person_id: null, feature_flags: {}, active: true,
      created_at: "2026-01-01T00:00:00Z",
    }],
    work_organizations: [{
      id: "org-auth",
      feature_flags: { employee_companion: true, voice_input: options.voice ?? true },
      legacy_owner_id: null, created_by: "creator-1",
    }],
    work_desktop_sessions: [{
      id: "session-auth", organization_id: "org-auth", user_id: "actor-1", token_hash: tokenHash,
      expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_used_at: new Date().toISOString(),
    }],
  };
  const db = {
    from(table: string) {
      const filters: Array<(row: AuthRow) => boolean> = [];
      let single = false;
      const query = {
        select() { return query; },
        eq(key: string, expected: unknown) { filters.push((row) => row[key] === expected); return query; },
        is(key: string, expected: unknown) { filters.push((row) => (row[key] ?? null) === expected); return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        update() { return query; },
        then(
          resolve: (value: { data: unknown; error: null }) => void,
          reject: (reason: unknown) => void,
        ) {
          return Promise.resolve().then(() => {
            const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
            return { data: single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const stubs: Record<string, Record<string, unknown>> = {
    "src/lib/supabase/admin.ts": { createAdminClient: () => db },
    "src/lib/supabase/auth.ts": {
      requireUserProfile: async () => ({
        user: { id: "actor-1" },
        profile: {
          id: "actor-1", role: "owner", email: "admin@example.test",
          displayName: "Admin", avatarUrl: null, createdAt: "2026-01-01T00:00:00Z",
        },
      }),
    },
    "src/lib/work-os.ts": { isWorkOsMigrationRequired: () => false },
  };
  const nativeRequire = createRequire(import.meta.url);
  const cache = new Map<string, Record<string, unknown>>();
  function load(relative: string): Record<string, unknown> {
    const file = relative.endsWith(".ts") ? relative : `${relative}.ts`;
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file)!;
    assert.ok(existsSync(path.join(path.resolve("."), file)), `missing production module: ${file}`);
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(path.join(path.resolve("."), file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const require = (specifier: string) => specifier.startsWith("@/")
      ? load(`src/${specifier.slice(2)}`)
      : specifier.startsWith(".")
        ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
        : nativeRequire(specifier);
    new Function("require", "exports", "module", js)(require, exports, { exports });
    return exports;
  }
  return { load, tables };
}

test("speech_and_transcribe_routes_use_real_bearer_access_boundaries", async () => {
  const { handleAdminRecapSpeech, __resetAdminSpeechCache } = await speech();
  __resetAdminSpeechCache();
  const f = accessAuthFixture();
  const { requireAdminOttoAccess } = f.load("src/lib/work-os-admin-otto-access.ts") as {
    requireAdminOttoAccess: (request: Request, capability?: "read" | "voice") => Promise<{
      access?: unknown; response?: NextResponse;
    }>;
  };
  const recap = reviewedRecap();
  const authorize = (request: Request) => requireAdminOttoAccess(request, "voice") as Promise<{
    access?: typeof adminAccess; response?: NextResponse;
  }>;
  const { deps } = speechDeps(recap, { authorize });
  const valid = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }, { headers: { authorization: "Bearer valid-desktop" } }),
    intervalA,
    deps,
  );
  assert.equal(valid.status, 200);
  const invalid = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }, { headers: { authorization: "Bearer invalid-desktop" } }),
    intervalA,
    deps,
  );
  assert.equal(invalid.status, 401);
  const malformed = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }, { headers: { authorization: "Token not-bearer" } }),
    intervalA,
    deps,
  );
  assert.equal(malformed.status, 401);
  const cookie = await handleAdminRecapSpeech(
    new Request(`https://app.example.test/api/work-os/admin/otto/recaps/${intervalA}/speech`, {
      method: "POST",
      headers: { origin: "https://app.example.test", "content-type": "application/json" },
      body: JSON.stringify({ reviewKey: recap.reviewKey, voice: "Kore" }),
    }),
    intervalA,
    deps,
  );
  assert.equal(cookie.status, 200, "the real cookie access path remains origin-guarded and valid");

  const { handleAdminOttoTranscribe } = await speech();
  const transcribe = transcribeDeps();
  transcribe.deps.authorize = authorize as unknown as typeof transcribe.deps.authorize;
  const transcribeValid = await handleAdminOttoTranscribe(
    transcribeRequest({ headers: { authorization: "Bearer valid-desktop" } }), transcribe.deps,
  );
  assert.equal(transcribeValid.status, 200);
  const transcribeInvalid = await handleAdminOttoTranscribe(
    transcribeRequest({ headers: { authorization: "Bearer invalid-desktop" } }), transcribe.deps,
  );
  assert.equal(transcribeInvalid.status, 401);
  const transcribeMalformed = await handleAdminOttoTranscribe(
    transcribeRequest({ headers: { authorization: "Token not-bearer" } }), transcribe.deps,
  );
  assert.equal(transcribeMalformed.status, 401);

  const deniedVoice = accessAuthFixture({ voice: false });
  const { requireAdminOttoAccess: requireVoice } = deniedVoice.load("src/lib/work-os-admin-otto-access.ts") as {
    requireAdminOttoAccess: (request: Request, capability?: "read" | "voice") => Promise<{
      access?: unknown; response?: NextResponse;
    }>;
  };
  const denied = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }, { headers: { authorization: "Bearer valid-desktop" } }),
    intervalA,
    { ...deps, authorize: (request) => requireVoice(request, "voice") as Promise<{ access?: typeof adminAccess; response?: NextResponse }> },
  );
  assert.equal(denied.status, 403);

  const employee = accessAuthFixture({ role: "employee" });
  const { requireAdminOttoAccess: requireEmployee } = employee.load("src/lib/work-os-admin-otto-access.ts") as {
    requireAdminOttoAccess: (request: Request, capability?: "read" | "voice") => Promise<{
      access?: unknown; response?: NextResponse;
    }>;
  };
  const employeeDenied = await handleAdminRecapSpeech(
    speechRequest({ reviewKey: recap.reviewKey, voice: "Kore" }, { headers: { authorization: "Bearer valid-desktop" } }),
    intervalA,
    { ...deps, authorize: (request) => requireEmployee(request, "voice") as Promise<{ access?: typeof adminAccess; response?: NextResponse }> },
  );
  assert.equal(employeeDenied.status, 403);
});

const REAL_PG_TOPOLOGY = {
  controllerMax: 1,
  workerAMax: 2,
  workerBMax: 2,
  workerApps: ["otto_speech_worker_a", "otto_speech_worker_b"],
  expectedBlockedClaims: 3,
  pollIntervalMs: 20,
  pollTimeoutMs: 10_000,
  observer: "controller",
  dropOnlyCreatedSchema: true,
} as const;

test("real_pg_fixture_topology_keeps_observer_independent", () => {
  assert.equal(REAL_PG_TOPOLOGY.controllerMax, 1, "the barrier/observer owns a dedicated controller connection");
  assert.ok(
    REAL_PG_TOPOLOGY.workerAMax + REAL_PG_TOPOLOGY.workerBMax >= REAL_PG_TOPOLOGY.expectedBlockedClaims,
    "the two worker pools can hold all three pending claims without a pool-wait deadlock",
  );
  assert.equal(new Set(REAL_PG_TOPOLOGY.workerApps).size, 2);
  assert.equal(REAL_PG_TOPOLOGY.observer, "controller");
  assert.equal(REAL_PG_TOPOLOGY.dropOnlyCreatedSchema, true);
  const source = readFileSync(new URL("./work-os-admin-otto-speech.test.mts", import.meta.url), "utf8");
  assert.match(source, /barrier = await controller\.connect\(\)/);
  assert.match(source, /waitForBlockedClaims\(barrier\)/);
  assert.match(source, /application_name: REAL_PG_TOPOLOGY\.workerApps\[0\]/);
  assert.match(source, /if \(created\) await setup\.query\(`drop schema if exists \$\{schema\} cascade`\)/);
});

async function waitForBlockedClaims(observer: PoolClient) {
  const expected = REAL_PG_TOPOLOGY.expectedBlockedClaims;
  const deadline = Date.now() + REAL_PG_TOPOLOGY.pollTimeoutMs;
  let observed = 0;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity
      where application_name = any($1::text[]) and state = 'active' and wait_event_type = 'Lock'`,
    [REAL_PG_TOPOLOGY.workerApps]);
    observed = Number(rows[0]?.n ?? 0);
    if (observed >= expected) return observed;
    await new Promise((resolve) => setTimeout(resolve, REAL_PG_TOPOLOGY.pollIntervalMs));
  }
  throw new Error(`real PostgreSQL barrier observed ${observed}/${expected} blocked claims before timeout`);
}

test("quota_uses_real_three_pool_postgres_contention", {
  skip: !disposableUrl || !optIn
    ? "Requires disposable loopback PostgreSQL with two connections; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1. PGlite cannot prove row-lock/commit ordering."
    : false,
}, async () => {
  const url = new URL(disposableUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a local disposable PostgreSQL fixture is permitted");
  const schema = `otto_speech_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({
    connectionString: disposableUrl, max: 1,
    application_name: "otto_speech_setup",
  });
  // The controller owns the barrier and the only observer. Worker claims can
  // never consume its connection, so the previous pool-starved pg_locks poll
  // cannot deadlock. Two workers have four total slots for three claims.
  const controller = new Pool({
    connectionString: disposableUrl, max: REAL_PG_TOPOLOGY.controllerMax,
    application_name: "otto_speech_controller", statement_timeout: 15000,
  });
  const poolA = new Pool({
    connectionString: disposableUrl, max: REAL_PG_TOPOLOGY.workerAMax,
    application_name: REAL_PG_TOPOLOGY.workerApps[0],
    options: `-c search_path=${schema},public`,
    statement_timeout: 15000,
  });
  const poolB = new Pool({
    connectionString: disposableUrl, max: REAL_PG_TOPOLOGY.workerBMax,
    application_name: REAL_PG_TOPOLOGY.workerApps[1],
    options: `-c search_path=${schema},public`,
    statement_timeout: 15000,
  });
  let created = false;
  let barrier: PoolClient | null = null;
  let claims: Array<Promise<{ token: string; release(): Promise<void> }>> = [];
  try {
    await setup.query(`create schema ${schema}`);
    created = true;
    await poolA.query(prerequisites);
    await poolA.query(await migration());
    const { claimAdminSpeechSlot, AdminSpeechQuotaError } = await speech();

    // Hold a session advisory lock and make every lease INSERT wait on its
    // transaction-scoped twin. With the production membership FOR UPDATE, the
    // first claim blocks at the insert and the other two block on the row lock;
    // without it all three reach the insert. In both cases exactly three
    // worker backends are active and waiting on a Lock before the barrier is
    // released, so the observer can wait for the real state rather than guess.
    await poolA.query(`create or replace function otto_speech_insert_barrier()
      returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(4242, 18); return new; end $$`);
    await poolA.query(`create trigger otto_speech_insert_barrier
      before insert on work_admin_otto_speech_leases
      for each row execute function otto_speech_insert_barrier()`);
    barrier = await controller.connect();
    await barrier.query("select pg_advisory_lock(4242, 18)");

    // Alternate the production pool accessor between two genuinely independent
    // worker pools so concurrent claims own separate connections.
    let nextPool = 0;
    globalThis.__workOsPgPool = {
      connect: async () => ((nextPool++ % 2 === 0 ? poolA : poolB).connect()),
      query: (text: string, values?: unknown[]) => poolA.query(text, values),
    } as unknown as Pool;

    claims = [
      claimAdminSpeechSlot(adminAccess),
      claimAdminSpeechSlot(adminAccess),
      claimAdminSpeechSlot(adminAccess),
    ];
    const blocked = await waitForBlockedClaims(barrier);
    assert.equal(blocked, REAL_PG_TOPOLOGY.expectedBlockedClaims, "all claims reached the DB barrier before release");
    await barrier.query("select pg_advisory_unlock(4242, 18)");
    barrier.release();
    barrier = null;

    const [first, second, third] = await Promise.allSettled(claims);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "fulfilled");
    assert.equal(third.status, "rejected");
    if (third.status === "rejected") {
      assert.ok(third.reason instanceof AdminSpeechQuotaError);
      assert.ok(third.reason.retryAfterSeconds >= 1);
    }
    const active = await poolA.query<{ n: number }>(
      "select count(*)::int as n from work_admin_otto_speech_leases where released_at is null and expires_at > clock_timestamp()",
    );
    assert.equal(active.rows[0].n, 2, "real row locks never admit a third active lease");

    if (first.status === "fulfilled") await first.value.release();
    if (second.status === "fulfilled") await second.value.release();
    const released = await claimAdminSpeechSlot(adminAccess);
    await released.release();

    // Expiry recovery under the real database clock.
    const expiredA = await claimAdminSpeechSlot(adminAccess);
    const expiredB = await claimAdminSpeechSlot(adminAccess);
    await poolA.query(`update work_admin_otto_speech_leases
      set expires_at = clock_timestamp() - interval '1 second'
      where id = any($1::uuid[])`, [[expiredA.token, expiredB.token]]);
    const recovered = await claimAdminSpeechSlot(adminAccess);
    await recovered.release();

    // Ten production claims in the rolling minute admit the next only after
    // a non-expired start leaves the window; use releases to keep leases low.
    await poolA.query("delete from work_admin_otto_speech_leases");
    await poolA.query("delete from work_admin_otto_speech_starts");
    for (let index = 0; index < 10; index += 1) {
      const lease = await claimAdminSpeechSlot(adminAccess);
      await lease.release();
    }
    await assert.rejects(
      () => claimAdminSpeechSlot(adminAccess),
      (error: unknown) => error instanceof AdminSpeechQuotaError && error.retryAfterSeconds >= 1,
    );
  } finally {
    if (barrier) {
      await barrier.query("select pg_advisory_unlock(4242, 18)").catch(() => undefined);
      barrier.release(true);
      barrier = null;
    }
    await Promise.allSettled(claims);
    globalThis.__workOsPgPool = undefined;
    await Promise.all([poolA.end(), poolB.end(), controller.end()]);
    if (created) await setup.query(`drop schema if exists ${schema} cascade`);
    await setup.end();
  }
});

test("feed_never_warms_audio", () => {
  const inbox = readFileSync(new URL("../src/lib/work-os-admin-otto-inbox.ts", import.meta.url), "utf8");
  assert.doesNotMatch(inbox, /work-os-admin-otto-speech|synthesizeRecapSpeech|speakReviewedRecap/);
});
