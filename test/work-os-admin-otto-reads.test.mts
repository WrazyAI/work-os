import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type { PGlite } from "@electric-sql/pglite";
import {
  adminAccess, adminUser, fixture, intervalA, intervalB, org, otherOrg, otherOrgAdminAccess,
  otherPerson, personA, personB, personC,
} from "./helpers/work-os-admin-otto-reads-fixture.mts";

const reads = () => import("../src/lib/work-os-admin-otto-reads");
const model = () => import("../src/modules/work-os/admin-task-model");

// Cursor HMAC signing derives from the already-required database secret. The
// fixture executes through the in-memory pool; this value never opens a socket.
process.env.DATABASE_URL ??= "postgres://pglite-test/work-os";

type Db = Pick<PGlite, "query">;

async function rows<T>(db: Db, sql: string, values?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}

async function nextSequence(db: Db) {
  await db.query(`insert into work_admin_otto_clock (organization_id, sequence)
    values ($1, 0) on conflict (organization_id) do nothing`, [org]);
  const found = await rows<{ sequence: string | number | bigint }>(db,
    "update work_admin_otto_clock set sequence = sequence + 1 where organization_id = $1 returning sequence",
    [org]);
  return Number(found[0].sequence);
}

async function seedPerson(db: Db, input: {
  id: string; name: string; timezone?: string; active?: boolean; nifty?: string | null; organizationId?: string;
}) {
  const organizationId = input.organizationId ?? org;
  await db.query(`insert into work_people (id, organization_id, display_name, active, nifty_member_id)
    values ($1,$2,$3,$4,$5)`, [input.id, organizationId, input.name, input.active ?? true, input.nifty ?? null]);
  await db.query(`insert into work_employee_onboarding (organization_id, person_id, timezone)
    values ($1,$2,$3)`, [organizationId, input.id, input.timezone ?? "UTC"]);
}

async function seedTask(db: Db, input: {
  id?: string; title?: string; assignees?: string[]; providerAssignees?: string[]; raw?: Record<string, unknown>;
  due?: string | null; created?: string | null; updated?: string | null; completed?: boolean;
  status?: string; parentId?: string | null; providerParentId?: string | null; organizationId?: string;
} = {}) {
  const id = input.id ?? randomUUID();
  const organizationId = input.organizationId ?? org;
  await db.query(`insert into work_tasks
    (id,user_id,organization_id,title,completed,status,assignee_person_ids,assignee_provider_ids,
     due_date,parent_task_id,parent_provider_task_id,provider_created_at,created_at,updated_at,raw)
    values ($1,$2,$3,$4,$5,$6,$7::uuid[],$8::text[],$9,$10,$11,$12,$12,$13,$14::jsonb)`,
  [id, adminUser, organizationId, input.title ?? "Task", input.completed ?? false, input.status ?? "open",
    input.assignees ?? [], input.providerAssignees ?? [], input.due ?? null,
    input.parentId ?? null, input.providerParentId ?? null,
    input.created ?? "2026-10-20T09:00:00.000Z", input.updated ?? input.created ?? "2026-10-20T09:00:00.000Z",
    JSON.stringify(input.raw ?? {})]);
  return id;
}

async function seedUpdate(db: Db, personId: string, occurredAt: string, text = "Authored update") {
  const id = randomUUID();
  await db.query(`insert into work_check_ins
    (id,organization_id,person_id,kind,input_text,substantive,occurred_at,created_at)
    values ($1,$2,$3,'catch_up',$4,true,$5,$5)`, [id, org, personId, text, occurredAt]);
  return id;
}

async function seedReport(db: Db, personId: string, input: {
  reportDate: string; submittedAt?: string | null; status?: string; markdown?: string; submittedMarkdown?: string | null;
  kind?: string;
}) {
  const id = randomUUID();
  await db.query(`insert into work_reports
    (id,organization_id,person_id,report_date,kind,status,title,markdown,submitted_markdown,submitted_at)
    values ($1,$2,$3,$4,$5,$6,'EOD',$7,$8,$9)`,
  [id, org, personId, input.reportDate, input.kind ?? "eod",
    input.status ?? (input.submittedAt ? "pending_review" : "draft"),
    input.markdown ?? "", input.submittedMarkdown ?? null, input.submittedAt ?? null]);
  return id;
}

async function seedSession(db: Db, personId: string, input: {
  shiftDate: string; state?: string; occurredAt?: string;
}) {
  const id = randomUUID();
  await db.query(`insert into work_sessions
    (id,organization_id,person_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at,clocked_in_at,clocked_out_at)
    values ($1,$2,$3,$4,$5,'UTC',$6,$6,$6,$6)`,
  [id, org, personId, input.shiftDate, input.state ?? "clocked_out",
    input.occurredAt ?? `${input.shiftDate}T17:00:00.000Z`]);
  return id;
}

async function seedTaskEvent(db: Db, personId: string, taskId: string, input: {
  localDate: string; eventType?: string; occurredAt?: string; title?: string;
}) {
  const id = randomUUID();
  await db.query(`insert into work_task_day_events
    (id,organization_id,person_id,task_id,local_date,event_type,exact_at,observed_at,task_snapshot,idempotency_key)
    values ($1,$2,$3,$4,$5,$6,$7,$7,$8::jsonb,$9)`,
  [id, org, personId, taskId, input.localDate, input.eventType ?? "completed",
    input.occurredAt ?? `${input.localDate}T15:00:00.000Z`,
    JSON.stringify({ title: input.title ?? "Task" }), randomUUID()]);
  return id;
}

async function seedReviewedInterval(db: Db, input: {
  personId: string; intervalId?: string; reviewedAt: string; headline?: string; detail?: string;
  reviewStatus?: "confirmed" | "amended" | "inferred"; withReview?: boolean; arrivalEligible?: boolean;
  employeeFeedback?: string | null; timezone?: string;
}) {
  const intervalId = input.intervalId ?? randomUUID();
  const reviewedAt = input.reviewedAt;
  const timezone = input.timezone ?? "UTC";
  const detail = input.detail ?? "Reviewed the queue.";
  const feedback = input.reviewStatus === "amended" ? (input.employeeFeedback ?? "Employee correction.") : null;
  const finalDetail = input.reviewStatus === "amended"
    ? `Original AI summary.\n${detail}\n\nEmployee correction.\n${feedback}`
    : detail;
  await db.query(`insert into work_activity_intervals
    (id,organization_id,person_id,generation_status,review_status,headline,ai_detail,final_detail,
     employee_feedback,structured_summary,source_hash,revision,window_start,window_end,timezone,generated_at,reviewed_at)
    values ($1,$2,$3,'ready',$4,$5,$6,$7,$10,'{"activities":[]}','source',1,$8,$8,$9,$8,$8)`,
  [intervalId, org, input.personId, input.reviewStatus ?? "confirmed",
    input.headline ?? "Reviewed work", detail, finalDetail, reviewedAt, timezone, feedback]);
  if (input.withReview === false || input.reviewStatus === "inferred") return intervalId;
  const eventId = randomUUID();
  const payload = {
    intervalId, eventId, person: { id: input.personId, displayName: "Person", active: true, timezone },
    reviewVersion: 1, reviewKey: `review-${intervalId}`, sourceRevision: 1, scriptHash: "script",
    reviewStatus: input.reviewStatus ?? "confirmed", reviewedAt,
    windowStart: reviewedAt, windowEnd: reviewedAt, timezone,
    original: { headline: input.headline ?? "Reviewed work", detail, activities: [] },
    employeeFeedback: feedback, speechLines: [], coverage: [],
  };
  await db.query(`insert into work_recap_reviews
    (id,organization_id,interval_id,person_id,version,event_sequence,review_key,source_revision,
     content_hash,script_hash,payload,reviewed_at,arrival_eligible)
    values ($1,$2,$3,$4,1,$5,$6,1,$7,'script',$8::jsonb,$9,$10)`,
  [eventId, org, intervalId, input.personId, await nextSequence(db), payload.reviewKey,
    `content-${eventId}`, JSON.stringify(payload), reviewedAt, input.arrivalEligible ?? true]);
  return intervalId;
}

const fixedNow = new Date("2026-10-22T12:00:00.000Z");

