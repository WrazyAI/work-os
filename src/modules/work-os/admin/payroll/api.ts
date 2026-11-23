"use client";

import { adminFetch } from "../api";
import type {
  Page, PayrollDayResult, PayrollFinding, PayrollReview, PayrollRosterPage,
  PayrollRun,
} from "@/modules/work-os/payroll/contracts";

export const payrollKeys = {
  roster: (payDate: string) => ["work-os", "admin", "payroll", "roster", payDate] as const,
  rosterPages: (payDate: string, recordsOnly: boolean) => ["work-os", "admin", "payroll", "roster-pages", payDate, recordsOnly] as const,
  review: (reviewId: string) => ["work-os", "admin", "payroll", "review", reviewId] as const,
  days: (reviewId: string) => ["work-os", "admin", "payroll", "days", reviewId] as const,
  findings: (reviewId: string, revision: number, status: string, cursor: string | null) => ["work-os", "admin", "payroll", "findings", reviewId, revision, status, cursor] as const,
  run: (runId: string) => ["work-os", "admin", "payroll", "run", runId] as const,
};

export const payrollApi = {
  roster: (payDate: string, cursor: string | null = null, recordsOnly = false) =>
    adminFetch<PayrollRosterPage>(`/api/work-os/admin/payroll?payDate=${encodeURIComponent(payDate)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${recordsOnly ? "&view=records" : ""}`),
  review: (reviewId: string) => adminFetch<PayrollReview>(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}`),
  days: (reviewId: string, cursor: string | null = null) =>
    adminFetch<Page<PayrollDayResult>>(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}/days${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  findings: (reviewId: string, status: string, cursor: string | null) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (cursor) query.set("cursor", cursor);
    return adminFetch<Page<PayrollFinding>>(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}/findings?${query}`);
  },
  decide: (reviewId: string, body: Record<string, unknown>) =>
    adminFetch<PayrollReview>(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}/decisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  approve: (reviewId: string, body: Record<string, unknown>) =>
    adminFetch(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  reopen: (reviewId: string, body: Record<string, unknown>) =>
    adminFetch<PayrollReview>(`/api/work-os/admin/payroll/reviews/${encodeURIComponent(reviewId)}/reopen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  run: (runId: string) => adminFetch<{ id: string; status: string; phase: string; progress: Record<string, unknown> }>(`/api/work-os/admin/payroll/runs/${encodeURIComponent(runId)}`),
  advance: (runId: string) => adminFetch(`/api/work-os/admin/payroll/runs/${encodeURIComponent(runId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "advance" }) }),
  cancel: (runId: string, rowVersion: string) => adminFetch(`/api/work-os/admin/payroll/runs/${encodeURIComponent(runId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", rowVersion }) }),
  start: (personId: string, payDate: string, requestKey: string) =>
    adminFetch<PayrollRun>(`/api/work-os/admin/payroll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId, payDate, requestKey }) }),
};
