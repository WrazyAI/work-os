import { NextResponse } from "next/server";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { adminPreviewRecord, defaultAdminAgentActionServices, previewAdminAction } from "@/lib/work-admin-agent-actions";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { adminAgentJsonBody, adminAgentOptionalJsonBody } from "@/lib/work-admin-agent-preview-routes";
import { getAdminAgentTask } from "@/lib/work-admin-agent-tasks";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One task with its subtasks and completion evidence. A missing, archived,
 * tombstoned, or cross-organization task is indistinguishable from an unknown
 * id: the employee reader throws NotFound and the shared mapper answers 404. */
export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    const detail = await getAdminAgentTask(auth.agent.access, taskId);
    return NextResponse.json(detail);
  } catch (error) {
    return adminAgentRouteError(error);
  }
}

/** Content, priority, dates, blockers, and labels. Reassignment is its own
 * action, and a parent change is `task.move`, so this preview can never smuggle
 * either one in. Answers `202` with the described change; the confirm route is
 * the only writer. */
export async function PATCH(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await adminAgentJsonBody(req, "Task patch");
    // The path names the target; a body `task_id` cannot retarget the request.
    const payload: Json = { ...body, task_id: taskId };
    const preview = await previewAdminAction(
      auth.agent.access,
      "task.update",
      payload,
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, "task.update", preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}

const REMOVAL_MODES = new Set(["archive", "delete"]);

/** Archive (default) or tombstone a task. The mode comes from `?mode=` or the
 * body; anything else is a caller mistake. Both cascade subtasks, so the
 * preview names the cascade and the confirm performs it. Answers `202`. */
export async function DELETE(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await adminAgentOptionalJsonBody(req, "Task removal payload");
    for (const field of Object.keys(body)) {
      if (field !== "mode") throw new WorkOsValidationError(`Field ${field} cannot be set on a task removal`);
    }
    const requested = new URL(req.url).searchParams.get("mode") ?? body.mode ?? "archive";
    if (typeof requested !== "string" || !REMOVAL_MODES.has(requested)) {
      throw new WorkOsValidationError("mode must be archive or delete");
    }
    const action = requested === "delete" ? "task.delete" : "task.archive";
    const preview = await previewAdminAction(
      auth.agent.access,
      action,
      { task_id: taskId },
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, action, preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