test("unique_full_or_partial_name_resolves", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera", timezone: "America/New_York" });
    await seedPerson(f.db, { id: personB, name: "Maria Chen", timezone: "Pacific/Auckland" });
    await seedPerson(f.db, { id: personC, name: "Sam Okafor", timezone: "UTC", active: false });
    const service = await reads();
    const exact = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["  alex   rivera "] });
    assert.equal(exact.kind, "resolved");
    if (exact.kind !== "resolved") assert.fail("exact name did not resolve");
    assert.deepEqual(exact.people.map((person: { id: string }) => person.id), [personA]);
    assert.equal(exact.people[0]!.timezone, "America/New_York");
    const partial = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["mar"] });
    assert.equal(partial.kind, "resolved");
    if (partial.kind !== "resolved") assert.fail("partial name did not resolve");
    assert.deepEqual(partial.people.map((person: { id: string }) => person.id), [personB]);
    const team = await service.resolveAdminOttoPeople(adminAccess, { kind: "team" });
    assert.equal(team.kind, "resolved");
    if (team.kind !== "resolved") assert.fail("team did not resolve");
    assert.deepEqual(team.people.map((person: { id: string }) => person.id).sort(), [personA, personB].sort());
    const ids = await service.resolveAdminOttoPeople(adminAccess, { kind: "ids", ids: [personB, personA, personB] });
    assert.equal(ids.kind, "resolved");
    if (ids.kind !== "resolved") assert.fail("ids did not resolve");
    assert.deepEqual(ids.people.map((person: { id: string }) => person.id), [personB, personA]);
  } finally { await f.close(); }
});

test("ambiguous_name_waits", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    await seedPerson(f.db, { id: personB, name: "Alex Kim" });
    const service = await reads();
    const ambiguous = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["Alex"] });
    assert.equal(ambiguous.kind, "ambiguous");
    if (ambiguous.kind !== "ambiguous") assert.fail("ambiguous name resolved");
    assert.deepEqual(ambiguous.choices.map((person: { id: string }) => person.id).sort(), [personA, personB].sort());
    const unique = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["Alex R"] });
    assert.equal(unique.kind, "resolved");
    if (unique.kind !== "resolved") assert.fail("unique partial name did not resolve");
    assert.equal(unique.people[0]!.id, personA);
    const missing = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["Nobody Here"] });
    assert.deepEqual(missing, { kind: "missing", name: "Nobody Here" });
  } finally { await f.close(); }
});

test("foreign_id_rejected_even_with_same_name", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    await seedPerson(f.db, { id: otherPerson, name: "Alex Rivera", organizationId: otherOrg });
    const service = await reads();
    const foreign = await service.resolveAdminOttoPeople(adminAccess, { kind: "ids", ids: [otherPerson] });
    assert.deepEqual(foreign, { kind: "missing", name: otherPerson });
    const local = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["Alex Rivera"] });
    assert.equal(local.kind, "resolved");
    if (local.kind !== "resolved") assert.fail("local name did not resolve");
    assert.deepEqual(local.people.map((person: { id: string }) => person.id), [personA]);
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [otherPerson], overdueOnly: false, now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
    );
  } finally { await f.close(); }
});

test("multi_assignee_union_is_distinct", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera", nifty: "nifty-a" });
    await seedPerson(f.db, { id: personB, name: "Maria Chen", nifty: "nifty-b" });
    const both = await seedTask(f.db, { title: "Both", assignees: [personA, personB] });
    const onlyA = await seedTask(f.db, { title: "Only A", assignees: [personA] });
    const creatorB = await seedTask(f.db, { title: "Created by B", raw: { created_by: "nifty-b" } });
    await seedTask(f.db, { title: "Archived B", assignees: [personB], status: "archived" });
    const unassigned = await seedTask(f.db, { title: "Unassigned" });
    const service = await reads();
    const union = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA, personB], overdueOnly: false, now: fixedNow,
    });
    assert.equal(union.total, 3);
    assert.deepEqual(union.items.map((task: { id: string }) => task.id).sort(), [both, onlyA, creatorB].sort());
    assert.equal(union.items.find((task: { id: string }) => task.id === both)!.assignees.length, 2);
    const aOnly = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, now: fixedNow,
    });
    assert.deepEqual(aOnly.items.map((task: { id: string }) => task.id).sort(), [both, onlyA].sort());
    const none = await service.listAdminOttoTasks(adminAccess, {
      personIds: [], overdueOnly: false, now: fixedNow,
    });
    assert.equal(none.total, 0);
    const team = await service.listAdminOttoTasks(adminAccess, {
      personIds: null, overdueOnly: false, now: fixedNow,
    });
    assert.equal(team.total, 4);
    assert.ok(team.items.some((task: { id: string }) => task.id === unassigned));
    // A blank Nifty mapping never attributes provider-empty fields.
    await seedPerson(f.db, { id: personC, name: "Blank Mapping", nifty: "" });
    await seedTask(f.db, {
      title: "Blank provider fields", providerAssignees: [""],
      raw: { created_by: "", subscribers: [""] },
    });
    const blank = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personC], overdueOnly: false, now: fixedNow,
    });
    assert.equal(blank.total, 0, "a blank nifty mapping must not match empty provider fields");
    const blankCounts = await service.countAdminTaskRecord(adminAccess, {
      ownerId: adminUser, personId: personC, today: "2026-10-22",
    });
    assert.equal(blankCounts.open, 0);
  } finally { await f.close(); }
});

test("subtask cards carry the inherited parent title, never an opaque id", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const parent = await seedTask(f.db, { title: "Prepare the admin rollout", assignees: [personA] });
    const child = await seedTask(f.db, {
      title: "Ship the admin recap inbox", assignees: [personA], parentId: parent,
    });
    const service = await reads();
    const page = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, now: fixedNow,
    });
    const card = page.items.find((task: { id: string }) => task.id === child);
    assert.ok(card);
    assert.equal(card.parentId, parent);
    assert.equal(card.parentTitle, "Prepare the admin rollout");
    // The opaque parent UUID remains available for typing/linking, but the
    // server also supplies the human title the result card must show.
    assert.notEqual(card.parentTitle, card.parentId);
  } finally { await f.close(); }
});

test("old_open_tasks_survive_date_default", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const oldOpen = await seedTask(f.db, {
      title: "Old open", assignees: [personA], created: "2024-01-10T09:00:00.000Z", due: null,
    });
    await seedTask(f.db, {
      title: "Old completed", assignees: [personA], created: "2024-01-10T09:00:00.000Z", completed: true,
    });
    await seedTask(f.db, { title: "Archived", assignees: [personA], status: "archived" });
    await seedTask(f.db, { title: "Deleted", assignees: [personA], status: "deleted" });
    const service = await reads();
    const page = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, now: fixedNow,
    });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, oldOpen);
    assert.equal(page.items[0].createdDate, "2024-01-10");
    assert.equal(page.items[0].effectiveDueDate, "2024-01-11");
    assert.equal(page.items[0].status, "overdue");
  } finally { await f.close(); }
});

