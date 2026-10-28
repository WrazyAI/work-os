import assert from "node:assert/strict";
import test from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { decideReviewedRecap } from "../src/lib/work-os-reviewed-recaps";
import {
  access, admin2Access, admin2Membership, adminAccess, adminMembership, fixture, interval,
  newPerson, org, otherOrg, otherOrgAdminAccess, otherAdminMembership, otherPerson, person,
} from "./helpers/work-os-admin-otto-fixture.mts";

const service = () => import("../src/lib/work-os-admin-otto-preferences");

const conflict = (reason: string) => (error: unknown) =>
  error instanceof Error && error.name === "WorkOsConflictError"
  && (error as { reason?: string }).reason === reason;
const validation = (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError";

async function rows<T>(db: PGlite, sql: string, values?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}

async function clock(db: PGlite, organizationId = org): Promise<number> {
  const found = await rows<{ sequence: string | number | bigint }>(db,
    "select sequence from work_admin_otto_clock where organization_id = $1", [organizationId]);
  return found[0] ? Number(found[0].sequence) : 0;
}

type WindowRow = {
  person_id: string; access_epoch: string | number;
  start_sequence: string | number | bigint; end_sequence: string | number | bigint | null;
};

async function windows(db: PGlite, membershipId = adminMembership, organizationId = org) {
  const found = await rows<WindowRow>(db, `select person_id, access_epoch, start_sequence, end_sequence
    from work_admin_otto_follow_windows
    where organization_id = $1 and membership_id = $2
    order by person_id, start_sequence`, [organizationId, membershipId]);
  return found.map((row) => ({
    personId: row.person_id,
    accessEpoch: Number(row.access_epoch),
    start: Number(row.start_sequence),
    end: row.end_sequence === null ? null : Number(row.end_sequence),
  }));
}

const open = <T extends { end: number | null }>(rows: T[]) => rows.filter((row) => row.end === null);

async function preference(db: PGlite, membershipId = adminMembership) {
  const found = await rows<{
    mode: "all" | "selected"; selected_person_ids: string[]; revision: number | string;
    access_epoch: number | string; activated_sequence: string | number | bigint | null; active: boolean;
  }>(db, `select mode, selected_person_ids, revision, access_epoch, activated_sequence, active
    from work_admin_otto_preferences where organization_id = $1 and membership_id = $2`, [org, membershipId]);
  return found[0];
}

const at = (sequence: number, start: number, end: number | null) =>
  sequence >= start && (end === null || sequence < end);

test("defaults_all_and_includes_new_active_people", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, getAdminOttoPreferences } = await service();
    assert.deepEqual(await getAdminOttoPreferences(adminAccess),
      { mode: "all", personIds: [], revision: 0, activated: false });
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_preferences"), []);

    assert.deepEqual(await initializeAdminOtto(adminAccess),
      { mode: "all", personIds: [], revision: 0, activated: true });
    assert.equal(await clock(f.db), 1);
    assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 1, end: null }]);

    await f.db.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'New Hire',true)",
      [newPerson, org]);
    assert.equal(await clock(f.db), 2);
    assert.deepEqual((await open(await windows(f.db))).map((w) => [w.personId, w.start]),
      [[person, 1], [newPerson, 2]], "All follows the new active person from their own activation boundary");

    const reconnected = await preference(f.db);
    assert.deepEqual(await initializeAdminOtto(adminAccess),
      { mode: "all", personIds: [], revision: 0, activated: true });
    assert.equal(await clock(f.db), 2, "a normal reconnect keeps the epoch and watermark");
    assert.deepEqual(await preference(f.db), reconnected);
  } finally { await f.close(); }
});

test("explicit_empty_means_none", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    assert.deepEqual(await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 }),
    { mode: "selected", personIds: [], revision: 1, activated: true });
    assert.equal(await clock(f.db), 2);
    assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 1, end: 2 }]);
    assert.deepEqual(await open(await windows(f.db)), []);

    await f.db.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'New Hire',true)",
      [newPerson, org]);
    assert.equal(await clock(f.db), 2, "a new hire is not silently added to an explicit empty selection");
    assert.deepEqual(await open(await windows(f.db)), []);
  } finally { await f.close(); }
});

