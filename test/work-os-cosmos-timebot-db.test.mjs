import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Executes the real trigger, claim function and reconciler. The focused unit
// tests only read the migration as text, which is exactly how an invalid column
// reference in the reconciler survived review: PL/pgSQL bodies are not checked
// until they run.
const migration = readFileSync("supabase/migrations/0075_work_cosmos_timebot_notifications.sql", "utf8");

const SCHEMA = `
    create table work_organizations (id uuid primary key default gen_random_uuid(), name text not null, slug text not null);
    create table work_people (id uuid primary key default gen_random_uuid(), display_name text not null);
    create table work_sessions (id uuid primary key default gen_random_uuid(), organization_id uuid not null, person_id uuid not null, timezone text not null);
    create table work_session_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references work_organizations(id) on delete cascade,
      person_id uuid not null references work_people(id) on delete cascade,
      session_id uuid not null references work_sessions(id) on delete cascade,
      event_type text not null,
      source text not null default 'desktop',
      observed_at timestamptz not null,
      recorded_at timestamptz not null default now()
    );
  `;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  return db;
}

/** An organization that existed before the migration, to exercise the seed. */
async function freshDbWithOrg() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  const org = await db.query("insert into work_organizations (name, slug) values ('Wrazy', 'wrazy') returning id");
  await db.exec(migration);
  return { db, organizationId: org.rows[0].id };
}

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

async function seed(db) {
  const org = await db.query("insert into work_organizations (name, slug) values ('Wrazy', 'wrazy') returning id");
  const organizationId = org.rows[0].id;
  const person = await db.query("insert into work_people (display_name) values ('David Zawadi') returning id");
  const personId = person.rows[0].id;
  const session = await db.query(
    "insert into work_sessions (organization_id, person_id, timezone) values ($1,$2,'Europe/London') returning id",
    [organizationId, personId],
  );
  return { organizationId, personId, sessionId: session.rows[0].id };
}

async function addEvent(db, ids, eventType, observedAt) {
  const result = await db.query(
    `insert into work_session_events (organization_id, person_id, session_id, event_type, observed_at)
     values ($1,$2,$3,$4,$5) returning id`,
    [ids.organizationId, ids.personId, ids.sessionId, eventType, observedAt],
  );
  return result.rows[0].id;
}

test("the trigger enqueues the four employee transitions and nothing else", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    await addEvent(db, ids, "clock_in", ago(10));
    await addEvent(db, ids, "pause", ago(8));
    await addEvent(db, ids, "resume", ago(6));
    await addEvent(db, ids, "clock_out", ago(4));
    await addEvent(db, ids, "mark_active", ago(3));
    await addEvent(db, ids, "late_reason", ago(2));

    const rows = await db.query(
      "select event_type, person_name, timezone, status from work_notification_outbox order by observed_at",
    );
    assert.deepEqual(
      rows.rows.map((row) => row.event_type),
      ["clock_in", "pause", "resume", "clock_out"],
    );
    assert.equal(rows.rows[0].person_name, "David Zawadi");
    assert.equal(rows.rows[0].timezone, "Europe/London");
    assert.equal(rows.rows[0].status, "pending");
  } finally {
    await db.close();
  }
});

test("an old event is still enqueued: age never drops a transition", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    // More than a day late. It must still be queued and claimable; only the
    // rendered line changes, and that is covered by the unit tests.
    await addEvent(db, ids, "clock_in", ago(26 * 60));
    const row = await db.query("select status, last_error from work_notification_outbox");
    assert.equal(row.rows[0].status, "pending");
    assert.equal(row.rows[0].last_error, null);
    const claimed = await db.query("select event_type from work_claim_notification_outbox(10)");
    assert.equal(claimed.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("claiming follows event time, so a break cannot overtake its clock-in", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    const before = await addEvent(db, ids, "clock_in", ago(10));
    const after = await addEvent(db, ids, "pause", ago(8));
    // Both rows are written in the same statement batch, so created_at ties.
    const claimed = await db.query("select session_event_id, event_type from work_claim_notification_outbox(10)");
    assert.equal(claimed.rows.length, 1, "only the head of the line is claimable");
    assert.equal(claimed.rows[0].session_event_id, before);
    await db.query("update work_notification_outbox set status = 'sent' where session_event_id = $1", [before]);
    const next = await db.query("select session_event_id from work_claim_notification_outbox(10)");
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0].session_event_id, after);
  } finally {
    await db.close();
  }
});

test("the reconciler actually runs and rebuilds a missing row", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    await addEvent(db, ids, "clock_in", ago(10));
    await addEvent(db, ids, "pause", ago(8));
    // Simulate the trigger being swallowed.
    await db.query("delete from work_notification_outbox");
    const rebuilt = await db.query("select work_reconcile_timebot_outbox(now() - interval '1 hour', 50) as inserted");
    assert.equal(Number(rebuilt.rows[0].inserted), 2, "the reconciler must not fail on a column that does not exist");
    const rows = await db.query("select event_type from work_notification_outbox order by observed_at");
    assert.deepEqual(
      rows.rows.map((row) => row.event_type),
      ["clock_in", "pause"],
    );
    // Idempotent: a second pass inserts nothing.
    const again = await db.query("select work_reconcile_timebot_outbox(now() - interval '1 hour', 50) as inserted");
    assert.equal(Number(again.rows[0].inserted), 0);
  } finally {
    await db.close();
  }
});

