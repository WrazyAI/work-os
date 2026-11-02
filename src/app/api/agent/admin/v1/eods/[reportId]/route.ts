import { NextResponse } from "next/server";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentEod } from "@/lib/work-admin-agent-eods";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One submitted EOD with its person and version history. A report outside the
 * token's organization is indistinguishable from a missing id. */
export async function GET(req: Request, context: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "eods:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { reportId } = await context.params;
    const result = await getAdminAgentEod(auth.agent.access, reportId);
    if (!result) return adminAgentError("not_found", "EOD report not found", 404);
    return NextResponse.json({ eod: result.eod, versions: result.versions });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
