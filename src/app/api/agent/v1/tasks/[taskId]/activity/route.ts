import { NextResponse } from "next/server";
import { listAgentActivity } from "@/lib/work-agent-activity";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentLimitParam } from "@/lib/work-agent-params";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    const params = new URL(req.url).searchParams;
    const page = await listAgentActivity(auth.agent, taskId, {
      cursor: params.get("cursor"),
      limit: agentLimitParam(params.get("limit"), 50, 100),
    });
    return NextResponse.json({ items: page.items, cursor: { next: page.nextCursor } });
  } catch (error) {
    return agentRouteError(error);
  }
}
