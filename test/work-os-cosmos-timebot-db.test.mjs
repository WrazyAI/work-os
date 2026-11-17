import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Executes the real trigger, claim function and reconciler. The focused unit
// tests only read the migration as text, which is exactly how an invalid column
// reference in the reconciler survived review: PL/pgSQL bodies are not checked
// until they run.
const migration = readFileSync("supabase/migrations/0075_work_cosmos_timebot_notifications.sql", "utf8");

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
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
  `);
  await db.exec(migration);
  return db;
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

test("a stale event is stored dead rather than posted hours late", async () => {
  const db = await freshDb();
  try {
    const ids = await seed(db);
    await addEvent(db, ids, "clock_in", ago(60));
    const row = await db.query("select status, last_error from work_notification_outbox");
    assert.equal(row.rows[0].status, "dead");
    assert.equal(row.rows[0].last_error, "stale");
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
    const rebuilt = await db.query("select work_reconcile_timebot_outbox(50) as inserted");
    assert.equal(Number(rebuilt.rows[0].inserted), 2, "the reconciler must not fail on a column that does not exist");
    const rows = await db.query("select event_type from work_notification_outbox order by observed_at");
    assert.deepEqual(
      rows.rows.map((row) => row.event_type),
      ["clock_in", "pause"],
    );
    // Idempotent: a second pass inserts nothing.
    const again = await db.query("select work_reconcile_timebot_outbox(50) as inserted");
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
    const reconciled = await db.query("select work_reconcile_timebot_outbox(50) as inserted");
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
