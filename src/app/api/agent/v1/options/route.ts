import { NextResponse } from "next/server";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { getWorkOsTaskCreationOptions } from "@/lib/work-os-employee-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The people and projects this token may attach to a task. Both are the same
 * sets the employee's own composer offers, so an agent can pick a real
 * `project_id` or `assignee_person_ids` value instead of guessing ids. */
export async function GET(req: Request) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const options = await getWorkOsTaskCreationOptions(auth.agent.access);
    return NextResponse.json(options);
  } catch (error) {
    return agentRouteError(error);
  }
}
