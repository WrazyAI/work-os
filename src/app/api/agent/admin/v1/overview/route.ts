import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentOverview } from "@/lib/work-admin-agent-insights";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The administration overview: counts, the decision queue, outstanding EODs,
 * and overdue work for one local day. Read-only, so `insights:read` is enough. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "insights:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const date = new URL(req.url).searchParams.get("date")?.trim() || undefined;
    const overview = await getAdminAgentOverview(auth.agent.access, date);
    return NextResponse.json(overview);
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
