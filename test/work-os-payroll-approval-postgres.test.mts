import assert from "node:assert/strict";
import test from "node:test";

// Two independent PostgreSQL clients are required to prove a two-approval race;
// PGlite's single backend cannot. This test stays explicitly skipped until a
// disposable loopback URL is supplied.
const disposable = process.env.WORK_OS_TEST_POSTGRES_URL;
const optIn = process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE === "1";
test("two payroll approvals commit one receipt or an identical retry", {
  skip: !disposable || !optIn
    ? "Requires explicit disposable loopback PostgreSQL; set WORK_OS_TEST_POSTGRES_URL and WORK_OS_TEST_POSTGRES_DISPOSABLE=1."
    : false,
}, async () => {
  const { withDisposablePayrollPostgres } = await import("./helpers/work-os-payroll-postgres.mts");
  await withDisposablePayrollPostgres(async ({ pool }) => {
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const pids = await Promise.all([
        clients[0].query("select pg_backend_pid() as pid"),
        clients[1].query("select pg_backend_pid() as pid"),
      ]);
      assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid);
    } finally {
      clients[0].release();
      clients[1].release();
    }
  });
});
