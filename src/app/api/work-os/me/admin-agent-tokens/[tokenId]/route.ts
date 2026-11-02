import { NextResponse } from "next/server";
import { revokeAdminAgentToken } from "@/lib/work-agent-tokens";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    roles: ["admin"],
    feature: "employee_companion",
  });
}

/** Revocation is immediate and owner-only: a token minted by another
 * administrator, or one that never existed, is a not-found. */
export async function DELETE(req: Request, context: { params: Promise<{ tokenId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    if (auth.access.featureFlags.admin_agent_api !== true) {
      return NextResponse.json(
        { error: "The admin agent API is not enabled for this organization", code: "feature_disabled" },
        { status: 403 },
      );
    }
    const { tokenId } = await context.params;
    const revoked = await revokeAdminAgentToken(auth.access, tokenId);
    if (!revoked) return NextResponse.json({ error: "Token not found" }, { status: 404 });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return jsonError(error);
  }
}
