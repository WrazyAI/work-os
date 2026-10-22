import { NextResponse } from "next/server";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { completeAgentTask } from "@/lib/work-agent-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Completion still passes the employee evidence gate: a task with an expected
 * outcome or definition of done answers 409 evidence_required until an artifact
 * is attached. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", `/api/agent/v1/tasks/${taskId}/complete`, {}),
      handler: async () => {
        const completed = await completeAgentTask(auth.agent, taskId, true);
        return { status: 200, body: { task: completed.task, providerStatus: completed.providerStatus } };
      },
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}
