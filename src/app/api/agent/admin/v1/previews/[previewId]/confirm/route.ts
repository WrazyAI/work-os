import { NextResponse } from "next/server";
import {
  confirmAdminPreview,
  getAdminPreviewRecord,
  WorkAdminPreviewError,
} from "@/lib/work-admin-action-previews";
import {
  applyAdminAction,
  defaultAdminAgentActionServices,
  readAdminPreviewTargetState,
} from "@/lib/work-admin-agent-actions";
import {
  adminAgentError,
  adminAgentRouteError,
  hasAdminAgentScope,
  requireAdminAgentAccess,
} from "@/lib/work-admin-agent-auth";
import { adminPreviewActionScope } from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only execution path for a consequential admin action.
 *
 * A confirm is a write, so it requires its own `Idempotency-Key`; the preview
 * id is the canonical one-time replay key, which is why a second confirm with a
 * different header returns the stored result with `Idempotent-Replay: true`
 * instead of writing twice. The route re-reads the target through the same
 * projection the preview used, and `applyAdminAction` receives that state as
 * `expectedState`, so a target that moved between preview and confirm answers
 * `409 preview_stale` and writes nothing. */
export async function POST(req: Request, context: { params: Promise<{ previewId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req);
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);

    const { previewId } = await context.params;
    const record = await getAdminPreviewRecord(auth.agent.access, previewId, auth.agent.tokenId);
    if (!record) throw new WorkAdminPreviewError("preview_not_found");
    const required = adminPreviewActionScope(record.action);
    if (!hasAdminAgentScope(auth.agent.scopes, required)) {
      return adminAgentError("insufficient_scope", `This token is missing the ${required} scope`, 403);
    }

    // The confirm transaction re-reads the target under the preview row lock and
    // compares its fingerprint with the one stored at creation. Keeping the
    // fresh state lets apply repeat the comparison, so a target that changes
    // between the read and the write also refuses to apply.
    let currentState: Json | undefined;
    const result = await confirmAdminPreview(
      auth.agent.access,
      previewId,
      key,
      {
        readState: async () => {
          currentState = await readAdminPreviewTargetState(auth.agent.access, record);
          return currentState;
        },
        apply: async () => applyAdminAction(
          auth.agent.access,
          record.action,
          record.request,
          defaultAdminAgentActionServices,
          {
            tokenId: auth.agent.tokenId,
            tokenName: auth.agent.tokenName,
            previewId: record.preview.id,
            reviewerPersonId: auth.agent.reviewerPersonId,
          },
          currentState,
        ),
      },
      auth.agent.tokenId,
    );

    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
