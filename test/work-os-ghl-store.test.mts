import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  actorSam,
  fixture,
  person,
  scope,
  setIdentityRevision,
} from "./helpers/work-os-ghl-fixture.mts";

import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import { ghlMappingRevision, loadGhlIdentities, persistGhlRecords, reconcileGhlAttribution } from "../src/lib/work-os-ghl-store";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/work-os-ghl.json", import.meta.url), "utf8"));

async function rows(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, any>>;
}

async function context(scopeValue = scope) {
  const identities = await loadGhlIdentities(scopeValue);
  return { scope: scopeValue, identities, revision: ghlMappingRevision(identities), observedAt: "2026-11-06T12:00:00.000Z" };
}

test("persists one logical event and its personal mirror idempotently", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    const records = normalizeGhlRecord("email", fixtures.manualEmail, ctx);
    const first = await persistGhlRecords(scope, records, ctx.revision);
    const second = await persistGhlRecords(scope, records, ctx.revision);
    assert.equal(first.rejectedStaleMapping, false);
    assert.equal(second.rejectedStaleMapping, false);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events where provider = 'ghl'"))[0].n, 1);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence where source = 'ghl'"))[0].n, 1);
    const event = (await rows(f.db, "select person_id, metadata from work_evidence_events where provider = 'ghl'"))[0] as any;
    assert.equal(event.person_id, person);
    assert.equal(event.metadata.ghl.relation, "performed");
    assert.equal(event.metadata.ghl.actorId, actorSam);
    assert.equal(event.metadata.ghl.emailId, "msg-manual-1");
  } finally {
    await f.close();
  }
});

test("shared and automation records are retained without a personal mirror", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    const records = [
      ...normalizeGhlRecord("email", fixtures.workflowEmail, ctx),
      ...normalizeGhlRecord("note", fixtures.sharedAccountNote, ctx),
    ];
    await persistGhlRecords(scope, records, ctx.revision);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events where provider = 'ghl'"))[0].n, 2);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence where source = 'ghl'"))[0].n, 0);
    const relations = (await f.db.query("select metadata->'ghl'->>'relation' as relation from work_evidence_events order by relation")).rows.map((row: any) => row.relation);
    assert.deepEqual(relations, ["automation", "shared_account"]);
  } finally {
    await f.close();
  }
});

test("stale mapping revision rejects personal evidence", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    await setIdentityRevision(f.db, actorSam, "r2", true);
    const records = normalizeGhlRecord("email", fixtures.manualEmail, ctx);
    const result = await persistGhlRecords(scope, records, ctx.revision);
    assert.equal(result.rejectedStaleMapping, true);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence where source = 'ghl'"))[0].n, 0);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events where provider = 'ghl'"))[0].n, 0);
  } finally {
    await f.close();
  }
});

test("revoked mapping retracts a prior mirror while the organization event remains", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    await persistGhlRecords(scope, normalizeGhlRecord("email", fixtures.manualEmail, ctx), ctx.revision);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence"))[0].n, 1);
    await setIdentityRevision(f.db, actorSam, "r2", false);
    const result = await reconcileGhlAttribution(scope, actorSam);
    assert.equal(result.retracted, 1);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence"))[0].n, 0);
    const event = (await rows(f.db, "select person_id, metadata from work_evidence_events"))[0] as any;
    assert.equal(event.person_id, null);
    assert.equal(event.metadata.ghl.relation, "unknown");
  } finally {
    await f.close();
  }
});

test("a snapshot without provider time stays contextual and is not an occurrence", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    await persistGhlRecords(scope, normalizeGhlRecord("appointment", fixtures.appointmentWithoutTimestamps, ctx), ctx.revision);
    const event = (await rows(f.db, "select occurred_at, metadata from work_evidence_events"))[0] as any;
    assert.equal(event.metadata.ghl.occurredAt, null);
    assert.equal(event.metadata.ghl.snapshot, true);
    assert.equal(new Date(event.occurred_at).toISOString(), "2026-11-06T12:00:00.000Z");
  } finally {
    await f.close();
  }
});

test("an employee correction survives a later provider re-sync", async () => {
  const f = await fixture();
  try {
    const ctx = await context();
    const records = normalizeGhlRecord("email", fixtures.manualEmail, ctx);
    await persistGhlRecords(scope, records, ctx.revision);
    await f.db.query("update work_evidence_events set correction_status = 'corrected', summary = 'Corrected by an administrator.' where provider = 'ghl'");
    await f.db.query("update work_evidence set summary = 'Corrected by an administrator.' where source = 'ghl'");
    await persistGhlRecords(scope, records, ctx.revision);
    const event = (await rows(f.db, "select correction_status, summary, count(*) over ()::int as n from work_evidence_events where provider = 'ghl'"))[0] as any;
    assert.equal(event.correction_status, "corrected");
    assert.equal(event.summary, "Corrected by an administrator.");
    assert.equal((await rows(f.db, "select summary from work_evidence where source = 'ghl'"))[0]!.summary, "Corrected by an administrator.");
    assert.equal(event.n, 1);
  } finally {
    await f.close();
  }
});
