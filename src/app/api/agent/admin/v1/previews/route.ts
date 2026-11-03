import { NextResponse } from "next/server";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { adminPreviewRecord, previewAdminAction, defaultAdminAgentActionServices } from "@/lib/work-admin-agent-actions";
import {
  adminAgentError,
  adminAgentRouteError,
  hasAdminAgentScope,
  requireAdminAgentAccess,
} from "@/lib/work-admin-agent-auth";
import {
  adminAgentJsonBody,
  adminPreviewActionScope,
  isAdminPreviewAction,
} from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENVELOPE_FIELDS = new Set(["action", "payload"]);

/** The generic preview creator: `{ action, payload }` describes one
 * consequential action without executing it. The action routes are the typed
 * front doors; this one exists for a driver (MCP/Otto) that already speaks the
 * action names. The required scope is the action's own write scope, so a
 * `tasks:write` token cannot mint an EOD decision preview.
 *
 * Progress notes and completion evidence are additive, audited writes with
 * their own routes; they are deliberately not preview actions. */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req);
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    // A preview is a write intent: without a creation key a retried request
    // would mint a second card for the same action.
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);

    const body = await adminAgentJsonBody(req, "Preview request");
    for (const field of Object.keys(body)) {
      if (!ENVELOPE_FIELDS.has(field)) {
        throw new WorkOsValidationError(`Field ${field} cannot be set on a preview request`);
      }
    }
    if (!isAdminPreviewAction(body.action)) {
      throw new WorkOsValidationError("action must be a supported admin action");
    }
    const action = body.action;
    const required = adminPreviewActionScope(action);
    // A recognized action always has a scope; the null branch keeps the check
    // fail-closed if the map and the action list ever drift.
    if (!required) return adminAgentError("insufficient_scope", "This action is not available on this token", 403);
    if (!hasAdminAgentScope(auth.agent.scopes, required)) {
      return adminAgentError("insufficient_scope", `This token is missing the ${required} scope`, 403);
    }
    const payload = (body.payload ?? {}) as Json;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new WorkOsValidationError("payload must be an object");
    }

    const preview = await previewAdminAction(
      auth.agent.access,
      action,
      payload,
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, action, preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
