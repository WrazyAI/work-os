import { NextResponse } from "next/server";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentPerson } from "@/lib/work-admin-agent-directory";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One person's profile, schedule timezone, role, manager, and teams. A person
 * outside the token's organization is indistinguishable from a missing id. */
export async function GET(req: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "people:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { personId } = await context.params;
    const person = await getAdminAgentPerson(auth.agent.access, personId);
    if (!person) return adminAgentError("not_found", "Person not found", 404);
    return NextResponse.json({ person });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
