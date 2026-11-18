import { resolvePayrollPeriod } from "../../src/lib/work-os-payroll-period";
import type { PayrollReview, PayrollRosterPage } from "../../src/modules/work-os/payroll/contracts";

export function payrollReviewFixture(over: Partial<PayrollReview> = {}): PayrollReview {
  const period = resolvePayrollPeriod("2026-11-16", "UTC");
  return {
    id: "95000000-0000-4000-8000-000000000001",
    scope: { organizationId: "10000000-0000-4000-8000-000000000001", personId: "20000000-0000-4000-8000-000000000001" },
    period,
    token: { rowVersion: "0", analysisRevision: 1, sourceHash: "manifest-hash" },
    status: "ready",
    totals: { recorded: 370, eligibleTracked: 350, outside: 20, break: 20, inactivity: 45, held: 0, manualExcluded: 0, recommended: 285, approved: 0 },
    briefs: [
      { week: 1, status: "ready", title: "Queue and review", summary: "Reviewed the queue and documented the result.", summaryCitations: [], themes: [], openItems: [], gaps: [], sourceHash: "week-1" },
      { week: 2, status: "ready", title: "Delivery", summary: "Prepared the delivery record.", summaryCitations: [], themes: [], openItems: [], gaps: [], sourceHash: "week-2" },
    ],
    blockers: [], run: null, approval: null,
    retentionExpiresAt: "2026-12-16T00:00:00.000Z", firstExportAt: null,
    evidenceChangedSinceApproval: false, providerVerifiedAt: null,
    recapStats: { employeeReviewed: 3, autoApproved: 2, pending: 1 },
    ...over,
  };
}

export const staleReview = payrollReviewFixture({ status: "stale", evidenceChangedSinceApproval: true });

export const payrollRosterFixture: PayrollRosterPage = {
  items: [{
    personId: "20000000-0000-4000-8000-000000000001", displayName: "Ada Lovelace", active: true, mapped: true,
    reviewId: "95000000-0000-4000-8000-000000000001", status: "ready",
    totals: { recorded: 370, eligibleTracked: 350, outside: 20, break: 20, inactivity: 45, held: 0, manualExcluded: 0, recommended: 285, approved: 0 }, workdays: 10,
  }],
  total: 1, nextCursor: null, period: resolvePayrollPeriod("2026-11-16", "UTC"),
  counts: { ready: 1, confirmed: 3, approved: 0 },
};
