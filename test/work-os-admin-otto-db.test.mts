import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { access, adminAccess, adminMembership, fixture, interval, migration, org, otherAdminMembership, otherOrg, otherPerson, person, prerequisites } from "./helpers/work-os-admin-otto-fixture.mts";

test("actual_migration_is_repeatable_private_and_org_scoped", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await migration());
    assert.deepEqual((await f.db.query("select * from work_recap_reviews")).rows, []);
    const insert = `insert into work_recap_reviews (id,organization_id,interval_id,person_id,version,event_sequence,review_key,source_revision,content_hash,script_hash,payload,reviewed_at,arrival_eligible)
      values ($1,$2,$3,$4,1,1,'key',1,'hash','script','{}',now(),true)`;
    await assert.rejects(f.db.query(insert, [randomUUID(), otherOrg, interval, otherPerson]), /foreign key/i);
    await assert.rejects(f.db.query(insert, [randomUUID(), org, interval, otherPerson]), /foreign key/i);
    await f.db.query(insert, [randomUUID(), org, interval, person]);
    await assert.rejects(f.db.exec("update work_recap_reviews set content_hash = 'changed'"), /immutable/i);
    assert.deepEqual((await f.db.query(`select relname, relrowsecurity from pg_class where relname in ('work_recap_reviews','work_admin_otto_clock') order by relname`)).rows,
      [{ relname: "work_admin_otto_clock", relrowsecurity: true }, { relname: "work_recap_reviews", relrowsecurity: true }]);
    assert.deepEqual((await f.db.query(`select grantee from information_schema.table_privileges where table_name in ('work_recap_reviews','work_admin_otto_clock') and grantee = 'PUBLIC'`)).rows, []);
  } finally { await f.close(); }
});

