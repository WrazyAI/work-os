import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";
import ts from "typescript";
import type { PGlite } from "@electric-sql/pglite";
import {
  admin2Access, admin2Membership, adminAccess, adminMembership, fixture, migration,
  newPerson, org, person, prerequisites,
} from "./helpers/work-os-admin-otto-fixture.mts";

const service = () => import("../src/lib/work-os-admin-otto-inbox");
const preferences = () => import("../src/lib/work-os-admin-otto-preferences");

const conflict = (reason: string) => (error: unknown) =>
  error instanceof Error && error.name === "WorkOsConflictError"
  && (error as { reason?: string }).reason === reason;
const validation = (error: unknown) => error instanceof Error && error.name === "WorkOsValidationError";

type Db = Pick<PGlite, "query">;

async function rows<T>(db: Db, sql: string, values?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}

async function nextSequence(db: Db, organizationId = org): Promise<number> {
  await db.query(`insert into work_admin_otto_clock (organization_id, sequence)
    values ($1, 0) on conflict (organization_id) do nothing`, [organizationId]);
  const found = await rows<{ sequence: string | number | bigint }>(db,
    "update work_admin_otto_clock set sequence = sequence + 1 where organization_id = $1 returning sequence",
    [organizationId]);
  return Number(found[0].sequence);
}

async function seedInterval(db: Db, input: {
  personId?: string; windowStart?: string; windowEnd?: string; reviewedAt?: string;
} = {}) {
  const id = randomUUID();
  const start = input.windowStart ?? "2026-10-22T09:00:00.000Z";
  const end = input.windowEnd ?? "2026-10-22T10:00:00.000Z";
  await db.query(`insert into work_activity_intervals
    (id, organization_id, person_id, headline, ai_detail, final_detail, structured_summary,
     source_hash, window_start, window_end, generated_at, review_status, reviewed_at)
    values ($1,$2,$3,'Headline','Detail','Detail','{"activities":[]}','source',$4,$5,$6,'confirmed',$6)`,
  [id, org, input.personId ?? person, start, end, input.reviewedAt ?? end]);
  return id;
}

function recapFor(input: {
  intervalId: string; eventId: string; personId?: string; version?: number;
  reviewedAt: string; displayName?: string; headline?: string; detail?: string;
  reviewStatus?: "confirmed" | "amended"; employeeFeedback?: string | null;
}) {
  return {
    intervalId: input.intervalId,
    eventId: input.eventId,
    person: {
      id: input.personId ?? person,
      displayName: input.displayName ?? "Ada",
      active: true,
      timezone: "UTC",
    },
    reviewVersion: input.version ?? 1,
    reviewKey: `review-key-${input.intervalId}-${input.version ?? 1}`,
    sourceRevision: 1,
    scriptHash: `script-${input.version ?? 1}`,
    reviewStatus: input.reviewStatus ?? "confirmed",
    reviewedAt: input.reviewedAt,
    windowStart: "2026-10-22T09:00:00.000Z",
    windowEnd: "2026-10-22T10:00:00.000Z",
    timezone: "UTC",
    original: {
      headline: input.headline ?? "Headline",
      detail: input.detail ?? "Detail",
      activities: ["Reviewed the queue"],
    },
    employeeFeedback: input.employeeFeedback ?? null,
    speechLines: [{ text: input.headline ?? "Headline", time: null }],
    coverage: ["AI-inferred activity, employee reviewed; not task completion or attendance."],
  };
}

async function seedEvent(db: Db, input: {
  intervalId?: string; personId?: string; version?: number; sequence?: number;
  reviewedAt?: string; eligible?: boolean; displayName?: string;
  headline?: string; detail?: string; reviewStatus?: "confirmed" | "amended";
  employeeFeedback?: string | null;
} = {}) {
  const intervalId = input.intervalId ?? await seedInterval(db, { personId: input.personId });
  const eventId = randomUUID();
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const sequence = input.sequence ?? await nextSequence(db);
  const payload = recapFor({
    intervalId, eventId, personId: input.personId, version: input.version ?? 1,
    reviewedAt, displayName: input.displayName, headline: input.headline,
    detail: input.detail, reviewStatus: input.reviewStatus,
    employeeFeedback: input.employeeFeedback,
  });
  await db.query(`insert into work_recap_reviews
    (id, organization_id, interval_id, person_id, version, event_sequence, review_key,
     source_revision, content_hash, script_hash, payload, reviewed_at, arrival_eligible)
    values ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10::jsonb,$11,$12)`,
  [eventId, org, intervalId, input.personId ?? person, input.version ?? 1, sequence,
    payload.reviewKey, `content-${eventId}`, payload.scriptHash, JSON.stringify(payload),
    reviewedAt, input.eligible ?? true]);
  return eventId;
}

