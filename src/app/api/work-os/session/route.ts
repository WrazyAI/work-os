import { NextResponse } from "next/server";
import { jsonError, resolveWorkOsSession } from "@/lib/work-os-api";
import { resolveWorkOsViewModeFor } from "@/lib/work-os-view-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const resolved = await resolveWorkOsSession({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
    });
    if ("response" in resolved) return resolved.response;
    if ("choices" in resolved) {
      return NextResponse.json({
        requiresWorkspaceSelection: true,
        organizations: resolved.choices,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const access = resolved.access;
    return NextResponse.json({
      requiresWorkspaceSelection: false,
      organizationId: access.organizationId,
      organizationName: access.organizationName,
      role: access.role,
      personId: access.personId,
      userId: access.ctx.user.id,
      featureFlags: access.featureFlags,
      viewMode: await resolveWorkOsViewModeFor(access),
      organizations: access.workspaces,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
