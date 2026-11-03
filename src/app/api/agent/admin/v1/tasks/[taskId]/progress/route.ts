import { NextResponse } from "next/server";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { addAdminAgentProgress } from "@/lib/work-admin-agent-evidence";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add an authored progress note to any task in the organization. Progress is
 * additive, so it writes directly instead of going through a preview; the
 * service keeps it task-scoped, validates the note, and audits the admin. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return adminAgentError("validation_error", "A JSON body is required", 400);
    }
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", `/api/agent/admin/v1/tasks/${taskId}/progress`, body),
      handler: async () => ({
        status: 201,
        body: {
          evidence: await addAdminAgentProgress(
            auth.agent.access,
            taskId,
            body,
            key,
            { tokenId: auth.agent.tokenId, tokenName: auth.agent.tokenName },
          ),
        },
      }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
