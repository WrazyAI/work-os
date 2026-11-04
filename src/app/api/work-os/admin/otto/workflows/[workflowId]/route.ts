import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { adminOttoWorkflowDeps } from "@/lib/work-os-admin-otto-chat";
import { loadOttoWorkflow, prepareOttoWorkflow } from "@/lib/work-os-admin-otto-workflows";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { WorkOsConflictError, WorkOsValidationError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request, context: { params: Promise<{ workflowId: string }> }, prepare: boolean) {
  try {
    const auth = await requireAdminOttoAccess(req, "read");
    if (auth.response) return auth.response;
    if (prepare && !req.headers.get("authorization") && !hasExpectedPublicOrigin(req)) {
      return NextResponse.json({ error: "invalid origin" }, { status: 403 });
    }
    const { workflowId } = await context.params;
    const deps = adminOttoWorkflowDeps(auth.access);
    let refreshIndex: number | undefined;
    if (prepare) {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "refreshIndex")) {
        throw new WorkOsValidationError("Specify the step to refresh, or an empty object to prepare ready steps.");
      }
      refreshIndex = body.refreshIndex;
    }
    const workflow = prepare ? await prepareOttoWorkflow(auth.access, workflowId, deps, refreshIndex)
      : await loadOttoWorkflow(auth.access, workflowId, deps);
    const fresh = await requireAdminOttoAccess(req, "read");
    if (fresh.response) return fresh.response;
    return NextResponse.json({ schemaVersion: 1, workflow }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkOsConflictError || error instanceof WorkOsValidationError) {
      return NextResponse.json({ error: error.message, reason: error instanceof WorkOsConflictError ? error.reason : "validation_error" }, { status: error instanceof WorkOsConflictError ? 409 : 400 });
    }
    console.error("[admin-otto-workflow] request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The requests could not be refreshed. Try again.", reason: "internal_error" }, { status: 500 });
  }
}
export const GET = (req: Request, context: { params: Promise<{ workflowId: string }> }) => handle(req, context, false);
export const POST = (req: Request, context: { params: Promise<{ workflowId: string }> }) => handle(req, context, true);
