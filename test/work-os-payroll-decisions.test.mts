import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import { loadPayrollSourceToken } from "../src/lib/work-os-payroll-freshness";
import type { PayrollDayResult, PayrollCommand } from "../src/modules/work-os/payroll/contracts";

// The break this catches: a decided span changing twice, approval before a
// held finding is resolved, or a retry minting a second payroll receipt.
const decisions = () => import("../src/lib/work-os-payroll-decisions");
const approvals = () => import("../src/lib/work-os-payroll-approvals");
const reviewId = "90000000-0000-4000-8000-000000000001";
const heldKey = "inactivity:1000-2000";

async function seed(f: Awaited<ReturnType<typeof payrollFixture>>) {
  const client = f.db as unknown as PoolClient;
  const token = await loadPayrollSourceToken(client, { organizationId: org, personId: person });
  const day: PayrollDayResult = {
    id: null, scope: { organizationId: org, personId: person }, date: "2026-11-05", week: 1,
    partition: [
      { span: { startMs: 0, endMs: 600_000 }, category: "held", findingKey: heldKey },
      { span: { startMs: 600_000, endMs: 18_300_000 }, category: "payable", findingKey: null },
    ],
    exactMs: { payable: 17_700_000, break: 0, inactivity: 0, held: 600_000, manual: 0, outside: 0 },
    minutes: { recorded: 305, eligibleTracked: 305, outside: 0, break: 0, inactivity: 0, held: 10, manualExcluded: 0, recommended: 295, approved: 0 },
    findings: [{
      id: heldKey, key: heldKey, scope: { organizationId: org, personId: person }, dayId: "", date: "2026-11-05",
      kind: "inactivity", status: "needs_review", effect: "hold", span: { startMs: 0, endMs: 600_000 },
      durationMs: 600_000, minutes: 10, sourceHash: "hash", blocksApproval: true, requiredAction: "decide",
      reason: "Held run", citations: [],
    }],
    blockers: [], sourceHash: "day-hash", decisionKeys: [], decisionState: {}, decisionAmounts: {},
  };
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,status,analysis_revision,row_version,source_hash,totals,retention_expires_at)
    values($1,$2,$3,'2026-11-16','2026-11-01','2026-11-15','UTC','needs_review',1,0,'hash',$4::jsonb,'2026-12-16Z')`,
  [reviewId, org, person, JSON.stringify(day.minutes)]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot,source_token,provider_watermark,provider_verified_at,resolved_policy)
    values($1,$2,$3,1,'hash','v1','2026-11-16T06:05:00Z','{}','{}',$4,'2026-11-15T23:00:00Z','2026-11-16T06:00:00Z','{"providerFingerprint":"provider-fingerprint"}'::jsonb)`, [org, reviewId, person, token]);
  const savedDay = await f.db.query(`insert into work_payroll_days
    (organization_id,review_id,person_id,analysis_revision,local_date,week,status,recorded_ms,eligible_ms,exact_ms,partition,
     tracked_minutes,held_minutes,recommended_minutes,source_hash,result)
    values($1,$2,$3,1,'2026-11-05',1,'needs_review',18300000,18300000,$4::jsonb,$5::jsonb,305,10,295,'day-hash',$6::jsonb) returning id`,
  [org, reviewId, person, JSON.stringify(day.exactMs), JSON.stringify(day.partition), JSON.stringify(day)]);
  const dayId = String((savedDay.rows[0] as { id: string }).id);
  await f.db.query(`insert into work_payroll_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,blocks_approval,required_action,
     start_at,end_at,duration_ms,minutes,reason,citations,source_hash)
    values($1,$2,$3,1,$4,$5,'inactivity','needs_review','hold',true,'decide','2026-11-05T09:00:00Z','2026-11-05T09:10:00Z',600000,10,'Held run','[]','hash')`,
  [org, reviewId, person, dayId, heldKey]);
  return { dayId, token };
}
const command = (over: Partial<PayrollCommand> = {}): PayrollCommand => ({ rowVersion: "0", analysisRevision: 1, sourceHash: "hash", requestKey: "decision-1", ...over });
const approvalDeps = {
  refreshProvider: async () => ({
    complete: true, watermark: "2026-11-15T23:00:00Z", verifiedAt: "2026-11-16T06:05:00Z",
    fingerprint: "provider-fingerprint", pages: 1,
  }),
};
const count = async (f: Awaited<ReturnType<typeof payrollFixture>>, sql: string, params: unknown[] = []) =>
  Number(((await f.db.query(sql, params)).rows[0] as { n?: number }).n ?? 0);
const cell = async (f: Awaited<ReturnType<typeof payrollFixture>>, sql: string, params: unknown[] = []) =>
  (await f.db.query(sql, params)).rows[0] as Record<string, unknown>;

test("held minutes move to payable exactly once and an identical retry is inert", async () => {
  const { resolvePayrollFindings, loadPayrollReview } = await decisions();
  const f = await payrollFixture();
  try {
    await seed(f);
    const before = await loadPayrollReview(adminAccess, reviewId);
    assert.equal(before.totals.recommended, 295);
    const updated = await resolvePayrollFindings(adminAccess, reviewId, { ...command(), findingIds: [heldKey], action: "payable", note: "Checked the context" });
    assert.equal(updated.totals.recommended, 305);
    assert.equal(updated.totals.held, 0);
    const retry = await resolvePayrollFindings(adminAccess, reviewId, { ...command(), findingIds: [heldKey], action: "payable", note: "Checked the context" });
    assert.equal(retry.totals.recommended, 305);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_decisions where review_id=$1", [reviewId]), 1);
    assert.equal((await cell(f, "select review_status from work_activity_intervals where id='30000000-0000-4000-8000-000000000001'")).review_status, "inferred");
  } finally { await f.close(); }
});

