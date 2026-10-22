import { NextResponse } from "next/server";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identity is available to any valid token so a write-only credential can
 * still discover its person, scopes, and expiry. */
export async function GET(req: Request) {
  try {
    const auth = await requireAgentAccess(req);
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { agent } = auth;
    return NextResponse.json({
      organization_id: agent.access.organizationId,
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
    return agentRouteError(error);
  }
}