test("effective_due_count_matches_rendered_overdue", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const recorded = await seedTask(f.db, { title: "Recorded", assignees: [personA], due: "2026-10-20" });
    const derived = await seedTask(f.db, { title: "Derived", assignees: [personA], due: null, created: "2026-10-01T09:00:00.000Z" });
    const dueToday = await seedTask(f.db, { title: "Due today", assignees: [personA], due: null, created: "2026-10-21T09:00:00.000Z" });
    await seedTask(f.db, { title: "Due today recorded", assignees: [personA], due: "2026-10-22" });
    await seedTask(f.db, { title: "Future", assignees: [personA], due: "2026-10-23" });
    await seedTask(f.db, { title: "Done past", assignees: [personA], due: "2026-10-01", completed: true });
    const service = await reads();
    const all = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, now: fixedNow,
    });
    assert.equal(all.total, 5);
    const overdue = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: true, now: fixedNow,
    });
    assert.equal(overdue.total, 2);
    assert.deepEqual(overdue.items.map((task: { id: string }) => task.id).sort(), [recorded, derived].sort());
    assert.ok(overdue.items.every((task: { status: string }) => task.status === "overdue"));
    assert.equal(all.items.find((task: { id: string }) => task.id === dueToday)!.status, "open");
    const counts = await service.countAdminTaskRecord(adminAccess, {
      ownerId: adminUser, personId: personA, today: "2026-10-22",
    });
    assert.deepEqual(counts, { open: 5, overdue: 2, completedWeek: 0 });
    const dates = (await model()).adminTaskDates({ due_date: null, provider_created_at: "2026-10-01T09:00:00.000Z" });
    assert.deepEqual(dates, { createdDate: "2026-10-01", effectiveDueDate: "2026-10-02" });
    assert.equal((await model()).adminTaskStatusRank({ completed: false, due_date: null, provider_created_at: "2026-10-01T09:00:00.000Z" }, "2026-10-22"), 0);
    assert.equal((await model()).adminTaskStatusRank({ completed: false, due_date: "2026-10-22" }, "2026-10-22"), 1);
    assert.deepEqual((await model()).adminTaskDates({ created_at: "2026-02-30" }), { createdDate: null, effectiveDueDate: null });
    assert.deepEqual((await model()).adminTaskDates({ created_at: "2026-02-30T09:00:00Z" }), { createdDate: null, effectiveDueDate: null });
    assert.deepEqual((await model()).adminTaskDates({ created_at: "2026-10-20T23:30:00" }), { createdDate: null, effectiveDueDate: null });
    assert.deepEqual((await model()).adminTaskDates({ created_at: "2026-10-20garbage" }), { createdDate: null, effectiveDueDate: null });
    assert.deepEqual(
      (await model()).adminTaskDates({ due_date: "not-a-date", created_at: "2026-10-01T09:00:00.000Z" }),
      { createdDate: "2026-10-01", effectiveDueDate: "2026-10-02" },
    );
    // Timestamp-shaped instants canonicalize to the stored UTC day in the
    // string, pg Date and SQL paths. Only a date-only YYYY-MM-DD keeps its
    // exact validated recorded day.
    const offsetString = (await model()).adminTaskDates({ provider_created_at: "2026-10-20T23:30:00-05:00" });
    const offsetDate = (await model()).adminTaskDates({ provider_created_at: new Date("2026-10-21T04:30:00.000Z") });
    assert.deepEqual(offsetString, { createdDate: "2026-10-21", effectiveDueDate: "2026-10-22" });
    assert.deepEqual(offsetDate, offsetString, "offset string and the same pg Date agree at UTC");
    const originalTimezone = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    try {
      assert.deepEqual(
        (await model()).adminTaskDates({ provider_created_at: "2026-10-20T23:30:00-05:00" }),
        offsetString,
        "an explicit offset is independent of the host timezone",
      );
      assert.deepEqual(
        (await model()).adminTaskDates({ provider_created_at: "2026-10-20T23:30:00" }),
        { createdDate: null, effectiveDueDate: null },
        "a timezone-less timestamp is rejected instead of using host-local time",
      );
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
    assert.deepEqual(
      (await model()).adminTaskDates({ due_date: "2026-10-20", created_at: "2026-10-20T23:30:00-05:00" }),
      { createdDate: "2026-10-21", effectiveDueDate: "2026-10-20" },
      "a date-only due date keeps its exact validated recorded day",
    );
    assert.deepEqual(
      (await model()).adminTaskDates({ due_date: "2026-13-01", created_at: "2026-10-01" }),
      { createdDate: "2026-10-01", effectiveDueDate: "2026-10-02" },
    );
    // Actual SQL date columns keep the recorded day; a stored timestamptz uses
    // its UTC day because PostgreSQL no longer has the provider's offset.
    const offsetCreated = await seedTask(f.db, {
      title: "Offset created", assignees: [personA],
      created: "2026-10-20T23:30:00-05:00", due: null,
    });
    const offsetDue = await seedTask(f.db, {
      title: "Offset due", assignees: [personA],
      created: "2026-10-20T23:30:00-05:00", due: "2026-10-20",
    });
    const offsetPage = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, now: new Date("2026-10-22T04:30:00-05:00"),
    });
    const offsetTask = offsetPage.items.find((task: { id: string }) => task.id === offsetCreated)!;
    assert.equal(offsetTask.createdDate, "2026-10-21", "stored timestamptz uses its UTC day");
    assert.equal(offsetTask.effectiveDueDate, "2026-10-22", "the derived due uses the same UTC day");
    assert.deepEqual(
      { createdDate: offsetTask.createdDate, effectiveDueDate: offsetTask.effectiveDueDate },
      offsetDate,
      "the server row, offset string and pg Date agree for the same instant",
    );
    const offsetDueTask = offsetPage.items.find((task: { id: string }) => task.id === offsetDue)!;
    assert.equal(offsetDueTask.effectiveDueDate, "2026-10-20", "a date-only due column never shifts");
    assert.deepEqual(
      { createdDate: offsetDueTask.createdDate, effectiveDueDate: offsetDueTask.effectiveDueDate },
      (await model()).adminTaskDates({ provider_created_at: new Date("2026-10-21T04:30:00.000Z"), due_date: "2026-10-20" }),
      "the server row and the shared helper agree on actual date columns",
    );
  } finally { await f.close(); }
});

test("server_sort_precedes_pagination", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const seeded: Array<{ id: string; title: string; created: string; due: string | null; effectiveDue: string; updated: string }> = [];
    for (let index = 0; index < 130; index += 1) {
      const day = String((index % 29) + 1).padStart(2, "0");
      const created = `2026-03-${day}T09:00:00.000Z`;
      const title = `Task ${String(index).padStart(3, "0")}`;
      const storedTitle = index % 17 === 0 ? `  ${title}  ` : title;
      const due = index % 4 === 0 ? null
        : index % 4 === 1 ? "2026-02-01"
          : index % 4 === 2 ? "2026-05-01" : "2026-03-15";
      const createdDay = created.slice(0, 10);
      const derived = new Date(`${createdDay}T12:00:00Z`);
      derived.setUTCDate(derived.getUTCDate() + 1);
      const effectiveDue = due ?? derived.toISOString().slice(0, 10);
      const updated = `2026-03-${day}T${String(10 + (index % 5)).padStart(2, "0")}:00:00.000Z`;
      const id = await seedTask(f.db, {
        title: storedTitle, assignees: [personA], created, due, updated,
      });
      seeded.push({ id, title: storedTitle, created, due, effectiveDue, updated });
    }
    const expected = [...seeded].sort((a, b) => {
      const created = b.created.slice(0, 10).localeCompare(a.created.slice(0, 10));
      if (created) return created;
      const updated = Date.parse(b.updated) - Date.parse(a.updated);
      if (updated) return updated;
      const effectiveDue = b.effectiveDue.localeCompare(a.effectiveDue);
      if (effectiveDue) return effectiveDue;
      return a.title.trim().toLowerCase().localeCompare(b.title.trim().toLowerCase())
        || a.id.localeCompare(b.id);
    }).map((task) => task.id);
    // The newest-created group must lead even though more than one page exists.
    const service = await reads();
    const first = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, limit: 100, now: fixedNow,
    });
    assert.equal(first.total, 130);
    assert.equal(first.items[0].createdDate, "2026-03-29");
    assert.equal(first.items.length, 100);
    const second = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, limit: 100, cursor: first.nextCursor!, now: fixedNow,
    });
    assert.equal(second.items.length, 30);
    assert.equal(second.nextCursor, null, "the final page has no continuation");
    assert.deepEqual(
      [...first.items, ...second.items].map((task: { id: string }) => task.id),
      expected,
      "pages join in the documented server order without reordering",
    );
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personB], overdueOnly: false, cursor: first.nextCursor!, now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
    );
    const [body, signature] = first.nextCursor!.split(".");
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    decoded.i = randomUUID();
    const tampered = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personA], overdueOnly: false, cursor: tampered, now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
    );
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personA], overdueOnly: false, cursor: "not-a-cursor", now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
    );
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personA], overdueOnly: false, cursor: first.nextCursor!.slice(0, -1), now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "a truncated signature is rejected",
    );
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personA], overdueOnly: false, cursor: `${first.nextCursor!}.extra`, now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "an extra cursor segment is rejected",
    );
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [personA], overdueOnly: false, cursor: "a".repeat(4097), now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "an oversized cursor is rejected before parsing",
    );
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `${originalDatabaseUrl}-rotated`;
    try {
      await assert.rejects(
        service.listAdminOttoTasks(adminAccess, {
          personIds: [personA], overdueOnly: false, cursor: first.nextCursor!, now: fixedNow,
        }),
        (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
        "rotating the signing key invalidates in-flight cursors",
      );
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    const team = await service.listAdminOttoTasks(adminAccess, {
      personIds: null, overdueOnly: false, limit: 1, now: fixedNow,
    });
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, {
        personIds: [], overdueOnly: false, cursor: team.nextCursor!, now: fixedNow,
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "an empty person set still validates the cursor against its own scope",
    );
  } finally { await f.close(); }
});

