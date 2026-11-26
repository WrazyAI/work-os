import { apiRequest, apiRequestRaw } from "../../api";
import type {
  Page, PayrollCommand, PayrollDayResult, PayrollFinding, PayrollReview, PayrollRosterPage, PayrollRun,
} from "@wrazy/work-os-shared/payroll/contracts";

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
  const findingsPage = (id: string, status: string, cursor: string | null, signal?: AbortSignal) =>
    get<Page<PayrollFinding>>(pathWith(`${reviewPath(id)}/findings`, { status, cursor, limit: "100" }), signal);
  return {
    roster: (payDate: string, cursor: string | null, recordsOnly: boolean, signal?: AbortSignal) =>
      get<PayrollRosterPage>(pathWith(base, { payDate, cursor, view: recordsOnly ? "records" : null }), signal),
    review: (id: string, signal?: AbortSignal) => get<PayrollReview>(reviewPath(id), signal),
    days: (id: string, signal?: AbortSignal) => get<Page<PayrollDayResult>>(`${reviewPath(id)}/days`, signal),
    findings: findingsPage,
    findingsAll: async (id: string, signal?: AbortSignal) => {
      const items: PayrollFinding[] = [];
      let cursor: string | null = null;
      let total = 0;
      for (let page = 0; page < 10; page += 1) {
        const result = await findingsPage(id, "", cursor, signal);
        items.push(...result.items);
        total = result.total;
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return { items, total, nextCursor: cursor };
    },
    start: (input: { personId: string; payDate: string; requestKey: string; from?: string; through?: string }) => post<PayrollRun>(base, input),
    advance: (runId: string) => post(`${base}/runs/${encodeURIComponent(runId)}`, { action: "advance" }, 60_000),
    cancel: (runId: string, rowVersion: string) => post(`${base}/runs/${encodeURIComponent(runId)}`, { action: "cancel", rowVersion }),
    decide: (id: string, input: PayrollCommand & { findingIds: string[]; action: "payable" | "excluded" | "acknowledged"; note: string }) =>
      post<PayrollReview>(`${reviewPath(id)}/decisions`, input),
    approve: (id: string, input: PayrollCommand & { note: string }) =>
      post(`${reviewPath(id)}/approve`, input, 100_000),
    reopen: (id: string, input: PayrollCommand & { reason: string }) =>
      post<PayrollReview>(`${reviewPath(id)}/reopen`, input),
    previewFrame: async (id: string, findingKey: string, summaryId: string, reason: string) => {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview-admin")) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#20262b"/><rect width="960" height="34" fill="#2c343a"/><circle cx="18" cy="17" r="5" fill="#68737b"/><circle cx="36" cy="17" r="5" fill="#68737b"/><circle cx="54" cy="17" r="5" fill="#68737b"/><g fill="#4a5963"><rect x="40" y="80" width="220" height="470" rx="8"/><rect x="290" y="92" width="580" height="18" rx="4"/><rect x="290" y="132" width="420" height="14" rx="4"/><rect x="290" y="162" width="540" height="14" rx="4"/><rect x="290" y="192" width="360" height="14" rx="4"/></g><rect x="290" y="240" width="580" height="2" fill="#3a4650"/><text x="48" y="580" fill="#8d958a" font-family="Inter, sans-serif" font-size="15">Synthetic evidence frame — ${summaryId.slice(0, 8)}</text></svg>`;
        return new Blob([svg], { type: "image/svg+xml" });
      }
      const response = await apiRequestRaw(`${reviewPath(id)}/findings/${encodeURIComponent(findingKey)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_id: summaryId, reason, request_key: crypto.randomUUID() }),
      }, { timeoutMs: 30_000, organizationId });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "The evidence frame could not be opened.");
      }
      return response.blob();
    },
  };
}
