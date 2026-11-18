import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import { seedPayroll } from "./helpers/work-os-payroll-fixture.mts";

// The break this catches: an expired review still readable, an export or recap
// resurrecting a purged period, or purge deleting the employee's own ledger.
const retention = () => import("../src/lib/work-os-payroll-retention");
const runs = () => import("../src/lib/work-os-payroll-runs");
const count = async (f: Awaited<ReturnType<typeof payrollFixture>>, sql: string, params: unknown[] = []) =>
  Number(((await f.db.query(sql, params)).rows[0] as { n?: number }).n ?? 0);

test("unapproved_period_expires_thirty_days_after_pay_date", async () => {
  const { payrollRetentionExpiry } = await retention();
  assert.equal(payrollRetentionExpiry({ payDate: "2026-11-16", timezone: "UTC", approvedAt: null, firstExportAt: null }), "2026-12-16T00:00:00.000Z");
  assert.equal(payrollRetentionExpiry({ payDate: "2026-11-16", timezone: "UTC", approvedAt: "2026-11-20T12:00:00Z", firstExportAt: null }), "2026-12-20T12:00:00.000Z");
  assert.equal(payrollRetentionExpiry({ payDate: "2026-11-16", timezone: "UTC", approvedAt: "2026-11-20T12:00:00Z", firstExportAt: "2026-11-25T00:00:00Z" }), "2026-12-25T00:00:00.000Z");
});

test("purge removes only payroll artifacts and marks the period expired", async () => {
  const { purgeExpiredPayroll } = await retention();
  const { startPayrollRun } = await runs();
  const f = await payrollFixture();
  try {
    const seeded = await seedPayroll(f);
    await f.db.query("update work_payroll_reviews set retention_expires_at='2000-01-01Z' where id=$1", [seeded.reviewId]);
    await f.db.query(`insert into work_payroll_exports(organization_id,review_id,person_id,approval_id,kind,schema_version,snapshot_hash,payload,payload_hash,actor_user_id)
      values($1,$2,$3,$4,'summary','v1','h',decode('01','hex'),'h',$5)`, [org, seeded.reviewId, person, seeded.approvalId, adminAccess.ctx.user.id]);
    await f.db.query(`insert into work_payroll_decisions(organization_id,review_id,person_id,analysis_revision,finding_key,source_hash,decision,reason,actor_user_id,expected_row_version,idempotency_key)
      values($1,$2,$3,1,'gap-1','source-a','acknowledged','Checked source coverage',$4,0,'retention-decision')`, [org, seeded.reviewId, person, adminAccess.ctx.user.id]);
    await f.db.query(`insert into work_payroll_questions(organization_id,review_id,person_id,actor_user_id,thread_id,analysis_revision,request_key,source_hash,question)
      values($1,$2,$3,$4,'93000000-0000-4000-8000-000000000001',1,'q-1','h','Why?')`, [org, seeded.reviewId, person, adminAccess.ctx.user.id]);
    await f.db.query(`insert into work_audit_log(organization_id,actor_user_id,action,target_type,target_id,metadata)
      values($1,$2,'payroll.approved','payroll_review',$3,'{}'),($1,$2,'task.updated','task','other','{}')`, [org, adminAccess.ctx.user.id, seeded.reviewId]);
    const recapBefore = await f.db.query("select id,version,payload from work_recap_reviews order by id,version");
    const intervalBefore = await f.db.query("select id,review_status,review_source from work_activity_intervals order by id");
    const screenshots = await f.db.query("select count(*)::int as n from work_screenshot_summaries");
    const result = await purgeExpiredPayroll({ at: new Date("2026-12-20T00:00:00Z"), limit: 10 });
    assert.equal(result.reviews, 1);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_reviews"), 0);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_approvals"), 0);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_exports"), 0);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_questions"), 0);
    assert.deepEqual((await f.db.query("select id,version,payload from work_recap_reviews order by id,version")).rows, recapBefore.rows);
    assert.deepEqual((await f.db.query("select id,review_status,review_source from work_activity_intervals order by id")).rows, intervalBefore.rows);
    assert.equal(await count(f, "select count(*)::int as n from work_screenshot_summaries"), Number((screenshots.rows[0] as { n: number }).n));
    assert.equal(await count(f, "select count(*)::int as n from work_audit_log where action='task.updated'"), 1);
    assert.equal(await count(f, "select count(*)::int as n from work_audit_log where action='payroll.approved'"), 0);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_retention_tombstones where organization_id=$1 and person_id=$2 and pay_date='2026-11-16'", [org, person]), 1);
    await assert.rejects(startPayrollRun(adminAccess, { personId: person, payDate: "2026-11-16", requestKey: "resurrect" }), /expired/i);
  } finally { await f.close(); }
});

test("a documented hold prevents purge visibility while leaving artifacts intact", async () => {
  const { purgeExpiredPayroll } = await retention();
  const f = await payrollFixture();
  try {
    const seeded = await seedPayroll(f);
    await f.db.query("update work_payroll_reviews set retention_expires_at='2000-01-01Z' where id=$1", [seeded.reviewId]);
    await f.db.query(`insert into work_payroll_operator_holds(organization_id,review_id,person_id,reason,operator_reference)
      values($1,$2,$3,'Preservation order','ticket-1')`, [org, seeded.reviewId, person]);
    const result = await purgeExpiredPayroll({ at: new Date("2026-12-20T00:00:00Z"), limit: 10 });
    assert.equal(result.reviews, 0);
    assert.equal(result.remaining, 1);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_reviews where id=$1", [seeded.reviewId]), 1);
  } finally { await f.close(); }
});
