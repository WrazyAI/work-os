import type { Json } from "@/lib/work-os-internal";

export const ADMIN_PREVIEW_ACTIONS = [
  "task.create", "task.update", "task.assign", "task.move",
  "task.complete", "task.reopen", "task.archive", "task.delete", "eod.review",
] as const;
export type AdminPreviewAction = (typeof ADMIN_PREVIEW_ACTIONS)[number];

export type AdminPreviewChange = { field: string; from: Json; to: Json };
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
export type AdminAgentTaskFilters = {
  personIds: string[] | null; query: string | null; completed: boolean | null;
  status: "active" | "archived" | "deleted" | null;
  projectId: string | null; dueFrom: string | null; dueTo: string | null;
  updatedSince: string | null; limit: number; cursor: string | null;
};
