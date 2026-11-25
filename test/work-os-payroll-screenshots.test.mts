import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import { WORK_OS_SCREENSHOT_CONSENT_PURPOSE, WORK_OS_TRACKING_POLICY } from "../src/lib/work-os-onboarding";

// The break this catches: decrypting a screenshot from an unvalidated client id,
// or returning bytes when the access audit did not commit.
const screenshots = () => import("../src/lib/work-os-payroll-screenshots");
const reviewId = "90000000-0000-4000-8000-000000000020";
const findingKey = "inactivity:0-600000";
const summaryId = "80000000-0000-4000-8000-000000000020";
const evidenceId = "80000000-0000-4000-8000-000000000021";
const now = new Date("2026-11-16T06:05:00Z");

async function seed(f: Awaited<ReturnType<typeof payrollFixture>>) {
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,status,analysis_revision,row_version,source_hash,retention_expires_at)
    values($1,$2,$3,'2026-11-16','2026-11-01','2026-11-15','UTC','needs_review',1,0,'hash','2026-12-16Z')`, [reviewId, org, person]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
    values($1,$2,$3,1,'hash','v1','2026-11-16T06:05:00Z','{}','{}')`, [org, reviewId, person]);
  const day = await f.db.query(`insert into work_payroll_days
    (organization_id,review_id,person_id,analysis_revision,local_date,week,status,source_hash)
    values($1,$2,$3,1,'2026-11-05',1,'needs_review','day') returning id`, [org, reviewId, person]);
  const dayId = String((day.rows[0] as { id: string }).id);
  await f.db.query(`insert into work_payroll_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,blocks_approval,required_action,reason,source_hash)
    values($1,$2,$3,1,$4,$5,'inactivity','needs_review','hold',true,'decide','Held run','hash')`, [org, reviewId, person, dayId, findingKey]);
  await f.db.query(`insert into work_evidence_events(id,organization_id,person_id) values($1,$2,$3)`, [evidenceId, org, person]);
  await f.db.query(`insert into work_screenshot_summaries(id,organization_id,person_id,evidence_event_id,processing_status,expires_at,visible_context)
    values($1,$2,$3,$4,'processed','2027-01-01T00:00:00Z','{}')`, [summaryId, org, person, evidenceId]);
  await f.db.query(`insert into work_payroll_frame_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,screenshot_summary_id,evidence_event_id,captured_at,category,confidence,reason,model,prompt_version,rubric_hash,classification_key,source_hash,policy_hash)
    values($1,$2,$3,1,$4,$5,$6,'2026-11-05T09:05:00Z','work',0.9,'Editor','model','v1','rubric','key','source','policy')`,
  [org, reviewId, person, dayId, summaryId, evidenceId]);
  await f.db.query(`insert into work_consent_records(organization_id,person_id,purpose,policy_version,decision,occurred_at)
    values($1,$2,$3,$4,'accepted','2026-01-01T00:00:00Z'),($1,$2,$5,$4,'accepted','2026-01-01T00:00:00Z')`,
  [org, person, WORK_OS_TRACKING_POLICY.purpose, WORK_OS_TRACKING_POLICY.version, WORK_OS_SCREENSHOT_CONSENT_PURPOSE]);
  return dayId;
}

test("a valid unresolved finding writes the reason before returning bytes", async () => {
  const { previewPayrollScreenshot } = await screenshots();
  const f = await payrollFixture();
  try {
    await seed(f);
    let loads = 0;
    const image = await previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Checking the held interval", requestKey: "preview-1" }, now, {
      loadImage: async () => { loads += 1; return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }; },
    });
    assert.deepEqual([...image.bytes], [1, 2, 3]);
    assert.equal(loads, 1);
    const audit = (await f.db.query("select reason from work_screenshot_access_log where screenshot_summary_id=$1", [summaryId])).rows[0] as { reason: string };
    assert.equal(audit.reason, "Checking the held interval");
  } finally { await f.close(); }
});

test("cross_org_summary_never_decrypts", async () => {
  const { previewPayrollScreenshot } = await screenshots();
  const f = await payrollFixture();
  try {
    await seed(f);
    let decrypts = 0;
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId: "88888888-0000-4000-8000-000000000001", reason: "Wrong tenant", requestKey: "preview-2" }, now, {
      loadImage: async () => { decrypts += 1; return { bytes: new Uint8Array(), contentType: "image/jpeg" }; },
    }), /not attached|not found|forbidden/i);
    assert.equal(decrypts, 0);
    assert.equal(((await f.db.query("select count(*)::int as n from work_screenshot_access_log")).rows[0] as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("manager, resolved, expired, sensitive and revoked-consent frames are refused", async () => {
  const { previewPayrollScreenshot } = await screenshots();
  const f = await payrollFixture();
  try {
    await seed(f);
    const manager = { ...adminAccess, role: "manager" } as typeof adminAccess;
    await assert.rejects(previewPayrollScreenshot(manager, { reviewId, findingId: findingKey, summaryId, reason: "Manager", requestKey: "p" }, now), /admin/i);
    await f.db.query("update work_payroll_findings set status='resolved_payable' where review_id=$1", [reviewId]);
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Resolved", requestKey: "p" }, now), /unresolved|disputed/i);
    await f.db.query("update work_payroll_findings set status='auto_excluded', kind='inactivity', effect='exclude' where review_id=$1", [reviewId]);
    const excludedImage = await previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Checking an excluded inactivity interval", requestKey: "excluded" }, now, {
      loadImage: async () => ({ bytes: new Uint8Array([4, 5]), contentType: "image/jpeg" }),
    });
    assert.deepEqual([...excludedImage.bytes], [4, 5]);
    await f.db.query("update work_payroll_findings set status='needs_review' where review_id=$1", [reviewId]);
    await f.db.query("update work_screenshot_summaries set expires_at='2026-01-01T00:00:00Z' where id=$1", [summaryId]);
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Expired", requestKey: "p" }, now), /expired/i);
    await f.db.query("update work_screenshot_summaries set expires_at='2027-01-01T00:00:00Z',visible_context='{\"contains_sensitive_content\":true}' where id=$1", [summaryId]);
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Sensitive", requestKey: "p" }, now), /sensitive|policy/i);
    await f.db.query("update work_screenshot_summaries set visible_context='{}' where id=$1", [summaryId]);
    await f.db.query(`insert into work_consent_records(organization_id,person_id,purpose,policy_version,decision,occurred_at)
      values($1,$2,$3,$4,'denied','2026-11-15T00:00:00Z')`, [org, person, WORK_OS_SCREENSHOT_CONSENT_PURPOSE, WORK_OS_TRACKING_POLICY.version]);
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "No consent", requestKey: "p" }, now), /consent/i);
  } finally { await f.close(); }
});

test("audit_failure_returns_no_bytes", async () => {
  const { previewPayrollScreenshot } = await screenshots();
  const f = await payrollFixture();
  try {
    await seed(f);
    let loads = 0;
    await assert.rejects(previewPayrollScreenshot(adminAccess, { reviewId, findingId: findingKey, summaryId, reason: "Audit failure", requestKey: "p" }, now, {
      audit: async () => { throw new Error("audit insert failed"); },
      loadImage: async () => { loads += 1; return { bytes: new Uint8Array([1]), contentType: "image/jpeg" }; },
    }), /audit insert failed/);
    assert.equal(loads, 0);
  } finally { await f.close(); }
});
