import assert from "node:assert/strict";
import test from "node:test";
import { access, fixture, interval, org, otherOrg, person, untouched } from "./helpers/work-os-admin-otto-fixture.mts";
import type { ActivityIntervalRecord } from "../src/lib/work-os-activity-intervals";

const service = () => import("../src/lib/work-os-reviewed-recaps");

test("inferred_or_rolled_back_review_emits_nothing", async () => {
  const f = await fixture();
  try {
    const { loadReviewedRecap, decideReviewedRecap } = await service();
    const before = await untouched(f.db);
    assert.equal(await loadReviewedRecap(access, interval), null);
    await f.db.exec(`create function reject_audit() returns trigger language plpgsql as $$ begin raise exception 'audit rejected'; end $$;
      create trigger reject_audit before insert on work_audit_log for each row execute function reject_audit();`);
    await assert.rejects(decideReviewedRecap(access, interval, { action: "confirm" }), /audit rejected/);
    assert.deepEqual((await f.db.query("select * from work_recap_reviews")).rows, []);
    assert.deepEqual((await f.db.query("select * from work_admin_otto_clock where sequence > 0")).rows, []);
    assert.equal((await f.db.query<{ review_status: string }>("select review_status from work_activity_intervals")).rows[0].review_status, "inferred");
    assert.deepEqual(await untouched(f.db), before);
    assert.equal(f.releases(), 2);
  } finally { await f.close(); }
});

test("confirm_retry_emits_one_version", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap, loadReviewedRecap } = await service();
    const before = await untouched(f.db);
    const { decideActivityInterval } = await import("../src/lib/work-os-activity-intervals");
    const row = await decideActivityInterval(access, interval, { action: "confirm", expectedReviewVersion: 0 });
    assert.equal(row.review_status, "confirmed");
    // The next-step pass may already advance this status; a retry must not
    // queue it again or move reviewed_at.
    await f.db.exec("update work_activity_intervals set next_steps_status = 'generated', reviewed_at = '2026-10-21T10:05:00Z'");
    await decideReviewedRecap(access, interval, { action: "confirm", expectedReviewVersion: 0 });
    await decideReviewedRecap(access, interval, { action: "confirm" });
    const events = (await f.db.query("select version, arrival_eligible from work_recap_reviews")).rows;
    assert.deepEqual(events, [{ version: 1, arrival_eligible: true }]);
    assert.equal((await f.db.query<{ n: number }>("select count(*)::int as n from work_audit_log")).rows[0].n, 1);
    const unchanged = (await f.db.query<{ next_steps_status: string; reviewed_at: string | Date }>(
      "select next_steps_status, reviewed_at from work_activity_intervals")).rows[0];
    assert.equal(unchanged.next_steps_status, "generated");
    assert.equal(new Date(unchanged.reviewed_at).toISOString(), "2026-10-21T10:05:00.000Z");
    const recap = await loadReviewedRecap(access, interval);
    assert.deepEqual(recap?.speechLines, [{ text: "Reviewed the queue.", time: null }, { text: "Read the queue", time: "9:20 AM" }]);
    assert.equal(recap?.person.id, person);
    assert.deepEqual(await untouched(f.db), before);
  } finally { await f.close(); }
});

test("amend_changes_key_even_if_generation_revision_is_same", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap, loadReviewedRecap } = await service();
    const before = await untouched(f.db);
    await decideReviewedRecap(access, interval, { action: "confirm" });
    const a = await loadReviewedRecap(access, interval);
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "I only read the queue.", expectedReviewVersion: 1 });
    const b = await loadReviewedRecap(access, interval);
    assert.equal(b?.sourceRevision, a?.sourceRevision);
    assert.notEqual(b?.reviewKey, a?.reviewKey);
    assert.notEqual(b?.scriptHash, a?.scriptHash);
    assert.deepEqual(b?.speechLines, [
      { text: "Original AI summary.", time: null }, { text: "Reviewed the queue.", time: null },
      { text: "Read the queue", time: "9:20 AM" }, { text: "Employee correction.", time: null },
      { text: "I only read the queue.", time: null },
    ]);
    assert.equal(b?.original.detail, "Reviewed the queue.");
    assert.deepEqual(await untouched(f.db), before);
  } finally { await f.close(); }
});