test("preferences_are_personal_and_org_bound", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, getAdminOttoPreferences, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await initializeAdminOtto(admin2Access);
    await initializeAdminOtto(otherOrgAdminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 });

    assert.deepEqual(await getAdminOttoPreferences(admin2Access),
      { mode: "all", personIds: [], revision: 0, activated: true }, "another admin keeps their own defaults");
    assert.deepEqual(await getAdminOttoPreferences(otherOrgAdminAccess),
      { mode: "all", personIds: [], revision: 0, activated: true });
    assert.deepEqual((await open(await windows(f.db, admin2Membership))).map((w) => w.personId), [person]);
    assert.deepEqual((await open(await windows(f.db, otherAdminMembership, otherOrg))).map((w) => w.personId),
      [otherPerson]);
    assert.equal((await preference(f.db, admin2Membership)).revision, 0);
    assert.deepEqual((await preference(f.db, adminMembership)).selected_person_ids, [person]);

    await assert.rejects(getAdminOttoPreferences(access), conflict("otto_access_revoked"));
    const forged = {
      ...adminAccess,
      membershipId: admin2Membership,
    };
    await assert.rejects(getAdminOttoPreferences(forged), conflict("otto_access_revoked"),
      "another user's membership is not a silent default");
    await assert.rejects(initializeAdminOtto(forged), conflict("otto_access_revoked"),
      "the membership must belong to the authenticated user");
  } finally { await f.close(); }
});

test("refollow_opens_fresh_window", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await decideReviewedRecap(access, interval, { action: "confirm" }); // sequence 2
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 }); // sequence 3 closes the window
    await decideReviewedRecap(access, interval, { action: "amend", feedback: "During unfollow", expectedReviewVersion: 1 }); // sequence 4
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 1 }); // sequence 5 opens a fresh window

    assert.equal(await clock(f.db), 5);
    assert.deepEqual(await windows(f.db), [
      { personId: person, accessEpoch: 1, start: 1, end: 3 },
      { personId: person, accessEpoch: 1, start: 5, end: null },
    ]);
    const events = await rows<{ version: number; event_sequence: string | number | bigint }>(f.db,
      "select version, event_sequence from work_recap_reviews order by version");
    assert.deepEqual(events.map((event) => Number(event.event_sequence)), [2, 4]);
    assert.equal(at(2, 1, 3), true);
    assert.equal(at(4, 1, 3), false, "the unfollowed period is outside the closed window");
    assert.equal(at(4, 5, null), false, "refollowing does not replay the unfollowed review");
    assert.deepEqual((await preference(f.db)).selected_person_ids, [person]);
  } finally { await f.close(); }
});

test("reactivation_preserves_choice_without_backfill", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await initializeAdminOtto(admin2Access);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // sequence 3
    await f.db.query("update work_people set active = false where id = $1", [person]); // sequence 4
    await decideReviewedRecap(access, interval,
      { action: "confirm" }); // sequence 5, during the inactive period
    await f.db.query("update work_people set active = true where id = $1", [person]); // sequence 6

    assert.equal((await preference(f.db)).mode, "selected");
    assert.deepEqual((await preference(f.db)).selected_person_ids, [person]);
    for (const membershipId of [adminMembership, admin2Membership]) {
      assert.deepEqual(await windows(f.db, membershipId), [
        { personId: person, accessEpoch: 1, start: membershipId === adminMembership ? 1 : 2, end: 4 },
        { personId: person, accessEpoch: 1, start: 6, end: null },
      ]);
    }
    const events = await rows<{ event_sequence: string | number | bigint }>(f.db,
      "select event_sequence from work_recap_reviews order by version");
    assert.equal(at(Number(events[0].event_sequence), 6, null), false,
      "a review committed while the employee was inactive is not replayed");
  } finally { await f.close(); }
});