async function preferenceState(db: Db, membershipId = adminMembership) {
  return (await rows<{
    active: boolean; access_epoch: number; materialized_through_sequence: string | number | bigint;
    mode: string; selected_person_ids: string[];
  }>(db, `select active, access_epoch, materialized_through_sequence, mode, selected_person_ids
    from work_admin_otto_preferences where organization_id = $1 and membership_id = $2`,
  [org, membershipId]))[0];
}

async function deliveryRows(db: Db, membershipId = adminMembership) {
  return rows<{
    event_id: string; seen_at: string | Date | null; listened_at: string | Date | null;
    dismissed_at: string | Date | null; presented_at: string | Date | null;
    superseded_at: string | Date | null; lease_token: string | null; lease_until: string | Date | null;
    device_id: string | null; window_id: string | null;
  }>(db, `select event_id, seen_at, listened_at, dismissed_at, presented_at, superseded_at,
      lease_token, lease_until, device_id, window_id
    from work_admin_otto_deliveries where organization_id = $1 and membership_id = $2
    order by event_id`, [org, membershipId]);
}

test("late_materialization_uses_event_time_follow_window", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess); // window starts at sequence 1
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 }); // no person followed, closes at 2
    const beforeInterval = await seedInterval(f.db);
    const before = await seedEvent(f.db, { intervalId: beforeInterval }); // sequence 3, unfollowed
    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 1 }); // fresh window at 4
    const afterInterval = await seedInterval(f.db);
    const after = await seedEvent(f.db, { intervalId: afterInterval }); // sequence 5, followed

    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [after],
      "materialization judges the event at its own commit sequence, not at materialization time");
    assert.equal(page.total, 1);
    assert.equal(page.catchupPending, false);
    assert.deepEqual((await deliveryRows(f.db)).map((row) => row.event_id), [after]);
    assert.ok(!page.items.some((item) => item.recap.eventId === before));
  } finally { await f.close(); }
});

test("same_timestamp_events_not_skipped", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const reviewedAt = "2026-10-22T12:00:00.000Z";
    const firstInterval = await seedInterval(f.db);
    const secondInterval = await seedInterval(f.db);
    const first = await seedEvent(f.db, { intervalId: firstInterval, reviewedAt });
    const second = await seedEvent(f.db, { intervalId: secondInterval, reviewedAt });

    const pageOne = await inbox.listAdminRecapInbox(adminAccess, { limit: 1 });
    assert.equal(pageOne.total, 2);
    assert.deepEqual(pageOne.items.map((item) => item.recap.eventId), [second],
      "equal reviewed timestamps still order by committed sequence");
    assert.ok(pageOne.nextCursor);

    const pageTwo = await inbox.listAdminRecapInbox(adminAccess, { cursor: pageOne.nextCursor!, limit: 1 });
    assert.deepEqual(pageTwo.items.map((item) => item.recap.eventId), [first]);
    assert.equal(pageTwo.nextCursor, null);
  } finally { await f.close(); }
});

test("more_than_100_same_timestamp_events_are_not_skipped", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const reviewedAt = "2026-10-22T13:00:00.000Z";
    const eventIds: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      eventIds.push(await seedEvent(f.db, {
        intervalId: await seedInterval(f.db), reviewedAt,
      }));
    }

    const firstBatch = await inbox.listAdminRecapInbox(adminAccess, { limit: 100 });
    assert.equal(firstBatch.catchupPending, true);
    const secondBatch = await inbox.listAdminRecapInbox(adminAccess, { limit: 100 });
    assert.equal(secondBatch.catchupPending, false);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await inbox.listAdminRecapInbox(adminAccess, { cursor, limit: 12 });
      assert.equal(page.total, 105);
      seen.push(...page.items.map((item) => item.recap.eventId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 105);
    assert.deepEqual(new Set(seen), new Set(eventIds),
      "identical review timestamps never collapse or skip a committed sequence");

    const firstLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    const secondLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.equal(firstLease?.eventIds.length, 100);
    assert.equal(secondLease?.eventIds.length, 5);
    assert.deepEqual(new Set([...firstLease!.eventIds, ...secondLease!.eventIds]), new Set(eventIds));
  } finally { await f.close(); }
});