// Explicit disposable fixture only: never DATABASE_URL or a production fallback.
// Set both envs to consent to creating/dropping an isolated schema on loopback.
const disposableUrl = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";
test("concurrent_stale_decision_conflicts_and_sequences_follow_commit_order", {
  skip: !disposableUrl || !optIn ? "Requires disposable loopback PostgreSQL with two connections; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1. PGlite cannot prove row-lock/commit ordering." : false,
}, async () => {
  const url = new URL(disposableUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a local disposable PostgreSQL fixture is permitted");
  const schema = `otto_test_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: disposableUrl, max: 1 });
  const pool = new Pool({ connectionString: disposableUrl, max: 4, options: `-c search_path=${schema},public`, statement_timeout: 10000 });
  try {
    await setup.query(`create schema ${schema}`);
    await pool.query(prerequisites);
    await pool.query(await migration());
    globalThis.__workOsPgPool = pool;
    const { decideReviewedRecap } = await import("../src/lib/work-os-reviewed-recaps");
    // Hold the shared clock in one connection; actual service decisions on two
    // other connections must wait. No fake scheduling or PGlite concurrency.
    await pool.query("insert into work_admin_otto_clock (organization_id, sequence) values ($1,0)", [org]);
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select * from work_admin_otto_clock where organization_id=$1 for update", [org]);
    const first = decideReviewedRecap(access, interval, { action: "amend", feedback: "First", expectedReviewVersion: 0 });
    const second = decideReviewedRecap(access, interval, { action: "amend", feedback: "Second", expectedReviewVersion: 0 });
    await blocker.query("commit");
    blocker.release();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.name, "WorkOsConflictError");
    const firstSequence = BigInt((await pool.query("select event_sequence from work_recap_reviews")).rows[0].event_sequence);
    await decideReviewedRecap(access, interval, { action: "confirm", expectedReviewVersion: 1 });
    const secondSequence = BigInt((await pool.query("select event_sequence from work_recap_reviews where version=2")).rows[0].event_sequence);
    assert.ok(secondSequence > firstSequence);
    // Rollback under real PostgreSQL must revert the interval, clock and event.
    await pool.query("create function reject_audit() returns trigger language plpgsql as $$ begin raise exception 'audit rejected'; end $$; create trigger reject_audit before insert on work_audit_log for each row execute function reject_audit()");
    await assert.rejects(decideReviewedRecap(access, interval, { action: "amend", feedback: "Rollback", expectedReviewVersion: 2 }), /audit rejected/);
    assert.equal((await pool.query("select count(*)::int as n from work_recap_reviews")).rows[0].n, 2);
    assert.equal(BigInt((await pool.query("select sequence from work_admin_otto_clock")).rows[0].sequence), secondSequence);
  } finally {
    globalThis.__workOsPgPool = undefined;
    await pool.end();
    await setup.query(`drop schema if exists ${schema} cascade`);
    await setup.end();
  }
});

test("preferences_migration_is_repeatable_private_and_org_scoped", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await migration());
    assert.deepEqual((await f.db.query("select * from work_admin_otto_preferences")).rows, []);
    assert.deepEqual((await f.db.query(`select relname, relrowsecurity from pg_class
      where relname in ('work_admin_otto_clock','work_admin_otto_preferences','work_admin_otto_follow_windows','work_recap_reviews')
      order by relname`)).rows, [
      { relname: "work_admin_otto_clock", relrowsecurity: true },
      { relname: "work_admin_otto_follow_windows", relrowsecurity: true },
      { relname: "work_admin_otto_preferences", relrowsecurity: true },
      { relname: "work_recap_reviews", relrowsecurity: true },
    ]);
    assert.deepEqual((await f.db.query(`select table_name, grantee from information_schema.table_privileges
      where table_name in ('work_admin_otto_preferences','work_admin_otto_follow_windows')
        and grantee in ('PUBLIC','anon','authenticated')`)).rows, []);
    assert.deepEqual((await f.db.query(`select indexname from pg_indexes
      where tablename = 'work_admin_otto_follow_windows'
        and indexname = 'work_admin_otto_follow_windows_open_idx'`)).rows,
    [{ indexname: "work_admin_otto_follow_windows_open_idx" }]);

    // The composite membership FK rejects another organization's membership.
    await assert.rejects(f.db.query(`insert into work_admin_otto_preferences
      (organization_id, membership_id, access_epoch, activated_sequence, active)
      values ($1,$2,1,1,true)`, [org, otherAdminMembership]), /foreign key/i);
    await f.db.query(`insert into work_admin_otto_preferences
      (organization_id, membership_id, access_epoch, activated_sequence, active)
      values ($1,$2,1,1,true)`, [org, adminMembership]);
    // A person from another organization cannot enter an org-scoped window.
    await assert.rejects(f.db.query(`insert into work_admin_otto_follow_windows
      (organization_id, membership_id, person_id, access_epoch, start_sequence)
      values ($1,$2,$3,1,1)`, [org, adminMembership, otherPerson]), /foreign key/i);
    await f.db.query(`insert into work_admin_otto_follow_windows
      (organization_id, membership_id, person_id, access_epoch, start_sequence)
      values ($1,$2,$3,1,1)`, [org, adminMembership, person]);
    await assert.rejects(f.db.query(`insert into work_admin_otto_follow_windows
      (organization_id, membership_id, person_id, access_epoch, start_sequence)
      values ($1,$2,$3,1,2)`, [org, adminMembership, person]), /duplicate key|unique/i);
    await f.db.query(`update work_admin_otto_follow_windows set end_sequence = 2
      where organization_id = $1 and membership_id = $2 and person_id = $3 and end_sequence is null`,
    [org, adminMembership, person]);
    await f.db.query(`insert into work_admin_otto_follow_windows
      (organization_id, membership_id, person_id, access_epoch, start_sequence)
      values ($1,$2,$3,1,2)`, [org, adminMembership, person]);
  } finally { await f.close(); }
});

test("delivery_migration_is_repeatable_private_and_org_scoped", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await migration());
    assert.deepEqual((await f.db.query(`select column_name, data_type, column_default, is_nullable
      from information_schema.columns
      where table_name = 'work_admin_otto_preferences' and column_name = 'materialized_through_sequence'`)).rows,
    [{ column_name: "materialized_through_sequence", data_type: "bigint", column_default: "0", is_nullable: "NO" }]);
    assert.deepEqual((await f.db.query(`select relname, relrowsecurity from pg_class
      where relname = 'work_admin_otto_deliveries'`)).rows,
    [{ relname: "work_admin_otto_deliveries", relrowsecurity: true }]);
    assert.deepEqual((await f.db.query(`select table_name, grantee from information_schema.table_privileges
      where table_name = 'work_admin_otto_deliveries'
        and grantee in ('PUBLIC','anon','authenticated')`)).rows, []);
    const pendingIndex = (await f.db.query<{ indexdef: string }>(`select indexdef from pg_indexes
      where tablename = 'work_admin_otto_deliveries'
        and indexname = 'work_admin_otto_deliveries_pending_idx'`)).rows;
    assert.equal(pendingIndex.length, 1);
    assert.match(pendingIndex[0].indexdef, /presented_at IS NULL/);
    assert.match(pendingIndex[0].indexdef, /dismissed_at IS NULL/);
    assert.match(pendingIndex[0].indexdef, /superseded_at IS NULL/);
    const eventIndex = (await f.db.query<{ indexdef: string }>(`select indexdef from pg_indexes
      where tablename = 'work_admin_otto_deliveries'
        and indexname = 'work_admin_otto_deliveries_event_idx'`)).rows;
    assert.equal(eventIndex.length, 1, "the review-delete cascade has a matching delivery index");
    assert.match(eventIndex[0].indexdef, /\(organization_id, event_id\)/);

    await f.db.query(`insert into work_admin_otto_preferences
      (organization_id, membership_id, access_epoch, activated_sequence, active)
      values ($1,$2,1,1,true)`, [org, adminMembership]);
    const eventId = randomUUID();
    await f.db.query(`insert into work_recap_reviews
      (id,organization_id,interval_id,person_id,version,event_sequence,review_key,source_revision,content_hash,script_hash,payload,reviewed_at,arrival_eligible)
      values ($1,$2,$3,$4,1,1,'key',1,'hash','script','{}',now(),true)`, [eventId, org, interval, person]);
    // Cross-organization membership and event relationships are rejected.
    await assert.rejects(f.db.query(`insert into work_admin_otto_deliveries
      (organization_id, membership_id, event_id) values ($1,$2,$3)`, [org, otherAdminMembership, eventId]),
    /foreign key/i);
    await assert.rejects(f.db.query(`insert into work_admin_otto_deliveries
      (organization_id, membership_id, event_id) values ($1,$2,$3)`, [org, adminMembership, randomUUID()]),
    /foreign key/i);
    await f.db.query(`insert into work_admin_otto_deliveries
      (organization_id, membership_id, event_id) values ($1,$2,$3)`, [org, adminMembership, eventId]);
    await assert.rejects(f.db.query(`insert into work_admin_otto_deliveries
      (organization_id, membership_id, event_id) values ($1,$2,$3)`, [org, adminMembership, eventId]),
    /duplicate key/i);
    // Lease fields are all present or all absent.
    await assert.rejects(f.db.query(`update work_admin_otto_deliveries
      set lease_token = 'token' where organization_id = $1 and membership_id = $2 and event_id = $3`,
    [org, adminMembership, eventId]), /check/i);
  } finally { await f.close(); }
});

test("follow_lifecycle_and_review_commit_order_serialize_without_deadlock", {
  skip: !disposableUrl || !optIn ? "Requires disposable loopback PostgreSQL with two connections; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1. PGlite cannot prove row-lock/commit ordering." : false,
}, async () => {
  const url = new URL(disposableUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a local disposable PostgreSQL fixture is permitted");
  const schema = `otto_prefs_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: disposableUrl, max: 1 });
  const pool = new Pool({ connectionString: disposableUrl, max: 4, options: `-c search_path=${schema},public`, statement_timeout: 10000 });
  try {
    await setup.query(`create schema ${schema}`);
    await pool.query(prerequisites);
    await pool.query(await migration());
    globalThis.__workOsPgPool = pool;
    const { initializeAdminOtto, saveAdminOttoPreferences } = await import("../src/lib/work-os-admin-otto-preferences");
    const { decideReviewedRecap } = await import("../src/lib/work-os-reviewed-recaps");

    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess, { mode: "selected", personIds: [], expectedRevision: 0 });

    // A follow save and a review both take the org clock first. Holding it in a
    // third connection proves they wait rather than deadlock, and whichever
    // commits first fixes the boundary the event is judged against.
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select * from work_admin_otto_clock where organization_id=$1 for update", [org]);
    const followOrder: string[] = [];
    const follow = saveAdminOttoPreferences(adminAccess, { mode: "selected", personIds: [person], expectedRevision: 1 })
      .then((result) => { followOrder.push("follow"); return result; });
    const review = decideReviewedRecap(access, interval, { action: "confirm" })
      .then((result) => { followOrder.push("review"); return result; });
    await blocker.query("commit");
    blocker.release();
    await Promise.all([follow, review]);
    assert.deepEqual([...followOrder].sort(), ["follow", "review"]);
    const windowStart = Number((await pool.query(`select start_sequence from work_admin_otto_follow_windows
      where organization_id=$1 and membership_id=$2 and end_sequence is null`, [org, adminMembership])).rows[0].start_sequence);
    const eventSequence = Number((await pool.query(`select event_sequence from work_recap_reviews
      where organization_id=$1`, [org])).rows[0].event_sequence);
    if (followOrder[0] === "follow") {
      assert.ok(eventSequence > windowStart, "a review committed after the follow save is inside the fresh window");
    } else {
      assert.ok(eventSequence < windowStart, "a review committed before the follow save is not replayed");
    }

    const blocker2 = await pool.connect();
    await blocker2.query("begin");
    await blocker2.query("select * from work_admin_otto_clock where organization_id=$1 for update", [org]);
    const lifecycleOrder: string[] = [];
    const disable = pool.query(`update work_org_members
      set feature_flags = '{"employee_companion":false}' where id=$1`, [adminMembership])
      .then((result) => { lifecycleOrder.push("disable"); return result; });
    const amended = decideReviewedRecap(access, interval,
      { action: "amend", feedback: "During disable", expectedReviewVersion: 1 })
      .then((result) => { lifecycleOrder.push("review"); return result; });
    await blocker2.query("commit");
    blocker2.release();
    await Promise.all([disable, amended]);
    assert.deepEqual([...lifecycleOrder].sort(), ["disable", "review"]);
    const closedAt = Number((await pool.query(`select end_sequence from work_admin_otto_follow_windows
      where organization_id=$1 and membership_id=$2 and person_id=$3 and end_sequence is not null
      order by end_sequence desc limit 1`, [org, adminMembership, person])).rows[0].end_sequence);
    const amendedSequence = Number((await pool.query(`select event_sequence from work_recap_reviews
      where organization_id=$1 and version=2`, [org])).rows[0].event_sequence);
    if (lifecycleOrder[0] === "disable") {
      assert.ok(amendedSequence > closedAt, "a review committed after the disable is outside the closed window");
    } else {
      assert.ok(amendedSequence < closedAt, "a review committed before the disable stays inside the window");
    }
  } finally {
    globalThis.__workOsPgPool = undefined;
    await pool.end();
    await setup.query(`drop schema if exists ${schema} cascade`);
    await setup.end();
  }
});

