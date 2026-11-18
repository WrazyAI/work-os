import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { payrollFixture, org, otherOrg, person, otherPerson } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";

// The break this catches: an export that joins live names/recaps, changes bytes
// on retry, or lets spreadsheet formulas escape text cells.
const exportsLib = () => import("../src/lib/work-os-payroll-exports");
const printLib = () => import("../src/modules/work-os/admin/payroll/PayrollPrint");
const approvalId = "91000000-0000-4000-8000-000000000001";
const reviewId = "92000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-16T06:05:00Z");

async function seedApproval(f: Awaited<ReturnType<typeof payrollFixture>>, input: {
  id?: string; review?: string; orgId?: string; personId?: string; payDate?: string; name?: string; emptyDays?: boolean;
} = {}) {
  const id = input.id ?? approvalId;
  const review = input.review ?? reviewId;
  const organizationId = input.orgId ?? org;
  const personId = input.personId ?? person;
  const payDate = input.payDate ?? "2026-11-16";
  const period = resolvePayrollPeriod(payDate, "UTC");
  const snapshot = {
    schemaVersion: "payroll-approval-v1", period,
    identity: { displayName: input.name ?? "Ada Lovelace" },
    totals: { recorded: 370, eligibleTracked: 370, outside: 0, break: 20, inactivity: 45, held: 0, manualExcluded: 0, recommended: 305, approved: 305 },
    days: input.emptyDays ? [] : [{ date: "2026-11-05", minutes: { recorded: 370, eligibleTracked: 370, outside: 0, break: 20, inactivity: 45, held: 0, manualExcluded: 0, recommended: 305, approved: 305 }, status: "resolved" }],
    briefs: [{ week: 1, status: "ready", title: "Week 1", summary: "Reviewed the queue.", summaryCitations: [], themes: [], openItems: [], gaps: [], sourceHash: "week-1" }],
    findings: [],
    sourceExplanation: { sourceHash: "manifest", sourceToken: "0:0", policyVersion: "v1", asOf: "2026-11-16T06:00:00Z" },
  };
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,status,analysis_revision,row_version,source_hash,totals,retention_expires_at)
    values($1,$2,$3,$4,$5,$6,'UTC','approved',1,1,'manifest',$7::jsonb,'2026-12-16Z')`,
  [review, organizationId, personId, payDate, period.from, period.through, JSON.stringify(snapshot.totals)]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
    values($1,$2,$3,1,'manifest','v1','2026-11-16T06:05:00Z','{}','{}')`, [organizationId, review, personId]);
  await f.db.query(`insert into work_payroll_approvals
    (id,organization_id,review_id,person_id,analysis_revision,revision,snapshot,approved_minutes,approved_by,approved_at,note,snapshot_hash,export_schema_version,request_key)
    values($1,$2,$3,$4,1,1,$5::jsonb,305,$6,'2026-11-16T06:05:00Z',null,'hash-1','payroll-approval-v1',$7)`,
  [id, organizationId, review, personId, JSON.stringify(snapshot), adminAccess.ctx.user.id, `approve-${id}`]);
  await f.db.query("update work_payroll_reviews set current_approval_id=$1 where organization_id=$2 and id=$3", [id, organizationId, review]);
  return { id, review, snapshot };
}

test("canonical_export_survives_live_changes", async () => {
  const { createPayrollExport } = await exportsLib();
  const f = await payrollFixture();
  try {
    await seedApproval(f);
    const first = await createPayrollExport(adminAccess, { approvalIds: [approvalId], kind: "summary", requestKey: "export-1" }, now);
    await f.db.query("update work_people set display_name='Changed Live Name' where id=$1", [person]);
    const retry = await createPayrollExport(adminAccess, { approvalIds: [approvalId], kind: "summary", requestKey: "export-2" }, new Date("2026-11-20T12:00:00Z"));
    assert.equal(Buffer.compare(Buffer.from(first.bytes), Buffer.from(retry.bytes)), 0);
    assert.equal(first.hash, retry.hash);
    const text = Buffer.from(first.bytes).toString("utf8");
    assert.match(text, /Ada Lovelace/);
    assert.doesNotMatch(text, /Changed Live Name|storage_path|x_api_key|data:image/);
    const review = (await f.db.query("select first_export_at,last_exported_at from work_payroll_reviews where id=$1", [reviewId])).rows[0] as Record<string, unknown>;
    assert.ok(review.first_export_at);
    const firstAnchor = String(review.first_export_at);
    const again = await createPayrollExport(adminAccess, { approvalIds: [approvalId], kind: "summary", requestKey: "export-3" }, new Date("2026-12-01T00:00:00Z"));
    assert.equal(Buffer.compare(Buffer.from(first.bytes), Buffer.from(again.bytes)), 0);
    assert.equal(String(((await f.db.query("select first_export_at from work_payroll_reviews where id=$1", [reviewId])).rows[0] as { first_export_at: unknown }).first_export_at), firstAnchor);
    assert.equal(((await f.db.query("select count(*)::int as n from work_payroll_exports where approval_id=$1", [approvalId])).rows[0] as { n: number }).n, 1);
  } finally { await f.close(); }
});