test("ascending_catchup_does_not_skip_page_two", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventIds: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      const intervalId = await seedInterval(f.db);
      eventIds.push(await seedEvent(f.db, { intervalId }));
    }

    const firstBatch = await inbox.listAdminRecapInbox(adminAccess, { limit: 100 });
    assert.equal(firstBatch.catchupPending, true, "only one 100-event batch materializes per request");
    const secondBatch = await inbox.listAdminRecapInbox(adminAccess, { limit: 100 });
    assert.equal(secondBatch.catchupPending, false);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await inbox.listAdminRecapInbox(adminAccess, { cursor, limit: 12 });
      assert.equal(page.total, 105);
      seen.push(...page.items.map((item) => item.recap.eventId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 105);
    assert.equal(new Set(seen).size, 105, "no event is dropped or duplicated across pages");
    assert.deepEqual(new Set(seen), new Set(eventIds));
    assert.doesNotMatch(JSON.stringify(secondBatch.items),
      /raw_image|rawImage|storage_path|screenshot|provider_payload/i,
      "the inbox projection carries no raw images, storage paths or provider payloads");

    const firstLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.equal(firstLease?.eventIds.length, 100, "a lease claims at most 100 events");
    const secondLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.equal(secondLease?.eventIds.length, 5);
    assert.equal(new Set([...firstLease!.eventIds, ...secondLease!.eventIds]).size, 105);
    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: firstLease!.eventIds, action: "release", leaseToken: firstLease!.token });
    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: secondLease!.eventIds, action: "release", leaseToken: secondLease!.token });
  } finally { await f.close(); }
});

test("superseded_versions_collapse_before_delivery", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const intervalId = await seedInterval(f.db);
    const first = await seedEvent(f.db, { intervalId, version: 1 });

    const before = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(before.items.map((item) => item.recap.eventId), [first]);

    const corrected = await seedEvent(f.db, { intervalId, version: 2 });
    const after = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(after.items.map((item) => item.recap.eventId), [corrected]);
    assert.equal(after.items[0].recap.reviewVersion, 2);
    assert.equal(after.total, 1, "an unpresented superseded version collapses before delivery");

    const deliveries = await deliveryRows(f.db);
    assert.notEqual(deliveries.find((row) => row.event_id === first)?.superseded_at, null);
    assert.equal(deliveries.find((row) => row.event_id === corrected)?.superseded_at, null);

    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [corrected], "the superseded version is never claimed");
  } finally { await f.close(); }
});

test("presented_v1_then_correction_keeps_both_immutable_versions_in_history", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const intervalId = await seedInterval(f.db);
    const first = await seedEvent(f.db, {
      intervalId, version: 1, headline: "Original headline", detail: "Original detail",
    });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [first]);
    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [first], action: "presented", leaseToken: lease!.token });
    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [first], action: "seen" });

    const corrected = await seedEvent(f.db, {
      intervalId, version: 2, headline: "Corrected headline", detail: "Corrected detail",
      reviewStatus: "amended", employeeFeedback: "The correction",
    });
    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [corrected, first],
      "a delivered version is not superseded by a later correction");
    assert.equal(page.total, 2);
    assert.equal(page.unread, 1, "the presented and seen v1 stays read; v2 is unread");
    assert.equal(page.items[0].recap.original.headline, "Corrected headline");
    assert.equal(page.items[1].recap.original.headline, "Original headline",
      "the historical card keeps its immutable stored words instead of reloading v2");
    assert.equal(page.items[1].recap.reviewVersion, 1);
    assert.equal(page.items[1].seenAt !== null, true);
    assert.equal((await deliveryRows(f.db)).find((row) => row.event_id === first)?.superseded_at, null);

    const nextLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.deepEqual(nextLease?.eventIds, [corrected], "only the new correction is delivered");
  } finally { await f.close(); }
});

test("claim_then_unfollow_denies_presented_without_a_receipt", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [eventId]);

    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [], expectedRevision: 0 });
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [eventId], action: "presented", leaseToken: lease!.token }),
    conflict("delivery_lease_invalid"));
    const delivery = (await deliveryRows(f.db))[0];
    assert.equal(delivery.presented_at, null, "an unfollowed item leaves no presentation receipt");
    assert.equal(delivery.lease_token, lease!.token, "the failed atomic ack leaves expiry as recovery");
    assert.deepEqual((await inbox.listAdminRecapInbox(adminAccess, {})).items, []);
  } finally { await f.close(); }
});

