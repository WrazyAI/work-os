import { NextResponse } from "next/server";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { getAgentTask } from "@/lib/work-agent-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    return NextResponse.json(await getAgentTask(auth.agent, taskId));
  } catch (error) {
    return agentRouteError(error);
  }
}
