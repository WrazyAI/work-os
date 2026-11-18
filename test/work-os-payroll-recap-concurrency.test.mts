import assert from "node:assert/strict";
import test from "node:test";
import { org, person } from "./helpers/work-os-payroll-fixture.mts";

// Requires an explicit disposable loopback PostgreSQL. PGlite serializes on one
// backend and cannot prove the organization-clock lock ordering.
const disposableUrl = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";
const unavailable = !disposableUrl || !optIn
  ? "Requires explicit disposable loopback PostgreSQL; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1."
  : false;

test("concurrent payroll cutoffs write exactly one immutable system version", { skip: unavailable }, async () => {
  const { withDisposablePayrollPostgres } = await import("./helpers/work-os-payroll-postgres.mts");
  await withDisposablePayrollPostgres(async ({ pool }) => {
    globalThis.__workOsPgPool = pool;
    try {
      await pool.query("insert into work_payroll_settings(organization_id,enabled,auto_approve_enabled,cutoff_hour,auto_approve_activated_at) values($1,true,true,6,'2026-10-01Z')", [org]);
      await pool.query(`insert into work_activity_intervals
        (id,organization_id,person_id,local_date,generation_status,review_status,headline,ai_detail,final_detail,structured_summary,source_hash,revision,window_start,window_end,timezone,generated_at,next_steps_status)
        values('70000000-0000-4000-8000-000000000001',$1,$2,'2026-11-05','ready','inferred','H','D','D','{}','s',1,'2026-11-05T12:00:00Z','2026-11-05T13:00:00Z','UTC','2026-11-05T13:01:00Z','not_requested')`, [org, person]);
      const { ensurePayrollRecapApproval } = await import("../src/lib/work-os-payroll-recap-approval");
      const { resolvePayrollPeriod } = await import("../src/lib/work-os-payroll-period");
      const period = resolvePayrollPeriod("2026-11-16", "UTC");
      const scope = { organizationId: org, personId: person };
      const results = await Promise.all([
        ensurePayrollRecapApproval(scope, period, new Date("2026-11-16T06:05:00Z"), 100),
        ensurePayrollRecapApproval(scope, period, new Date("2026-11-16T06:05:01Z"), 100),
      ]);
      assert.equal(results.reduce((sum, result) => sum + result.approved, 0), 1);
      const reviews = await pool.query("select review_source,version from work_recap_reviews");
      assert.deepEqual(reviews.rows, [{ review_source: "payroll_auto", version: 1 }]);
      assert.equal((await pool.query("select review_status,review_source from work_activity_intervals")).rows[0].review_source, "payroll_auto");
    } finally {
      globalThis.__workOsPgPool = undefined;
    }
  });
});