test("claim_then_person_deactivation_denies_presented", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    await f.db.query("update work_people set active = false where id = $1", [person]);

    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [eventId], action: "presented", leaseToken: lease!.token }),
    conflict("delivery_lease_invalid"));
    assert.equal((await deliveryRows(f.db))[0].presented_at, null);
    assert.deepEqual((await inbox.listAdminRecapInbox(adminAccess, {})).items, []);
  } finally { await f.close(); }
});

test("claim_v1_then_correction_denies_stale_presented_and_collapses_pending_v1", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const intervalId = await seedInterval(f.db);
    const first = await seedEvent(f.db, { intervalId, version: 1, headline: "Original headline" });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [first]);

    const corrected = await seedEvent(f.db, {
      intervalId, version: 2, headline: "Corrected headline", reviewStatus: "amended",
      employeeFeedback: "The correction",
    });
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [first], action: "presented", leaseToken: lease!.token }),
    conflict("delivery_lease_invalid"),
    "a correction committed before the ack makes the old version ineligible");
    assert.equal((await deliveryRows(f.db)).find((row) => row.event_id === first)?.presented_at, null);

    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [corrected],
      "a pending superseded version still collapses before delivery");
    assert.equal(page.total, 1);
    assert.equal((await deliveryRows(f.db)).find((row) => row.event_id === first)?.superseded_at !== null, true);
    const nextLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.deepEqual(nextLease?.eventIds, [corrected]);
  } finally { await f.close(); }
});

test("claim_then_role_loss_denies_presented_as_revoked", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    await f.db.query("update work_org_members set role = 'employee' where id = $1", [adminMembership]);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [eventId], action: "presented", leaseToken: lease!.token }),
    conflict("otto_access_revoked"));
    assert.equal((await deliveryRows(f.db))[0].presented_at, null);
  } finally { await f.close(); }
});

test("seen_or_listened_items_are_not_claimed_for_transient_delivery", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const seen = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    const listened = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [seen], action: "seen" });
    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [listened], action: "listened" });

    assert.equal(await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" }), null,
    "an item already read or listened to in the inbox does not replay as a toast");
    const inboxPage = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.equal(inboxPage.total, 2, "seen/listened items remain in the inbox");
    assert.deepEqual(inboxPage.items.map((item) => item.recap.eventId), [listened, seen]);

    const fresh = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [fresh]);
  } finally { await f.close(); }
});

test("only_one_device_claims", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const first = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    const second = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});

    const before = Date.now();
    const laptop = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(laptop?.eventIds, [first, second]);
    assert.equal(laptop?.pendingCount, 2);
    assert.equal(typeof laptop?.token, "string");
    const expires = Date.parse(laptop!.expiresAt);
    assert.ok(expires - before >= 25_000 && expires - before <= 35_000, "the lease lasts 30 seconds");

    const phone = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.equal(phone, null, "a second device cannot claim an active lease");
    const rows = await deliveryRows(f.db);
    assert.ok(rows.every((row) => row.lease_token === laptop!.token && row.device_id === "laptop"));

    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: laptop!.eventIds, action: "release", leaseToken: laptop!.token });
    const recovered = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.deepEqual(recovered?.eventIds, [first, second]);
    assert.equal(recovered?.pendingCount, 2);

    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: recovered!.eventIds, action: "presented", leaseToken: recovered!.token });
    const presented = await deliveryRows(f.db);
    assert.ok(presented.every((row) => row.presented_at !== null));
    assert.ok(presented.every((row) => row.lease_token === null));
    assert.equal(await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "tablet", windowId: "main" }), null,
    "a successful presentation suppresses a duplicate toast");
  } finally { await f.close(); }
});

test("expired_claim_recoverable", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const first = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(first?.eventIds, [eventId]);

    await f.db.query(`update work_admin_otto_deliveries
      set lease_until = clock_timestamp() - interval '1 second' where lease_token = $1`, [first!.token]);
    const second = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.deepEqual(second?.eventIds, [eventId], "an expired lease is recoverable");
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [eventId], action: "presented", leaseToken: first!.token }),
    conflict("delivery_lease_invalid"));
    assert.equal((await deliveryRows(f.db))[0].presented_at, null,
      "an expired token cannot acknowledge presentation");
  } finally { await f.close(); }
});

