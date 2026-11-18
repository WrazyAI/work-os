import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayrollOverviewView } from "../src/modules/work-os/admin/payroll/PayrollOverviewView";
import { PayrollReviewView } from "../src/modules/work-os/admin/payroll/PayrollReviewView";
import { payrollRosterFixture, payrollReviewFixture, staleReview } from "./fixtures/work-os-payroll";

test("stale review renders a re-analyze action and no approve action", () => {
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review: staleReview, onApprove() {}, onAdvance() {} }));
  assert.match(markup, /Re-analyze/);
  assert.doesNotMatch(markup, /Approve payable hours/);
  assert.match(markup, /Evidence changed/);
});

test("system_recaps_do_not_claim_employee_review", () => {
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review: payrollReviewFixture() }));
  assert.match(markup, /Auto-approved for payroll/);
  assert.match(markup, /3 employee-reviewed/);
  assert.match(markup, /not an employee confirmation/);
});

test("overview shows exact period dates and both review states", () => {
  const markup = renderToStaticMarkup(createElement(PayrollOverviewView, { page: payrollRosterFixture, payDate: "2026-11-16" }));
  assert.match(markup, /2026-11-01 — 2026-11-15/);
  assert.match(markup, /Ada Lovelace/);
  assert.match(markup, /Open review/);
});
