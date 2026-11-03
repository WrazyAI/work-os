import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { listAdminAgentEods, parseAdminAgentEodFilters } from "@/lib/work-admin-agent-eods";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cross-person EOD search. An absent `person_ids` reads the whole
 * organization; an empty one is an explicit empty result. Counts stay per
 * status so the reviewer can see the backlog behind a status filter. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "eods:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const filters = parseAdminAgentEodFilters(new URL(req.url).searchParams);
    const page = await listAdminAgentEods(auth.agent.access, filters);
    return NextResponse.json({
      eods: page.eods,
      counts: page.counts,
      total: page.total,
      cursor: { next: page.nextCursor },
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