test("excluded moves held to inactivity without a second deduction", async () => {
  const { resolvePayrollFindings } = await decisions();
  const f = await payrollFixture();
  try {
    await seed(f);
    const updated = await resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "decision-2" }), findingIds: [heldKey], action: "excluded", note: "No work evidence" });
    assert.equal(updated.totals.recommended, 295);
    assert.equal(updated.totals.held, 0);
    assert.equal(updated.totals.inactivity, 10);
  } finally { await f.close(); }
});

test("incompatible batch effects fail without a partial decision", async () => {
  const { resolvePayrollFindings } = await decisions();
  const f = await payrollFixture();
  try {
    await seed(f);
    await assert.rejects(resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "bad-batch" }), findingIds: [heldKey, "break:1"], action: "payable", note: "Batch" }), /no longer exist|break/i);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_decisions where review_id=$1", [reviewId]), 0);
  } finally { await f.close(); }
});

test("approval_retry_preserves_the_same_receipt", async () => {
  const { resolvePayrollFindings, loadPayrollReview } = await decisions();
  const { approvePayrollReview } = await approvals();
  const f = await payrollFixture();
  try {
    await seed(f);
    await resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "decide-for-approval" }), findingIds: [heldKey], action: "payable", note: "Resolved" });
    const current = await loadPayrollReview(adminAccess, reviewId);
    const input = { rowVersion: current.token.rowVersion, analysisRevision: 1, sourceHash: "hash", requestKey: "approve-1", note: "Payroll approved" };
    const first = await approvePayrollReview(adminAccess, reviewId, input, approvalDeps);
    const retry = await approvePayrollReview(adminAccess, reviewId, input, approvalDeps);
    assert.equal(first.id, retry.id);
    assert.equal(first.snapshotHash, retry.snapshotHash);
    assert.equal(first.totals.approved, 305);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_approvals where review_id=$1", [reviewId]), 1);
    const snapshot = (await f.db.query(`select snapshot from work_payroll_approvals where id=$1`, [first.id])).rows[0] as { snapshot: Record<string, unknown> };
    assert.doesNotMatch(JSON.stringify(snapshot.snapshot), /storage_path|storagePath|https?:\/\//);
  } finally { await f.close(); }
});

test("changed or unavailable provider evidence blocks approval", async () => {
  const { resolvePayrollFindings, loadPayrollReview } = await decisions();
  const { approvePayrollReview } = await approvals();
  const f = await payrollFixture();
  try {
    await seed(f);
    await resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "decide-provider" }), findingIds: [heldKey], action: "payable", note: "Resolved" });
    const current = await loadPayrollReview(adminAccess, reviewId);
    const changed = {
      refreshProvider: async () => ({
        complete: true, watermark: "2026-11-15T23:30:00Z", verifiedAt: "2026-11-16T06:05:00Z",
        fingerprint: "different-provider-fingerprint", pages: 1,
      }),
    };
    await assert.rejects(approvePayrollReview(adminAccess, reviewId, {
      rowVersion: current.token.rowVersion, analysisRevision: 1, sourceHash: "hash", requestKey: "approve-provider-changed",
    }, changed), /provider evidence changed/i);
    await assert.rejects(approvePayrollReview(adminAccess, reviewId, {
      rowVersion: current.token.rowVersion, analysisRevision: 1, sourceHash: "hash", requestKey: "approve-provider-offline",
    }, { refreshProvider: async () => { throw new Error("provider offline"); } }), /provider refresh/i);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_approvals where review_id=$1", [reviewId]), 0);
  } finally { await f.close(); }
});

test("a source edit after the analysis freezes approval with a conflict", async () => {
  const { resolvePayrollFindings, loadPayrollReview } = await decisions();
  const { approvePayrollReview } = await approvals();
  const f = await payrollFixture();
  try {
    await seed(f);
    await resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "decide-source" }), findingIds: [heldKey], action: "payable", note: "Resolved" });
    const current = await loadPayrollReview(adminAccess, reviewId);
    await f.db.query("update work_sessions set organization_id=$1,person_id=$2,clocked_out_at='2026-11-16T00:00:00Z' where id=1", [org, person]);
    await assert.rejects(approvePayrollReview(adminAccess, reviewId, { rowVersion: current.token.rowVersion, analysisRevision: 1, sourceHash: "hash", requestKey: "approve-source" }, approvalDeps), /source|changed/i);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_approvals where review_id=$1", [reviewId]), 0);
  } finally { await f.close(); }
});

test("reopening keeps the old receipt addressable and creates no new approval", async () => {
  const { resolvePayrollFindings, loadPayrollReview } = await decisions();
  const { approvePayrollReview, reopenPayrollReview } = await approvals();
  const f = await payrollFixture();
  try {
    await seed(f);
    await resolvePayrollFindings(adminAccess, reviewId, { ...command({ requestKey: "decide-reopen" }), findingIds: [heldKey], action: "payable", note: "Resolved" });
    const current = await loadPayrollReview(adminAccess, reviewId);
    const approval = await approvePayrollReview(adminAccess, reviewId, { rowVersion: current.token.rowVersion, analysisRevision: 1, sourceHash: "hash", requestKey: "approve-reopen" }, approvalDeps);
    const reopened = await reopenPayrollReview(adminAccess, reviewId, { rowVersion: "2", analysisRevision: 1, sourceHash: "hash", requestKey: "reopen-1", reason: "New evidence" });
    assert.equal(reopened.status, "reopened");
    assert.equal(reopened.approval, null);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_approvals where review_id=$1", [reviewId]), 1);
    assert.equal((await cell(f, "select status from work_payroll_reviews where id=$1", [reviewId])).status, "reopened");
    assert.ok(approval.id);
  } finally { await f.close(); }
});
