import { payrollStandardWindow } from "@wrazy/work-os-shared/payroll/window";

const payrollPath = "/work-os/admin/payroll";

export function payrollWorkspaceHref(tab: "records" | "audits", payDate?: string, newAudit = false) {
  const query = new URLSearchParams();
  if (tab === "audits") query.set("tab", "audits");
  if (tab === "audits" && newAudit) query.set("new", "1");
  if (payDate) query.set("payDate", payDate);
  return query.size ? `${payrollPath}?${query}` : payrollPath;
}

export function payrollReviewHref(personId: string, payDate: string, reviewId?: string | null) {
  const query = new URLSearchParams({ payDate });
  if (reviewId) query.set("reviewId", reviewId);
  return `${payrollPath}/${encodeURIComponent(personId)}?${query}`;
}

export function isPayrollDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

export function isPayrollPayDate(value: unknown): value is string {
  return isPayrollDate(value) && (value.slice(8, 10) === "01" || value.slice(8, 10) === "16");
}

/** Default a new audit to this pay date's window, capped at the current day
 * when the window has not finished. A future window keeps its full dates and
 * is refused by the server and the form. */
export function payrollDefaultWindow(payDate: string, today = new Date().toISOString().slice(0, 10)) {
  const standard = payrollStandardWindow(payDate);
  if (standard.from > today) return { ...standard, future: true };
  return { from: standard.from, through: standard.through < today ? standard.through : today, future: false };
}
