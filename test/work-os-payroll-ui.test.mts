import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayrollOverviewView } from "../src/modules/work-os/admin/payroll/PayrollOverviewView";
import { PayrollReviewView } from "../src/modules/work-os/admin/payroll/PayrollReviewView";
import { payrollDefaultWindow } from "../src/modules/work-os/admin/payroll/paths";
import pageModule from "../src/app/work-os/admin/payroll/page";
import { payrollRosterFixture, payrollReviewFixture, staleReview } from "./fixtures/work-os-payroll";
import { payrollApi } from "../src/modules/work-os/admin/payroll/api";

test("web finding retrieval reaches the eleventh page", async (context) => {
  let page = 0;
  context.mock.method(payrollApi, "findings", async (_id: string, _status: string, cursor: string | null, revision: number) => {
    assert.equal(cursor, page ? String(page) : null);
    assert.equal(revision, 8);
    page += 1;
    return {
      items: Array.from({ length: page === 11 ? 1 : 100 }, (_, index) => ({ key: `${page}:${index}` })),
      total: 1001,
      nextCursor: page === 11 ? null : String(page),
    };
  });
  const result = await payrollApi.findingsAll("review", 8);
  assert.equal(result.items.length, 1001);
  assert.equal(result.items.at(-1)?.key, "11:0");
  assert.equal(result.nextCursor, null);
});

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

test("weekly briefs read as structured memos with dates, sources and observation sections", () => {
  const review = payrollReviewFixture();
  const source = { type: "interval" as const, id: "recap-42", revision: 7 };
  review.briefs = [{
    ...review.briefs[0],
    summaryCitations: [source],
    themes: [{ heading: "Release checks", detail: "Documented the rollback checks.", citations: [source] }],
    openItems: [{ text: "Confirm the staging result.", citations: [] }],
    gaps: ["Friday capture coverage is incomplete."],
  }];
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review }));
  assert.match(markup, /class="payroll-brief-head"/);
  assert.match(markup, /class="payroll-brief-week">Week 1</);
  assert.match(markup, /class="payroll-brief-period">Nov 1 – Nov 7, 2026</);
  assert.match(markup, /class="payroll-brief-state" data-tone="ok">Grounded in 1 source</);
  assert.match(markup, /class="payroll-brief-summary"/);
  assert.match(markup, /<h4>Work observed<\/h4>/);
  assert.match(markup, /class="payroll-brief-observation"/);
  assert.match(markup, /<h4>Open items<\/h4>/);
  assert.match(markup, /class="payroll-brief-limit"/);
  assert.match(markup, /Sources \(1\)/);
});

test("empty exclusion rules stay flat, compact and honest about zero removals", () => {
  const review = payrollReviewFixture();
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review }));
  assert.doesNotMatch(markup, /<details class="payroll-rule"/);
  assert.match(markup, /No intervals removed from pay/);
  assert.match(markup, /class="payroll-rule-count">None</);
  assert.doesNotMatch(markup, /class="payroll-rule-empty"/);
});

test("excluded findings align to labelled columns on every rule", () => {
  const review = payrollReviewFixture();
  const finding = {
    id: "break-1", key: "break:1", scope: review.scope, dayId: "d1", date: "2026-11-04",
    kind: "break" as const, status: "auto_excluded" as const, effect: "exclude" as const,
    span: { startMs: 0, endMs: 1_800_000 }, durationMs: 1_800_000, minutes: 30,
    sourceHash: "s", blocksApproval: false, requiredAction: "none" as const,
    reason: "Break time is unpaid.", citations: [], frameSummaryIds: [],
  };
  const markup = renderToStaticMarkup(createElement(PayrollReviewView, { review, findings: [finding] }));
  assert.match(markup, /class="payroll-rule-columns"/);
  for (const label of ["Date", "Time", "Excluded", "Evidence"]) assert.match(markup, new RegExp(`>${label}<`));
  assert.match(markup, /class="payroll-rule-evidence">No frames by policy/);
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
