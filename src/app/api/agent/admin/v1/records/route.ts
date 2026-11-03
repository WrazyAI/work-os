import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { listAdminAgentRecords, parseAdminAgentRecordFilters } from "@/lib/work-admin-agent-records";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cross-person records: authored updates, submitted EODs, canonical task
 * events, reviewed recaps, and workday snapshots. An absent `person_ids` reads
 * the whole organization; an empty one is an explicit empty result. `coverage`
 * states which sources and local windows produced the page. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "records:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const filters = parseAdminAgentRecordFilters(new URL(req.url).searchParams);
    const page = await listAdminAgentRecords(auth.agent.access, filters);
    return NextResponse.json({
      records: page.records,
      total: page.total,
      cursor: { next: page.nextCursor },
      coverage: page.coverage,
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
