// Shared frame-analysis cache: reuse rules, cache keys, and store mapping.
// The cache is what lets a Worktivity audit reuse frames analyzed earlier
// instead of downloading and classifying them again.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_FINGERPRINT_VERSION,
  classificationCacheKey,
  createFrameAnalysisStore,
  pruneFrameAnalyses,
  reusableClassification,
  reusableFingerprint,
  rubricHash,
  saveFrameFingerprint,
  type FrameAnalysisRecord,
} from "../src/lib/worktivityFrameCache";

type Row = Record<string, unknown>;

const exact = (n: number) => n.toString(16).padStart(64, "0");
const fingerprint = (n: number, perceptual = "0".repeat(64)) => ({ exactHash: exact(n), perceptualHash: perceptual });

function record(overrides: Partial<FrameAnalysisRecord> = {}): FrameAnalysisRecord {
  return {
    employeeId: "employee-a",
    screenshotId: "shot-1",
    capturedAt: "2026-07-15T10:00:00.000Z",
    localDate: "2026-07-15",
    app: "VS Code",
    url: "example.test",
    activityLevel: 30,
    fingerprint: null,
    fingerprintVersion: null,
    fingerprintAt: null,
    classification: null,
    classificationKey: null,
    classificationModel: null,
    classificationAt: null,
    ...overrides,
  };
}

/** In-memory stand-in for the PostgREST-style DbClient (only the operators the
 * store uses). Upserts merge provided columns, exactly like ON CONFLICT. */
function createFakeClient(initial: Row[] = []) {
  const rows = [...initial];
  const upsertBatches: Row[][] = [];
  const from = (table: string) => {
    assert.equal(table, "worktivity_frame_analyses");
    let filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "upsert" | "delete" = "select";
    let upsertValues: Row[] = [];
    const execute = () => {
      if (mode === "upsert") {
        upsertBatches.push(upsertValues);
        for (const value of upsertValues) {
          const index = rows.findIndex((row) => row.employee_id === value.employee_id && row.screenshot_id === value.screenshot_id);
          if (index >= 0) rows[index] = { ...rows[index], ...value };
          else rows.push({ ...value });
        }
        return { data: upsertValues, error: null };
      }
      if (mode === "delete") {
        const kept = rows.filter((row) => !filters.every((filter) => filter(row)));
        const removed = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return { data: Array.from({ length: removed }, () => ({})), error: null };
      }
      return { data: rows.filter((row) => filters.every((filter) => filter(row))), error: null };
    };
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return query; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return query; },
      upsert: (values: Row | Row[]) => { mode = "upsert"; upsertValues = Array.isArray(values) ? values : [values]; return query; },
      delete: () => { mode = "delete"; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return query;
  };
  return { rows, upsertBatches, client: { from } as never };
}

test("fingerprints are reused only at the current algorithm version and well formed", () => {
  const cached = fingerprint(1);
  assert.deepEqual(
    reusableFingerprint(record({ fingerprint: cached, fingerprintVersion: FRAME_FINGERPRINT_VERSION })),
    cached,
  );
  assert.equal(
    reusableFingerprint(record({ fingerprint: cached, fingerprintVersion: FRAME_FINGERPRINT_VERSION - 1 })),
    null,
    "an older fingerprint algorithm must be recomputed",
  );
  assert.equal(reusableFingerprint(record({ fingerprint: { exactHash: "not-hex", perceptualHash: "0".repeat(64) }, fingerprintVersion: FRAME_FINGERPRINT_VERSION })), null);
  assert.equal(reusableFingerprint(record({ fingerprint: { exactHash: exact(1), perceptualHash: "101" }, fingerprintVersion: FRAME_FINGERPRINT_VERSION })), null);
  assert.equal(reusableFingerprint(record()), null);
});

test("classifications are reused only under the exact cache key", () => {
  const key = classificationCacheKey({ promptVersion: 1, model: "gpt-x", rubricHash: "abc", exactHash: exact(1) });
  const classification = { app: "VS Code", category: "work" as const, confidence: 0.9, reason: "editing code" };
  const hit = record({ classification, classificationKey: key });
  assert.deepEqual(reusableClassification(hit, key), classification);
  assert.equal(reusableClassification(hit, `${key}!`), null, "a different key must not reuse the classification");
  assert.equal(reusableClassification(record(), key), null);
});

