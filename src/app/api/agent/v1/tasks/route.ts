import { NextResponse } from "next/server";
import { agentError, agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { AGENT_TASK_PAGE_MAX, listAgentTasks } from "@/lib/work-agent-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integerParam(value: string | null, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(AGENT_TASK_PAGE_MAX, Math.max(1, Math.trunc(parsed))) : fallback;
}

/** The person's assigned work. Without `updated_since` it reads newest first;
 * with it, the feed replays row changes in ascending order for a cursor walk. */
export async function GET(req: Request) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const params = new URL(req.url).searchParams;
    const updatedSince = params.get("updated_since");
    if (updatedSince && Number.isNaN(new Date(updatedSince).getTime())) {
      return agentError("validation_error", "updated_since must be an ISO timestamp", 400);
    }
    const page = await listAgentTasks(auth.agent, {
      updatedSince,
      includeArchived: params.get("include_archived") === "true",
      limit: integerParam(params.get("limit"), 50),
      cursor: params.get("cursor"),
    });
    return NextResponse.json({ tasks: page.tasks, cursor: { next: page.nextCursor } });
  } catch (error) {
    return agentRouteError(error);
  }
}
