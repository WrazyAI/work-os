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
import { WorkOsConflictError, WorkOsValidationError, WorkOsForbiddenError, WorkOsNotFoundError } from "@/lib/work-os-api";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { assertOttoWorkflowActive, currentOttoAction } from "@/lib/work-os-admin-otto-workflows";
import { CompletionEvidenceError } from "@/modules/work-os/completion-evidence";
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
    if (!req.headers.get("authorization") && !hasExpectedPublicOrigin(req)) {
      return NextResponse.json({ error: "invalid origin" }, { status: 403 });
    }
    if (auth.access.featureFlags.admin_agent_api !== true) {
      return NextResponse.json({ error: "Task actions are not enabled for this workspace." }, { status: 403 });
    }
    const { previewId } = await context.params;
    const record = await getAdminPreviewRecord(auth.access, previewId, null);
    if (!record || record.source !== "otto") return NextResponse.json({ error: "This change is no longer available." }, { status: 404 });
    if (record.idempotencyKey?.startsWith("otto-workflow:")) {
      await assertOttoWorkflowActive(auth.access, record.idempotencyKey.split(":")[1]);
    }
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
          tokenId: null,
          tokenName: "Admin Otto",
          previewId,
          reviewerPersonId: auth.access.personId ?? null,
        },
        // The pre-read fingerprint alone is not enough: planning re-reads the
        // target, and a change landing between the two must not be silently
        // overwritten by a stale approval.
        record.preview.state as Json,
      ),
    }, null);
    const action = await currentOttoAction(auth.access, {
      previewId, action: record.action, summary: record.preview.summary, changes: record.preview.changes,
      warnings: record.preview.warnings, expiresAt: record.preview.expiresAt,
    });
    return NextResponse.json({ schemaVersion: 1, result: confirmed.body, replayed: confirmed.replayed, action }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WorkOsForbiddenError) return NextResponse.json({ error: "You no longer have permission to make this change.", code: "forbidden" }, { status: 403 });
    if (error instanceof WorkOsNotFoundError) return NextResponse.json({ error: "This task is no longer available.", code: "not_found" }, { status: 404 });
    if (error instanceof CompletionEvidenceError) return NextResponse.json({ error: error.message, code: "evidence_required" }, { status: 400 });
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
    return NextResponse.json({ error: "The outcome could not be verified. Check its status before trying again.", code: "outcome_unknown" }, { status: 500 });
  }
}

export async function GET(req: Request, context: { params: Promise<{ previewId: string }> }) {
  const auth = await requireAdminOttoAccess(req, "read");
  if (auth.response) return auth.response;
  const { previewId } = await context.params;
  const record = await getAdminPreviewRecord(auth.access, previewId, null);
  if (!record || record.source !== "otto") return NextResponse.json({ error: "This change is no longer available." }, { status: 404 });
  const action = await currentOttoAction(auth.access, {
    previewId, action: record.action, summary: record.preview.summary, changes: record.preview.changes,
    warnings: record.preview.warnings, expiresAt: record.preview.expiresAt,
  });
  return NextResponse.json({ schemaVersion: 1, action }, { headers: { "Cache-Control": "no-store" } });
}
