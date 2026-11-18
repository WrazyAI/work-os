import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess } from "./helpers/work-os-admin-otto-fixture.mts";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import { loadPayrollSourceToken } from "../src/lib/work-os-payroll-freshness";
import type { PayrollDayResult, PayrollScope, PayrollSourceManifest } from "../src/modules/work-os/payroll/contracts";
import type { PayrollRunDeps } from "../src/lib/work-os-payroll-runs";
import type { PoolClient } from "pg";

// The break this catches: a duplicate click launching two runs, a stale
// claimant publishing over a newer lease, or losing the frozen run identity on
// restart.
const runs = () => import("../src/lib/work-os-payroll-runs");
const scope: PayrollScope = { organizationId: org, personId: person };
const count = async (f: Awaited<ReturnType<typeof payrollFixture>>, sql: string, params: unknown[] = []) =>
  Number(((await f.db.query(sql, params)).rows[0] as { n?: number }).n ?? 0);
const period = resolvePayrollPeriod("2026-11-16", "UTC");
const dayResult = (date: string): PayrollDayResult => ({
  id: null, scope, date, week: 1,
  partition: [{ span: { startMs: Date.parse(`${date}T09:00:00Z`), endMs: Date.parse(`${date}T10:00:00Z`) }, category: "payable", findingKey: null }],
  exactMs: { payable: 3_600_000, break: 0, inactivity: 0, held: 0, manual: 0, outside: 0 },
  minutes: { recorded: 60, eligibleTracked: 60, outside: 0, break: 0, inactivity: 0, held: 0, manualExcluded: 0, recommended: 60, approved: 0 },
  findings: [], blockers: [], sourceHash: "day-source", decisionKeys: [], decisionState: {}, decisionAmounts: {},
});

async function deps(f: Awaited<ReturnType<typeof payrollFixture>>): Promise<PayrollRunDeps> {
  const token = await loadPayrollSourceToken(f.db as unknown as PoolClient, scope);
  const manifest: PayrollSourceManifest = {
    scope, period, asOf: "2026-11-16T06:05:00.000Z", sourceToken: token, policyVersion: "payroll-sources-v1",
    days: [{
      scope, date: "2026-11-05", week: 1, timezone: "UTC", sessions: [], breaks: [], pauseResidualMs: 0,
      captures: [], exceptions: [], frameSignals: [], frameCandidates: [], blockers: [], sourceHash: "day-source",
    }],
    weekSources: [
      { scope, week: 1, from: period.weeks[0].from, through: period.weeks[0].through, sourceHash: "week-1", recaps: [], outcomes: [], gaps: [] },
      { scope, week: 2, from: period.weeks[1].from, through: period.weeks[1].through, sourceHash: "week-2", recaps: [], outcomes: [], gaps: [] },
    ],
    hash: "manifest-hash", rawImageExpiry: {},
  };
  return {
    now: () => new Date("2026-11-16T06:05:00Z"),
    ensureRecaps: async () => ({ approved: 0, pending: 0, skipped: 0, complete: true }),
    fetchProviderPage: async () => ({ logs: [], nextCursor: null, complete: true, watermark: "" }),
    loadSources: async () => manifest,
    classifyFrame: async (_scope, frame) => ({ category: "unclear", confidence: 0, reason: "No image in fixture.", app: frame.app, sourceHash: frame.sourceHash, model: "fixture", promptVersion: "v1", classificationKey: "key" }),
    calculateDay: () => dayResult("2026-11-05"),
    advanceBrief: async (_scope, sources) => ({
      brief: { week: sources.week, status: "ready", title: `Week ${sources.week}`, summary: "Reviewed the supplied work.", summaryCitations: [], themes: [], openItems: [], gaps: [], sourceHash: sources.sourceHash },
      checkpoint: { sourceHash: sources.sourceHash, nextBatch: 0, drafts: [], phase: "done" }, complete: true,
    }),
    resolveConnection: async () => ({ connectionId: "connection", employeeId: "employee" }),
    providerDeps: { post: async () => { throw new Error("unused"); }, now: () => new Date(), reserve: async () => undefined },
    policy: { textModel: "deepseek/deepseek-v4.1-flash-1017", visionModel: "openai/gpt-6-luna", effort: "high", version: "payroll-ai-v1" },
  } as PayrollRunDeps;
}

test("duplicate_start_reuses_active_run", async () => {
  const { startPayrollRun } = await runs();
  const f = await payrollFixture();
  try {
    const first = await startPayrollRun(adminAccess, { personId: person, payDate: "2026-11-16", requestKey: "run-1" });
    const second = await startPayrollRun(adminAccess, { personId: person, payDate: "2026-11-16", requestKey: "run-2" });
    assert.equal(first.id, second.id);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_runs where review_id=$1 and status in ('queued','running')", [first.reviewId]), 1);
    assert.equal(second.targetRevision, first.targetRevision);
  } finally { await f.close(); }
});

test("a resumable run publishes one deterministic revision and two briefs", async () => {
  const { startPayrollRun, advancePayrollRun } = await runs();
  const f = await payrollFixture();
  try {
    const run = await startPayrollRun(adminAccess, { personId: person, payDate: "2026-11-16", requestKey: "run-3" });
    let progress: Awaited<ReturnType<typeof advancePayrollRun>> | undefined;
    for (let call = 0; call < 20; call += 1) {
      progress = await advancePayrollRun(scope, run.id, await deps(f), new Date("2026-11-16T06:05:00Z"));
      if (progress.status === "done" || progress.status === "failed") break;
    }
    assert.equal(progress?.status, "done");
    const review = (await f.db.query("select status,analysis_revision,totals from work_payroll_reviews where id=$1", [run.reviewId])).rows[0] as Record<string, unknown>;
    assert.equal(review.status, "ready");
    assert.equal(Number(review.analysis_revision), run.targetRevision);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_days where review_id=$1 and analysis_revision=$2", [run.reviewId, run.targetRevision]), 1);
    assert.equal(await count(f, "select count(*)::int as n from work_payroll_week_briefs where review_id=$1 and analysis_revision=$2", [run.reviewId, run.targetRevision]), 2);
    assert.equal(((await f.db.query("select status from work_payroll_runs where id=$1", [run.id])).rows[0] as { status: string }).status, "done");
    const again = await advancePayrollRun(scope, run.id, await deps(f), new Date("2026-11-16T06:06:00Z"));
    assert.equal(again.status, "done");
  } finally { await f.close(); }
});

test("cancelling a run fences publication and leaves no active lease", async () => {
  const { startPayrollRun, advancePayrollRun, cancelPayrollRun } = await runs();
  const f = await payrollFixture();
  try {
    const run = await startPayrollRun(adminAccess, { personId: person, payDate: "2026-11-16", requestKey: "run-4" });
    const canceled = await cancelPayrollRun(adminAccess, run.id, { rowVersion: run.rowVersion });
    assert.equal(canceled.progress.status, "canceled");
    const progress = await advancePayrollRun(scope, run.id, await deps(f), new Date("2026-11-16T06:05:00Z"));
    assert.equal(progress.status, "canceled");
    const row = (await f.db.query("select status,lease_token,lease_until from work_payroll_runs where id=$1", [run.id])).rows[0] as Record<string, unknown>;
    assert.equal(row.status, "canceled");
    assert.equal(row.lease_token, null);
    assert.equal(row.lease_until, null);
  } finally { await f.close(); }
});
