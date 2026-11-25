import { invoke } from "@tauri-apps/api/core";
import { Gauge, LayoutDashboard, ListChecks, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import type { AdminSection } from "../admin/types";
import { ADMIN_ATTENTION_SEEN_KEY, parseAdminAttentionSeen, type AdminAttentionSeen } from "../adminOtto/attention";
import { apiRequest } from "../api";
import { formatWorkOsTime as formatTime, shiftWorkOsDate } from "../dateFormat";
import type { DayData } from "../types";
import type { WorktivityControlResult, WorktivityControlTransport, WorktivityDesktopResult, WorktivityPreflight } from "../worktivityControl";
import type { View } from "./types";

/** Bounded interactive preparation before an EOD draft: four batches of a few
 * frames is enough to cover a day's sampled context without letting a single
 * press run away with vision cost. */
export const EOD_PREPARE_ROUNDS = 4;

/** Remembers which workspace this device last opened. The choice is a view
 * preference; the account's role stays the authority on what it may open. */
export const WORKSPACE_MODE_KEY = "work-os.workspace-mode";

/** How often the review-notification sources (memory, activity intervals) are
 * re-read while the app is open. Matches the day poll cadence. */
export const NOTIFICATION_POLL_MS = 60_000;

/** Device-local memory for the Focus tab's goal section (§7.2.1). */
export const GOAL_COLLAPSE_KEY = "work-os.focus.goal-collapsed.v1";

export const worktivityControlTransport: WorktivityControlTransport = {
  preflight: (request) => apiRequest<WorktivityPreflight>("/api/work-os/me/workday/worktivity-control", {
    method: "POST",
    headers: { "Idempotency-Key": request.operation_id, "X-Work-OS-Desktop-Control": "companion" },
    body: JSON.stringify(request),
  }),
  execute: (action) => invoke<WorktivityDesktopResult>("worktivity_control", { action }),
  restore: (desktop) => !desktop || desktop.restore_required
    ? invoke<void>("finish_worktivity_control")
    : Promise.resolve(),
  confirm: (request) => apiRequest<Extract<WorktivityControlResult, { status: "confirmed" | "pending" | "blocked" | "not_applied" }>>("/api/work-os/me/workday/worktivity-control", {
    method: "POST",
    headers: { "Idempotency-Key": request.operation_id, "X-Work-OS-Desktop-Control": "companion" },
    body: JSON.stringify(request),
  }),
  sleep: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
};

export function isWorktivityControlResult(value: unknown): value is WorktivityControlResult {
  return !!value && typeof value === "object" && "operation_id" in value && "status" in value
    && ["confirmed", "not_applied", "pending", "desktop_failed", "blocked", "confirmation_required"].includes(String((value as { status: unknown }).status));
}

export const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "day", label: "My Day", icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "EOD Review", icon: MessageSquareText },
  { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export const ADMIN_MENU_SECTIONS: Array<{ id: AdminSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "tasks", label: "Tasks" },
  { id: "review", label: "EOD Review" },
  { id: "payroll", label: "Payroll" },
  { id: "insights", label: "Insights" },
  { id: "evidence", label: "Evidence" },
  { id: "settings", label: "Settings" },
];

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = Object.fromEntries(
  ADMIN_MENU_SECTIONS.map((section) => [section.id, section.label]),
) as Record<AdminSection, string>;

export const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
export const initials = (value?: string | null) => (value ?? "Work OS").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "WO";
export const timeRemaining = (value?: string | null) => {
  const remaining = value ? Math.max(0, Date.parse(value) - Date.now()) : 0;
  const minutes = Math.floor(remaining / 60_000);
  return value ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : "—";
};

export function moveDate(date: string, amount: number) {
  return shiftWorkOsDate(date, amount);
}

export function remainingShiftLabel(endsAt: string | undefined, now: Date) {
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - now.getTime()) : 0;
  if (!endsAt || !Number.isFinite(remaining)) return "—";
  const minutes = Math.ceil(remaining / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function worktivityClockOutLabel(attendance: DayData["attendance"] | null | undefined, timezone?: string) {
  if (attendance?.clockedOutAt) return `${attendance.clockedOutAtInferred ? "Inferred · " : ""}${formatTime(attendance.clockedOutAt, timezone)}`;
  if (attendance?.state === "active" || attendance?.state === "paused") return "Still active";
  return attendance?.clockedInAt ? "Not observed" : "—";
}

export const actionSuccessMessages: Record<string, string> = {
  "check_in.create": "Your update was saved.",
  "proposal.reject": "The proposal was rejected.",
  "proposal.accept": "The proposal was approved.",
  "shift.clock_in": "You are clocked in.",
  "shift.clock_out": "Your workday was closed.",
  "shift.pause_toggle": "Your session status was updated.",
  "shift.resolve_missed_clock_out": "The missed clock-out was corrected.",
  "report.submit": "Your EOD was submitted for review.",
  "task.create": "The task was created.",
  "task.complete": "The task was marked complete.",
  "task.reopen": "The task was reopened.",
  "task.update": "The task was updated.",
  "task.subtask_create": "The subtask was created.",
  "task.subtask_move": "The subtask was moved.",
  "task.archive": "The task was archived.",
  "task.delete": "The task was permanently deleted.",
  "workspace.task_surface": "The task was added to today.",
  "workspace.task_defer": "The task was deferred.",
};

/** One filing transport for approvals and retries: the accept request plus the
 * owner-scoped readback used to reconcile an interrupted response. */
export function proposalFilingTransport() {
  return {
    reviewProposal: (proposalId: string, options?: { providerCreateResolution?: "no_task_created" }) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept", ...(options?.providerCreateResolution ? { provider_create_resolution: options.providerCreateResolution } : {}) }), signal: AbortSignal.timeout(60_000) }),
    readProposal: (proposalId: string) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`),
    reviewBatch: (batchId: string, body: { decision: "accept" | "reject"; decisions: Array<{ proposal_id: string; decision?: "accept" | "reject"; edits?: Record<string, unknown>; clear_fields?: string[] }> }) => apiRequest(`/api/work-os/proposal-batches/${encodeURIComponent(batchId)}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }),
  };
}

/** The seen registries are best-effort local memory: losing them only means a
 * reminder may be announced once more, never that one is lost. */
export function readSeenIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeSeenIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch { /* best effort */ }
}

/** The EOD attention baseline is a watermark plus ids, not just a list: it
 * catches a report submitted while the app was closed without re-announcing
 * one that was already seen. */
export function readAdminAttentionSeen(): AdminAttentionSeen | null {
  try {
    const raw = window.localStorage.getItem(ADMIN_ATTENTION_SEEN_KEY);
    return raw ? parseAdminAttentionSeen(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeAdminAttentionSeen(value: AdminAttentionSeen): void {
  try {
    window.localStorage.setItem(ADMIN_ATTENTION_SEEN_KEY, JSON.stringify(value));
  } catch { /* best effort */ }
}