test("the classification key changes with prompt version, model, rubric, and frame content", () => {
  const base = { promptVersion: 1, model: "gpt-x", rubricHash: "abc", exactHash: exact(1) };
  const key = classificationCacheKey(base);
  assert.notEqual(classificationCacheKey({ ...base, promptVersion: 2 }), key);
  assert.notEqual(classificationCacheKey({ ...base, model: "gpt-y" }), key);
  assert.notEqual(classificationCacheKey({ ...base, rubricHash: "other" }), key);
  assert.notEqual(classificationCacheKey({ ...base, exactHash: exact(2) }), key, "content that changed is classified again");
  assert.equal(
    classificationCacheKey({ ...base, exactHash: null }),
    classificationCacheKey({ ...base, exactHash: null }),
    "an unfingerprinted frame still keys deterministically",
  );
});

test("the rubric hash is stable for the same rubric and changes with it", () => {
  assert.equal(rubricHash("role: designer"), rubricHash("role: designer"));
  assert.notEqual(rubricHash("role: designer"), rubricHash("role: developer"));
});

test("the store round-trips records and a fingerprint-only save keeps the classification", async () => {
  const fake = createFakeClient();
  const store = createFrameAnalysisStore(fake.client);
  const classification = { app: "Figma", category: "work" as const, confidence: 0.8, reason: "design work" };
  const key = classificationCacheKey({ promptVersion: 1, model: "gpt-x", rubricHash: "abc", exactHash: exact(1) });

  await store.save([record({
    fingerprint: fingerprint(1),
    fingerprintVersion: FRAME_FINGERPRINT_VERSION,
    fingerprintAt: "2026-07-15T10:01:00.000Z",
    classification,
    classificationKey: key,
    classificationModel: "gpt-x",
    classificationAt: "2026-07-15T10:01:00.000Z",
  })]);
  assert.equal(fake.rows.length, 1);

  const loaded = await store.load("employee-a", "2026-07-15T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  const cached = loaded.get("shot-1");
  assert.ok(cached, "the stored record loads back");
  assert.deepEqual(cached.fingerprint, fingerprint(1));
  assert.equal(cached.fingerprintVersion, FRAME_FINGERPRINT_VERSION);
  assert.deepEqual(reusableClassification(cached, key), classification);

  // The Work OS pipeline writes fingerprints without ever touching the
  // classification columns of an existing row.
  await saveFrameFingerprint(fake.client, {
    employeeId: "employee-a",
    screenshotId: "shot-1",
    capturedAt: "2026-07-15T10:00:00.000Z",
    localDate: "2026-07-15",
    fingerprint: fingerprint(2),
  });
  const after = (await store.load("employee-a", "2026-07-15T00:00:00.000Z", "2026-07-16T00:00:00.000Z")).get("shot-1");
  assert.deepEqual(after?.fingerprint, fingerprint(2), "the fresh fingerprint wins");
  assert.deepEqual(after?.classification, classification, "the classification survives a fingerprint-only upsert");
  assert.equal(after?.classificationKey, key);
});

test("load filters to the employee and capture window", async () => {
  const fake = createFakeClient([
    { employee_id: "employee-a", screenshot_id: "shot-1", captured_at: "2026-07-15T10:00:00.000Z" },
    { employee_id: "employee-a", screenshot_id: "shot-2", captured_at: "2026-07-16T10:00:00.000Z" },
    { employee_id: "employee-b", screenshot_id: "shot-3", captured_at: "2026-07-15T10:00:00.000Z" },
  ]);
  const store = createFrameAnalysisStore(fake.client);
  const loaded = await store.load("employee-a", "2026-07-15T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  assert.deepEqual([...loaded.keys()], ["shot-1"]);
});

test("pruning removes only rows older than the retention cutoff", async () => {
  const fake = createFakeClient([
    { employee_id: "employee-a", screenshot_id: "old", captured_at: "2026-07-01T10:00:00.000Z" },
    { employee_id: "employee-a", screenshot_id: "recent", captured_at: "2026-07-15T10:00:00.000Z" },
  ]);
  const removed = await pruneFrameAnalyses(fake.client, "2026-07-10T00:00:00.000Z");
  assert.equal(removed, 1);
  assert.deepEqual(fake.rows.map((row) => row.screenshot_id), ["recent"]);
});

console.log("Frame analysis cache tests passed.");
