import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { agentError, agentRouteError, hasAgentScope, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { completeAgentTask } from "@/lib/work-agent-tasks";
import { attachWorkOsTaskCompletionEvidence } from "@/lib/work-os-employee-tasks";
import { CompletionEvidenceError, COMPLETION_EVIDENCE_MAX_BYTES } from "@/modules/work-os/completion-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function evidenceError(error: CompletionEvidenceError) {
  if (/8 MB|size|smaller/i.test(error.message)) return agentError("file_too_large", error.message, 413);
  if (/PNG|JPEG|WebP|PDF|type/i.test(error.message)) return agentError("unsupported_file_type", error.message, 415);
  return agentError("validation_error", error.message, 400);
}

/** One agent-attached completion file plus an optional note. Evidence is saved
 * before completion; a completion failure answers 502 with the saved evidence
 * so a retry only re-runs the completion. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "evidence:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const form = await req.formData();
    const files = form.getAll("file").filter((value): value is File => typeof value !== "string");
    if (files.length !== 1) return agentError("validation_error", "Attach exactly one completion evidence file", 400);
    const file = files[0]!;
    if (file.size <= 0) return agentError("validation_error", "The evidence file must not be empty", 400);
    if (file.size > COMPLETION_EVIDENCE_MAX_BYTES) {
      return agentError("file_too_large", "The evidence file must be 8 MB or smaller", 413);
    }
    const key = String(form.get("idempotency_key") ?? req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return agentError("validation_error", "Idempotency-Key is required", 400);
    const note = form.get("note");
    const complete = form.get("complete") !== "false";
    if (complete && !hasAgentScope(auth.agent.scopes, "tasks:write")) {
      return agentError("insufficient_scope", "Completing a task also requires the tasks:write scope", 403);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      return agentError("validation_error", "The evidence file could not be read completely", 400);
    }
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", `/api/agent/v1/tasks/${taskId}/evidence`, {
        note: typeof note === "string" ? note : "",
        complete,
        fileName: file.name,
        contentType: file.type,
        fileHash,
      }),
      handler: async () => {
        const attached = await attachWorkOsTaskCompletionEvidence(auth.agent.access, taskId, {
          fileName: file.name,
          contentType: file.type,
          bytes,
          note: typeof note === "string" ? note : "",
          idempotencyKey: key,
        }, { tokenId: auth.agent.tokenId, tokenName: auth.agent.tokenName });
        if (!complete) return { status: 201, body: { evidence: attached.evidence, task: null } };
        try {
          const completed = await completeAgentTask(auth.agent, taskId, true);
          return {
            status: 201,
            body: { evidence: attached.evidence, task: completed.task, providerStatus: completed.providerStatus },
          };
        } catch (completionError) {
          const message = completionError instanceof Error ? completionError.message : "The task could not be marked complete";
          return {
            status: 502,
            body: {
              error: `Evidence saved. ${message}`,
              code: "internal_error",
              request_id: randomUUID(),
              evidence: attached.evidence,
              task: null,
            },
          };
        }
      },
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    if (error instanceof CompletionEvidenceError) return evidenceError(error);
    return agentRouteError(error);
  }
}