test("thirty_day_age_uses_review_commit_not_interval_date", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    const recentWindow = await seedInterval(f.db, { windowStart: yesterday, windowEnd: yesterday });
    const oldReview = await seedEvent(f.db,
      { intervalId: recentWindow, reviewedAt: thirtyOneDaysAgo });
    const oldWindow = await seedInterval(f.db, { windowStart: fortyDaysAgo, windowEnd: fortyDaysAgo });
    const recentReview = await seedEvent(f.db, { intervalId: oldWindow, reviewedAt: yesterday });

    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [recentReview]);
    assert.equal(page.total, 1);
    const ids = (await deliveryRows(f.db)).map((row) => row.event_id);
    assert.ok(!ids.includes(oldReview), "an interval date cannot extend the 30-day arrival window");
    const lease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(lease?.eventIds, [recentReview], "old reviews are never claimed for a toast");
  } finally { await f.close(); }
});

test("unfollow_or_role_loss_hides_pending", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto, saveAdminOttoPreferences } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    await f.db.query(`insert into work_people (id, organization_id, display_name, active)
      values ($1,$2,'Grace',true)`, [newPerson, org]);
    const followedEvent = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    const secondPersonEvent = await seedEvent(f.db,
      { intervalId: await seedInterval(f.db, { personId: newPerson }), personId: newPerson, displayName: "Grace" });
    assert.equal((await inbox.listAdminRecapInbox(adminAccess, {})).total, 2);

    await saveAdminOttoPreferences(adminAccess,
      { mode: "selected", personIds: [person], expectedRevision: 0 });
    const afterUnfollow = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(afterUnfollow.items.map((item) => item.recap.eventId), [followedEvent]);
    const unfollowLease = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    assert.deepEqual(unfollowLease?.eventIds, [followedEvent], "an unfollowed person's pending item is hidden");

    const cursorBefore = Number((await preferenceState(f.db)).materialized_through_sequence);
    const deliveriesBefore = (await deliveryRows(f.db)).length;
    await f.db.query("update work_org_members set role = 'employee' where id = $1", [adminMembership]);
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, {}), conflict("otto_access_revoked"));
    assert.equal(Number((await preferenceState(f.db)).materialized_through_sequence), cursorBefore,
      "a denied read cannot consume the materialization cursor");
    assert.equal((await deliveryRows(f.db)).length, deliveriesBefore);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [secondPersonEvent], action: "seen" }), conflict("otto_access_revoked"));

    await f.db.query("update work_org_members set role = 'admin' where id = $1", [adminMembership]);
    await initializeAdminOtto(adminAccess); // fresh epoch after the lost role
    const restored = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(restored.items, [], "the previous epoch's pending arrivals are not replayed");
  } finally { await f.close(); }
});

test("inactive_person_hides_pending_without_deleting_history", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    assert.equal((await inbox.listAdminRecapInbox(adminAccess, {})).total, 1);

    await f.db.query("update work_people set active = false where id = $1", [person]);
    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items, [], "an inactive employee's pending arrival is hidden");
    assert.equal(await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" }), null);
    assert.equal((await deliveryRows(f.db)).length, 1,
      "the durable delivery stays for the audit trail instead of being deleted");
    assert.equal((await deliveryRows(f.db))[0].event_id, eventId);
  } finally { await f.close(); }
});

test("pre_retention_backlog_does_not_delay_a_retained_arrival", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    for (let index = 0; index < 105; index += 1) {
      await seedEvent(f.db, {
        intervalId: await seedInterval(f.db), reviewedAt: thirtyOneDaysAgo,
      });
    }
    const retained = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });

    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [retained],
      "a pre-retention prefix is skipped in one batch instead of delaying the retained event");
    assert.equal(page.catchupPending, false);
    assert.equal(page.total, 1);
  } finally { await f.close(); }
});

test("reactivation_does_not_scan_a_pre_activation_backlog", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    // Lose the role, accumulate a large ineligible backlog, then restore and
    // activate a fresh epoch. None of the backlog can be an arrival.
    await f.db.query("update work_org_members set role = 'employee' where id = $1", [adminMembership]);
    for (let index = 0; index < 105; index += 1) {
      await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    }
    await f.db.query("update work_org_members set role = 'admin' where id = $1", [adminMembership]);
    await initializeAdminOtto(adminAccess);
    const fresh = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });

    const page = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(page.items.map((item) => item.recap.eventId), [fresh],
      "the first request after reactivation reaches the fresh event without draining stale batches");
    assert.equal(page.catchupPending, false);
    assert.equal(page.total, 1);
  } finally { await f.close(); }
});

