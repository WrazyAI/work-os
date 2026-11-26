import type { PayrollReview } from "@/modules/work-os/payroll/contracts";

export function PayrollProgress({ review }: { review: PayrollReview }) {
  const progress = review.run?.progress;
  if (!progress || progress.status === "done") return null;
  const message = progress.status === "failed"
    ? (review.status === "ready"
      ? `Latest re-analysis did not finish: ${progress.message} The published analysis is unchanged.`
      : `Audit did not finish: ${progress.message} Re-analyze this period to try again.`)
    : progress.status === "canceled" ? "Audit was canceled."
      : progress.message;
  return <p className="payroll-progress" role="status">{message}{progress.days > 0 ? ` · ${progress.daysDone}/${progress.days} days` : ""}</p>;
}
