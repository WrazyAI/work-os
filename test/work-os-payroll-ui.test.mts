import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayrollOverviewView } from "../src/modules/work-os/admin/payroll/PayrollOverviewView";
import { PayrollReviewView } from "../src/modules/work-os/admin/payroll/PayrollReviewView";
import pageModule from "../src/app/work-os/admin/payroll/page";
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

test("Payroll defaults to Records and New audit links to the Audits view", async () => {
  const PayrollOverviewPage = typeof pageModule === "function"
    ? pageModule : (pageModule as { default: typeof pageModule }).default;
  const page = await PayrollOverviewPage({ searchParams: Promise.resolve({}) });
  assert.equal(page.props.tab, "records");
  const audit = await PayrollOverviewPage({ searchParams: Promise.resolve({ tab: "audits", new: "1", payDate: "2026-11-16" }) });
  assert.equal(audit.props.tab, "audits");
  assert.equal(audit.props.newAudit, true);
  assert.equal(audit.props.initialPayDate, "2026-11-16");
  const markup = renderToStaticMarkup(createElement(PayrollOverviewView, { page: payrollRosterFixture, payDate: "2026-11-16" }));
  assert.match(markup, /\/work-os\/admin\/payroll\?tab=audits&amp;new=1&amp;payDate=2026-11-16/);
  assert.match(markup, /New audit/);
});

test("audit presents saved themes, open work, limitations and source revisions", () => {
  const review = payrollReviewFixture();
  const source = { type: "interval" as const, id: "recap-42", revision: 7 };
  review.briefs[0] = {
    ...review.briefs[0],
    summaryCitations: [source],
    themes: [{ heading: "Release checks", detail: "Documented the rollback checks.", citations: [source] }],
    openItems: [{ text: "Confirm the staging result.", citations: [source] }],
    gaps: ["Friday capture coverage is incomplete."],
  };
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review }));
  for (const text of ["Release checks", "Confirm the staging result.", "Friday capture coverage is incomplete.", "recap-42"]) {
    assert.ok(markup.includes(text), text);
  }
});