test("role_or_feature_reenable_gets_fresh_epoch", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, getAdminOttoPreferences, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // sequence 2
    await f.db.query("update work_org_members set active = false where id = $1", [adminMembership]); // sequence 3

    await assert.rejects(getAdminOttoPreferences(adminAccess), conflict("otto_access_revoked"));
    const disabled = await preference(f.db);
    assert.equal(disabled.active, false);
    assert.equal(disabled.activated_sequence, null);
    assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 1, end: 3 }]);
    assert.equal(disabled.access_epoch, 1);

    await decideReviewedRecap(access, interval,
      { action: "amend", feedback: "Disabled period", expectedReviewVersion: 0 }); // sequence 4
    await f.db.query("update work_org_members set active = true where id = $1", [adminMembership]);
    assert.equal(await clock(f.db), 4, "restored access waits for an explicit POST context");
    assert.equal((await preference(f.db)).active, false);

    const restored = await initializeAdminOtto(adminAccess); // sequence 5
    assert.deepEqual(restored, { mode: "selected", personIds: [person], revision: 1, activated: true });
    assert.equal((await preference(f.db)).access_epoch, 2);
    assert.deepEqual(await windows(f.db), [
      { personId: person, accessEpoch: 1, start: 1, end: 3 },
      { personId: person, accessEpoch: 2, start: 5, end: null },
    ]);
    assert.equal(at(4, 5, null), false, "reviews from the disabled period do not become catch-up alerts");
  } finally { await f.close(); }
});

test("admin_role_demotion_closes_and_repromotion_waits_for_post", async () => {
  for (const role of ["employee", "manager"] as const) {
    const f = await fixture();
    try {
      const { initializeAdminOtto, getAdminOttoPreferences } = await service();
      await initializeAdminOtto(adminAccess); // sequence 1
      await f.db.query("update work_org_members set role = $2 where id = $1",
        [adminMembership, role]); // sequence 2
      const demoted = await preference(f.db);
      assert.equal(demoted.active, false);
      assert.equal(demoted.activated_sequence, null);
      assert.equal(demoted.access_epoch, 1);
      assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 1, end: 2 }]);
      await assert.rejects(getAdminOttoPreferences(adminAccess), conflict("otto_access_revoked"));

      await f.db.query("update work_org_members set role = 'admin' where id = $1", [adminMembership]);
      assert.equal(await clock(f.db), 2, "restoring the admin role waits for POST");
      assert.equal((await preference(f.db)).active, false);

      const restored = await initializeAdminOtto(adminAccess); // sequence 3
      assert.equal(restored.activated, true);
      assert.equal((await preference(f.db)).access_epoch, 2);
      assert.deepEqual(await windows(f.db), [
        { personId: person, accessEpoch: 1, start: 1, end: 2 },
        { personId: person, accessEpoch: 2, start: 3, end: null },
      ]);
    } finally { await f.close(); }
  }
});