// ---------------------------------------------------------------------------
// Opt-in race fixtures. These create a disposable schema on a loopback
// PostgreSQL and pause the preference transaction at its deferred COMMIT so a
// second lifecycle transaction can race the clock boundary deterministically.
// They are skipped when no disposable database is configured; PGlite runs the
// same SQL sequentially and is not concurrency proof.

const raceSkip = !disposableUrl || !optIn
  ? "Requires disposable loopback PostgreSQL with two connections; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1. PGlite cannot prove row-lock/commit ordering."
  : false;

async function withDisposableSchema(run: (pool: Pool) => Promise<void>) {
  const url = new URL(disposableUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a local disposable PostgreSQL fixture is permitted");
  const schema = `otto_race_${randomUUID().replaceAll("-", "")}`;
  const setup = new Pool({ connectionString: disposableUrl, max: 1 });
  const pool = new Pool({
    connectionString: disposableUrl,
    max: 6,
    options: `-c search_path=${schema},public`,
    statement_timeout: 15000,
  });
  try {
    await setup.query(`create schema ${schema}`);
    await pool.query(prerequisites);
    await pool.query(await migration());
    globalThis.__workOsPgPool = pool;
    await run(pool);
  } finally {
    globalThis.__workOsPgPool = undefined;
    await pool.end();
    await setup.query(`drop schema if exists ${schema} cascade`);
    await setup.end();
  }
}

async function installCommitPause(pool: Pool) {
  await pool.query(`create or replace function otto_pause_commit() returns trigger
    language plpgsql as $$ begin perform pg_advisory_xact_lock(4242, 17); return null; end $$`);
  await pool.query(`create constraint trigger otto_pause_commit
    after insert or update on work_admin_otto_preferences
    deferrable initially deferred
    for each row execute function otto_pause_commit()`);
}

async function waitForCommitPause(pool: Pool) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from pg_locks
      where locktype = 'advisory' and classid = 4242 and objid = 17 and not granted`);
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the preference transaction did not reach its deferred commit pause");
}

async function blockedOrCommitted(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(() => "committed" as const),
    new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 400)),
  ]);
}

async function personLifecycleRace(writer: "activation" | "save", lifecycle: "insert" | "reactivate" | "deactivate") {
  await withDisposableSchema(async (pool) => {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await import("../src/lib/work-os-admin-otto-preferences");
    const racePerson = "20000000-0000-4000-8000-0000000000a1";
    if (lifecycle === "reactivate") {
      await pool.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'Race',false)", [racePerson, org]);
    }
    if (lifecycle === "deactivate") {
      await pool.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'Race',true)", [racePerson, org]);
    }
    if (writer === "save") {
      await initializeAdminOtto(adminAccess);
      await saveAdminOttoPreferences(adminAccess, { mode: "selected", personIds: [], expectedRevision: 0 });
    }
    await installCommitPause(pool);
    const blocker = await pool.connect();
    await blocker.query("select pg_advisory_lock(4242, 17)");
    let writerPromise: Promise<unknown> | undefined;
    let lifecyclePromise: Promise<unknown> | undefined;
    try {
      writerPromise = writer === "activation"
        ? initializeAdminOtto(adminAccess)
        : saveAdminOttoPreferences(adminAccess, { mode: "all", personIds: [], expectedRevision: 1 });
      await waitForCommitPause(pool);
      lifecyclePromise = lifecycle === "insert"
        ? pool.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'Race',true)", [racePerson, org])
        : pool.query("update work_people set active = $2 where id = $1", [racePerson, lifecycle !== "deactivate"]);
      assert.equal(await blockedOrCommitted(lifecyclePromise), "blocked",
        `${lifecycle} must wait for the clock instead of deciding on a stale snapshot`);
      await blocker.query("select pg_advisory_unlock(4242, 17)");
      await Promise.all([writerPromise, lifecyclePromise]);
    } finally {
      await blocker.query("select pg_advisory_unlock(4242, 17)").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([writerPromise, lifecyclePromise].filter((promise): promise is Promise<unknown> => promise !== undefined));
    }
    const row = (await pool.query<{ active: boolean }>("select active from work_people where id=$1", [racePerson])).rows[0];
    assert.equal(row.active, lifecycle !== "deactivate");
    const open = (await pool.query<{ n: number }>(`select count(*)::int as n from work_admin_otto_follow_windows
      where organization_id=$1 and person_id=$2 and end_sequence is null`, [org, racePerson])).rows[0].n;
    if (lifecycle === "deactivate") {
      assert.equal(open, 0, "deactivation must close any window opened before its clock boundary");
    } else {
      assert.equal(open, 1, "a new/reactivated person must be followed after the concurrent writer commits");
      const sequence = (await pool.query<{ sequence: string }>("select sequence from work_admin_otto_clock where organization_id=$1", [org])).rows[0].sequence;
      const start = (await pool.query<{ start_sequence: string }>(`select start_sequence from work_admin_otto_follow_windows
        where organization_id=$1 and person_id=$2 and end_sequence is null`, [org, racePerson])).rows[0].start_sequence;
      assert.equal(start, sequence);
    }
  });
}

async function memberLifecycleRace(change: "active" | "feature" | "employee" | "manager") {
  await withDisposableSchema(async (pool) => {
    const { initializeAdminOtto } = await import("../src/lib/work-os-admin-otto-preferences");
    await installCommitPause(pool);
    const blocker = await pool.connect();
    await blocker.query("select pg_advisory_lock(4242, 17)");
    let writerPromise: Promise<unknown> | undefined;
    let lifecyclePromise: Promise<unknown> | undefined;
    try {
      writerPromise = initializeAdminOtto(adminAccess);
      await waitForCommitPause(pool);
      lifecyclePromise = change === "active"
        ? pool.query("update work_org_members set active = false where id = $1", [adminMembership])
        : change === "feature"
          ? pool.query(`update work_org_members set feature_flags = '{"employee_companion":false}' where id = $1`, [adminMembership])
          : pool.query("update work_org_members set role = $2 where id = $1", [adminMembership, change]);
      assert.equal(await blockedOrCommitted(lifecyclePromise), "blocked",
        `member ${change} must wait for the clock instead of deciding on a stale snapshot`);
      await blocker.query("select pg_advisory_unlock(4242, 17)");
      await Promise.all([writerPromise, lifecyclePromise]);
    } finally {
      await blocker.query("select pg_advisory_unlock(4242, 17)").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([writerPromise, lifecyclePromise].filter((promise): promise is Promise<unknown> => promise !== undefined));
    }
    const member = (await pool.query<{ active: boolean; role: string; feature_flags: Record<string, boolean> }>(
      "select active, role, feature_flags from work_org_members where id=$1", [adminMembership])).rows[0];
    if (change === "active") assert.equal(member.active, false);
    else if (change === "feature") assert.equal(member.feature_flags.employee_companion, false);
    else assert.equal(member.role, change);
    const preference = (await pool.query<{ active: boolean; activated_sequence: string | null }>(
      "select active, activated_sequence from work_admin_otto_preferences where organization_id=$1 and membership_id=$2",
      [org, adminMembership])).rows[0];
    assert.equal(preference.active, false);
    assert.equal(preference.activated_sequence, null);
    assert.equal((await pool.query<{ n: number }>(`select count(*)::int as n from work_admin_otto_follow_windows
      where organization_id=$1 and membership_id=$2 and end_sequence is null`, [org, adminMembership])).rows[0].n, 0);
  });
}

async function orgDisableRace() {
  await withDisposableSchema(async (pool) => {
    const { initializeAdminOtto } = await import("../src/lib/work-os-admin-otto-preferences");
    await installCommitPause(pool);
    const blocker = await pool.connect();
    await blocker.query("select pg_advisory_lock(4242, 17)");
    let writerPromise: Promise<unknown> | undefined;
    let lifecyclePromise: Promise<unknown> | undefined;
    try {
      writerPromise = initializeAdminOtto(adminAccess);
      await waitForCommitPause(pool);
      lifecyclePromise = pool.query(`update work_organizations
        set feature_flags = '{"employee_companion":false}' where id = $1`, [org]);
      assert.equal(await blockedOrCommitted(lifecyclePromise), "blocked",
        "org disable must wait for the clock instead of deciding on a stale snapshot");
      await blocker.query("select pg_advisory_unlock(4242, 17)");
      await Promise.all([writerPromise, lifecyclePromise]);
    } finally {
      await blocker.query("select pg_advisory_unlock(4242, 17)").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([writerPromise, lifecyclePromise].filter((promise): promise is Promise<unknown> => promise !== undefined));
    }
    assert.equal((await pool.query<{ enabled: boolean }>(`select (feature_flags->'employee_companion') = 'true'::jsonb as enabled
      from work_organizations where id=$1`, [org])).rows[0].enabled, false);
    const preference = (await pool.query<{ active: boolean; activated_sequence: string | null }>(
      "select active, activated_sequence from work_admin_otto_preferences where organization_id=$1 and membership_id=$2",
      [org, adminMembership])).rows[0];
    assert.equal(preference.active, false);
    assert.equal(preference.activated_sequence, null);
    assert.equal((await pool.query<{ n: number }>(`select count(*)::int as n from work_admin_otto_follow_windows
      where organization_id=$1 and membership_id=$2 and end_sequence is null`, [org, adminMembership])).rows[0].n, 0);
  });
}

test("person_insert_and_reactivation_race_activation_and_save", { skip: raceSkip }, async () => {
  for (const writer of ["activation", "save"] as const) {
    for (const lifecycle of ["insert", "reactivate"] as const) {
      await personLifecycleRace(writer, lifecycle);
    }
  }
});

test("person_deactivation_races_activation_and_save", { skip: raceSkip }, async () => {
  for (const writer of ["activation", "save"] as const) {
    await personLifecycleRace(writer, "deactivate");
  }
});

test("member_disable_and_demotion_race_activation", { skip: raceSkip }, async () => {
  for (const change of ["active", "feature", "employee", "manager"] as const) {
    await memberLifecycleRace(change);
  }
});

test("org_disable_races_activation", { skip: raceSkip }, async () => {
  await orgDisableRace();
});
