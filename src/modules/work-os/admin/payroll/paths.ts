const payrollPath = "/work-os/admin/payroll";

export function payrollWorkspaceHref(tab: "records" | "audits", payDate?: string, newAudit = false) {
  const query = new URLSearchParams();
  if (tab === "audits") query.set("tab", "audits");
  if (tab === "audits" && newAudit) query.set("new", "1");
  if (payDate) query.set("payDate", payDate);
  return query.size ? `${payrollPath}?${query}` : payrollPath;
}

export function payrollReviewHref(personId: string, payDate: string) {
  return `${payrollPath}/${encodeURIComponent(personId)}?payDate=${encodeURIComponent(payDate)}`;
}

export function isPayrollPayDate(value: unknown): value is string {
  return typeof value === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(01|16)$/.test(value);
}
