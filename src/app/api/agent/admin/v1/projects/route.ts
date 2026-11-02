import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { listAdminAgentProjects } from "@/lib/work-admin-agent-directory";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Active projects the organization can file work into. Archived projects are
 * omitted so a caller never assigns new work to a retired project. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "people:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const projects = await listAdminAgentProjects(auth.agent.access);
    return NextResponse.json({ projects });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
