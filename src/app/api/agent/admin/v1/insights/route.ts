import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentInsights, parseAdminAgentInsightRange } from "@/lib/work-admin-agent-insights";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deterministic 7/30/90-day facts, organization-wide unless `person_id` names
 * one active member of this organization. A person outside the token's
 * organization answers 404, never a zeroed team view. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "insights:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const params = new URL(req.url).searchParams;
    const range = parseAdminAgentInsightRange(params.get("range"));
    const insights = await getAdminAgentInsights(auth.agent.access, range, {
      personId: params.get("person_id")?.trim() || null,
      through: params.get("through")?.trim() || null,
    });
    return NextResponse.json(insights);
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
