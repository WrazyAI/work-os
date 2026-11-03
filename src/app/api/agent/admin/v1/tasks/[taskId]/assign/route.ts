import { NextResponse } from "next/server";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { adminPreviewRecord, defaultAdminAgentActionServices, previewAdminAction } from "@/lib/work-admin-agent-actions";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { adminAgentJsonBody } from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change who owns a task. `mode` is `replace`, `add`, or `remove`; the preview
 * resolves the final list once against the current assignees and stores that
 * exact list, so the confirm applies it as a replace instead of re-running a
 * delta against a changed snapshot. Answers `202`; the confirm route writes. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await adminAgentJsonBody(req, "Task assign payload");
    const payload: Json = { ...body, task_id: taskId };
    const preview = await previewAdminAction(
      auth.agent.access,
      "task.assign",
      payload,
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, "task.assign", preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
