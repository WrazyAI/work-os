import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess, otherOrgAdminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import type { PayrollDayResult } from "../src/modules/work-os/payroll/contracts";

// The break this catches: a roster/days read leaking source arrays, returning
// page length as total, or allowing a manager/foreign admin to read payroll.
const reads = () => import("../src/lib/work-os-payroll-reads");
const api = () => import("../src/lib/work-os-payroll-api");
const reviewId = "94000000-0000-4000-8000-000000000001";
const dayId = "94000000-0000-4000-8000-000000000002";
const findingKey = "inactivity:0-600000";

async function seed(f: Awaited<ReturnType<typeof payrollFixture>>) {
  const day: PayrollDayResult = {
    id: null, scope: { organizationId: org, personId: person }, date: "2026-11-05", week: 1,
    partition: [{ span: { startMs: 0, endMs: 600_000 }, category: "held", findingKey }],
    exactMs: { payable: 0, break: 0, inactivity: 0, held: 600_000, manual: 0, outside: 0 },
    minutes: { recorded: 10, eligibleTracked: 10, outside: 0, break: 0, inactivity: 0, held: 10, manualExcluded: 0, recommended: 0, approved: 0 },
    findings: [], blockers: [], sourceHash: "day", decisionKeys: [], decisionState: {}, decisionAmounts: {},
  };
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,status,analysis_revision,row_version,source_hash,totals,retention_expires_at)
    values($1,$2,$3,'2026-11-16','2026-11-01','2026-11-15','UTC','needs_review',1,0,'hash','{"held":10}','2027-01-01Z')`, [reviewId, org, person]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
    values($1,$2,$3,1,'hash','v1','2026-11-16T06:05:00Z','{}','{}')`, [org, reviewId, person]);
  await f.db.query(`insert into work_payroll_days
    (id,organization_id,review_id,person_id,analysis_revision,local_date,week,status,recorded_ms,eligible_ms,exact_ms,partition,held_minutes,recommended_minutes,source_hash,result)
    values($1,$2,$3,$4,1,'2026-11-05',1,'needs_review',600000,600000,'{}','[]',10,0,'day',$5::jsonb)`,
  [dayId, org, reviewId, person, JSON.stringify(day)]);
  await f.db.query(`insert into work_payroll_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,blocks_approval,required_action,reason,citations,source_hash)
    values($1,$2,$3,1,$4,$5,'inactivity','needs_review','hold',true,'decide','Held run','[]','hash')`, [org, reviewId, person, dayId, findingKey]);
}

test("roster, days, findings and one day read within the organization", async () => {
  const { listPayrollRoster, listPayrollDays, listPayrollFindings, loadPayrollDay } = await reads();
  const f = await payrollFixture();
  try {
    await seed(f);
    const roster = await listPayrollRoster(adminAccess, { payDate: "2026-11-16", cursor: null, limit: 50 });
    assert.equal(roster.total, 1);
    assert.equal(roster.items[0].reviewId, reviewId);
    assert.equal(roster.items[0].mapped, false, "an existing record is not proof of a verified mapping");
    assert.equal(roster.period.from, "2026-11-01");
    const days = await listPayrollDays(adminAccess, reviewId, { cursor: null, limit: 50 });
    assert.equal(days.total, 1);
    assert.equal(days.items[0].id, dayId);
    assert.deepEqual(days.items[0].evidence, { sessions: [], scheduleSource: null, sampledFrames: 0 });
    assert.equal("captures" in days.items[0], false);
    assert.equal("frameCandidates" in days.items[0], false);
    const findings = await listPayrollFindings(adminAccess, reviewId, { status: "needs_review", cursor: null, limit: 50 });
    assert.equal(findings.total, 1);
    assert.equal(findings.items[0].key, findingKey);
    assert.equal(findings.items[0].scope.personId, person);
    const day = await loadPayrollDay(adminAccess, reviewId, dayId);
    assert.equal(day.date, "2026-11-05");
  } finally { await f.close(); }
});

