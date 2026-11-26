import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayrollOverviewView } from "../src/modules/work-os/admin/payroll/PayrollOverviewView";
import { PayrollReviewView } from "../src/modules/work-os/admin/payroll/PayrollReviewView";
import { payrollDefaultWindow } from "../src/modules/work-os/admin/payroll/paths";
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
  assert.match(markup, /3 employee-reviewed/);
  assert.match(markup, /2 system-reviewed/);
  assert.match(markup, /1 pending/);
  assert.doesNotMatch(markup, /employee confirmation/);
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

test("attention findings stay actionable on a ready review and expose linked frames", () => {
  const review = payrollReviewFixture();
  const finding = {
    id: "f-action", key: "inactivity:action", scope: review.scope, dayId: "d1", date: "2026-11-04",
    kind: "inactivity" as const, status: "needs_review" as const, effect: "hold" as const,
    span: { startMs: 0, endMs: 240_000 }, durationMs: 240_000, minutes: 4,
    sourceHash: "s", blocksApproval: true, requiredAction: "decide" as const,
    reason: "Continuous verified zero activity for 3 minutes or more is excluded from pay.",
    citations: [], frameSummaryIds: ["90000000-0000-4000-8000-000000000010"],
  };
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review, findings: [finding], onDecide: async () => {} }));
  assert.match(markup, />Approve</);
  assert.match(markup, />Reject</);
  assert.match(markup, /1 frame/);
  assert.ok(markup.indexOf("Needs attention") < markup.indexOf("Excluded by rule"), "decisions come before the excluded ledger");
  assert.ok(markup.indexOf("Excluded by rule") < markup.indexOf("Daily evidence"), "daily evidence follows the review queue");
  assert.ok(markup.indexOf("Daily evidence") < markup.indexOf("Weekly briefs"), "briefs are supporting context");
  assert.ok(markup.indexOf("Weekly briefs") < markup.indexOf("Apps and sites"), "apps are context after the review");
});

test("pay-affecting acknowledgement findings offer approve or reject, not a bare acknowledgement", () => {
  const review = payrollReviewFixture();
  const finding = {
    id: "f-gap", key: "unverified_gap:1", scope: review.scope, dayId: "d1", date: "2026-11-04",
    kind: "unverified_gap" as const, status: "needs_review" as const, effect: "acknowledge" as const,
    span: { startMs: 0, endMs: 360_000 }, durationMs: 360_000, minutes: 6,
    sourceHash: "s", blocksApproval: true, requiredAction: "acknowledge" as const,
    reason: "Tracked time has no valid activity coverage. Approve to keep it payable, or reject to exclude it.",
    citations: [], frameSummaryIds: ["90000000-0000-4000-8000-000000000010"],
  };
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review, findings: [finding], onDecide: async () => {} }));
  assert.match(markup, />Approve</);
  assert.match(markup, />Reject</);
  assert.doesNotMatch(markup, />Acknowledge</);
});

test("a running analysis offers cancel and cannot record a decision", () => {
  const review = payrollReviewFixture({
    status: "analyzing",
    run: {
      id: "run-1", reviewId: "95000000-0000-4000-8000-000000000001",
      scope: { organizationId: "10000000-0000-4000-8000-000000000001", personId: "20000000-0000-4000-8000-000000000001" },
      targetRevision: 2, asOf: "2026-11-16T06:05:00Z",
      progress: { phase: "evidence", message: "Reading provider evidence.", daysDone: 0, days: 10, framesClassified: 0, framesReused: 0, findings: 0, remaining: 10, status: "running", nextAttemptAt: null },
      rowVersion: "0",
    },
  });
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review, onCancel() {}, onDecide: async () => {} }));
  assert.match(markup, /Cancel analysis/);
  assert.doesNotMatch(markup, />Approve</);
});

test("new audit windows default to the available days in the current period", () => {
  assert.deepEqual(payrollDefaultWindow("2026-11-16", "2026-11-03"), { from: "2026-11-01", through: "2026-11-03", future: false });
  assert.deepEqual(payrollDefaultWindow("2026-11-16", "2026-12-01"), { from: "2026-11-01", through: "2026-11-15", future: false });
  assert.deepEqual(payrollDefaultWindow("2027-01-01", "2026-12-01"), { from: "2026-12-16", through: "2026-12-31", future: true });
});

test("excluded inactivity intervals are shown with frames and breaks carry no frames", () => {
  const review = payrollReviewFixture();
  const base = {
    id: "f1", key: "inactivity:1", scope: review.scope, dayId: "d1", date: "2026-11-04",
    effect: "exclude" as const, sourceHash: "s", blocksApproval: false, requiredAction: "none" as const,
    citations: [],
  };
  const findings = [
    { ...base, kind: "inactivity" as const, status: "auto_excluded" as const, span: { startMs: 0, endMs: 180_000 }, durationMs: 180_000, minutes: 3,
      reason: "Continuous verified zero activity for 3 minutes or more is excluded from pay.", frameSummaryIds: ["90000000-0000-4000-8000-000000000010"] },
    { ...base, id: "f2", key: "break:1", kind: "break" as const, status: "auto_excluded" as const, span: { startMs: 0, endMs: 1_800_000 }, durationMs: 1_800_000, minutes: 30,
      reason: "Break time is unpaid.", frameSummaryIds: [] },
  ];
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review, findings }));
  assert.match(markup, /Excluded by rule/);
  assert.match(markup, /Continuous inactivity · 3 minutes or more/);
  assert.match(markup, /1 frame/);
  assert.match(markup, /No frames by policy/);
  assert.doesNotMatch(markup, /Activity during break/);
});