test("admin_task_sort_keys_are_discriminating", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const created = "2026-06-01T09:00:00.000Z";
    const updatedHigh = "2026-06-02T12:00:00.000Z";
    const updatedLow = "2026-06-02T11:00:00.000Z";
    const idHighA = "60000000-0000-4000-8000-000000000001";
    const idHighB = "60000000-0000-4000-8000-000000000002";
    const idDerived = "60000000-0000-4000-8000-000000000003";
    const idLowerDue = "60000000-0000-4000-8000-000000000004";
    const idLowerUpdated2 = "60000000-0000-4000-8000-000000000005";
    const idLowerUpdated = "60000000-0000-4000-8000-000000000006";
    await seedTask(f.db, {
      id: idHighA, title: "Same Title", assignees: [personA], created, updated: updatedHigh, due: "2026-06-10",
    });
    await seedTask(f.db, {
      id: idHighB, title: "  same title  ", assignees: [personA], created, updated: updatedHigh, due: "2026-06-10",
    });
    await seedTask(f.db, {
      id: idDerived, title: "Derived", assignees: [personA], created, updated: updatedHigh, due: null,
    });
    await seedTask(f.db, {
      id: idLowerDue, title: "Lower", assignees: [personA], created, updated: updatedHigh, due: "2026-05-30",
    });
    await seedTask(f.db, {
      id: idLowerUpdated2, title: "Lower updated 2", assignees: [personA], created, updated: updatedLow, due: "2026-06-21",
    });
    await seedTask(f.db, {
      id: idLowerUpdated, title: "Lower updated", assignees: [personA], created, updated: updatedLow, due: "2026-06-20",
    });
    // Explicit preconditions: each pair the sort relies on differs, and the
    // duplicate-title pair normalizes equal with distinct ids.
    assert.notEqual(updatedHigh, updatedLow);
    assert.notEqual("2026-06-10", "2026-06-02", "recorded and derived effective due differ");
    assert.equal("Same Title".trim().toLowerCase(), "  same title  ".trim().toLowerCase());
    assert.notEqual(idHighA, idHighB);
    assert.notEqual("2026-06-21", "2026-06-20", "the lower-updated due values differ");
    const service = await reads();
    const expected = [idHighA, idHighB, idDerived, idLowerDue, idLowerUpdated2, idLowerUpdated];
    const first = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, limit: 2, now: new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.deepEqual(first.items.map((task: { id: string }) => task.id), expected.slice(0, 2));
    assert.ok(first.nextCursor);
    const second = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, limit: 2, cursor: first.nextCursor!,
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.deepEqual(second.items.map((task: { id: string }) => task.id), expected.slice(2, 4));
    assert.ok(second.nextCursor);
    const third = await service.listAdminOttoTasks(adminAccess, {
      personIds: [personA], overdueOnly: false, limit: 2, cursor: second.nextCursor!,
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.deepEqual(third.items.map((task: { id: string }) => task.id), expected.slice(4, 6));
    assert.equal(third.nextCursor, null);
  } finally { await f.close(); }
});

test("dst_and_yesterday_use_each_person_timezone", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera", timezone: "America/New_York" });
    await seedPerson(f.db, { id: personB, name: "Maria Chen", timezone: "Pacific/Auckland" });
    const service = await reads();
    const now = new Date("2026-10-22T02:00:00.000Z");
    const people = [
      { id: personA, displayName: "Alex Rivera", active: true, timezone: "America/New_York" },
      { id: personB, displayName: "Maria Chen", active: true, timezone: "Pacific/Auckland" },
    ];
    const windows = service.adminRecordWindows(people, { relativeDay: "yesterday" }, now);
    assert.deepEqual(windows, [
      { personId: personA, timezone: "America/New_York", from: "2026-10-20", through: "2026-10-20" },
      { personId: personB, timezone: "Pacific/Auckland", from: "2026-10-21", through: "2026-10-21" },
    ]);
    // 05:00Z is already 01:00 on Oct 21 in New York (today), but 18:00 on
    // Oct 21 in Auckland (yesterday). Only Auckland's authored update belongs.
    await seedUpdate(f.db, personA, "2026-10-21T05:00:00.000Z", "New York today");
    await seedUpdate(f.db, personB, "2026-10-21T05:00:00.000Z", "Auckland yesterday");
    const page = await service.listAdminOttoRecords(adminAccess, { windows });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].personId, personB);
    assert.equal(page.items[0].localDate, "2026-10-21");
    assert.equal(page.items[0].text, "Auckland yesterday");

    // The 25-hour fall-back day keeps both sides of the repeated hour on the
    // same local date.
    const dstWindow = service.adminRecordWindows(
      [{ id: personA, displayName: "Alex Rivera", active: true, timezone: "America/New_York" }],
      { from: "2026-11-01", through: "2026-11-01" },
      new Date("2026-11-02T12:00:00.000Z"),
    );
    await seedUpdate(f.db, personA, "2026-11-01T04:30:00.000Z", "Before fall back");
    await seedUpdate(f.db, personA, "2026-11-02T04:30:00.000Z", "After fall back");
    const dstPage = await service.listAdminOttoRecords(adminAccess, { windows: dstWindow });
    assert.equal(dstPage.total, 2);
    assert.ok(dstPage.items.every((record: { localDate: string }) => record.localDate === "2026-11-01"));
  } finally { await f.close(); }
});

test("private_chat_memory_and_draft_reports_excluded", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    await seedUpdate(f.db, personA, "2026-10-21T12:00:00.000Z", "Authored update");
    await seedReport(f.db, personA, {
      reportDate: "2026-10-21", submittedAt: null, markdown: "DRAFT PRIVATE REPORT",
    });
    await seedReport(f.db, personA, {
      reportDate: "2026-10-21", submittedAt: "2026-10-21T17:00:00.000Z",
      submittedMarkdown: "Submitted EOD snapshot",
    });
    await seedReport(f.db, personA, {
      reportDate: "2026-10-21", submittedAt: "2026-10-21T17:30:00.000Z",
      submittedMarkdown: "NON EOD REPORT SENTINEL", kind: "weekly",
    });
    const task = await seedTask(f.db, { title: "Canonical task", assignees: [personA] });
    await seedTaskEvent(f.db, personA, task, { localDate: "2026-10-21", title: "Canonical task" });
    await seedSession(f.db, personA, { shiftDate: "2026-10-21", occurredAt: "2026-10-21T17:00:00.000Z" });
    await seedReviewedInterval(f.db, { personId: personA, reviewedAt: "2026-10-21T16:00:00.000Z" });
    await f.db.exec(`create table work_chat_messages (id uuid primary key, body text);
      create table work_memory (id uuid primary key, content text);
      insert into work_chat_messages values ('${randomUUID()}', 'PRIVATE CHAT SENTINEL');
      insert into work_memory values ('${randomUUID()}', 'MEMORY SENTINEL');`);
    const service = await reads();
    const windows = service.adminRecordWindows(
      [{ id: personA, displayName: "Alex Rivera", active: true, timezone: "UTC" }],
      { from: "2026-10-21", through: "2026-10-21" },
      fixedNow,
    );
    const page = await service.listAdminOttoRecords(adminAccess, { windows });
    assert.deepEqual([...new Set(page.items.map((record: { source: string }) => record.source))].sort(),
      ["reviewed_recap", "submitted_eod", "task", "update", "workday"]);
    const text = page.items.map((record: { text: string }) => record.text).join("\n");
    assert.match(text, /Authored update/);
    assert.match(text, /Submitted EOD snapshot/);
    assert.doesNotMatch(text, /DRAFT PRIVATE REPORT/);
    assert.doesNotMatch(text, /NON EOD REPORT SENTINEL/);
    assert.doesNotMatch(text, /PRIVATE CHAT SENTINEL/);
    assert.doesNotMatch(text, /MEMORY SENTINEL/);
    assert.ok(page.items.every((record: { recordUrl: string }) => record.recordUrl.startsWith("/work-os/admin/")));
  } finally { await f.close(); }
});

