import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { actorSam, fixture, org, scope } from "./helpers/work-os-ghl-fixture.mts";
import { decryptProviderSecret, encryptProviderSecret } from "../src/lib/work-os-secrets";
import { ghlMappingRevision, loadGhlIdentities, persistGhlRecords } from "../src/lib/work-os-ghl-store";
import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import { purgeExpiredGhlContent, registerGhlContentReference } from "../src/lib/work-os-ghl-retention";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");

async function rows(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, sql: string, params?: unknown[]) {
  return (await db.query(sql, params)).rows as Array<Record<string, any>>;
}

test("expiry redacts encrypted content and every registered machine copy while leaving report state intact", async () => {
  const f = await fixture();
  try {
    const identities = await loadGhlIdentities(scope);
    const record = normalizeGhlRecord("email", {
      id: "msg-expiring",
      type: "TYPE_EMAIL",
      direction: "outbound",
      source: "app",
      userId: actorSam,
      dateAdded: "2026-01-01T12:00:00.000Z",
    }, { scope, identities, observedAt: "2026-01-01T12:00:00.000Z" })[0];
    await persistGhlRecords(scope, [record], ghlMappingRevision(identities));
    const event = (await rows(f.db, "select id from work_evidence_events where provider = 'ghl'")).at(0)!;

    const contentId = randomUUID();
    await f.db.query(
      `insert into work_ghl_email_content
        (id, organization_id, connection_id, evidence_event_id, content_hash, excerpt_cipher, summary_cipher, analysis_version, source_occurred_at, observed_at, expires_at)
       values ($1,$2,$3,$4,'hash',$5,$6,'v1','2026-01-01T12:00:00Z','2026-01-01T12:00:00Z','2026-04-01T12:00:00Z')`,
      [contentId, org, scope.connectionId, event.id, encryptProviderSecret("SYNTHETIC_EMAIL_BODY_SENTINEL excerpt"), encryptProviderSecret("SYNTHETIC_EMAIL_BODY_SENTINEL summary")],
    );
    const reportId = randomUUID();
    const versionId = randomUUID();
    const intervalId = randomUUID();
    await f.db.query(
      "insert into work_reports (id, organization_id, status, generated_markdown) values ($1,$2,'pending_review',$3)",
      [reportId, org, "Draft included SYNTHETIC_EMAIL_BODY_SENTINEL full detail."],
    );
    await f.db.query(
      "insert into work_report_versions (id, report_id, markdown) values ($1,$2,$3)",
      [versionId, reportId, "Version included SYNTHETIC_EMAIL_BODY_SENTINEL."],
    );
    await f.db.query(
      "insert into work_activity_intervals (id, organization_id, headline, ai_detail, final_detail) values ($1,$2,$3,$4,$5)",
      [intervalId, org, "Recap headline", "Detail with SYNTHETIC_EMAIL_BODY_SENTINEL.", "Employee wrote: keep this line."],
    );
    for (const reference of [
      { table: "work_reports", id: reportId, field: "generated_markdown" },
      { table: "work_report_versions", id: versionId, field: "markdown" },
      { table: "work_activity_intervals", id: intervalId, field: "ai_detail" },
    ]) {
      await registerGhlContentReference({ organizationId: org, contentId, consumerTable: reference.table, consumerId: reference.id, consumerField: reference.field });
    }

    const result = await purgeExpiredGhlContent(new Date("2026-11-06T12:00:00.000Z"));
    assert.equal(result.expired, 1);
    assert.equal(result.referencesRedacted, 3);

    const content = (await rows(f.db, "select excerpt_cipher, summary_cipher, content_purged_at from work_ghl_email_content")).at(0)!;
    assert.equal(content.excerpt_cipher, null);
    assert.equal(content.summary_cipher, null);
    assert.ok(content.content_purged_at);
    const report = (await rows(f.db, "select status, generated_markdown from work_reports")).at(0)!;
    assert.equal(report.status, "pending_review", "report review state is not regenerated");
    assert.equal(String(report.generated_markdown).includes("GHL email evidence expired"), true);
    assert.equal(JSON.stringify(await rows(f.db, "select * from work_reports")).includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false);
    assert.equal(JSON.stringify(await rows(f.db, "select * from work_report_versions")).includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false);
    const interval = (await rows(f.db, "select ai_detail, final_detail, review_status from work_activity_intervals")).at(0)!;
    assert.equal(interval.final_detail, "Employee wrote: keep this line.", "employee amendment is preserved");
    assert.equal(interval.review_status, "inferred");
    assert.equal(String(interval.ai_detail).includes("GHL email evidence expired"), true);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_audit_log where action = 'ghl_content.retention_purged'")).at(0)!.n, 1);
  } finally {
    await f.close();
  }
});

test("future content is not purged early", async () => {
  const f = await fixture();
  try {
    const identities = await loadGhlIdentities(scope);
    const record = normalizeGhlRecord("email", {
      id: "msg-future",
      type: "TYPE_EMAIL",
      direction: "outbound",
      source: "app",
      userId: actorSam,
      dateAdded: "2026-11-01T12:00:00.000Z",
    }, { scope, identities, observedAt: "2026-11-01T12:00:00.000Z" })[0];
    await persistGhlRecords(scope, [record], ghlMappingRevision(identities));
    const event = (await rows(f.db, "select id from work_evidence_events where provider = 'ghl'")).at(0)!;
    await f.db.query(
      `insert into work_ghl_email_content
        (id, organization_id, connection_id, evidence_event_id, content_hash, excerpt_cipher, observed_at, expires_at)
       values ($1,$2,$3,$4,'hash',$5,'2026-11-01T12:00:00Z','2027-01-30T12:00:00Z')`,
      [randomUUID(), org, scope.connectionId, event.id, encryptProviderSecret("still valid")],
    );
    const result = await purgeExpiredGhlContent(new Date("2026-11-06T12:00:00.000Z"));
    assert.equal(result.expired, 0);
    const stored = (await rows(f.db, "select excerpt_cipher from work_ghl_email_content")).at(0)!;
    assert.equal(decryptProviderSecret(String(stored.excerpt_cipher)), "still valid");
  } finally {
    await f.close();
  }
});