test("org_feature_disable_and_restore_respects_member_override", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, getAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess); // sequence 1
    await initializeAdminOtto(admin2Access); // sequence 2
    await f.db.query(`update work_org_members set feature_flags = '{"employee_companion":true}' where id = $1`,
      [admin2Membership]);

    await f.db.query(`update work_organizations set feature_flags = '{"employee_companion":false}' where id = $1`,
      [org]); // sequence 3 closes only members without an override
    await assert.rejects(getAdminOttoPreferences(adminAccess), conflict("otto_access_revoked"));
    assert.deepEqual(await getAdminOttoPreferences(admin2Access),
      { mode: "all", personIds: [], revision: 0, activated: true });
    assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 1, end: 3 }]);
    assert.deepEqual((await open(await windows(f.db, admin2Membership))).map((w) => w.personId), [person]);

    await decideReviewedRecap(access, interval, { action: "confirm" }); // sequence 4
    await f.db.query(`update work_organizations set feature_flags = '{"employee_companion":true}' where id = $1`, [org]);
    assert.equal(await clock(f.db), 4, "restoration does not activate without a POST context");

    const restored = await initializeAdminOtto(adminAccess); // sequence 5
    assert.equal(restored.activated, true);
    assert.equal((await preference(f.db)).access_epoch, 2);
    assert.deepEqual(await windows(f.db), [
      { personId: person, accessEpoch: 1, start: 1, end: 3 },
      { personId: person, accessEpoch: 2, start: 5, end: null },
    ]);
    await initializeAdminOtto(admin2Access);
    assert.deepEqual((await open(await windows(f.db, admin2Membership))).map((w) => [w.start, w.accessEpoch]),
      [[2, 1]], "a member override keeps its window across an org-wide disable");
    assert.equal(at(4, 5, null), false);
    assert.equal(at(4, 2, null), true);

    await f.db.query(`update work_org_members set feature_flags = '{"employee_companion":false}' where id = $1`,
      [admin2Membership]); // sequence 6
    assert.equal((await preference(f.db, admin2Membership)).active, false);
    assert.deepEqual(await windows(f.db, admin2Membership), [
      { personId: person, accessEpoch: 1, start: 2, end: 6 },
    ]);
    assert.deepEqual((await open(await windows(f.db))).map((w) => w.start), [5],
      "one member's override never closes another member's windows");
  } finally { await f.close(); }
});

test("stale_pref_save_conflicts", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // revision 1, sequence 2
    const before = await preference(f.db);
    const windowsBefore = await windows(f.db);

    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 }), conflict("preferences_conflict"));
    assert.deepEqual(await preference(f.db), before);
    assert.deepEqual(await windows(f.db), windowsBefore);
    assert.equal(await clock(f.db), 2, "a rejected save does not advance the follow watermark");

    assert.deepEqual(await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 1 }),
    { mode: "selected", personIds: [person], revision: 2, activated: true });
  } finally { await f.close(); }
});

test("first_activation_excludes_history", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await service();
    await decideReviewedRecap(access, interval, { action: "confirm" }); // historical sequence 1
    await initializeAdminOtto(adminAccess); // activation sequence 2
    await decideReviewedRecap(access, interval,
      { action: "amend", feedback: "After activation", expectedReviewVersion: 1 }); // sequence 3

    const events = await rows<{ event_sequence: string | number | bigint }>(f.db,
      "select event_sequence from work_recap_reviews order by version");
    assert.deepEqual(events.map((event) => Number(event.event_sequence)), [1, 3]);
    assert.deepEqual(await windows(f.db), [{ personId: person, accessEpoch: 1, start: 2, end: null }]);
    assert.equal(at(Number(events[0].event_sequence), 2, null), false,
      "a review committed before first activation is not an arrival");
    assert.equal(at(Number(events[1].event_sequence), 2, null), true,
      "a review committed after activation is eligible");
  } finally { await f.close(); }
});

test("save_requires_activation_and_get_is_read_only", async () => {
  const f = await fixture();
  try {
    const { getAdminOttoPreferences, saveAdminOttoPreferences } = await service();
    assert.deepEqual(await getAdminOttoPreferences(adminAccess),
      { mode: "all", personIds: [], revision: 0, activated: false });
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_preferences"), []);
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_follow_windows"), []);
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_clock"), []);

    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 }), conflict("otto_context_required"));
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_preferences"), []);
    assert.deepEqual(await rows(f.db, "select * from work_admin_otto_follow_windows"), []);
    assert.equal(await clock(f.db), 0);
  } finally { await f.close(); }
});

