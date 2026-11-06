import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { actorSam, fixture, org, person, scope } from "./helpers/work-os-ghl-fixture.mts";
import { ghlMappingRevision, loadGhlIdentities, persistGhlRecords } from "../src/lib/work-os-ghl-store";
import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import { eodGhlFactsFromActivity, listGhlActivity } from "../src/lib/work-os-ghl-activity";
import { analyzeGhlEmail, getGhlEmailForViewer } from "../src/lib/work-os-ghl-email";
import { buildEodReportMarkdown, type EodReportFacts } from "../src/lib/work-os-eod-report";
import type { WorkOsAccess } from "../src/lib/work-os-api";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/work-os-ghl.json", import.meta.url), "utf8"));
const userId = "aaaaaaaa-0000-4000-8000-000000000001";

function access(): WorkOsAccess {
  return {
    ctx: { user: { id: userId }, profile: { id: userId } as any },
    organizationId: scope.organizationId,
    organizationName: "Wrazy",
    organizationOwnerId: null,
    role: "employee",
    personId: person,
    membershipId: "membership",
    featureFlags: { ghl_evidence: true },
    workspaces: [],
  } as WorkOsAccess;
}

async function rows(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, any>>;
}

test("configuration and probe dry runs cannot write or call the provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghl-probe-"));
  const credential = join(dir, "credential");
  writeFileSync(credential, "synthetic-credential-not-live-value");
  const configure = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/configure-ghl-evidence.mts",
    "--organization-id", org,
    "--location-id", scope.locationId,
    "--credential-file", credential,
  ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://user:pass@fixture.invalid:5432/db" } });
  assert.equal(configure.status, 0);
  const configured = JSON.parse(configure.stdout);
  assert.deepEqual(configured.writes, []);
  assert.equal((configure.stdout + configure.stderr).includes("synthetic-credential-not-live-value"), false);
  const probe = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/verify-ghl-evidence-live.mts",
    "--organization-id", org,
    "--location-id", scope.locationId,
  ], { encoding: "utf8" });
  assert.equal(probe.status, 0);
  const output = JSON.parse(probe.stdout);
  assert.equal(output.mode, "dry_run");
  assert.equal(output.networkCalls, 0);
  assert.equal(output.bodiesPrinted, 0);
});

test("the complete GHL flow produces bounded evidence without manufacturing employee updates", async () => {
  const f = await fixture();
  try {
    const beforeCheckIns = (await rows(f.db, "select count(*)::int as n from work_check_ins")).at(0)!.n;
    const beforeSession = new Date((await rows(f.db, "select last_substantive_update_at from work_sessions")).at(0)!.last_substantive_update_at).toISOString();

    const identities = await loadGhlIdentities(scope);
    const ctx = { scope, identities, observedAt: "2026-11-06T12:00:00.000Z" };
    const records = [
      ...normalizeGhlRecord("call", fixtures.outboundCall, ctx),
      ...normalizeGhlRecord("email", fixtures.manualEmail, ctx),
      ...normalizeGhlRecord("appointment", fixtures.assignedOnlyAppointment, ctx),
      ...normalizeGhlRecord("email", fixtures.workflowEmail, ctx),
      ...normalizeGhlRecord("note", fixtures.sharedAccountNote, ctx),
    ];
    await persistGhlRecords(scope, records, ghlMappingRevision(identities));
    await persistGhlRecords(scope, records, ghlMappingRevision(identities));

    const personal = await listGhlActivity({
      scope, personId: person, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: false,
    });
    assert.deepEqual(personal.items.map((item) => item.kind).sort(), ["call", "email"]);
    assert.equal(personal.items.every((item) => item.relation === "performed"), true);

    const organization = await listGhlActivity({
      scope, personId: null, from: "2026-11-01T00:00:00.000Z", through: "2026-11-07T00:00:00.000Z",
      includeOrganizationContext: true,
    });
    assert.equal(organization.items.some((item) => item.relation === "automation"), true);
    assert.equal(organization.items.some((item) => item.relation === "shared_account"), true);
    assert.equal(organization.items.some((item) => item.relation === "assigned_only"), true);

    const emailEvent = personal.items.find((item) => item.kind === "email")!;
    const analysis = await analyzeGhlEmail({
      scope, eventId: emailEvent.eventId, emailId: "msg-manual-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({ id: "msg-manual-1", subject: "Proposal", contentType: "text/plain", body: "Sent the proposal for review. SYNTHETIC_EMAIL_BODY_SENTINEL" }),
      complete: async () => ({ summary: "Sent a proposal for review.", claims: [{ description: "Proposal sent", quote: "Sent the proposal for review." }] }),
    });
    assert.equal(analysis.state, "ready");
    const viewed = await getGhlEmailForViewer(access(), emailEvent.eventId);
    assert.equal(viewed.availability, "unavailable", "no live credential is configured in the fixture");
    assert.equal(viewed.excerpt, "Sent the proposal for review.");

    const ghl = eodGhlFactsFromActivity(personal);
    assert.deepEqual(ghl.performed, { call: 1, email: 1 });
    const facts: EodReportFacts = {
      date: "2026-11-03", personName: "Sam Adly", timezone: "America/New_York", roleName: "Account manager",
      goal: { text: "Follow up with prospects", provenance: "employee" },
      session: { clockedInAt: "2026-11-03T13:00:00.000Z", clockedOutAt: "2026-11-03T21:00:00.000Z" },
      completed: [], carried: [], automation: [], automationOutsideLabel: null, planItems: [], updates: [], blockers: [],
      recaps: [], hourly: [], github: null, ghl, media: [], evidence: [],
    };
    const report = buildEodReportMarkdown(facts);
    assert.match(report.markdown, /1 email/);
    assert.match(report.markdown, /1 call/);
    assert.match(report.markdown, /do not prove attendance, productivity, or task completion/);

    const afterCheckIns = (await rows(f.db, "select count(*)::int as n from work_check_ins")).at(0)!.n;
    const afterSession = new Date((await rows(f.db, "select last_substantive_update_at from work_sessions")).at(0)!.last_substantive_update_at).toISOString();
    assert.equal(afterCheckIns, beforeCheckIns);
    assert.equal(afterSession, beforeSession);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events")).at(0)!.n, 5, "re-sync does not duplicate");
    const serialized = JSON.stringify(await rows(f.db, "select * from work_ghl_email_content"));
    assert.equal(serialized.includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false);
    assert.equal(JSON.stringify(await rows(f.db, "select metadata from work_evidence_events")).includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false);
  } finally {
    await f.close();
  }
});
