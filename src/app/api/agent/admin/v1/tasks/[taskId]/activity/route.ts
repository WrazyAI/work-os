import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentTaskActivity } from "@/lib/work-admin-agent-tasks";
import { agentLimitParam } from "@/lib/work-agent-params";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The merged task timeline (day events, evidence, blockers). The reader proves
 * the task belongs to this organization before it loads any rows. */
export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    const params = new URL(req.url).searchParams;
    const page = await getAdminAgentTaskActivity(auth.agent.access, taskId, {
      cursor: params.get("cursor"),
      limit: agentLimitParam(params.get("limit"), 50, 100),
    });
    return NextResponse.json({ items: page.items, cursor: { next: page.nextCursor } });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