test("review_A_B_A_allocates_three_versions", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap } = await service();
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "A" });
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "B", expectedReviewVersion: 1 });
    const third = await decideReviewedRecap(access, interval, { action: "amend", feedback: "A", expectedReviewVersion: 2 });
    assert.equal(third.employee_feedback, "A");
    const rows = (await f.db.query<{ version: number; review_key: string; content_hash: string }>("select version, review_key, content_hash from work_recap_reviews order by version")).rows;
    assert.deepEqual(rows.map((r) => r.version), [1, 2, 3]);
    assert.equal(rows[0].content_hash, rows[2].content_hash);
    assert.notEqual(rows[0].review_key, rows[2].review_key);
  } finally { await f.close(); }
});

test("stale_and_legacy_conflicting_decisions_require_reload", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap } = await service();
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "Kept" });
    for (const input of [{ action: "confirm" as const }, { action: "amend" as const, feedback: "Lost", expectedReviewVersion: 0 }]) {
      await assert.rejects(decideReviewedRecap(access, interval, input), (error) =>
        error instanceof Error && error.name === "WorkOsConflictError"
        && (error as { reason?: string }).reason === "review_version_conflict");
    }
    assert.equal((await f.db.query<{ employee_feedback: string }>("select employee_feedback from work_activity_intervals")).rows[0].employee_feedback, "Kept");
    assert.equal((await f.db.query<{ n: number }>("select count(*)::int as n from work_recap_reviews")).rows[0].n, 1);
  } finally { await f.close(); }
});

test("legacy_lazy_snapshot_is_stable_and_never_an_arrival_then_new_review_is_version_two", async () => {
  const f = await fixture();
  try {
    await f.db.exec("update work_activity_intervals set review_status = 'confirmed', reviewed_at = '2026-10-21T10:02:00Z'");
    const { decideReviewedRecap, loadReviewedRecap } = await service();
    const { activityIntervalFullView } = await import("../src/lib/work-os-activity-intervals");
    const legacyRow = (await f.db.query<Record<string, unknown>>("select * from work_activity_intervals")).rows[0] as unknown as ActivityIntervalRecord;
    assert.equal((await activityIntervalFullView(legacyRow)).reviewVersion, 1, "a reviewed row implies the lazy snapshot version 1 before it is read");
    const releasesBefore = f.releases();
    const first = await loadReviewedRecap(access, interval);
    assert.equal(f.releases(), releasesBefore + 1, "the missing version-1 snapshot is created inside one locked transaction");
    assert.deepEqual(await loadReviewedRecap(access, interval), first);
    assert.equal(f.releases(), releasesBefore + 1, "the existing snapshot is read without opening a transaction");
    assert.equal((await activityIntervalFullView(legacyRow)).reviewVersion, 1);
    assert.equal(first?.reviewVersion, 1);
    assert.equal(first?.reviewedAt, "2026-10-21T10:02:00.000Z");
    assert.deepEqual((await f.db.query("select arrival_eligible from work_recap_reviews")).rows, [{ arrival_eligible: false }]);
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "Correction", expectedReviewVersion: 1 });
    assert.deepEqual((await f.db.query("select version, arrival_eligible from work_recap_reviews order by version")).rows,
      [{ version: 1, arrival_eligible: false }, { version: 2, arrival_eligible: true }]);
  } finally { await f.close(); }
});

test("existing_reviewed_reads_take_no_transaction_and_no_clock_lock", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap, loadReviewedRecap } = await service();
    await decideReviewedRecap(access, interval, { action: "confirm" });
    const clock = (await f.db.query<{ sequence: number }>(
      "select sequence from work_admin_otto_clock where organization_id = $1", [org])).rows[0];
    const releases = f.releases();
    const recap = await loadReviewedRecap(access, interval);
    assert.equal(recap?.reviewVersion, 1);
    // Detail, speech and record pages read this constantly; an existing
    // snapshot must not open a transaction or take the organization clock lock.
    assert.equal(f.releases(), releases, "no transaction is opened for an existing review");
    assert.deepEqual((await f.db.query("select sequence from work_admin_otto_clock where organization_id = $1", [org])).rows[0], clock);
  } finally { await f.close(); }
});