test("seen_listened_and_dismiss_are_personal_and_separate", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    await initializeAdminOtto(admin2Access);
    const first = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    const second = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    assert.equal((await inbox.listAdminRecapInbox(adminAccess, {})).total, 2);
    assert.equal((await inbox.listAdminRecapInbox(admin2Access, {})).total, 2);

    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [first], action: "seen" });
    let delivery = (await deliveryRows(f.db)).find((row) => row.event_id === first)!;
    assert.ok(delivery.seen_at);
    assert.equal(delivery.listened_at, null, "seen is not listened");
    assert.equal(delivery.presented_at, null, "seen is not a presentation acknowledgement");

    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [first], action: "listened" });
    delivery = (await deliveryRows(f.db)).find((row) => row.event_id === first)!;
    assert.ok(delivery.seen_at);
    assert.ok(delivery.listened_at);

    await inbox.updateAdminRecapDelivery(adminAccess, { eventIds: [second], action: "dismissed" });
    const adminPage = await inbox.listAdminRecapInbox(adminAccess, {});
    assert.deepEqual(adminPage.items.map((item) => item.recap.eventId), [first]);
    assert.equal(adminPage.unread, 0, "the remaining item was already seen");
    const otherPage = await inbox.listAdminRecapInbox(admin2Access, {});
    assert.deepEqual(otherPage.items.map((item) => item.recap.eventId), [second, first]);
    assert.equal(otherPage.unread, 2, "dismiss affects only that admin's item");
    const otherDelivery = (await deliveryRows(f.db, admin2Membership))
      .find((row) => row.event_id === second)!;
    assert.equal(otherDelivery.dismissed_at, null);
  } finally { await f.close(); }
});

test("denied_get_cannot_consume_a_cursor_or_acknowledge", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(f.db, { intervalId: await seedInterval(f.db) });
    await f.db.query("update work_org_members set active = false where id = $1", [adminMembership]);
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, {}), conflict("otto_access_revoked"));
    assert.equal(Number((await preferenceState(f.db)).materialized_through_sequence), 0);
    assert.deepEqual(await deliveryRows(f.db), []);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [eventId], action: "presented", leaseToken: "forged" }), conflict("otto_access_revoked"));
    assert.deepEqual(await deliveryRows(f.db), []);
  } finally { await f.close(); }
});

test("inbox_validates_cursor_limit_claim_and_state_inputs", async () => {
  const f = await fixture();
  try {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, { cursor: "not-a-cursor" }), validation);
    const oversized = Buffer.from(JSON.stringify({
      v: 1, s: "1", pad: "x".repeat(5000),
    }), "utf8").toString("base64url");
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, { cursor: oversized }), validation,
      "an oversized cursor is rejected before decoding");
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, { limit: 101 }), validation);
    await assert.rejects(inbox.listAdminRecapInbox(adminAccess, { limit: 0 }), validation);
    await assert.rejects(inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "", windowId: "main" }), validation);
    await assert.rejects(inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "x".repeat(201) }), validation);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      // @ts-expect-error deliberately invalid action at the service boundary
      { eventIds: [randomUUID()], action: "played" }), validation);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: [], action: "seen" }), validation);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: ["not-a-uuid"], action: "seen" }), validation);
    await assert.rejects(inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: Array.from({ length: 101 }, () => randomUUID()), action: "seen" }), validation);
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------
// Route execution. Only external auth and the inbox service are stubbed; the
// real route modules, origin helper and wire wrapping execute.

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);

