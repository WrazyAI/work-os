import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentTask } from "@/lib/work-admin-agent-tasks";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One task with its subtasks and completion evidence. A missing, archived,
 * tombstoned, or cross-organization task is indistinguishable from an unknown
 * id: the employee reader throws NotFound and the shared mapper answers 404. */
export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    const detail = await getAdminAgentTask(auth.agent.access, taskId);
    return NextResponse.json(detail);
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