test("view_payload_carries_the_review_version_not_the_generation_revision", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap } = await service();
    const { activityIntervalFullView } = await import("../src/lib/work-os-activity-intervals");
    await f.db.exec("update work_activity_intervals set revision = 7");
    const row = (await f.db.query<Record<string, unknown>>("select * from work_activity_intervals")).rows[0] as unknown as ActivityIntervalRecord;
    const inferred = await activityIntervalFullView(row);
    assert.equal(inferred.reviewStatus, "inferred");
    assert.equal(inferred.revision, 7, "the generation revision stays its own field");
    assert.equal(inferred.reviewVersion, 0, "an unreviewed card exposes no review version");
    assert.equal(inferred.detail, "Reviewed the queue.", "the unreviewed card's words are unchanged");
    // What the employee client actually holds after JSON transport.
    const clientPayload = JSON.parse(JSON.stringify(inferred));
    const confirmedRow = await decideReviewedRecap(access, interval, {
      action: "confirm", expectedReviewVersion: clientPayload.reviewVersion,
    });
    const confirmed = await activityIntervalFullView(confirmedRow);
    assert.equal(confirmed.reviewStatus, "confirmed");
    assert.equal(confirmed.reviewVersion, 1);
    assert.equal(confirmed.revision, 7);
    // The decision response is the next payload the client echoes: a deliberate
    // later correction must succeed with that review version, not the generation
    // revision the card also displays.
    const confirmedPayload = JSON.parse(JSON.stringify(confirmed));
    const amendedRow = await decideReviewedRecap(access, interval, {
      action: "amend", feedback: "I only read the queue.", expectedReviewVersion: confirmedPayload.reviewVersion,
    });
    const amended = await activityIntervalFullView(amendedRow);
    assert.equal(amended.reviewStatus, "amended");
    assert.equal(amended.reviewVersion, 2);
    assert.equal(amended.revision, 7);
    await assert.rejects(
      decideReviewedRecap(access, interval, { action: "confirm", expectedReviewVersion: amended.revision }),
      (error) => error instanceof Error && error.name === "WorkOsConflictError"
        && (error as { reason?: string }).reason === "review_version_conflict",
    );
    assert.deepEqual((await f.db.query<{ version: number }>("select version from work_recap_reviews order by version")).rows.map((entry) => entry.version), [1, 2]);
  } finally { await f.close(); }
});

test("pre_snapshot_legacy_decision_accepts_expected_version_one_and_starts_at_two", async () => {
  const f = await fixture();
  try {
    await f.db.exec("update work_activity_intervals set review_status = 'confirmed', reviewed_at = '2026-10-21T10:02:00Z'");
    const { decideReviewedRecap } = await service();
    const { activityIntervalFullView } = await import("../src/lib/work-os-activity-intervals");
    const row = (await f.db.query<Record<string, unknown>>("select * from work_activity_intervals")).rows[0] as unknown as ActivityIntervalRecord;
    assert.equal((await activityIntervalFullView(row)).reviewVersion, 1);
    assert.equal((await f.db.query("select * from work_recap_reviews")).rows.length, 0, "no lazy snapshot exists before the decision");
    const saved = await decideReviewedRecap(access, interval, { action: "amend", feedback: "Before any snapshot.", expectedReviewVersion: 1 });
    assert.equal(saved.review_status, "amended");
    assert.deepEqual((await f.db.query("select version, arrival_eligible from work_recap_reviews order by version")).rows,
      [{ version: 1, arrival_eligible: false }, { version: 2, arrival_eligible: true }]);
  } finally { await f.close(); }
});

