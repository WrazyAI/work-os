import assert from "node:assert/strict";
import test from "node:test";
import {
  actorSam,
  actorShared,
  connection,
  david,
  fixture,
  otherOrg,
  person,
  scope,
} from "./helpers/work-os-ghl-fixture.mts";
import {
  correctGhlEvidence,
  ghlMappingRevision,
  loadGhlCredential,
  loadGhlIdentities,
  persistGhlRecords,
  redactProviderConfig,
  requireGhlEvidenceAccess,
} from "../src/lib/work-os-ghl-store";
import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import type { WorkOsAccess } from "../src/lib/work-os-api";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

async function rows(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, any>>;
}

const userId = "aaaaaaaa-0000-4000-8000-000000000001";

function access(overrides: Partial<WorkOsAccess> = {}): WorkOsAccess {
  return {
    ctx: { user: { id: userId }, profile: { id: userId } as any },
    organizationId: scope.organizationId,
    organizationName: "Wrazy",
    organizationOwnerId: null,
    role: "admin",
    personId: null,
    membershipId: "membership",
    featureFlags: { ghl_evidence: true },
    workspaces: [],
    ...overrides,
  } as WorkOsAccess;
}

async function seed(fixtureDb: Awaited<ReturnType<typeof fixture>>) {
  const identities = await loadGhlIdentities(scope);
  const ctx = { scope, identities, observedAt: "2026-11-06T12:00:00.000Z" };
  const revision = ghlMappingRevision(identities);
  await persistGhlRecords(scope, normalizeGhlRecord("email", {
    id: "msg-person",
    type: "TYPE_EMAIL",
    direction: "outbound",
    source: "app",
    userId: actorSam,
    dateAdded: "2026-11-03T18:17:00.000Z",
  }, ctx), revision);
  await persistGhlRecords(scope, normalizeGhlRecord("note", {
    id: "note-shared",
    contactId: "contact-1",
    userId: actorShared,
    body: "shared",
    dateAdded: "2026-11-03T20:00:00.000Z",
  }, ctx), revision);
  const rows = (await fixtureDb.db.query("select id, person_id from work_evidence_events")).rows as Array<{ id: string; person_id: string | null }>;
  return {
    personEvent: rows.find((row) => row.person_id === person)!.id,
    sharedEvent: rows.find((row) => row.person_id === null)!.id,
  };
}

test("admin can inspect shared evidence and receives its scope", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    const result = await requireGhlEvidenceAccess(access(), ids.sharedEvent);
    assert.equal(result.personId, null);
    assert.equal(result.scope.organizationId, scope.organizationId);
    assert.equal(result.scope.locationId, scope.locationId);
    assert.equal(result.record.kind, "note");
  } finally {
    await f.close();
  }
});

test("mapped employee can inspect their own performed evidence", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    const result = await requireGhlEvidenceAccess(access({ role: "employee", personId: person }), ids.personEvent);
    assert.equal(result.personId, person);
  } finally {
    await f.close();
  }
});

test("employee cannot inspect shared location evidence", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    await assert.rejects(
      () => requireGhlEvidenceAccess(access({ role: "employee", personId: person }), ids.sharedEvent),
      /forbidden/i,
    );
  } finally {
    await f.close();
  }
});

test("employee cannot inspect another person's evidence", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    await assert.rejects(
      () => requireGhlEvidenceAccess(access({ role: "employee", personId: david }), ids.personEvent),
      /forbidden/i,
    );
  } finally {
    await f.close();
  }
});

test("cross-organization access is denied without leaking the event", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    await assert.rejects(
      () => requireGhlEvidenceAccess(access({ organizationId: otherOrg }), ids.sharedEvent),
      /not found|forbidden/i,
    );
  } finally {
    await f.close();
  }
});

test("credential loading validates the active connection and never leaks the token", async () => {
  const f = await fixture();
  try {
    const encrypted = (await import("../src/lib/work-os-secrets")).encryptProviderSecret("pit-super-secret");
    await f.db.query(
      "insert into work_provider_credentials (organization_id, provider, access_token_cipher) values ($1, 'ghl', $2)",
      [scope.organizationId, encrypted],
    );
    assert.equal(await loadGhlCredential(scope), "pit-super-secret");
    await f.db.query("update work_provider_connections set active = false where id = $1", [connection]);
    await assert.rejects(
      () => loadGhlCredential(scope),
      (error: Error) => {
        assert.equal(error.message.includes("pit-super-secret"), false);
        return /not active|not connected|credential/i.test(error.message);
      },
    );
  } finally {
    await f.close();
  }
});

test("admin can correct or retract unknown GHL evidence without inventing a person", async () => {
  const f = await fixture();
  try {
    const ids = await seed(f);
    const corrected = await correctGhlEvidence(access(), ids.sharedEvent, {
      status: "corrected",
      summary: "Corrected by an administrator.",
      reason: "Wrong contact context",
    });
    assert.equal((corrected as any).person_id, null);
    assert.equal((corrected as any).correction_status, "corrected");
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence"))[0].n, 1, "only the performed email is mirrored");
    await assert.rejects(
      () => correctGhlEvidence(access({ role: "employee", personId: person }), ids.sharedEvent, { status: "disputed" }),
      /forbidden/i,
    );
    const retracted = await correctGhlEvidence(access(), ids.sharedEvent, { status: "retracted", reason: "Duplicate" });
    assert.equal((retracted as any).correction_status, "retracted");
  } finally {
    await f.close();
  }
});

test("connection config redaction removes secret-bearing keys recursively", () => {
  const redacted = redactProviderConfig({
    label: "Wrazy",
    access_token: "secret",
    nested: { apiKey: "secret", keep: 1 },
    items: [{ secret: "x" }, { ok: true }],
  });
  assert.deepEqual(redacted, {
    label: "Wrazy",
    nested: { keep: 1 },
    items: [{}, { ok: true }],
  });
});
