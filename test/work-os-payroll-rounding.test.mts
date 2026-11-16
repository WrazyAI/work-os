import assert from "node:assert/strict";
import test from "node:test";
import type { Category } from "../src/modules/work-os/payroll/contracts";

// The break this catches: rounding each run instead of the whole day, or
// allocating the residual to the wrong category when fractions tie.
const rounding = () => import("../src/lib/work-os-payroll-hours");
const cats = (over: Partial<Record<Category, number>> = {}): Record<Category, number> => ({
  payable: 0, break: 0, inactivity: 0, held: 0, manual: 0, outside: 0, ...over,
});

test("179, 180 and 181 seconds all round half up without per-run rounding", async () => {
  const { allocatePayrollMinutes } = await rounding();
  for (const [seconds, expected] of [[179, 3], [180, 3], [181, 3], [149, 2], [150, 3], [89, 1], [90, 2]] as const) {
    const minutes = allocatePayrollMinutes(cats({ payable: seconds * 1000 }));
    assert.equal(minutes.payable, expected, `${seconds}s`);
    assert.equal(Object.values(minutes).reduce((sum, value) => sum + value, 0), expected);
  }
});

test("largest remainder uses the documented payable-first stable tie order", async () => {
  const { allocatePayrollMinutes } = await rounding();
  assert.deepEqual(allocatePayrollMinutes(cats({ payable: 90_000, outside: 90_000 })), cats({ payable: 2, outside: 1 }));
  assert.deepEqual(allocatePayrollMinutes(cats({ payable: 100_000, break: 100_000, outside: 100_000 })), cats({ payable: 2, break: 2, outside: 1 }));
  assert.deepEqual(allocatePayrollMinutes(cats({ payable: 30_000, break: 30_000, inactivity: 30_000, held: 30_000, manual: 30_000, outside: 30_000 })), cats({ payable: 1, break: 1, inactivity: 1 }));
  const uneven = allocatePayrollMinutes(cats({ payable: 50_000, break: 50_000, inactivity: 50_000, held: 50_000 }));
  assert.deepEqual(uneven, cats({ payable: 1, break: 1, inactivity: 1 }));
});

test("the allocation target is the half-up recorded duration and totals agree", async () => {
  const { allocatePayrollMinutes } = await rounding();
  assert.deepEqual(allocatePayrollMinutes(cats()), cats());
  assert.deepEqual(allocatePayrollMinutes(cats({ payable: 29_999 })), cats({ payable: 0 }));
  assert.deepEqual(allocatePayrollMinutes(cats({ payable: 30_000 })), cats({ payable: 1 }));
  for (const values of [
    { payable: 1, break: 2, inactivity: 3, held: 4, manual: 5, outside: 6 },
    { payable: 123_456, break: 7_890, inactivity: 12_345, held: 999, manual: 1, outside: 45_678 },
  ]) {
    const exact = cats(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * 58_000])) as Partial<Record<Category, number>>);
    const minutes = allocatePayrollMinutes(exact);
    const totalMs = Object.values(exact).reduce((sum, value) => sum + value, 0);
    assert.equal(Object.values(minutes).reduce((sum, value) => sum + value, 0), Math.floor(totalMs / 60_000 + 0.5));
    for (const key of Object.keys(cats()) as Category[]) {
      assert.ok(minutes[key] >= 0);
      assert.ok(minutes[key] <= exact[key] / 60_000 + 1);
    }
  }
  assert.throws(() => allocatePayrollMinutes(cats({ payable: -1 })), /negative/i);
  assert.throws(() => allocatePayrollMinutes(cats({ payable: Number.NaN })), /finite/i);
  assert.throws(() => allocatePayrollMinutes(cats({ payable: 1.5 })), /integer/i);
});
