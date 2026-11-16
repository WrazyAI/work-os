import assert from "node:assert/strict";
import test from "node:test";

// The break this catches: treating a semimonthly period as 14 rolling days,
// or applying the pay cutoff in the server's timezone instead of the person's.
const service = () => import("../src/lib/work-os-payroll-period");

test("payroll periods exclude the pay date and split at seven days", async () => {
  const { resolvePayrollPeriod } = await service();
  const period = resolvePayrollPeriod("2026-11-16", "Atlantic/Reykjavik");
  assert.deepEqual(period, {
    payDate: "2026-11-16", from: "2026-11-01", through: "2026-11-15",
    timezone: "Atlantic/Reykjavik",
    weeks: [
      { week: 1, from: "2026-11-01", through: "2026-11-07" },
      { week: 2, from: "2026-11-08", through: "2026-11-15" },
    ],
  });
  const secondHalf = resolvePayrollPeriod("2026-11-01", "UTC");
  assert.deepEqual([secondHalf.from, secondHalf.through], ["2026-10-16", "2026-10-31"]);
  assert.deepEqual(secondHalf.weeks, [
    { week: 1, from: "2026-10-16", through: "2026-10-22" },
    { week: 2, from: "2026-10-23", through: "2026-10-31" },
  ]);
});

test("payroll handles short, leap and year-crossing months", async () => {
  const { resolvePayrollPeriod } = await service();
  for (const [pay, from, through] of [
    ["2027-03-01", "2027-02-16", "2027-02-28"],
    ["2028-03-01", "2028-02-16", "2028-02-29"],
    ["2027-01-01", "2026-12-16", "2026-12-31"],
    ["2026-05-01", "2026-04-16", "2026-04-30"],
  ]) {
    const period = resolvePayrollPeriod(pay, "UTC");
    assert.deepEqual([period.from, period.through], [from, through]);
  }
  assert.deepEqual(resolvePayrollPeriod("2028-03-01", "UTC").weeks[1], {
    week: 2, from: "2028-02-23", through: "2028-02-29",
  });
});

test("only actual first and sixteenth calendar dates are accepted", async () => {
  const { resolvePayrollPeriod } = await service();
  for (const value of ["2026-11-02", "2026-02-30", "2026-2-01", "2026-11-16T00:00Z", "", "0000-01-01"]) {
    assert.throws(() => resolvePayrollPeriod(value, "UTC"), /date|year/i, value);
  }
  assert.throws(() => resolvePayrollPeriod("2026-11-16", "Mars/Olympus"), /timezone/i);
  assert.throws(() => resolvePayrollPeriod("2026-11-16", ""), /timezone/i);
});

test("latest due period uses the employee's calendar rather than host timezone", async () => {
  const { latestDuePayrollPeriod } = await service();
  const at = new Date("2026-11-16T00:30:00Z");
  assert.equal(latestDuePayrollPeriod(at, "UTC").payDate, "2026-11-16");
  assert.equal(latestDuePayrollPeriod(at, "America/Los_Angeles").payDate, "2026-11-01");
  assert.equal(latestDuePayrollPeriod(new Date("2026-12-01T01:00:00Z"), "America/New_York").payDate, "2026-11-16");
  assert.equal(latestDuePayrollPeriod(new Date("2027-01-01T00:00:00Z"), "UTC").payDate, "2027-01-01");
  assert.throws(() => latestDuePayrollPeriod(new Date(NaN), "UTC"), /instant/i);
});

test("payroll recap auto-approval waits until the local cutoff and catches up", async () => {
  const { resolvePayrollPeriod, payrollAutoApprovalDue } = await service();
  const period = resolvePayrollPeriod("2026-11-16", "Atlantic/Reykjavik");
  assert.equal(payrollAutoApprovalDue(period, new Date("2026-11-16T05:59:59Z")), false);
  assert.equal(payrollAutoApprovalDue(period, new Date("2026-11-16T06:00:00Z")), true);
  assert.equal(payrollAutoApprovalDue(period, new Date("2026-11-17T01:00:00Z")), true);
  assert.equal(payrollAutoApprovalDue(period, new Date("2026-11-15T23:59:59Z")), false);
  assert.equal(payrollAutoApprovalDue(period, new Date("2026-11-16T07:00:00Z"), 8), false);
  const ny = resolvePayrollPeriod("2026-11-16", "America/New_York");
  assert.equal(payrollAutoApprovalDue(ny, new Date("2026-11-16T10:59:59Z")), false);
  assert.equal(payrollAutoApprovalDue(ny, new Date("2026-11-16T11:00:00Z")), true);
  for (const hour of [-1, 24, 6.5, NaN]) assert.throws(() => payrollAutoApprovalDue(period, new Date(), hour), /hour/i);
  assert.throws(() => payrollAutoApprovalDue(period, new Date(NaN)), /instant/i);
});
