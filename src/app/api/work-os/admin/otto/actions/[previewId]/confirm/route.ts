import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import {
  getAdminPreviewRecord,
  confirmAdminPreview,
  WorkAdminPreviewError,
} from "@/lib/work-admin-action-previews";
import {
  adminTaskPreviewState,
  applyAdminAction,
  defaultAdminAgentActionServices,
} from "@/lib/work-admin-agent-actions";
import { WorkOsConflictError, WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session-bound confirmation for an Admin Otto action preview. The model never
 * receives this capability; the client calls it only after the administrator
 * presses the confirmation control. */
export async function POST(
  req: Request,
  context: { params: Promise<{ previewId: string }> },
) {
  try {
    const auth = await requireAdminOttoAccess(req, "read");
    if (auth.response) return auth.response;
    if (auth.access.featureFlags.admin_agent_api !== true) {
      return NextResponse.json({ error: "Task actions are not enabled for this workspace." }, { status: 403 });
    }
    const { previewId } = await context.params;
    const record = await getAdminPreviewRecord(auth.access, previewId, null);
    if (!record) return NextResponse.json({ error: "This change is no longer available." }, { status: 404 });
    const request = record.request as Record<string, unknown>;
    if (record.action !== "task.create" && record.action !== "task.update"
      && record.action !== "task.assign" && record.action !== "task.move"
      && record.action !== "task.complete" && record.action !== "task.reopen"
      && record.action !== "task.archive" && record.action !== "task.delete") {
      throw new WorkOsValidationError("This Otto change is not supported");
    }
    const taskId = typeof request.task_id === "string" ? request.task_id : null;
    if (record.action !== "task.create" && !taskId) {
      throw new WorkOsValidationError("This change has no task target");
    }
    const services = defaultAdminAgentActionServices;
    const key = req.headers.get("idempotency-key")?.trim() || `otto:${previewId}`;
    const confirmed = await confirmAdminPreview(auth.access, previewId, key, {
      readState: async () => {
        if (!taskId) return {};
        return adminTaskPreviewState(await services.getTask(auth.access, taskId) as Json);
      },
      apply: async () => applyAdminAction(
        auth.access,
        record.action,
        record.request as Json,
        services,
        {
          tokenId: "otto",
          tokenName: "Admin Otto",
          previewId,
          reviewerPersonId: auth.access.personId ?? null,
        },
      ),
    }, null);
    return NextResponse.json({ result: confirmed.body, replayed: confirmed.replayed }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WorkAdminPreviewError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WorkOsConflictError) {
      return NextResponse.json({ error: error.message, code: error.reason ?? "conflict" }, { status: 409 });
    }
    if (error instanceof WorkOsValidationError) {
      return NextResponse.json({ error: error.message, code: "validation_error" }, { status: 400 });
    }
    console.error("[admin-otto-action] confirm failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The change could not be confirmed." }, { status: 500 });
  }
}