test("text cells are RFC4180 quoted and formula-safe while numeric columns stay numeric", async () => {
  const { createPayrollExport } = await exportsLib();
  const f = await payrollFixture();
  try {
    await seedApproval(f, { name: ' =SUM(1,1),"quoted"\r\nnext line' });
    const file = await createPayrollExport(adminAccess, { approvalIds: [approvalId], kind: "summary", requestKey: "export-csv" }, now);
    const text = Buffer.from(file.bytes).toString("utf8");
    assert.ok(text.startsWith("\uFEFFapproval_id,"));
    assert.match(text, /"' =SUM\(1,1\),""quoted""\r\nnext line"/);
    assert.match(text, /,305,5\.0833,/);
  } finally { await f.close(); }
});

test("bulk export rejects cross-org and mixed pay dates", async () => {
  const { createPayrollExport } = await exportsLib();
  const f = await payrollFixture();
  try {
    await seedApproval(f);
    await assert.rejects(createPayrollExport(adminAccess, { approvalIds: ["99999999-0000-4000-8000-000000000001"], kind: "summary", requestKey: "x" }, now), /not found/i);
    const secondReview = "92000000-0000-4000-8000-000000000002";
    await seedApproval(f, { id: "91000000-0000-4000-8000-000000000002", review: secondReview, payDate: "2026-11-01" });
    await assert.rejects(createPayrollExport(adminAccess, { approvalIds: [approvalId, "91000000-0000-4000-8000-000000000002"], kind: "summary", requestKey: "mixed" }, now), /pay date|mixed/i);
    await seedApproval(f, { id: "91000000-0000-4000-8000-000000000003", review: "92000000-0000-4000-8000-000000000003", orgId: otherOrg, personId: otherPerson });
    await assert.rejects(createPayrollExport(adminAccess, { approvalIds: [approvalId, "91000000-0000-4000-8000-000000000003"], kind: "summary", requestKey: "cross" }, now), /not found/i);
  } finally { await f.close(); }
});

test("daily export includes a no-work zero row for an empty approved day set", async () => {
  const { createPayrollExport } = await exportsLib();
  const f = await payrollFixture();
  try {
    const seed = await seedApproval(f, { emptyDays: true });
    const file = await createPayrollExport(adminAccess, { approvalIds: [seed.id], kind: "daily", requestKey: "daily-zero" }, now);
    const text = Buffer.from(file.bytes).toString("utf8");
    assert.match(text, /No work recorded/);
    assert.match(text, /shift_date,.*finding_count,reason_summary/);
  } finally { await f.close(); }
});

test("print is rendered from the frozen approval snapshot", async () => {
  const { PayrollPrint } = await printLib();
  const f = await payrollFixture();
  try {
    await seedApproval(f);
    const { loadPayrollPrint } = await exportsLib();
    const approval = await loadPayrollPrint(adminAccess, approvalId);
    const html = renderToStaticMarkup(createElement(PayrollPrint, { approval }));
    assert.match(html, /Payroll record/);
    assert.match(html, /Ada Lovelace/);
    assert.match(html, /Reviewed the queue/);
    assert.match(html, /hash-1/);
    assert.doesNotMatch(html, /storage_path|data:image/);
    const historical = renderToStaticMarkup(createElement(PayrollPrint, { approval, historical: true }));
    assert.match(historical, /historical approval/i);
  } finally { await f.close(); }
});