test("explicit_people_ids_return_saved_inactive_same_org_names_only", async () => {
  const f = await fixture();
  try {
    for (let index = 1; index <= 60; index += 1) {
      await seedPerson(f.db, {
        id: `23000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Directory Person ${String(index).padStart(3, "0")}`,
      });
    }
    await seedPerson(f.db, { id: personA, name: "Ada" });
    const savedInactive = "24000000-0000-4000-8000-000000000001";
    await seedPerson(f.db, { id: savedInactive, name: "Ivy Former", active: false });
    const foreign = "24000000-0000-4000-8000-000000000002";
    await seedPerson(f.db, { id: foreign, name: "Foreign Person", organizationId: otherOrg });
    const service = await reads();
    const page = await service.listAdminOttoPeople(adminAccess, {
      ids: [savedInactive, personA, foreign, personA],
    });
    assert.equal(page.nextCursor, null);
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((person: { id: string; displayName: string; active: boolean }) =>
      [person.id, person.displayName, person.active]), [
      [personA, "Ada", true],
      [savedInactive, "Ivy Former", false],
    ]);
    assert.match(page.coverage.join(" "), /explicit id/i);
    await assert.rejects(
      () => service.listAdminOttoPeople(adminAccess, { ids: ["not-a-uuid"] }),
      /ids must contain between 1 and 100 organization employee ids/,
    );
    await assert.rejects(
      () => service.listAdminOttoPeople(adminAccess, { ids: Array.from({ length: 101 }, () => personA) }),
      /ids must contain between 1 and 100 organization employee ids/,
    );
    await assert.rejects(
      () => service.listAdminOttoPeople(adminAccess, { ids: [personA], cursor: "people-next" }),
      /ids cannot be combined with a cursor/,
    );
    // The ordinary directory remains active-only and paginated.
    const activePage = await service.listAdminOttoPeople(adminAccess, { limit: 50 });
    assert.equal(activePage.items.some((person: { id: string }) => person.id === savedInactive), false);
    assert.ok(activePage.nextCursor);
  } finally { await f.close(); }
});

test("directory_page_bounded_and_full_roster_resolution", async () => {
  const f = await fixture();
  try {
    for (let index = 1; index <= 120; index += 1) {
      await seedPerson(f.db, {
        id: `21000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Person ${String(index).padStart(3, "0")}`,
      });
    }
    await seedPerson(f.db, { id: personA, name: "Zulu Unique" });
    const service = await reads();
    const first = await service.listAdminOttoPeople(adminAccess, { limit: 50 });
    assert.equal(first.total, 121);
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    const second = await service.listAdminOttoPeople(adminAccess, { limit: 50, cursor: first.nextCursor! });
    assert.equal(second.items.length, 50);
    const third = await service.listAdminOttoPeople(adminAccess, { limit: 50, cursor: second.nextCursor! });
    assert.equal(third.items.length, 21);
    assert.equal(third.nextCursor, null);
    const resolution = await service.resolveAdminOttoPeople(adminAccess, { kind: "names", names: ["zulu uni"] });
    assert.equal(resolution.kind, "resolved");
    if (resolution.kind !== "resolved") assert.fail("full-roster partial name did not resolve");
    assert.equal(resolution.people[0]!.id, personA);
    // A stale cursor past the new end still reports the exact active total.
    await f.db.query(`update work_people set active = false
      where organization_id = $1 and display_name > 'Person 050'`, [org]);
    const pastEnd = await service.listAdminOttoPeople(adminAccess, { limit: 50, cursor: first.nextCursor! });
    assert.equal(pastEnd.items.length, 0);
    assert.equal(pastEnd.total, 50);
    assert.equal(pastEnd.nextCursor, null);
    await assert.rejects(service.listAdminOttoPeople(adminAccess, { limit: 101 }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError");
  } finally { await f.close(); }
});

test("oversized_people_name_cursor_fails_closed", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: `A${"x".repeat(5000)}` });
    await seedPerson(f.db, { id: personB, name: "B Person" });
    const service = await reads();
    await assert.rejects(
      service.listAdminOttoPeople(adminAccess, { limit: 1 }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "an over-bound cursor fails closed instead of truncating the keyset name",
    );
  } finally { await f.close(); }
});

test("records_and_recaps_page_and_keep_older_reviewed_history", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    await seedPerson(f.db, { id: personB, name: "Maria Chen" });
    for (let index = 0; index < 55; index += 1) {
      await seedUpdate(f.db, personA, `2026-10-21T${String(index % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`, `Update ${index}`);
    }
    const service = await reads();
    const windows = service.adminRecordWindows(
      [{ id: personA, displayName: "Alex Rivera", active: true, timezone: "UTC" }],
      { from: "2026-10-21", through: "2026-10-21" },
      fixedNow,
    );
    const first = await service.listAdminOttoRecords(adminAccess, { windows });
    assert.equal(first.total, 55);
    assert.equal(first.items.length, 50);
    await assert.rejects(
      service.listAdminOttoRecords(adminAccess, {
        windows: [{ personId: personA, timezone: "UTC", from: "2026-08-01", through: "2026-09-01" }],
      }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "record windows are bounded at 31 local days",
    );
    const second = await service.listAdminOttoRecords(adminAccess, { windows, cursor: first.nextCursor! });
    assert.equal(second.items.length, 5);
    assert.equal(second.nextCursor, null, "the final record page has no continuation");
    assert.equal(new Set([...first.items, ...second.items].map((record: { id: string }) => record.id)).size, 55);

    // Older than the 30-day arrival inbox, but still explicit reviewed history.
    const oldInterval = await seedReviewedInterval(f.db, {
      personId: personA, reviewedAt: "2026-09-01T12:00:00.000Z", headline: "Old reviewed", detail: "Still readable.",
    });
    const recentInterval = await seedReviewedInterval(f.db, {
      personId: personB, reviewedAt: "2026-10-21T12:00:00.000Z", headline: "Recent reviewed",
    });
    const oldWindows = service.adminRecordWindows(
      [{ id: personA, displayName: "Alex Rivera", active: true, timezone: "UTC" }],
      { from: "2026-08-25", through: "2026-09-05" },
      fixedNow,
    );
    const oldPage = await service.listAdminOttoRecaps(adminAccess, { windows: oldWindows, latest: false });
    assert.equal(oldPage.total, 1);
    assert.equal(oldPage.items[0].intervalId, oldInterval);
    const latest = await service.listAdminOttoRecaps(adminAccess, {
      windows: [
        { personId: personA, timezone: "UTC", from: "2026-10-21", through: "2026-10-21" },
        { personId: personB, timezone: "UTC", from: "2026-10-21", through: "2026-10-21" },
      ],
      latest: true,
    });
    assert.equal(latest.total, 2);
    assert.deepEqual(latest.items.map((recap: { intervalId: string }) => recap.intervalId).sort(),
      [oldInterval, recentInterval].sort());

    const detail = await service.getAdminOttoRecap(adminAccess, oldInterval);
    assert.equal(detail?.original.headline, "Old reviewed");
    assert.equal(await service.getAdminOttoRecap(adminAccess, randomUUID()), null);
    assert.equal(await service.getAdminOttoRecap(otherOrgAdminAccess, oldInterval), null);

    // An old reviewed interval with no Task 2 review row is lazily snapshotted
    // without publishing an arrival.
    const lazyInterval = await seedReviewedInterval(f.db, {
      personId: personA, reviewedAt: "2026-09-02T12:00:00.000Z",
      headline: "Lazy snapshot", withReview: false,
    });
    const lazyPage = await service.listAdminOttoRecaps(adminAccess, { windows: oldWindows, latest: false });
    assert.ok(lazyPage.items.some((recap: { intervalId: string }) => recap.intervalId === lazyInterval));
    const lazyRows = await rows<{ arrival_eligible: boolean; version: number }>(f.db,
      `select arrival_eligible, version from work_recap_reviews where organization_id=$1 and interval_id=$2`, [org, lazyInterval]);
    assert.equal(lazyRows.length, 1);
    assert.equal(lazyRows[0].arrival_eligible, false);
    assert.equal(lazyRows[0].version, 1);

    // An inferred interval has no reviewed truth and must never leak into
    // history, latest, records or detail.
    const inferredInterval = await seedReviewedInterval(f.db, {
      personId: personA, reviewedAt: "2026-09-03T12:00:00.000Z",
      headline: "Inferred only", reviewStatus: "inferred", withReview: false,
    });
    const inferredHistory = await service.listAdminOttoRecaps(adminAccess, { windows: oldWindows, latest: false });
    assert.ok(inferredHistory.items.every((recap: { intervalId: string }) => recap.intervalId !== inferredInterval));
    const inferredLatest = await service.listAdminOttoRecaps(adminAccess, {
      windows: [
        { personId: personA, timezone: "UTC", from: "2026-10-21", through: "2026-10-21" },
        { personId: personB, timezone: "UTC", from: "2026-10-21", through: "2026-10-21" },
      ],
      latest: true,
    });
    assert.ok(inferredLatest.items.every((recap: { intervalId: string }) => recap.intervalId !== inferredInterval));
    const inferredRecords = await service.listAdminOttoRecords(adminAccess, { windows: oldWindows });
    assert.ok(inferredRecords.items.every((record: { recordUrl: string }) => !record.recordUrl.includes(inferredInterval)));
    assert.equal(await service.getAdminOttoRecap(adminAccess, inferredInterval), null);
  } finally { await f.close(); }
});

