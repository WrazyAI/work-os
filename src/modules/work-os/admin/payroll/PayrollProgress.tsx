import type { PayrollReview } from "@/modules/work-os/payroll/contracts";

export function PayrollProgress({ review }: { review: PayrollReview }) {
  const progress = review.run?.progress;
  if (!progress || progress.status === "done") return null;
  const message = progress.status === "failed" ? "Audit did not finish. You can re-analyze this period."
    : progress.status === "canceled" ? "Audit was canceled."
      : progress.message;
  return <p className="payroll-progress" role="status">{message}{progress.days > 0 ? ` · ${progress.daysDone}/${progress.days} days` : ""}</p>;
}
