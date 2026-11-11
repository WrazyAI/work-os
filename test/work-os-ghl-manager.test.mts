import assert from "node:assert/strict";
import test from "node:test";
import { fixture, org, person, scope } from "./helpers/work-os-ghl-fixture.mts";
import { getGhlManagerSummary, ghlManagerState } from "../src/lib/work-os-ghl-manager";

async function rows(db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }, sql: string, values?: unknown[]) {
  return (await db.query(sql, values)).rows as Array<Record<string, any>>;
}

async function seed(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  await db.query(
    `insert into work_ghl_sync_state (organization_id, connection_id, kind, partition_key, state, range_from, range_through)
     values ($1,$2,'call','backfill:Call','complete',now()-interval '1 day',now())`,
    [org, scope.connectionId],
  );
  const base = `insert into work_evidence_events
    (organization_id, provider, external_event_id, evidence_class, person_id, occurred_at, title, summary, metadata, correction_status)
    values ($1,'ghl',$2,'output_evidence',$3,$4,$5,'',$6,$7)`;
  const event = (id: string, personId: string | null, relation: string, occurredAt: string | null, extra: Record<string, unknown> = {}, correction = "original") => db.query(base, [
    org,
    id,
    personId,
    occurredAt ?? "2026-11-10T12:00:00.000Z",
    id,
    JSON.stringify({ ghl: { kind: "email", relation, occurredAt, snapshot: extra.snapshot === true, connectionId: scope.connectionId } }),
    correction,
  ]);
  await event("performed", person, "performed", "2026-11-10T12:00:00.000Z");
  await event("performed-other", "70000000-0000-4000-8000-000000000003", "performed", "2026-11-10T13:00:00.000Z");
  await event("snapshot", person, "performed", "2026-11-10T14:00:00.000Z", { snapshot: true });
  await event("automation", null, "automation", "2026-11-10T15:00:00.000Z");
  await event("shared", null, "shared_account", "2026-11-10T16:00:00.000Z");
  await event("assigned", null, "assigned_only", "2026-11-10T17:00:00.000Z");
  await event("unknown", null, "unknown", "2026-11-10T18:00:00.000Z");
  await event("retracted", person, "performed", "2026-11-10T19:00:00.000Z", {}, "retracted");
}

test("manager GHL summary keeps performed and organization context separate", async () => {
  const f = await fixture();
  try {
    await seed(f.db);
    const personal = await getGhlManagerSummary({
      organizationId: org,
      from: "2026-11-10T00:00:00.000Z",
      through: "2026-11-11T00:00:00.000Z",
      personIds: [person],
      includeOrganizationContext: false,
      now: new Date("2026-11-10T20:00:00.000Z"),
    });
    assert.equal(personal.performed, 1, "only the verified performed event with a real occurrence time");
    assert.equal(personal.contextTotal, 0);
    assert.equal(personal.connected, true);
    assert.equal(personal.state, "ready");

    const admin = await getGhlManagerSummary({
      organizationId: org,
      from: "2026-11-10T00:00:00.000Z",
      through: "2026-11-11T00:00:00.000Z",
      personIds: null,
      includeOrganizationContext: true,
      now: new Date("2026-11-10T20:00:00.000Z"),
    });
    assert.equal(admin.performed, 2, "two people performed; snapshot and retracted are excluded");
    assert.deepEqual(admin.context, { automation: 1, shared_account: 1, assigned_only: 1, unknown: 1 });
    assert.equal(admin.contextTotal, 4);
  } finally {
    await f.close();
  }
});

test("manager GHL state distinguishes degraded, syncing and partial coverage", () => {
  assert.equal(ghlManagerState(false, []), "disconnected");
  assert.equal(ghlManagerState(true, [{ kind: "call", state: "unavailable" } as any]), "degraded");
  assert.equal(ghlManagerState(true, [{ kind: "call", state: "pending" } as any]), "syncing");
  assert.equal(ghlManagerState(true, [{ kind: "appointment", state: "partial" } as any]), "partial");
  assert.equal(ghlManagerState(true, [{ kind: "call", state: "complete" } as any]), "ready");
});
