import { apiRequest } from "../../api";
import type {
  Page, PayrollCommand, PayrollDayResult, PayrollFinding, PayrollReview, PayrollRosterPage, PayrollRun,
} from "../../../../../src/modules/work-os/payroll/contracts";

const base = "/api/work-os/admin/payroll";
export const desktopPayrollKey = (organizationId: string, userId: string) => ["work-os", "admin", "payroll", organizationId, userId] as const;

function pathWith(path: string, fields: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value) query.set(key, value);
  return query.size ? `${path}?${query}` : path;
}

const reviewPath = (id: string) => `${base}/reviews/${encodeURIComponent(id)}`;

export function desktopPayroll(organizationId: string) {
  const get = <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined }, { organizationId });
  const post = <T>(path: string, body: object, timeoutMs = 20_000) => apiRequest<T>(path,
    { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }, { organizationId });
  return {
    roster: (payDate: string, cursor: string | null, recordsOnly: boolean, signal?: AbortSignal) =>
      get<PayrollRosterPage>(pathWith(base, { payDate, cursor, view: recordsOnly ? "records" : null }), signal),
    review: (id: string, signal?: AbortSignal) => get<PayrollReview>(reviewPath(id), signal),
    days: (id: string, signal?: AbortSignal) => get<Page<PayrollDayResult>>(`${reviewPath(id)}/days`, signal),
    findings: (id: string, status: string, cursor: string | null, signal?: AbortSignal) =>
      get<Page<PayrollFinding>>(pathWith(`${reviewPath(id)}/findings`, { status, cursor }), signal),
    start: (input: { personId: string; payDate: string; requestKey: string }) => post<PayrollRun>(base, input),
    decide: (id: string, input: PayrollCommand & { findingIds: string[]; action: "payable" | "excluded" | "acknowledged"; note: string }) =>
      post<PayrollReview>(`${reviewPath(id)}/decisions`, input),
    approve: (id: string, input: PayrollCommand & { note: string }) =>
      post(`${reviewPath(id)}/approve`, input, 100_000),
    reopen: (id: string, input: PayrollCommand & { reason: string }) =>
      post<PayrollReview>(`${reviewPath(id)}/reopen`, input),
  };
}
