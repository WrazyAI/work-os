import { NextResponse } from "next/server";
import { agentError, agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { getAgentTask, updateAgentTask } from "@/lib/work-agent-tasks";
import type { Json } from "@/lib/work-os-internal";

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

/** Content updates only: project and parent moves are create-only. */
export async function PATCH(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentError("validation_error", "A JSON body is required", 400);
    }
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("PATCH", `/api/agent/v1/tasks/${taskId}`, body),
      handler: async () => ({ status: 200, body: { task: await updateAgentTask(auth.agent, taskId, body) } }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}
