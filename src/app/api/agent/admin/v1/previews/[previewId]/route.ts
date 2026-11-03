import { NextResponse } from "next/server";
import { getAdminPreviewRecord, WorkAdminPreviewError } from "@/lib/work-admin-action-previews";
import {
  adminAgentError,
  adminAgentRouteError,
  hasAdminAgentScope,
  requireAdminAgentAccess,
} from "@/lib/work-admin-agent-auth";
import { adminPreviewActionScope } from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rehydrate one pending preview card after a reload. Ownership is the preview
 * store's rule: an API preview is visible only to the token that created it,
 * and a missing, cross-organization, or other-token id is the same 404. The
 * response never includes the resolved request or audit metadata. */
export async function GET(req: Request, context: { params: Promise<{ previewId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req);
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { previewId } = await context.params;
    const record = await getAdminPreviewRecord(auth.agent.access, previewId, auth.agent.tokenId);
    if (!record) throw new WorkAdminPreviewError("preview_not_found");
    const required = adminPreviewActionScope(record.action);
    // An action this surface no longer recognizes cannot be authorized: treat
    // the card as gone instead of skipping the scope check.
    if (!required) throw new WorkAdminPreviewError("preview_not_found");
    if (!hasAdminAgentScope(auth.agent.scopes, required)) {
      return adminAgentError("insufficient_scope", `This token is missing the ${required} scope`, 403);
    }
    return NextResponse.json(record.preview);
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
