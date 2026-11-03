import type { AdminPreviewAction } from "@/modules/work-os/admin-agent/contracts";
import { ADMIN_PREVIEW_ACTIONS } from "@/modules/work-os/admin-agent/contracts";
import type { AdminAgentScope } from "@/lib/work-agent-tokens";
import { WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

/** HTTP plumbing shared by the admin preview creators. The action layer owns
 * what a preview describes; this module owns only the request shape a route
 * accepts and the write scope an action requires. */

/** Write scope per action. Task actions create, edit, reassign, complete, or
 * remove work, so they need `tasks:write`; an EOD decision needs
 * `eods:review`, which `eods:read` deliberately does not imply. */
const ACTION_SCOPE: Record<AdminPreviewAction, AdminAgentScope> = {
  "task.create": "tasks:write",
  "task.update": "tasks:write",
  "task.assign": "tasks:write",
  "task.move": "tasks:write",
  "task.complete": "tasks:write",
  "task.reopen": "tasks:write",
  "task.archive": "tasks:write",
  "task.delete": "tasks:write",
  "eod.review": "eods:review",
};

export function adminPreviewActionScope(action: AdminPreviewAction): AdminAgentScope {
  return ACTION_SCOPE[action];
}

export function isAdminPreviewAction(value: unknown): value is AdminPreviewAction {
  return typeof value === "string" && (ADMIN_PREVIEW_ACTIONS as readonly string[]).includes(value);
}

function isJsonObject(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A write body is a JSON object. Anything else (absent, an array, a scalar)
 * is a caller mistake the action layer would otherwise report as a confusing
 * "field is required". */
export async function adminAgentJsonBody(req: Request, label: string): Promise<Json> {
  const body = await req.json().catch(() => null);
  if (!isJsonObject(body)) throw new WorkOsValidationError(`${label} must be a JSON object`);
  return body;
}

/** For the lifecycle routes that take the id from the path and only need a body
 * to reject stray fields. An absent body is the same as an empty one; a body
 * that is present but not an object is still a caller mistake. */
export async function adminAgentOptionalJsonBody(req: Request, label: string): Promise<Json> {
  const body = await req.json().catch(() => null);
  if (body === null) return {};
  if (!isJsonObject(body)) throw new WorkOsValidationError(`${label} must be a JSON object`);
  return body;
}
