import type { PayrollReview } from "@/modules/work-os/payroll/contracts";

export function PayrollProgress({ review }: { review: PayrollReview }) {
  if (!review.run) return null;
  return <p className="payroll-progress" role="status">{review.run.progress.message} · {review.run.progress.daysDone}/{review.run.progress.days} days</p>;
}