test("recap_pages_terminate_on_the_final_page", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personB, name: "Maria Chen" });
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    for (let index = 0; index < 55; index += 1) {
      await seedReviewedInterval(f.db, {
        personId: personB,
        reviewedAt: new Date(base + index * 3_600_000).toISOString(),
        headline: `Recap ${index}`,
      });
    }
    const service = await reads();
    const windows = service.adminRecordWindows(
      [{ id: personB, displayName: "Maria Chen", active: true, timezone: "UTC" }],
      { from: "2026-10-01", through: "2026-10-31" },
      fixedNow,
    );
    const historyFirst = await service.listAdminOttoRecaps(adminAccess, { windows, latest: false });
    assert.equal(historyFirst.total, 55);
    assert.equal(historyFirst.items.length, 50);
    assert.ok(historyFirst.nextCursor);
    const historySecond = await service.listAdminOttoRecaps(adminAccess, {
      windows, latest: false, cursor: historyFirst.nextCursor!,
    });
    assert.equal(historySecond.items.length, 5);
    assert.equal(historySecond.nextCursor, null, "the final history page has no continuation");
  } finally { await f.close(); }
});

test("latest_recap_pages_terminate_on_the_final_page", async () => {
  const f = await fixture();
  try {
    const people: Array<{ id: string; displayName: string; active: boolean; timezone: string }> = [];
    for (let index = 0; index < 55; index += 1) {
      const id = `22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await seedPerson(f.db, { id, name: `Recap Person ${String(index).padStart(3, "0")}` });
      await seedReviewedInterval(f.db, {
        personId: id,
        reviewedAt: new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 3_600_000).toISOString(),
        headline: `Latest ${index}`,
      });
      people.push({ id, displayName: `Recap Person ${String(index).padStart(3, "0")}`, active: true, timezone: "UTC" });
    }
    const service = await reads();
    const windows = service.adminRecordWindows(people, { from: "2026-10-01", through: "2026-10-31" }, fixedNow);
    const first = await service.listAdminOttoRecaps(adminAccess, { windows, latest: true });
    assert.equal(first.total, 55);
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    const second = await service.listAdminOttoRecaps(adminAccess, {
      windows, latest: true, cursor: first.nextCursor!,
    });
    assert.equal(second.items.length, 5);
    assert.equal(second.nextCursor, null, "the final latest page has no continuation");
  } finally { await f.close(); }
});

test("amended_reviewed_records_keep_labelled_correction", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera" });
    const persisted = await seedReviewedInterval(f.db, {
      personId: personA, reviewedAt: "2026-10-21T12:00:00.000Z",
      headline: "Persisted amended", detail: "Original queue detail",
      reviewStatus: "amended", employeeFeedback: "Corrected the queue",
    });
    const lazy = await seedReviewedInterval(f.db, {
      personId: personA, reviewedAt: "2026-10-21T13:00:00.000Z",
      headline: "Lazy amended", detail: "Lazy original detail",
      reviewStatus: "amended", employeeFeedback: "Lazy correction", withReview: false,
    });
    const service = await reads();
    const windows = service.adminRecordWindows(
      [{ id: personA, displayName: "Alex Rivera", active: true, timezone: "Pacific/Auckland" }],
      { from: "2026-10-22", through: "2026-10-22" },
      fixedNow,
    );
    const page = await service.listAdminOttoRecords(adminAccess, { windows });
    const persistedRecord = page.items.find((record: { recordUrl: string }) => record.recordUrl.includes(persisted));
    const lazyRecord = page.items.find((record: { recordUrl: string }) => record.recordUrl.includes(lazy));
    assert.ok(persistedRecord, "the persisted amended recap is listed");
    assert.ok(lazyRecord, "the lazy amended recap is listed");
    assert.match(persistedRecord.text, /Original queue detail/);
    assert.match(persistedRecord.text, /Employee correction: Corrected the queue/);
    assert.match(lazyRecord.text, /Lazy original detail/);
    assert.match(lazyRecord.text, /Employee correction: Lazy correction/);
    assert.equal(persistedRecord.localDate, "2026-10-22", "the requested window timezone decides the local day");
    assert.equal(lazyRecord.localDate, "2026-10-22", "the lazy path keeps the window local day");
    const lazyRows = await rows<{ arrival_eligible: boolean }>(f.db,
      `select arrival_eligible from work_recap_reviews where organization_id=$1 and interval_id=$2`, [org, lazy]);
    assert.equal(lazyRows.length, 1);
    assert.equal(lazyRows[0].arrival_eligible, false);
  } finally { await f.close(); }
});



// ---------------------------------------------------------------------------
// General task service parity: execute listTasks/listPersonTasks against a
// focused query fake that records every filter, then compare with the real
// PGlite organization-qualified count.

function loadTaskService(rows: Array<Record<string, any>>, people: Array<Record<string, any>>) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  function matches(task: Record<string, any>, filters: Array<[string, unknown]>) {
    return filters.every(([kind, value]) => {
      const filter = value as { col: string; val: unknown; op?: string; values?: unknown[] };
      if (kind === "eq") {
        if (filter.col === "raw->>created_by") return task.raw?.created_by === filter.val;
        return task[filter.col] === filter.val;
      }
      if (kind === "not") {
        const list = String(filter.val).replace(/[()]/g, "").split(",").map((item) => item.trim());
        return !list.includes(String(task[filter.col]));
      }
      if (kind === "contains") {
        if (filter.col === "raw->subscribers") {
          const expected = JSON.parse(String(filter.val)) as string[];
          return Array.isArray(task.raw?.subscribers)
            && expected.every((item) => task.raw.subscribers.includes(item));
        }
        const expected = Array.isArray(filter.val) ? filter.val : [filter.val];
        return expected.every((item) => Array.isArray(task[filter.col]) && task[filter.col].includes(item));
      }
      if (kind === "in") {
        return (filter.values ?? []).includes(task[filter.col]);
      }
      return true;
    });
  }
  function query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let range: [number, number] | null = null;
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters.push(["eq", { col, val }]); return q; },
      not: (col: string, _op: string, val: unknown) => { filters.push(["not", { col, val }]); return q; },
      contains: (col: string, val: unknown) => { filters.push(["contains", { col, val }]); return q; },
      in: (col: string, values: unknown[]) => { filters.push(["in", { col, values }]); return q; },
      or: () => q,
      gte: () => q,
      lt: () => q,
      order: () => q,
      limit: () => q,
      range: (from: number, to: number) => { range = [from, to]; return q; },
      maybeSingle: async () => {
        calls.push({ table, filters });
        const data = table === "work_people" ? people.filter((row) => matches(row, filters)) : rows.filter((row) => matches(row, filters));
        return { data: data[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        try {
          calls.push({ table, filters });
          const source = table === "work_people" ? people : table === "work_projects" ? [] : rows;
          const selected = source.filter((row) => matches(row, filters));
          resolve({ data: range ? selected.slice(range[0], range[1] + 1) : selected, error: null });
        } catch (error) {
          reject(error);
        }
      },
    };
    return q;
  }
  const db = () => ({ from: query, rpc: async () => [] });
  const stubs: Record<string, unknown> = {
    "@/lib/work-os-internal": {
      db,
      ensureNoError: async (promise: Promise<{ data: unknown; error: unknown }>, label: string) => {
        const result = await promise;
        if (result.error) throw new Error(`${label}: ${String(result.error)}`);
        return result.data;
      },
      nonEmptyString: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
      dateOnly: (value: unknown) => typeof value === "string" ? value.slice(0, 10) : null,
      selectFirst: async (promise: Promise<{ data: unknown[] }>) => (await promise).data?.[0],
      niftyForOwner: async () => { throw new Error("provider access is not used in this fixture"); },
    },
    "@/lib/work-os-task-assignees": {
      attachTaskAssigneeIdentities: (tasks: Array<Record<string, any>>) => tasks,
    },
    "@/lib/work-os-schedule-validation": {
      validateWorkOsDate: (value: string) => value,
    },
    "@/lib/work-os-dates": {
      todayIso: () => "2026-10-22",
    },
    "@/lib/work-os-task-pagination": {
      createWorkspaceTaskCursor: () => "",
      parseWorkspaceTaskCursor: () => null,
      taskPageScope: () => ({}),
    },
    "@/lib/work-os-nifty": {
      syncNifty: async () => undefined,
      upsertNiftyTask: async () => undefined,
    },
    "@/lib/work-os-plan-ghosts": {
      removePlanItemsForTombstonedTask: async () => undefined,
    },
    "@/lib/integrations/nifty": {
      assignNiftyTask: async () => undefined,
      archiveNiftyTask: async () => undefined,
      completeNiftyTask: async () => undefined,
      createNiftyTask: async () => undefined,
      deleteNiftyTask: async () => undefined,
      ensureNiftyAccessToken: async () => "token",
      getNiftyTask: async () => null,
      listNiftyTasks: async () => [],
      NiftyHttpError: class extends Error {},
      normalizeNiftyTaskPayload: (value: unknown) => value,
      updateNiftyTask: async () => undefined,
      updateNiftyTaskField: async () => undefined,
    },
  };
  const file = "src/lib/work-os-tasks.ts";
  const js = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const require = (specifier: string) => {
    if (stubs[specifier]) return stubs[specifier];
    throw new Error(`unexpected task-service import: ${specifier}`);
  };
  const exports = {};
  new Function("require", "exports", "module", js)(require, exports, { exports });
  return {
    listTasks: (exports as any).listTasks,
    listPersonTasks: (exports as any).listPersonTasks,
    isNiftyTaskAttributableToMember: (exports as any).isNiftyTaskAttributableToMember,
    calls,
  };
}

test("two_org_same_owner_and_foreign_person_rows_counts_parity", async () => {
  const f = await fixture();
  try {
    await seedPerson(f.db, { id: personA, name: "Alex Rivera", nifty: "nifty-a" });
    await seedPerson(f.db, { id: personC, name: "Inactive Same Org", nifty: "nifty-c", active: false });
    await seedPerson(f.db, { id: otherPerson, name: "Foreign Person", nifty: "nifty-b", organizationId: otherOrg });
    const orgATask = randomUUID();
    const inactiveTask = randomUUID();
    const orgBTask = randomUUID();
    const foreignTask = randomUUID();
    await f.db.query(`insert into work_tasks
      (id,user_id,organization_id,title,completed,status,assignee_person_ids,raw,created_at,updated_at)
      values ($1,$2,$3,'Org A task',false,'open',ARRAY[$4]::uuid[],'{}',$5,$5)`,
    [orgATask, adminUser, org, personA, "2026-10-20T09:00:00.000Z"]);
    await f.db.query(`insert into work_tasks
      (id,user_id,organization_id,title,completed,status,assignee_person_ids,raw,created_at,updated_at)
      values ($1,$2,$3,'Inactive same-org task',false,'open',ARRAY[$4]::uuid[],'{}',$5,$5)`,
    [inactiveTask, adminUser, org, personC, "2026-10-20T09:00:00.000Z"]);
    await f.db.query(`insert into work_tasks
      (id,user_id,organization_id,title,completed,status,assignee_person_ids,raw,created_at,updated_at)
      values ($1,$2,$3,'Org B task',false,'open',ARRAY[$4]::uuid[],'{}',$5,$5)`,
    [orgBTask, adminUser, otherOrg, otherPerson, "2026-10-20T09:00:00.000Z"]);
    await f.db.query(`insert into work_tasks
      (id,user_id,organization_id,title,completed,status,assignee_person_ids,raw,created_at,updated_at)
      values ($1,$2,$3,'Foreign person task',false,'open',ARRAY[$4]::uuid[],'{}',$5,$5)`,
    [foreignTask, adminUser, otherOrg, otherPerson, "2026-10-20T09:00:00.000Z"]);
    const rows = [
      { id: orgATask, user_id: adminUser, organization_id: org, title: "Org A task", completed: false, status: "open", assignee_person_ids: [personA], raw: {}, created_at: "2026-10-20T09:00:00.000Z" },
      { id: inactiveTask, user_id: adminUser, organization_id: org, title: "Inactive same-org task", completed: false, status: "open", assignee_person_ids: [personC], raw: {}, created_at: "2026-10-20T09:00:00.000Z" },
      { id: orgBTask, user_id: adminUser, organization_id: otherOrg, title: "Org B task", completed: false, status: "open", assignee_person_ids: [otherPerson], raw: {}, created_at: "2026-10-20T09:00:00.000Z" },
      { id: foreignTask, user_id: adminUser, organization_id: otherOrg, title: "Foreign person task", completed: false, status: "open", assignee_person_ids: [otherPerson], raw: {}, created_at: "2026-10-20T09:00:00.000Z" },
    ];
    const people = [
      { id: personA, user_id: adminUser, organization_id: org, display_name: "Alex Rivera", active: true, nifty_member_id: "nifty-a" },
      { id: personC, user_id: adminUser, organization_id: org, display_name: "Inactive Same Org", active: false, nifty_member_id: "nifty-c" },
      { id: otherPerson, user_id: adminUser, organization_id: otherOrg, display_name: "Foreign Person", active: true, nifty_member_id: "nifty-b" },
    ];
    const tasks = loadTaskService(rows, people);
    const teamA = await tasks.listTasks(adminUser, { organizationId: org });
    assert.deepEqual(teamA.map((task: { id: string }) => task.id).sort(), [orgATask, inactiveTask].sort(),
      "org-aware rows include an inactive same-org person and exclude the same owner's other organization");
    const personRows = await tasks.listPersonTasks(adminUser, personA, {
      organizationId: org, order: "created_desc", includeLedgerHistory: true,
    });
    assert.deepEqual(personRows.map((task: { id: string }) => task.id), [orgATask], "person rows are organization-qualified");
    const inactiveRows = await tasks.listPersonTasks(adminUser, personC, {
      organizationId: org, order: "created_desc", includeLedgerHistory: true,
    });
    assert.deepEqual(inactiveRows.map((task: { id: string }) => task.id), [inactiveTask],
      "the general task record keeps inactive same-org history available");
    await assert.rejects(
      tasks.listPersonTasks(adminUser, otherPerson, { organizationId: org, order: "created_desc", includeLedgerHistory: true }),
      /authorized organization/,
      "a foreign person is rejected before attribution",
    );
    const service = await reads();
    const counts = await service.countAdminTaskRecord(adminAccess, {
      ownerId: adminUser, personId: personA, today: "2026-10-22",
    });
    assert.deepEqual(counts, { open: 1, overdue: 1, completedWeek: 0 }, "the count matches the organization-bounded row result");
    const inactiveCounts = await service.countAdminTaskRecord(adminAccess, {
      ownerId: adminUser, personId: personC, today: "2026-10-22",
    });
    assert.deepEqual(inactiveCounts, { open: 1, overdue: 1, completedWeek: 0 }, "the inactive same-org count matches its rows");
    const teamCount = await service.countAdminTaskRecord(adminAccess, {
      ownerId: adminUser, personId: null, today: "2026-10-22",
    });
    assert.equal(teamCount.open, 2, "the team count includes same-org inactive history and excludes the other organization");
    assert.ok(tasks.calls.some((call) => call.table === "work_tasks"
      && call.filters.some(([kind, value]) => kind === "eq"
        && (value as { col: string; val: unknown }).col === "organization_id"
        && (value as { val: unknown }).val === org)), "the actual row query carries the organization predicate");
    assert.equal(tasks.isNiftyTaskAttributableToMember({ assignee_provider_ids: ["nifty-a"], raw: {} }, "  nifty-a  "), true,
      "the canonical JS helper trims a nonblank mapping");
    assert.equal(tasks.isNiftyTaskAttributableToMember({ assignee_provider_ids: [""], raw: { created_by: "", subscribers: [""] } }, "   "), false,
      "the canonical JS helper rejects a blank mapping");
    // The Otto named-read adapter keeps its active-person policy; the general
    // historical task record above is the only surface allowed to include an
    // inactive same-org person.
    const inactiveResolution = await service.resolveAdminOttoPeople(adminAccess, { kind: "ids", ids: [personC] });
    assert.deepEqual(inactiveResolution, { kind: "missing", name: personC });
    const ottoTeam = await service.resolveAdminOttoPeople(adminAccess, { kind: "team" });
    assert.ok(ottoTeam.kind === "resolved" && ottoTeam.people.every((person: { id: string }) => person.id !== personC));
    await assert.rejects(
      service.listAdminOttoTasks(adminAccess, { personIds: [personC], overdueOnly: false, now: fixedNow }),
      (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError",
      "Otto named reads remain active-only",
    );
  } finally { await f.close(); }
});



// ---------------------------------------------------------------------------
// Route execution uses the production route modules with the access resolver
// and read service stubbed; the real SQL path is covered above.

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);

function routeFixture() {
  const calls: Record<string, unknown[]> = {
    people: [], tasks: [], windows: [], records: [], recaps: [], recap: [],
    adminTasks: [], adminPersonTasks: [], adminCounts: [], listTasks: [],
  };
  const state = { denied: false };
  const page = { items: [], nextCursor: null, total: 0, asOf: "2026-10-22T12:00:00.000Z", coverage: [] };
  const recap = { intervalId: intervalA, eventId: "event-1" };
  const windows = [{ personId: personA, timezone: "UTC", from: "2026-10-21", through: "2026-10-21" }];
  const stubs: Record<string, unknown> = {
    "src/lib/work-os-admin-otto-access.ts": {
      requireAdminOttoAccess: async () => state.denied
        ? { response: Response.json({ error: "forbidden" }, { status: 403 }) }
        : { access: adminAccess },
    },
    "src/lib/work-os-admin-otto-reads.ts": {
      listAdminOttoPeople: async (_access: unknown, input: unknown) => { calls.people.push(input); return page; },
      listAdminOttoTasks: async (_access: unknown, input: unknown) => { calls.tasks.push(input); return page; },
      adminOttoWindowsFromQuery: async (_access: unknown, params: URLSearchParams) => {
        calls.windows.push(params.get("windows") ?? params.get("personIds"));
        return windows;
      },
      listAdminOttoRecords: async (_access: unknown, input: unknown) => { calls.records.push(input); return page; },
      listAdminOttoRecaps: async (_access: unknown, input: unknown) => { calls.recaps.push(input); return page; },
      getAdminOttoRecap: async (_access: unknown, intervalId: string) => {
        calls.recap.push(intervalId);
        return intervalId === intervalA ? recap : null;
      },
      countAdminTaskRecord: async (_access: unknown, input: unknown) => {
        calls.adminCounts.push(input);
        return { open: 0, overdue: 0, completedWeek: 0 };
      },
    },
    "src/lib/work-os.ts": {
      listTasks: async (_ownerId: string, input: unknown) => { calls.listTasks.push(input); return []; },
      listPersonTasks: async (_ownerId: string, personId: string, input: unknown) => {
        calls.adminPersonTasks.push({ personId, input });
        return [];
      },
      getTaskByLocalOrProviderId: async () => null,
    },
    "src/lib/work-os-local-tasks.ts": {
      createLocalWorkOsTask: async () => ({}),
      defaultWorkOsTaskProjectId: async () => null,
    },
    "src/lib/work-os-api.ts": {
      WorkOsConflictError: class extends Error {},
      WorkOsValidationError: class extends Error {},
      requireWorkOsAdmin: async () => ({ access: adminAccess }),
      workOsOrganizationOwnerId: () => adminUser,
      jsonError: (error: unknown) => Response.json(
        { error: error instanceof Error ? error.message : "Request failed" },
        { status: (error as { name?: string })?.name === "WorkOsConflictError" ? 409 : 400 },
      ),
    },
  };
  const cache = new Map<string, any>();
  function load(relative: string): any {
    const file = relative.endsWith(".ts") ? relative : `${relative}.ts`;
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file);
    assert.ok(existsSync(path.join(root, file)), `missing production module: ${file}`);
    const exports = {};
    cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
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
  return { calls, state, page, recap, windows, load };
}

const request = (pathName: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test/api/work-os/admin/otto/${pathName}`, {
    headers: { authorization: "Bearer local-session", ...headers },
  });

test("admin_task_route_treats_empty_person_filter_as_team", async () => {
  const f = routeFixture();
  const route = f.load("src/app/api/work-os/tasks/route.ts");
  const empty = await route.GET(request("../tasks?personId="));
  assert.equal(empty.status, 200);
  assert.equal(f.calls.listTasks.length, 1);
  assert.equal(f.calls.adminPersonTasks.length, 0);
  assert.deepEqual(f.calls.adminCounts[0], {
    ownerId: adminUser, personId: null, today: new Date().toISOString().slice(0, 10),
  });
  const selected = await route.GET(request(`../tasks?personId=${personA}`));
  assert.equal(selected.status, 200);
  assert.equal(f.calls.adminPersonTasks.length, 1);
  assert.deepEqual(f.calls.adminCounts[1], {
    ownerId: adminUser, personId: personA, today: new Date().toISOString().slice(0, 10),
  });
});

test("read_routes_wire_schema_version_no_store_and_parsed_inputs", async () => {
  const f = routeFixture();
  const people = f.load("src/app/api/work-os/admin/otto/people/route.ts");
  const tasks = f.load("src/app/api/work-os/admin/otto/tasks/route.ts");
  const records = f.load("src/app/api/work-os/admin/otto/records/route.ts");
  const recaps = f.load("src/app/api/work-os/admin/otto/recaps/route.ts");
  const detail = f.load("src/app/api/work-os/admin/otto/recaps/[intervalId]/route.ts");

  const peopleResponse = await people.GET(request("people?limit=50&cursor=abc"));
  assert.equal(peopleResponse.status, 200);
  assert.equal(peopleResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await peopleResponse.json(), { schemaVersion: 1, ...f.page });
  assert.deepEqual(f.calls.people, [{ cursor: "abc", limit: 50 }]);

  const savedPeopleResponse = await people.GET(request(`people?ids=${personA},${personB}`));
  assert.equal(savedPeopleResponse.status, 200);
  assert.deepEqual(f.calls.people[1], { cursor: undefined, limit: undefined, ids: [personA, personB] });

  const tasksResponse = await tasks.GET(request(
    `tasks?personIds=${personA},${personB}&overdue=true&limit=10&date=2026-10-22`,
  ));
  assert.equal(tasksResponse.status, 200);
  assert.deepEqual(f.calls.tasks, [{
    personIds: [personA, personB], overdueOnly: true, limit: 10,
    cursor: undefined, now: new Date("2026-10-22T12:00:00.000Z"),
  }]);

  const recordsResponse = await records.GET(request(`records?windows=${encodeURIComponent(JSON.stringify(f.windows))}`));
  assert.equal(recordsResponse.status, 200);
  assert.deepEqual(f.calls.records, [{ windows: f.windows, cursor: undefined }]);

  const recapsResponse = await recaps.GET(request(`recaps?latest=true&windows=${encodeURIComponent(JSON.stringify(f.windows))}`));
  assert.equal(recapsResponse.status, 200);
  assert.deepEqual(f.calls.recaps, [{ windows: f.windows, latest: true, cursor: undefined }]);

  const detailResponse = await detail.GET(request(`recaps/${intervalA}`), { params: Promise.resolve({ intervalId: intervalA }) });
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(await detailResponse.json(), { schemaVersion: 1, recap: f.recap });
  const missing = await detail.GET(request(`recaps/${intervalB}`), { params: Promise.resolve({ intervalId: intervalB }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");

  f.state.denied = true;
  const denied = await people.GET(request("people"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(await denied.json(), { schemaVersion: 1, error: "forbidden" });
});
