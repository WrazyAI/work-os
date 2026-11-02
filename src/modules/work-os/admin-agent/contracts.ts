import type { Json } from "@/lib/work-os-internal";

export const ADMIN_PREVIEW_ACTIONS = [
  "task.create", "task.update", "task.assign", "task.move",
  "task.complete", "task.reopen", "task.archive", "task.delete", "eod.review",
] as const;
export type AdminPreviewAction = (typeof ADMIN_PREVIEW_ACTIONS)[number];

export type AdminPreviewValue = string | number | boolean | null | AdminPreviewValue[] | { [key: string]: AdminPreviewValue };
export type AdminPreviewChange = { field: string; from: AdminPreviewValue; to: AdminPreviewValue };
export type AdminPreview = {
  id: string;
  action: AdminPreviewAction;
  summary: string;
  changes: AdminPreviewChange[];
  warnings: string[];
  state: Json;
  expiresAt: string;
};
export type AdminAgentPerson = {
  id: string; displayName: string; email: string | null; active: boolean;
  timezone: string | null; roleProfile: { id: string; name: string } | null;
};
export type AdminAgentPersonDetail = AdminAgentPerson & {
  /** The onboarding timezone doubles as the schedule timezone until a
   * separate schedule reader is added. */
  schedule: { timezone: string | null } | null;
  manager: { id: string; displayName: string } | null;
  teams: Array<{ id: string; name: string; isManager: boolean; active: boolean }>;
};
export type AdminAgentProject = {
  id: string; name: string; provider: string; providerProjectId: string;
  archived: boolean;
};
export type AdminAgentTaskFilters = {
  personIds: string[] | null; query: string | null; completed: boolean | null;
  /** Overdue uses the effective due date (recorded due date, otherwise
   * created + 1 day) against the admin's local today. */
  overdue: boolean | null;
  status: "active" | "archived" | "deleted" | null;
  projectId: string | null; dueFrom: string | null; dueTo: string | null;
  updatedSince: string | null; limit: number; cursor: string | null;
};