test("full_view_projection_interleaving_never_pairs_old_words_with_a_newer_version", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap } = await service();
    const { activityIntervalFullView } = await import("../src/lib/work-os-activity-intervals");
    await decideReviewedRecap(access, interval, { action: "confirm", expectedReviewVersion: 0 });
    const staleRow = (await f.db.query<Record<string, unknown>>("select * from work_activity_intervals")).rows[0] as unknown as ActivityIntervalRecord;
    const pool = globalThis.__workOsPgPool as unknown as { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
    const originalQuery = pool.query;
    let injected = false;
    pool.query = async (sql: string, values?: unknown[]) => {
      // Commit version 2 exactly where the service asks for version identity:
      // the response may show v1 or v2, but the words and the version it hands
      // the client must come from the same statement snapshot.
      if (!injected && /work_recap_reviews/i.test(sql)) {
        injected = true;
        await decideReviewedRecap(access, interval, { action: "amend", feedback: "Mid-read correction.", expectedReviewVersion: 1 });
      }
      return originalQuery(sql, values);
    };
    let view: Awaited<ReturnType<typeof activityIntervalFullView>>;
    try {
      view = await activityIntervalFullView(staleRow);
    } finally {
      pool.query = originalQuery;
    }
    assert.equal(injected, true, "the interleaving committed an amendment");
    const v1Words = view.detail === "Reviewed the queue.";
    const v2Words = Boolean(view.detail?.includes("Original AI summary.") && view.detail.includes("Mid-read correction."));
    assert.ok(
      (view.reviewVersion === 1 && v1Words) || (view.reviewVersion === 2 && v2Words),
      `row/version mismatch: reviewVersion ${view.reviewVersion} with words ${String(view.detail)}`,
    );
    assert.deepEqual((await f.db.query<{ version: number }>("select version from work_recap_reviews order by version")).rows.map((entry) => entry.version), [1, 2]);
  } finally { await f.close(); }
});

test("employee_stream_projection_interleaving_never_pairs_old_words_with_a_newer_version", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap } = await service();
    const { listActivityIntervals } = await import("../src/lib/work-os-activity-intervals");
    await decideReviewedRecap(access, interval, { action: "confirm", expectedReviewVersion: 0 });
    const pool = globalThis.__workOsPgPool as unknown as { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
    const originalQuery = pool.query;
    let injected = false;
    pool.query = async (sql: string, values?: unknown[]) => {
      if (!injected && /work_recap_reviews/i.test(sql)) {
        injected = true;
        await decideReviewedRecap(access, interval, { action: "amend", feedback: "Stream correction.", expectedReviewVersion: 1 });
      }
      return originalQuery(sql, values);
    };
    let page: Awaited<ReturnType<typeof listActivityIntervals>>;
    try {
      page = await listActivityIntervals(access, { date: "2026-10-21", days: 1, limit: 10 });
    } finally {
      pool.query = originalQuery;
    }
    assert.equal(injected, true, "the interleaving committed an amendment");
    const item = page.intervals.find((entry) => entry.id === interval);
    assert.ok(item, "the employee stream still contains the interval");
    const v1Words = item.detail === "Reviewed the queue.";
    const v2Words = Boolean(item.detail?.includes("Original AI summary.") && item.detail.includes("Stream correction."));
    assert.ok(
      (item.reviewVersion === 1 && v1Words) || (item.reviewVersion === 2 && v2Words),
      `row/version mismatch: reviewVersion ${item.reviewVersion} with words ${String(item.detail)}`,
    );
  } finally { await f.close(); }
});

test("projection_rejects_inferred_and_reads_are_org_and_owner_scoped", async () => {
  const f = await fixture();
  try {
    const { decideReviewedRecap, loadReviewedRecap, buildReviewedRecap } = await service();
    const row = (await f.db.query<Record<string, unknown>>("select * from work_activity_intervals")).rows[0];
    assert.throws(() => buildReviewedRecap(row, 1, "event", { id: person, displayName: "Ada", active: true, timezone: "UTC" }), /review/i);
    await decideReviewedRecap(access, interval, { action: "confirm" });
    const stranger = "20000000-0000-4000-8000-000000000003";
    await f.db.query("insert into work_people (id, organization_id, display_name) values ($1,$2,'Bob')", [stranger, org]);
    await assert.rejects(decideReviewedRecap({ ...access, personId: stranger }, interval, { action: "confirm" }), /not found/);
    assert.equal((await f.db.query<{ n: number }>("select count(*)::int as n from work_recap_reviews")).rows[0].n, 1, "another person's decision writes no version");
    assert.equal(await loadReviewedRecap({ ...access, organizationId: otherOrg }, interval), null);
    assert.equal(await loadReviewedRecap({ ...access, personId: "20000000-0000-4000-8000-000000000099" }, interval), null);
    assert.equal((await loadReviewedRecap({ ...access, role: "admin", personId: null }, interval))?.intervalId, interval);
    await assert.rejects(decideReviewedRecap({ ...access, organizationId: org, personId: null }, interval, { action: "confirm" }), /mapping/i);
  } finally { await f.close(); }
});
