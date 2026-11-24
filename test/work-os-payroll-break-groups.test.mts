import assert from "node:assert/strict";
import test from "node:test";
import { groupBreakFindings } from "../src/modules/work-os/payroll/break-groups";
import type { PayrollFinding } from "../src/modules/work-os/payroll/contracts";

const breakFinding = (startMs: number, endMs: number, minutes: number): PayrollFinding => ({
  id: `break-${startMs}`, key: `break:${startMs}`, scope: { organizationId: "o", personId: "p" }, dayId: "d",
  date: "2026-11-02", kind: "break", status: "auto_excluded", effect: "exclude",
  span: { startMs, endMs }, durationMs: (endMs - startMs), minutes, sourceHash: "s",
  blocksApproval: false, requiredAction: "none", reason: "Unpaid break", citations: [],
});

test("break findings within the provider drift group into one display interval", () => {
  const grouped = groupBreakFindings([
    breakFinding(0, 60_000, 1),
    breakFinding(63_000, 123_000, 1),
    breakFinding(600_000, 660_000, 1),
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]!.minutes, 2);
  assert.deepEqual(grouped[0]!.span, { startMs: 0, endMs: 123_000 });
  assert.equal(grouped[1]!.minutes, 1);
});
