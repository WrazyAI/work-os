import { redirect } from "next/navigation";
import { resolveWorkOsSession, type WorkOsAccess } from "@/lib/work-os-api";
import { WORK_OS_WORKSPACE_SELECT } from "@/modules/work-os/workspace";

/**
 * Work OS access for Server Components.
 *
 * API routes translate a missing session into a 401 response; pages cannot
 * render that, so an unauthenticated request redirects to /login exactly like
 * `requireUserProfile`. An account with more than one active membership and no
 * chosen workspace goes to the chooser rather than being assigned one.
 * Anything else (no membership, no person mapping) stays a resolvable miss so
 * the page can fall back to the dispatcher or a role-appropriate destination
 * instead of throwing.
 */
export type WorkOsPageAccess =
  | { ok: true; access: WorkOsAccess }
  | { ok: false; status: number };

export async function resolveWorkOsPageAccess(): Promise<WorkOsPageAccess> {
  const resolved = await resolveWorkOsSession();
  if ("choices" in resolved) redirect(WORK_OS_WORKSPACE_SELECT);
  if ("response" in resolved) {
    if (resolved.response.status === 401) redirect("/login");
    return { ok: false, status: resolved.response.status };
  }
  return { ok: true, access: resolved.access };
}

/** Employees get the workspace; mapped admins share it for their own day. */
export function canUseEmployeeWorkspace(access: WorkOsAccess): boolean {
  return access.role === "employee" || (access.role === "admin" && Boolean(access.personId));
}
