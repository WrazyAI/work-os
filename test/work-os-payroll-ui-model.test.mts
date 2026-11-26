import assert from "node:assert/strict";
import test from "node:test";
import { payrollReviewFixture, staleReview } from "./fixtures/work-os-payroll";
import { payrollReviewModel } from "../src/modules/work-os/admin/payroll/model";
import { resolvePayrollWindow } from "../src/lib/work-os-payroll-period";

// The break this catches: approving stale evidence, subtracting outside time
// twice, or presenting payroll-auto recaps as employee-reviewed.
test("stale_review_cannot_be_approved", () => {
  assert.equal(payrollReviewModel(staleReview).canApprove, false);
  assert.ok(payrollReviewModel(staleReview).blockers.some((blocker) => /re-analyze/i.test(blocker)));
  assert.equal(payrollReviewModel(payrollReviewFixture({ recapStats: { employeeReviewed: 3, autoApproved: 2, pending: 0 } }), "2026-11-26").canApprove, true);
});

test("ready analysis with unsettled recaps does not offer approval", () => {
  const model = payrollReviewModel(payrollReviewFixture());
  assert.equal(model.canApprove, false);
  assert.match(model.blockers.join(" "), /recap/i);
});

test("an ended full period can be approved; a future full period cannot", () => {
  const future = payrollReviewFixture({
    period: { ...payrollReviewFixture().period, from: "2026-12-01", through: "2026-12-15", payDate: "2026-12-16" },
    recapStats: { employeeReviewed: 3, autoApproved: 2, pending: 0 },
  });
  const model = payrollReviewModel(future, "2026-11-26");
  assert.equal(model.canApprove, false);
  assert.match(model.blockers.join(" "), /has not ended/i);
});

test("a partial analysis window cannot be approved as a payroll period", () => {
  const period = resolvePayrollWindow("2026-11-01", "2026-11-10", "UTC", new Date("2026-11-12T12:00:00Z"));
  const review = payrollReviewFixture({ period, recapStats: { employeeReviewed: 3, autoApproved: 2, pending: 0 } });
  const model = payrollReviewModel(review);
  assert.equal(model.canApprove, false);
  assert.match(model.blockers.join(" "), /partial payroll window/i);
});

test("reconciliation keeps recorded, eligible and outside as separate lines", () => {
  const model = payrollReviewModel(payrollReviewFixture());
  assert.equal(model.reconciliation.find((row) => row.kind === "recorded")?.minutes, 370);
  assert.equal(model.reconciliation.find((row) => row.kind === "eligibleTracked")?.minutes, 350);
  assert.equal(model.reconciliation.find((row) => row.kind === "outside")?.minutes, 20);
  assert.equal(model.reconciliation.find((row) => row.kind === "recommended")?.minutes, 285);
});

test("recap provenance is split and an exact expiry reminder is present", () => {
  const model = payrollReviewModel(payrollReviewFixture());
  assert.deepEqual(model.recapStats, { employeeReviewed: 3, autoApproved: 2, pending: 1 });
  assert.match(model.retentionLabel, /2026-12-16/);
  assert.match(model.retentionLabel, /export/i);
});
