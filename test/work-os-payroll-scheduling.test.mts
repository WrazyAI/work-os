import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { payrollFixture, org } from "./helpers/work-os-payroll-fixture.mts";
import { activatePayrollPilot } from "../src/lib/work-os-payroll-api";

const root = new URL("../", import.meta.url);
const workflow = (name: string) => readFile(new URL(`.github/workflows/${name}`, root), "utf8");

test("recap_workflow_calls_hourly_service_without_logging_secret", async () => {
  const recap = await workflow("work-os-payroll-recap-approval.yml");
  assert.match(recap, /17 \* \* \* \*/);
  assert.match(recap, /auto-approve-payroll/);
  assert.doesNotMatch(recap, /set -x|echo.*CRON_SECRET/);
  assert.match(recap, /cancel-in-progress: false/);
  assert.match(recap, /timeout-minutes: 10/);
  assert.match(recap, /--max-time 110/);
});

test("advance and purge workflows are bounded and service-only endpoints", async () => {
  const advance = await workflow("work-os-payroll-advance.yml");
  const retention = await workflow("work-os-payroll-retention.yml");
  assert.match(advance, /\*\/5 \* \* \* \*/);
  assert.match(advance, /run-due/);
  assert.match(retention, /41 3 \* \* \*/);
  assert.match(retention, /payroll\/retention/);
  assert.doesNotMatch(advance + retention, /set -x|echo.*CRON_SECRET/);
});

test("service handlers refuse missing and wrong bearer secrets before work", async () => {
  const { POST: advance } = await import("../src/app/api/work-os/admin/payroll/run-due/route.ts");
  const { POST: retention } = await import("../src/app/api/work-os/admin/payroll/retention/route.ts");
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "expected";
  try {
    assert.equal((await advance(new Request("http://localhost/x", { method: "POST" }))).status, 401);
    assert.equal((await advance(new Request("http://localhost/x", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
    assert.equal((await retention(new Request("http://localhost/x", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});

test("pilot activation is explicit, revisioned and off by default", async () => {
  const f = await payrollFixture();
  try {
    const activated = await activatePayrollPilot(org, { expectedRevision: 0, autoApprove: false, cutoffHour: 6, activatedAt: new Date("2026-11-16T06:00:00Z") });
    assert.equal(activated.enabled, true);
    assert.equal(activated.auto_approve_enabled, false);
    assert.equal(Number(activated.revision), 1);
    await assert.rejects(activatePayrollPilot(org, { expectedRevision: 0, autoApprove: true, cutoffHour: 6, activatedAt: new Date() }), /changed|revision/i);
  } finally { await f.close(); }
});
