import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import type { AdminOttoRole } from "./bootstrap";
import { isOttoScope, type OttoMode } from "./mode";

export const OTTO_VIEW_STATE_EVENT = "work-os://otto-view-state";
export const OTTO_VIEW_REQUEST_EVENT = "work-os://otto-view-request";
export const OTTO_VIEW_RESULT_EVENT = "work-os://otto-view-result";

export type OttoViewRole = AdminOttoRole;
export type OttoAdminStatus = "loading" | "ready" | "failed" | "absent";
export type OttoViewFailure =
  | "employee_unavailable"
  | "admin_unavailable"
  | "admin_loading"
  | "admin_failed"
  | "stale_scope"
  | "offline"
  | "new_chat_pending"
  | "switch_failed";

export type OttoViewState = {
  scope: OttoScope;
  epoch: number;
  revision: number;
  workspace: OttoMode;
  role: OttoViewRole;
  adminStatus: OttoAdminStatus;
  personId: string | null;
  employeeAvailable: boolean;
  adminAvailable: boolean;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
  adminConversationId: string | null;
  adminConversationGeneration: number;
  adminConversationRevision: number;
  adminConversationBusy: boolean;
};

export type OttoViewRequest = {
  requestId: string;
  scope: OttoScope;
  epoch: number;
  action: "switch" | "retry-context";
  mode: OttoMode;
};

export type OttoViewResult = {
  requestId: string;
  scope: OttoScope;
  epoch: number;
  action: OttoViewRequest["action"];
  mode: OttoMode;
  accepted: boolean;
  reason: OttoViewFailure | null;
};

export type ViewAvailability = {
  employee: { available: boolean; reason: string | null };
  admin: { available: boolean; reason: string | null };
};

const ID_LIMIT = 128;
const VIEW_FAILURES = new Set<OttoViewFailure>([
  "employee_unavailable",
  "admin_unavailable",
  "admin_loading",
  "admin_failed",
  "stale_scope",
  "offline",
  "new_chat_pending",
  "switch_failed",
]);
const ROLES = new Set<OttoViewRole>(["admin", "manager", "employee"]);
const ADMIN_STATUSES = new Set<OttoAdminStatus>(["loading", "ready", "failed", "absent"]);

function copyScope(scope: OttoScope): OttoScope {
  return { userId: scope.userId, organizationId: scope.organizationId, mode: scope.mode };
}

function safePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nullableId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= ID_LIMIT);
}

function requiredId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_LIMIT;
}

function scopeFrom(value: unknown): OttoScope | null {
  if (!isOttoScope(value)) return null;
  return copyScope(value);
}

function exactBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function resolveViewAvailability(input: {
  role: OttoViewRole | null;
  adminStatus: OttoAdminStatus;
  personId: string | null;
}): ViewAvailability {
  if (input.role === null) {
    return {
      employee: { available: false, reason: "Loading your workspace…" },
      admin: { available: false, reason: "Loading Administration…" },
    };
  }
  if (input.role !== "admin") {
    return {
      employee: { available: true, reason: null },
      admin: { available: false, reason: "Administration is not available for this account." },
    };
  }
  const admin =
    input.adminStatus === "ready"
      ? { available: true, reason: null }
      : input.adminStatus === "loading"
        ? { available: false, reason: "Loading Administration…" }
        : { available: false, reason: "Administration is unavailable." };
  const employee =
    input.adminStatus === "loading"
      ? { available: false, reason: "Loading your workspace…" }
      : input.adminStatus === "failed"
        ? { available: false, reason: "Your workspace is unavailable until Administration connects." }
        : input.adminStatus === "ready" && input.personId !== null
          ? { available: true, reason: null }
          : input.adminStatus === "ready"
            ? { available: false, reason: "No personal workday is mapped." }
            : { available: false, reason: "Your workspace is unavailable until Administration connects." };
  return { employee, admin };
}

export function resolveWorkspaceSwitch(input: {
  requested: OttoMode;
  current: OttoMode;
  role: OttoViewRole | null;
  adminStatus: OttoAdminStatus;
  personId: string | null;
  online: boolean;
  resetting: boolean;
}): { ok: true } | { ok: false; reason: OttoViewFailure } {
  if (!input.online) return { ok: false, reason: "offline" };
  if (input.resetting) return { ok: false, reason: "new_chat_pending" };
  if (input.requested === input.current) return { ok: true };
  const availability = resolveViewAvailability(input);
  if (input.requested === "employee") {
    return availability.employee.available ? { ok: true } : { ok: false, reason: "employee_unavailable" };
  }
  if (input.role !== "admin") return { ok: false, reason: "admin_unavailable" };
  if (input.adminStatus === "ready") return { ok: true };
  if (input.adminStatus === "loading") return { ok: false, reason: "admin_loading" };
  if (input.adminStatus === "failed") return { ok: false, reason: "admin_failed" };
  return { ok: false, reason: "admin_unavailable" };
}

