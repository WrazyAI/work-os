import { NextResponse } from "next/server";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { adminPreviewRecord, defaultAdminAgentActionServices, previewAdminAction } from "@/lib/work-admin-agent-actions";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { adminAgentJsonBody } from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Move a subtask under another top-level task. The preview names the old and
 * new parent and warns when the shape or project makes the move doubtful; the
 * confirm performs it. Answers `202`. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await adminAgentJsonBody(req, "Task move payload");
    const payload: Json = { ...body, task_id: taskId };
    const preview = await previewAdminAction(
      auth.agent.access,
      "task.move",
      payload,
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, "task.move", preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
