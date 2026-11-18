import { recapReviewLabel } from "@/modules/work-os/recap-review";
import type { PayrollReview, PayrollTotals } from "@/modules/work-os/payroll/contracts";

export type PayrollReviewModel = {
  canApprove: boolean;
  blockers: string[];
  reconciliation: Array<{ kind: keyof PayrollTotals; minutes: number; label: string; findingStatus: string | null }>;
  retentionLabel: string;
  recapStats: { employeeReviewed: number; autoApproved: number; pending: number };
  stale: boolean;
  historicalApproval: boolean;
};

export function payrollReviewModel(review: PayrollReview): PayrollReviewModel {
  const stale = review.status === "stale" || review.status === "failed" || review.status === "analyzing" || review.evidenceChangedSinceApproval;
  const blockers = [...review.blockers];
  if (stale) blockers.push("Re-analyze before approval; the evidence or analysis changed.");
  if (review.status === "needs_review") blockers.push("Resolve the held or correction-required findings.");
  if (review.run && ["queued", "running"].includes(review.run.progress.status)) blockers.push("Analysis is still running.");
  const totals = review.totals;
  const canApprove = review.status === "ready" && !review.approval && !stale
    && !(review.run && ["queued", "running"].includes(review.run.progress.status))
    && totals.held === 0 && blockers.length === 0;
  const retention = Date.parse(review.retentionExpiresAt);
  const retentionLabel = Number.isFinite(retention)
    ? `Expires ${new Date(retention).toISOString().slice(0, 10)} · export before then`
    : "Expiry not recorded";
  return {
    canApprove, blockers, stale,
    historicalApproval: review.approval !== null && review.status !== "approved",
    retentionLabel,
    recapStats: review.recapStats ?? { employeeReviewed: 0, autoApproved: 0, pending: 0 },
    reconciliation: [
      { kind: "recorded", minutes: totals.recorded, label: "Recorded", findingStatus: null },
      { kind: "outside", minutes: totals.outside, label: "Outside window", findingStatus: "auto_excluded" },
      { kind: "eligibleTracked", minutes: totals.eligibleTracked, label: "Eligible tracked", findingStatus: null },
      { kind: "break", minutes: totals.break, label: "Break (unpaid)", findingStatus: "auto_excluded" },
      { kind: "inactivity", minutes: totals.inactivity, label: "Inactivity excluded", findingStatus: "auto_excluded" },
      { kind: "held", minutes: totals.held, label: "Held for review", findingStatus: "needs_review" },
      { kind: "manualExcluded", minutes: totals.manualExcluded, label: "Manual exclusions", findingStatus: "resolved_excluded" },
      { kind: "recommended", minutes: totals.recommended, label: "Recommended", findingStatus: null },
      { kind: "approved", minutes: totals.approved, label: "Approved", findingStatus: "approval" },
    ],
  };
}

export function payrollRecapProvenance(review: PayrollReview) {
  const stats = review.recapStats ?? { employeeReviewed: 0, autoApproved: 0, pending: 0 };
  return {
    employee: `${recapReviewLabel("confirmed", "employee")}: ${stats.employeeReviewed}`,
    auto: `${recapReviewLabel("confirmed", "payroll_auto")}: ${stats.autoApproved}`,
    pending: `Not yet reviewed: ${stats.pending}`,
  };
}