test("a stored partial window is reviewed as stored, not recomputed from the pay date", async () => {
  const { listPayrollRoster, loadPayrollReview } = await reads();
  const f = await payrollFixture();
  try {
    await seed(f);
    await f.db.query("update work_payroll_reviews set period_end='2026-11-10' where id=$1", [reviewId]);
    const review = await loadPayrollReview(adminAccess, reviewId);
    assert.equal(review.period.from, "2026-11-01");
    assert.equal(review.period.through, "2026-11-10");
    assert.equal(review.period.payDate, "2026-11-16");
    assert.equal(review.period.weeks[1].through, "2026-11-10");
    const roster = await listPayrollRoster(adminAccess, { payDate: "2026-11-16", cursor: null, limit: 50 });
    assert.equal(roster.items[0].reviewId, reviewId);
  } finally { await f.close(); }
});

test("cross-org reads are not found and expired records are refused", async () => {
  const { listPayrollDays, loadPayrollDay } = await reads();
  const f = await payrollFixture();
  try {
    await seed(f);
    await assert.rejects(listPayrollDays(otherOrgAdminAccess, reviewId, { cursor: null, limit: 50 }), /not found/i);
    await assert.rejects(loadPayrollDay(otherOrgAdminAccess, reviewId, dayId), /not found/i);
    await f.db.query("update work_payroll_reviews set retention_expires_at='2000-01-01Z' where id=$1", [reviewId]);
    await assert.rejects(listPayrollDays(adminAccess, reviewId, { cursor: null, limit: 50 }), /expired/i);
  } finally { await f.close(); }
});

test("an audit exposes its queued progress and pages findings without repeating a row", async () => {
  const { loadPayrollReview, listPayrollRoster, listPayrollFindings } = await reads();
  const f = await payrollFixture();
  try {
    await seed(f);
    await f.db.query(`insert into work_payroll_runs
      (organization_id,review_id,person_id,status,phase,progress,target_revision,as_of,request_key,resolved_policy)
      values($1,$2,$3,'queued','recaps','{"message":"Queued payroll analysis."}',2,'2026-11-16T06:05:00Z','queued-test','{}')`, [org, reviewId, person]);
    await f.db.query(`insert into work_payroll_findings
      (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,required_action,reason,source_hash)
      values($1,$2,$3,1,$4,'outside:1','outside_window','auto_excluded','exclude','none','Outside shift','hash')`, [org, reviewId, person, dayId]);
    const review = await loadPayrollReview(adminAccess, reviewId);
    assert.equal(review.run?.progress.status, "queued");
    assert.equal(review.run?.targetRevision, 2);
    const roster = await listPayrollRoster(adminAccess, { payDate: "2026-11-16", cursor: null, limit: 50, recordsOnly: true });
    assert.equal(roster.items[0].auditStatus, "queued");
    const first = await listPayrollFindings(adminAccess, reviewId, { status: null, cursor: null, limit: 1 });
    await assert.rejects(listPayrollFindings(adminAccess, reviewId, {
      status: null, cursor: first.nextCursor, limit: 1, analysisRevision: 2,
    }), /revision changed/i);
    assert.ok(first.nextCursor);
    const second = await listPayrollFindings(adminAccess, reviewId, { status: null, cursor: first.nextCursor, limit: 1 });
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal(second.total, 2);
    assert.equal(second.nextCursor, null);
  } finally { await f.close(); }
});

test("route shells use admin auth and service-secret routes reject unauthenticated calls", async () => {
  const { readFileSync } = await import("node:fs");
  const rosterRoute = readFileSync(new URL("../src/app/api/work-os/admin/payroll/route.ts", import.meta.url), "utf8");
  const serviceRoute = readFileSync(new URL("../src/app/api/work-os/admin/payroll/run-due/route.ts", import.meta.url), "utf8");
  assert.match(rosterRoute, /requirePayrollAdmin/);
  assert.match(serviceRoute, /payrollCronAuthorized/);
  const { payrollCronAuthorized } = await import("../src/lib/work-os-payroll-recap-approval");
  assert.equal(payrollCronAuthorized(new Request("http://localhost/x")), false);
  const { payrollLimit } = await api();
  assert.equal(payrollLimit(new URL("http://localhost/x?limit=1000")), 100);
});