test("the trigger cannot abort the parent event insert", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    // Break the enqueue path: the outbox gains a constraint the event cannot satisfy.
    await db.exec("alter table work_notification_outbox add constraint test_only check (person_name <> 'David Zawadi')");
    await addEvent(db, ids, "clock_in", ago(10));
    const events = await db.query("select count(*)::int as n from work_session_events");
    assert.equal(events.rows[0].n, 1, "the clock event must still commit");
    const outbox = await db.query("select count(*)::int as n from work_notification_outbox");
    assert.equal(outbox.rows[0].n, 0, "the failed enqueue is left to the reconciler");
    // With the constraint gone, reconciliation fills the gap.
    await db.exec("alter table work_notification_outbox drop constraint test_only");
    const reconciled = await db.query("select work_reconcile_timebot_outbox(now() - interval '1 hour', 50) as inserted");
    assert.equal(Number(reconciled.rows[0].inserted), 1);
  } finally {
    await db.close();
  }
});

test("ordinary roles cannot execute the queue functions", async () => {
  const db = await freshDb();
  try {
    const acl = await db.query(`
      select proname, proacl::text as acl
        from pg_proc
       where proname in ('work_claim_notification_outbox','work_reconcile_timebot_outbox','work_enqueue_timebot_notification')
       order by proname
    `);
    assert.equal(acl.rows.length, 3);
    for (const row of acl.rows) {
      assert.ok(row.acl, `${row.proname} must carry an explicit ACL after the revokes`);
      assert.doesNotMatch(row.acl, /(^|,)=X\//, `${row.proname} must not be executable by PUBLIC`);
    }
  } finally {
    await db.close();
  }
});

test("recovery is bounded by activation, not by a rolling window", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    await addEvent(db, ids, "clock_in", ago(60));
    // Pretend the row was written eight days ago: a swallowed enqueue must not
    // expire just because it was not noticed within a week.
    await db.query("update work_session_events set recorded_at = now() - interval '8 days'");
    await db.query("delete from work_notification_outbox");
    const rebuilt = await db.query("select work_reconcile_timebot_outbox(now() - interval '30 days', 50) as inserted");
    assert.equal(Number(rebuilt.rows[0].inserted), 1);
  } finally {
    await db.close();
  }
});

test("recovery never backfills history from before activation", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    await addEvent(db, ids, "clock_in", ago(60));
    await db.query("update work_session_events set recorded_at = now() - interval '2 days'");
    await db.query("delete from work_notification_outbox");
    const rebuilt = await db.query("select work_reconcile_timebot_outbox(now() - interval '1 hour', 50) as inserted");
    assert.equal(Number(rebuilt.rows[0].inserted), 0, "pre-rollout manual history must not be replayed");
  } finally {
    await db.close();
  }
});

test("the migration seeds the cutover for an organization that already exists", async () => {
  const { db, organizationId } = await freshDbWithOrg();
  try {
    const state = await db.query("select timebot_activated_at from work_notification_state where organization_id = $1", [organizationId]);
    assert.equal(state.rows.length, 1, "existing organizations get a cutover at migration time");
    const before = await db.query("select count(*)::int as n from work_session_events");
    assert.equal(before.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("a failed first enqueue still leaves the event that becomes the cutover", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    // Force the outbox insert to fail for this organization. The clock event
    // must still commit, and the state row must not be required for recovery.
    await db.exec("alter table work_notification_outbox add constraint test_first check (person_name <> 'David Zawadi')");
    await addEvent(db, ids, "clock_in", ago(2));
    const events = await db.query("select count(*)::int as n from work_session_events");
    assert.equal(events.rows[0].n, 1, "the clock event commits");
    const outbox = await db.query("select count(*)::int as n from work_notification_outbox");
    assert.equal(outbox.rows[0].n, 0, "the failed enqueue is left to the reconciler");
    const state = await db.query("select count(*)::int as n from work_notification_state where organization_id = $1", [ids.organizationId]);
    assert.equal(state.rows[0].n, 0, "no cutover row can be written in the same transaction that failed");
    const boundary = await db.query("select min(recorded_at)::text as at from work_session_events where organization_id = $1", [ids.organizationId]);
    assert.ok(boundary.rows[0].at, "the earliest event supplies the derived cutover");
    await db.exec("alter table work_notification_outbox drop constraint test_first");
    const rebuilt = await db.query("select work_reconcile_timebot_outbox($1::timestamptz, 50) as inserted", [boundary.rows[0].at]);
    assert.equal(Number(rebuilt.rows[0].inserted), 1, "recovery from the derived boundary closes the gap");
  } finally {
    await db.close();
  }
});
