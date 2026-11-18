import assert from "node:assert/strict";
import test from "node:test";
import { payrollReviewFixture, staleReview } from "./fixtures/work-os-payroll";
import { payrollReviewModel } from "../src/modules/work-os/admin/payroll/model";

// The break this catches: approving stale evidence, subtracting outside time
// twice, or presenting payroll-auto recaps as employee-reviewed.
test("stale_review_cannot_be_approved", () => {
  assert.equal(payrollReviewModel(staleReview).canApprove, false);
  assert.ok(payrollReviewModel(staleReview).blockers.some((blocker) => /re-analyze/i.test(blocker)));
  assert.equal(payrollReviewModel(payrollReviewFixture()).canApprove, true);
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
