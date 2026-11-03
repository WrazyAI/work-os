import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identity is available to any valid admin token, even one minted with no
 * scopes, so a driver can discover its organization, role, person mapping, and
 * expiry before deciding what else it may call. The secret is never returned:
 * only the non-reversible prefix that the settings list also shows. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req);
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { agent } = auth;
    return NextResponse.json({
      organization_id: agent.access.organizationId,
      user_id: agent.access.ctx.user.id,
      role: agent.access.role,
      person_id: agent.access.personId,
      token: {
        id: agent.tokenId,
        name: agent.tokenName,
        prefix: agent.tokenPrefix,
        scopes: agent.scopes,
        expires_at: agent.expiresAt,
      },
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
