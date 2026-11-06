import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fixture, org, person, scope } from "./helpers/work-os-ghl-fixture.mts";
import { ghlMappingRevision, loadGhlIdentities, persistGhlRecords } from "../src/lib/work-os-ghl-store";
import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import { eodGhlFactsFromActivity, formatGhlActivityBlock, ghlRecordedActivityAllowlist, listGhlActivity } from "../src/lib/work-os-ghl-activity";
import { encryptProviderSecret } from "../src/lib/work-os-secrets";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 8).toString("base64");
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/work-os-ghl.json", import.meta.url), "utf8"));

async function rows(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, sql: string, params?: unknown[]) {
  return (await db.query(sql, params)).rows as Array<Record<string, any>>;
}

async function seed() {
  const identities = await loadGhlIdentities(scope);
  const ctx = { scope, identities, observedAt: "2026-11-06T12:00:00.000Z" };
  const records = [
    ...normalizeGhlRecord("email", fixtures.manualEmail, ctx),
    ...normalizeGhlRecord("note", fixtures.sharedAccountNote, ctx),
    ...normalizeGhlRecord("appointment", fixtures.assignedOnlyAppointment, ctx),
  ];
  await persistGhlRecords(scope, records, ghlMappingRevision(identities));
  return identities;
}

test("personal projection includes only performed work for that person", async () => {
  const f = await fixture();
  try {
    await seed();
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items.length, 1);
    assert.equal(activity.items.every((item) => item.relation === "performed" && item.personId === person), true);
    assert.equal(activity.items[0]!.kind, "email");
  } finally {
    await f.close();
  }
});

test("organization context keeps shared, assigned-only and unknown activity visibly separate", async () => {
  const f = await fixture();
  try {
    await seed();
    const activity = await listGhlActivity({
      scope, personId: null, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: true,
    });
    const relations = new Set(activity.items.map((item) => item.relation));
    assert.equal(relations.has("performed"), true);
    assert.equal(relations.has("shared_account"), true);
    assert.equal(relations.has("assigned_only"), true);
    assert.equal(activity.items.every((item) => item.personId === null || item.personId === person), true);
  } finally {
    await f.close();
  }
});

test("the activity window is inclusive at the start and exclusive at the end", async () => {
  const f = await fixture();
  try {
    await seed();
    const included = await listGhlActivity({
      scope, personId: person, from: "2026-11-03T18:17:00.000Z", through: "2026-11-03T18:17:01.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(included.items.length, 1);
    const excluded = await listGhlActivity({
      scope, personId: person, from: "2026-11-03T18:17:01.000Z", through: "2026-11-03T18:18:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(excluded.items.length, 0);
  } finally {
    await f.close();
  }
});

test("the scan is bounded at 300 rows and reports that it was capped", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `insert into work_evidence_events
        (organization_id, provider, external_event_id, event_type, evidence_class, person_id, occurred_at, title, summary, metadata)
       select $1, 'ghl', 'bulk-' || n, 'note.created', 'output_evidence', $2,
              '2026-11-03T18:17:00Z'::timestamptz + (n || ' seconds')::interval,
              'Contact note added', 'Contact note recorded by GHL.',
              jsonb_build_object('ghl', jsonb_build_object('kind','note','action','created','relation','performed','occurredAt','2026-11-03T18:17:00Z','observedAt','2026-11-06T12:00:00Z','connectionId','${scope.connectionId}','locationId','${scope.locationId}'))
         from generate_series(1, 301) as n`,
      [org, person],
    );
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items.length, 300);
    assert.equal(activity.capped, true);
  } finally {
    await f.close();
  }
});

test("one logical email stays one fact after delivery-state updates and grounds the block", async () => {
  const f = await fixture();
  try {
    const identities = await seed();
    const updated = normalizeGhlRecord("email", { ...fixtures.manualEmail, status: "opened" }, {
      scope, identities, observedAt: "2026-11-06T12:05:00.000Z",
    });
    await persistGhlRecords(scope, updated, ghlMappingRevision(identities));
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items.filter((item) => item.kind === "email").length, 1);
    const block = formatGhlActivityBlock(activity);
    assert.match(block, /provider facts/);
    assert.match(block, /performed by the employee/);
    const allowlist = ghlRecordedActivityAllowlist(activity);
    assert.equal(allowlist.length, 1);
    assert.equal(allowlist[0]!.source, "ghl");
    assert.equal(allowlist[0]!.eventId, activity.items[0]!.eventId);
  } finally {
    await f.close();
  }
});

test("repeated appointment snapshots do not manufacture performed actions", async () => {
  const f = await fixture();
  try {
    const identities = await loadGhlIdentities(scope);
    const ctx = { scope, identities, observedAt: "2026-11-06T12:00:00.000Z" };
    const first = normalizeGhlRecord("appointment", fixtures.appointmentCreatedByUser, ctx);
    const second = normalizeGhlRecord("appointment", {
      ...fixtures.appointmentCreatedByUser,
      status: "rescheduled",
      dateUpdated: "2026-11-04T12:00:00.000Z",
    }, ctx);
    await persistGhlRecords(scope, [...first, ...second], ghlMappingRevision(identities));
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items.filter((item) => item.kind === "appointment").length, 1);
    assert.equal(eodGhlFactsFromActivity(activity).performed.appointment ?? 0, 0);
  } finally {
    await f.close();
  }
});

test("retracted evidence disappears from recap and EOD reads", async () => {
  const f = await fixture();
  try {
    await seed();
    await f.db.query("update work_evidence_events set correction_status = 'retracted' where provider = 'ghl'");
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items.length, 0);
  } finally {
    await f.close();
  }
});

test("expired email content is not exposed through the activity projection", async () => {
  const f = await fixture();
  try {
    await seed();
    const event = (await rows(f.db, "select id from work_evidence_events where provider = 'ghl' and person_id = $1", [person])).at(0)!;
    await f.db.query(
      `insert into work_ghl_email_content
        (organization_id, connection_id, evidence_event_id, content_hash, excerpt_cipher, observed_at, expires_at)
       values ($1,$2,$3,'hash',$4,'2026-11-03T18:17:00Z','2026-11-04T18:17:00Z')`,
      [org, scope.connectionId, event.id, encryptProviderSecret("expired excerpt")],
    );
    const activity = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.equal(activity.items[0]!.excerpt, null);
    assert.equal(formatGhlActivityBlock(activity).includes("expired excerpt"), false);
  } finally {
    await f.close();
  }
});
