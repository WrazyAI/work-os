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

/** The scope required to read or confirm a stored preview. An action this
 * surface does not recognize fails closed: `null` means "no scope", which every
 * caller must treat as a refusal. `hasAdminAgentScope(scopes, undefined)` would
 * otherwise report true and let a corrupt/legacy row skip authorization. */
export function adminPreviewActionScope(action: unknown): AdminAgentScope | null {
  return isAdminPreviewAction(action) ? ACTION_SCOPE[action] : null;
}

export function isAdminPreviewAction(value: unknown): value is AdminPreviewAction {
  return typeof value === "string" && (ADMIN_PREVIEW_ACTIONS as readonly string[]).includes(value);
}

function isJsonObject(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Read the body exactly once as text. `Request.json()` rejects on a truncated
 * payload, and a `.catch(() => null)` around it cannot tell "no body" from
 * "mangled body" — which would silently drop a lifecycle guard. Only an empty
 * or whitespace-only body is absent; anything else must parse. */
async function readRequestBody(req: Request, label: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new WorkOsValidationError(`${label} must be valid JSON`);
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkOsValidationError(`${label} must be valid JSON`);
  }
}

/** A write body is a JSON object. Anything else (absent, an array, a scalar, a
 * malformed payload) is a caller mistake the action layer would otherwise
 * report as a confusing "field is required". */
export async function adminAgentJsonBody(req: Request, label: string): Promise<Json> {
  const body = await readRequestBody(req, label);
  if (!isJsonObject(body)) throw new WorkOsValidationError(`${label} must be a JSON object`);
  return body;
}

/** For the lifecycle routes that take the id from the path and only need a body
 * to reject stray fields. An absent or empty body is `{}`; a body that is
 * present but malformed or not an object is still a caller mistake, so a
 * truncated `{"completed": false` cannot masquerade as "no fields sent". */
export async function adminAgentOptionalJsonBody(req: Request, label: string): Promise<Json> {
  const body = await readRequestBody(req, label);
  if (body === undefined) return {};
  if (!isJsonObject(body)) throw new WorkOsValidationError(`${label} must be a JSON object`);
  return body;
}
