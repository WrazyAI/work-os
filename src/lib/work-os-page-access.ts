import { redirect } from "next/navigation";
import { requireWorkOsAccess, type WorkOsAccess } from "@/lib/work-os-api";

/**
 * Work OS access for Server Components.
 *
 * API routes translate a missing session into a 401 response; pages cannot
 * render that, so an unauthenticated request redirects to /login exactly like
 * `requireUserProfile`. Anything else (no membership, no person mapping) stays
 * a resolvable miss so the page can fall back to the dispatcher or a
 * role-appropriate destination instead of throwing.
 */
export type WorkOsPageAccess =
  | { ok: true; access: WorkOsAccess }
  | { ok: false; status: number };

export async function resolveWorkOsPageAccess(): Promise<WorkOsPageAccess> {
  const result = await requireWorkOsAccess({});
  if (result.response) {
    if (result.response.status === 401) redirect("/login");
    return { ok: false, status: result.response.status };
  }
  return { ok: true, access: result.access };
}

/** Employees get the workspace; mapped admins share it for their own day. */
export function canUseEmployeeWorkspace(access: WorkOsAccess): boolean {
  return access.role === "employee" || (access.role === "admin" && Boolean(access.personId));
}
