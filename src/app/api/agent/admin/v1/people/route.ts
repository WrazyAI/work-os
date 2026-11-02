import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { listAdminAgentPeople, parseAdminAgentPeopleFilters } from "@/lib/work-admin-agent-directory";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Organization directory search. `q` matches name or email; active defaults
 * to true so the list answers "who works here now". */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "people:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const filters = parseAdminAgentPeopleFilters(new URL(req.url).searchParams);
    const page = await listAdminAgentPeople(auth.agent.access, filters);
    return NextResponse.json({
      people: page.people,
      total: page.total,
      cursor: { next: page.nextCursor },
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
