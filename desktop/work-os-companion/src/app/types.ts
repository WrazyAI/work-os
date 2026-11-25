import type { Update } from "@tauri-apps/plugin-updater";
import type { TaskEvidenceRecord } from "@wrazy/work-os-shared/completion-evidence";
import type { SidebarView } from "../SidebarNav";
import type { EodScreenshotHour } from "../types";
import type { UpdateDownloadProgress } from "../updater";
import type { WorktivityControlAction } from "../worktivityControl";

export type View = SidebarView;
export type TaskView = "today" | "unfinished" | "completed" | "all";
export type EodScreenshotContext = { processed: number; excluded: number; failed: number; pending: number; hours: EodScreenshotHour[] };
export type TaskAssigneeOption = { id: string; displayName: string; email: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TaskDeletionRequest = { task: Record<string, any>; closeParent: boolean; mode: "archive" | "delete" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TaskEditRequest = { task: Record<string, any>; kind: "task" | "subtask" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TaskEvidenceRequest = { task: Record<string, any>; mode: "complete" | "attach"; refreshDetails: boolean; savedEvidence?: TaskEvidenceRecord | null };
export type ClockInConfirmation = { kind: "late" | "exception"; reason: string; operationId?: string };
export type PendingWorktivityControl = { action: WorktivityControlAction; operationId: string; body: Record<string, unknown>; message: string };
export type MissedClockOutCorrection = { sessionId: string; date: string; clockedInAt: string | null };
export type ProgressUpdateKind = "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task";
export type ProgressReceipt = { text: string; message: string; kind: ProgressUpdateKind; queued?: boolean; createdAt: string };
export type ProgressPanel = "update" | "goal";

/** Update delivery flow shared by the flyout and the Settings row. The
 * plugin's Update object stays referenced while it holds native resources
 * (downloaded installer bytes, version catalog entry). */
export type UpdateFlow =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; update: Update; headers: Record<string, string> }
  | { status: "downloading"; update: Update; headers: Record<string, string>; progress: UpdateDownloadProgress }
  | { status: "downloaded"; update: Update }
  | { status: "failed"; update: Update; headers: Record<string, string>; message: string }
  | { status: "installing"; update: Update };

export type ComposerMode = "progress" | "agenda";