function routeFixture() {
  const calls = {
    list: [] as Array<{ cursor?: string; limit?: number }>,
    claim: [] as Array<{ deviceId: string; windowId: string }>,
    update: [] as Array<Record<string, unknown>>,
  };
  const state = { denied: false };
  const page = {
    items: [{
      deliveryId: "event-1",
      recap: recapFor({ intervalId: "interval-1", eventId: "event-1", reviewedAt: "2026-10-22T12:00:00.000Z" }),
      seenAt: null,
      listenedAt: null,
    }],
    nextCursor: "next-1",
    total: 1,
    asOf: "2026-10-22T12:00:01.000Z",
    coverage: ["Reviewed recap arrivals only."],
    unread: 1,
    catchupPending: false,
  };
  const lease = {
    token: "lease-token", expiresAt: "2026-10-22T12:00:31.000Z",
    eventIds: ["event-1"], pendingCount: 1,
  };
  const stubs: Record<string, unknown> = {
    "src/lib/work-os-admin-otto-access.ts": {
      requireAdminOttoAccess: async () => state.denied
        ? { response: Response.json({ error: "forbidden" }, { status: 403 }) }
        : { access: { organizationId: org, membershipId: adminMembership, role: "admin", ctx: { user: { id: randomUUID() } } } },
    },
    "src/lib/work-os-admin-otto-inbox.ts": {
      listAdminRecapInbox: async (_access: unknown, input: { cursor?: string; limit?: number }) => {
        calls.list.push(input);
        return page;
      },
      claimAdminRecapDelivery: async (_access: unknown, input: { deviceId: string; windowId: string }) => {
        calls.claim.push(input);
        return lease;
      },
      updateAdminRecapDelivery: async (_access: unknown, input: Record<string, unknown>) => {
        calls.update.push(input);
      },
    },
    "src/lib/work-os-api.ts": {
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
  return { calls, state, page, lease, load };
}

const routeRequest = (pathName: string, headers: Record<string, string> = {}, method = "GET", body?: unknown) =>
  new Request(`https://app.example.test/api/work-os/admin/otto/${pathName}`, {
    method,
    headers: { authorization: "Bearer local-session", "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test("inbox_routes_use_schema_version_no_store_and_expected_origin", async () => {
  const f = routeFixture();
  const inbox = f.load("src/app/api/work-os/admin/otto/inbox/route.ts");
  const claim = f.load("src/app/api/work-os/admin/otto/inbox/claim/route.ts");
  const state = f.load("src/app/api/work-os/admin/otto/inbox/state/route.ts");

  const get = await inbox.GET(routeRequest("inbox?cursor=abc&limit=12"));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.deepEqual(await get.json(), { schemaVersion: 1, ...f.page });
  assert.deepEqual(f.calls.list, [{ cursor: "abc", limit: 12 }]);

  const cookieDenied = await claim.POST(routeRequest("inbox/claim", { authorization: "" }, "POST",
    { deviceId: "laptop", windowId: "main" }));
  assert.equal(cookieDenied.status, 403);
  assert.equal(cookieDenied.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.claim.length, 0);
  const crossOrigin = await claim.POST(routeRequest("inbox/claim", {
    authorization: "", origin: "https://evil.example.test",
  }, "POST", { deviceId: "laptop", windowId: "main" }));
  assert.equal(crossOrigin.status, 403);
  const allowed = await claim.POST(routeRequest("inbox/claim", {
    authorization: "", origin: "https://app.example.test",
  }, "POST", { deviceId: "laptop", windowId: "main" }));
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { schemaVersion: 1, lease: f.lease });
  assert.deepEqual(f.calls.claim, [{ deviceId: "laptop", windowId: "main" }]);

  const bearer = await claim.POST(routeRequest("inbox/claim", {}, "POST",
    { deviceId: "phone", windowId: "avatar" }));
  assert.equal(bearer.status, 200, "native bearer keeps its no-origin contract");

  const eventId = "10000000-0000-4000-8000-0000000000aa";
  const stateDenied = await state.PUT(routeRequest("inbox/state", { authorization: "" }, "PUT",
    { eventIds: [eventId], action: "seen" }));
  assert.equal(stateDenied.status, 403);
  const stateAllowed = await state.PUT(routeRequest("inbox/state", {
    authorization: "", origin: "https://app.example.test",
  }, "PUT", { eventIds: [eventId], action: "seen" }));
  assert.equal(stateAllowed.status, 200);
  assert.deepEqual(await stateAllowed.json(), { schemaVersion: 1, ok: true });
  const stateBearer = await state.PUT(routeRequest("inbox/state", {}, "PUT",
    { eventIds: [eventId], action: "seen" }));
  assert.equal(stateBearer.status, 200, "native bearer state keeps its no-origin contract");
  assert.deepEqual(f.calls.update, [
    { eventIds: [eventId], action: "seen" },
    { eventIds: [eventId], action: "seen" },
  ]);

  f.state.denied = true;
  const denied = await inbox.GET(routeRequest("inbox"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(await denied.json(), { schemaVersion: 1, error: "forbidden" });
});

test("inbox_routes_reject_invalid_inputs_before_the_service", async () => {
  const f = routeFixture();
  const inbox = f.load("src/app/api/work-os/admin/otto/inbox/route.ts");
  const claim = f.load("src/app/api/work-os/admin/otto/inbox/claim/route.ts");
  const state = f.load("src/app/api/work-os/admin/otto/inbox/state/route.ts");

  for (const query of ["limit=0", "limit=101", "limit=abc", "cursor="]) {
    const response = await inbox.GET(routeRequest(`inbox?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.calls.list.length, 0);
  const oversized = Buffer.from(JSON.stringify({
    v: 1, s: "1", pad: "x".repeat(5000),
  }), "utf8").toString("base64url");
  const oversizedResponse = await inbox.GET(routeRequest(
    `inbox?cursor=${encodeURIComponent(oversized)}`));
  assert.equal(oversizedResponse.status, 400, "an oversized cursor is rejected at the route");
  assert.equal(f.calls.list.length, 0);

  for (const body of [null, [], {}, { deviceId: "", windowId: "main" }]) {
    const response = await claim.POST(routeRequest("inbox/claim", {}, "POST", body));
    assert.equal(response.status, 400);
  }
  const malformed = new Request("https://app.example.test/api/work-os/admin/otto/inbox/claim", {
    method: "POST",
    headers: { authorization: "Bearer local-session", "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await claim.POST(malformed)).status, 400);
  assert.equal(f.calls.claim.length, 0);

  for (const body of [
    null, {}, { eventIds: [], action: "seen" },
    { eventIds: ["event-1"], action: "played" },
    { eventIds: ["not-a-uuid"], action: "seen" },
  ]) {
    const response = await state.PUT(routeRequest("inbox/state", {}, "PUT", body));
    assert.equal(response.status, 400);
  }
  assert.equal(f.calls.update.length, 0);
});

// ---------------------------------------------------------------------------
// Opt-in genuine two-client PostgreSQL. These are skipped without a disposable
// loopback database and are the external gate, not proof from PGlite.

const disposableUrl = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";
const pgSkip = !disposableUrl || !optIn
  ? "Requires disposable loopback PostgreSQL with two connections; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1."
  : false;

async function withDisposableSchema(run: (pool: Pool) => Promise<void>) {
  const url = new URL(disposableUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Only a local disposable PostgreSQL fixture is permitted");
  const schema = `otto_inbox_${randomUUID().replaceAll("-", "")}`;
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

test("two_postgres_clients_cannot_claim_the_same_delivery", { skip: pgSkip }, async () => {
  await withDisposableSchema(async (pool) => {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventId = await seedEvent(pool, { intervalId: await seedInterval(pool) });
    await inbox.listAdminRecapInbox(adminAccess, {});
    const [left, right] = await Promise.all([
      inbox.claimAdminRecapDelivery(adminAccess, { deviceId: "laptop", windowId: "main" }),
      inbox.claimAdminRecapDelivery(adminAccess, { deviceId: "phone", windowId: "avatar" }),
    ]);
    assert.equal([left, right].filter((lease) => lease !== null).length, 1,
      "exactly one real connection wins the row lease");
    const owner = left ?? right!;
    assert.deepEqual(owner.eventIds, [eventId]);
    await inbox.updateAdminRecapDelivery(adminAccess,
      { eventIds: owner.eventIds, action: "release", leaseToken: owner.token });
    const recovered = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "tablet", windowId: "main" });
    assert.deepEqual(recovered?.eventIds, [eventId]);
  });
});

test("two_postgres_clients_materialize_without_duplicates_or_a_rewound_cursor", { skip: pgSkip }, async () => {
  await withDisposableSchema(async (pool) => {
    const { initializeAdminOtto } = await preferences();
    const inbox = await service();
    await initializeAdminOtto(adminAccess);
    const eventIds: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      eventIds.push(await seedEvent(pool, { intervalId: await seedInterval(pool) }));
    }
    await Promise.all([
      inbox.listAdminRecapInbox(adminAccess, { limit: 100 }),
      inbox.listAdminRecapInbox(adminAccess, { limit: 100 }),
    ]);
    const stored = await rows<{ event_id: string }>(pool,
      "select event_id from work_admin_otto_deliveries where organization_id = $1", [org]);
    assert.equal(stored.length, 150);
    assert.equal(new Set(stored.map((row) => row.event_id)).size, 150);
    const state = await preferenceState(pool);
    assert.equal(Number(state.materialized_through_sequence), eventIds.length + 1,
      "the cursor advances only through the last processed batch");

    const first = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "laptop", windowId: "main" });
    const second = await inbox.claimAdminRecapDelivery(adminAccess,
      { deviceId: "phone", windowId: "avatar" });
    assert.equal(first?.eventIds.length, 100);
    assert.equal(second?.eventIds.length, 50);
    assert.equal(new Set([...first!.eventIds, ...second!.eventIds]).size, 150);
  });
});
