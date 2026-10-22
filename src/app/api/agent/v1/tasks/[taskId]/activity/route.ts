import { NextResponse } from "next/server";
import { listAgentActivity } from "@/lib/work-agent-activity";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitParam(value: string | null): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : 50;
}

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    const params = new URL(req.url).searchParams;
    const page = await listAgentActivity(auth.agent, taskId, {
      cursor: params.get("cursor"),
      limit: limitParam(params.get("limit")),
    });
    return NextResponse.json({ items: page.items, cursor: { next: page.nextCursor } });
  } catch (error) {
    return agentRouteError(error);
  }
}