export function buildOttoViewState(input: Omit<OttoViewState, "employeeAvailable" | "adminAvailable">): OttoViewState {
  if (input.workspace !== input.scope.mode) throw new Error("workspace must match the scope mode");
  const availability = resolveViewAvailability(input);
  const capabilities = input.role === "admin" && input.adminStatus === "ready";
  return {
    scope: copyScope(input.scope),
    epoch: input.epoch,
    revision: input.revision,
    workspace: input.workspace,
    role: input.role,
    adminStatus: input.adminStatus,
    personId: input.personId,
    employeeAvailable: availability.employee.available,
    adminAvailable: availability.admin.available,
    voiceAvailable: capabilities && input.voiceAvailable,
    transcriptionAvailable: capabilities && input.transcriptionAvailable,
    adminConversationId: input.adminConversationId,
    adminConversationGeneration: input.adminConversationGeneration,
    adminConversationRevision: input.adminConversationRevision,
    adminConversationBusy: input.adminConversationBusy,
  };
}

export function parseOttoViewState(value: unknown): OttoViewState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope) return null;
  if (raw.workspace !== "employee" && raw.workspace !== "admin") return null;
  if (raw.workspace !== scope.mode) return null;
  if (!safePositive(raw.epoch) || !safePositive(raw.revision)) return null;
  if (typeof raw.role !== "string" || !ROLES.has(raw.role as OttoViewRole)) return null;
  if (typeof raw.adminStatus !== "string" || !ADMIN_STATUSES.has(raw.adminStatus as OttoAdminStatus)) return null;
  if (!nullableId(raw.personId)) return null;
  for (const field of ["employeeAvailable", "adminAvailable", "voiceAvailable", "transcriptionAvailable", "adminConversationBusy"] as const) {
    if (!exactBoolean(raw[field])) return null;
  }
  if (!nullableId(raw.adminConversationId)) return null;
  if (!safePositive(raw.adminConversationGeneration) || !safePositive(raw.adminConversationRevision)) return null;
  const workspace: OttoMode = raw.workspace;
  const input = {
    scope,
    epoch: raw.epoch,
    revision: raw.revision,
    workspace,
    role: raw.role as OttoViewRole,
    adminStatus: raw.adminStatus as OttoAdminStatus,
    personId: raw.personId as string | null,
    voiceAvailable: raw.voiceAvailable as boolean,
    transcriptionAvailable: raw.transcriptionAvailable as boolean,
    adminConversationId: raw.adminConversationId as string | null,
    adminConversationGeneration: raw.adminConversationGeneration,
    adminConversationRevision: raw.adminConversationRevision,
    adminConversationBusy: raw.adminConversationBusy as boolean,
  };
  const expected = resolveViewAvailability(input);
  if (raw.employeeAvailable !== expected.employee.available || raw.adminAvailable !== expected.admin.available) return null;
  const built = buildOttoViewState(input);
  if (raw.voiceAvailable !== built.voiceAvailable || raw.transcriptionAvailable !== built.transcriptionAvailable) return null;
  return built;
}

export function parseOttoViewRequest(value: unknown): OttoViewRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !requiredId(raw.requestId) || !safePositive(raw.epoch)) return null;
  if (raw.action !== "switch" && raw.action !== "retry-context") return null;
  if (raw.mode !== "admin" && raw.mode !== "employee") return null;
  return {
    requestId: raw.requestId,
    scope,
    epoch: raw.epoch,
    action: raw.action,
    mode: raw.mode,
  };
}

export function parseOttoViewResult(value: unknown): OttoViewResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !requiredId(raw.requestId) || !safePositive(raw.epoch)) return null;
  if (raw.action !== "switch" && raw.action !== "retry-context") return null;
  if (raw.mode !== "admin" && raw.mode !== "employee") return null;
  if (!exactBoolean(raw.accepted)) return null;
  if (raw.reason !== null && (typeof raw.reason !== "string" || !VIEW_FAILURES.has(raw.reason as OttoViewFailure))) return null;
  return {
    requestId: raw.requestId,
    scope,
    epoch: raw.epoch,
    action: raw.action,
    mode: raw.mode,
    accepted: raw.accepted,
    reason: raw.reason as OttoViewFailure | null,
  };
}

export function copyOttoViewState(view: OttoViewState): OttoViewState {
  return buildOttoViewState({ ...view, scope: copyScope(view.scope) });
}
