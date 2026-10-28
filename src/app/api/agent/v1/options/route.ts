import { NextResponse } from "next/server";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { getWorkOsTaskCreationOptions } from "@/lib/work-os-employee-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The projects available to this token and its own person. Assignment through
 * a token is self-only, so no other person is offered even when the member's
 * role could assign on the employee surface. */
export async function GET(req: Request) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const options = await getWorkOsTaskCreationOptions(auth.agent.access);
    return NextResponse.json({
      ...options,
      people: options.people.filter((person) => person.id === auth.agent.access.personId),
    });
  } catch (error) {
    return agentRouteError(error);
  }
}