test("unknown_or_foreign_selection_rejected_without_saving", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 });
    const before = await preference(f.db);
    const windowsBefore = await windows(f.db);

    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [otherPerson], expectedRevision: 1 }), validation);
    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: ["not-a-uuid"], expectedRevision: 1 }), validation);
    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: ["20000000-0000-4000-8000-0000000000ff"], expectedRevision: 1 }), validation);
    await assert.rejects(saveAdminOttoPreferences(adminAccess,
      { mode: "all", personIds: [person], expectedRevision: 1.5 }), validation);
    assert.deepEqual(await preference(f.db), before, "a directory/selection failure preserves prior choices");
    assert.deepEqual(await windows(f.db), windowsBefore);
    assert.equal(await clock(f.db), 2);

    assert.deepEqual(await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person, person], expectedRevision: 1 }),
    { mode: "selected", personIds: [person], revision: 2, activated: true });
  } finally { await f.close(); }
});

test("previously_selected_inactive_id_can_be_resaved", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess); // sequence 1
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // sequence 2
    await f.db.query("update work_people set active = false where id = $1", [person]); // sequence 3

    const resaved = await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 1 }); // sequence 4
    assert.deepEqual(resaved,
      { mode: "selected", personIds: [person], revision: 2, activated: true });
    assert.deepEqual(await open(await windows(f.db)), [],
      "a previously selected inactive id is accepted without opening a window");

    await f.db.query("update work_people set active = true where id = $1", [person]); // sequence 5
    assert.deepEqual((await open(await windows(f.db))).map((w) => [w.personId, w.start, w.accessEpoch]),
      [[person, 5, 1]]);
  } finally { await f.close(); }
});

test("all_includes_a_mapped_admin_employee_record", async () => {
  const f = await fixture();
  try {
    const adminPerson = "20000000-0000-4000-8000-000000000014";
    await f.db.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'Admin Employee',true)",
      [adminPerson, org]);
    await f.db.query("update work_org_members set person_id = $1 where id = $2",
      [adminPerson, adminMembership]);

    const { initializeAdminOtto } = await service();
    await initializeAdminOtto(adminAccess);
    assert.deepEqual((await open(await windows(f.db))).map((w) => w.personId).sort(),
      [person, adminPerson].sort(), "All follows mapped admins who have an active employee record");
  } finally { await f.close(); }
});

test("trigger_only_relevant_columns", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // sequence 2
    const before = await preference(f.db);
    const windowsBefore = await windows(f.db);

    await f.db.query(`update work_org_members set ui_state = '{"panel":"follows"}' where id = $1`, [adminMembership]);
    await f.db.query(`update work_org_members set feature_flags = '{"unrelated":true}' where id = $1`, [adminMembership]);
    await f.db.query("update work_people set display_name = 'Renamed' where id = $1", [person]);
    await f.db.query(`update work_organizations set feature_flags = '{"employee_companion":true,"unrelated":true}' where id = $1`,
      [org]);
    await f.db.query(`update work_org_members set feature_flags = '{"employee_companion":true}' where id = $1`,
      [adminMembership]);

    assert.equal(await clock(f.db), 2, "only relevant lifecycle columns advance the clock");
    assert.deepEqual(await preference(f.db), before);
    assert.deepEqual(await windows(f.db), windowsBefore);
  } finally { await f.close(); }
});

test("new_hire_selected_not_added_all_switch_includes", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await service();
    await initializeAdminOtto(adminAccess);
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 }); // sequence 2
    await f.db.query("insert into work_people (id, organization_id, display_name, active) values ($1,$2,'New Hire',true)",
      [newPerson, org]);
    assert.equal(await clock(f.db), 2, "a new hire is not silently followed in Selected mode");
    assert.deepEqual((await open(await windows(f.db))).map((w) => w.personId), [person]);

    await saveAdminOttoPreferences(adminAccess,
      { mode: "all", personIds: [person], expectedRevision: 1 }); // sequence 3
    assert.deepEqual((await open(await windows(f.db))).map((w) => [w.personId, w.start]),
      [[person, 1], [newPerson, 3]], "All follows every active person, including a new hire");

    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 2 }); // sequence 4
    assert.deepEqual(await windows(f.db), [
      { personId: person, accessEpoch: 1, start: 1, end: null },
      { personId: newPerson, accessEpoch: 1, start: 3, end: 4 },
    ]);
  } finally { await f.close(); }
});
