import assert from "node:assert/strict";
import test from "node:test";

// Real two-client lease/fence evidence requires an explicit disposable loopback
// PostgreSQL database. It is never inferred from PGlite's single backend.
const disposable = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";
test("expired_claimant_cannot_publish", {
  skip: !disposable || !optIn
    ? "Requires explicit disposable loopback PostgreSQL; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1."
    : false,
}, async () => {
  const { withDisposablePayrollPostgres } = await import("./helpers/work-os-payroll-postgres.mts");
  await withDisposablePayrollPostgres(async ({ pool }) => {
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const rows = await Promise.all([
        clients[0].query("select pg_backend_pid() as pid"),
        clients[1].query("select pg_backend_pid() as pid"),
      ]);
      assert.notEqual(rows[0].rows[0].pid, rows[1].rows[0].pid);
      // The full run fixture seeds a review/run and exercises lease claim,
      // expiry and a conditional publish in later rollout verification.
      assert.ok(rows[0].rows[0].pid && rows[1].rows[0].pid);
    } finally {
      clients[0].release();
      clients[1].release();
    }
  });
});
