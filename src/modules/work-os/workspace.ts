/**
 * Explicit Work OS workspace identity.
 *
 * A signed-in account can belong to more than one Work OS organization. The
 * active workspace is a per-device choice, never an implicit "oldest
 * membership" pick: the web stores it in this cookie after the account chooses
 * on /work-os/select-workspace, and the desktop connect screen sends the chosen
 * organization when it authorizes a device. The cookie only selects among
 * memberships the server has already verified; it is never an authorization
 * boundary.
 */

export type WorkOsWorkspaceRole = "employee" | "manager" | "admin";

export interface WorkOsWorkspaceChoice {
  organizationId: string;
  name: string;
  role: WorkOsWorkspaceRole;
  personId: string | null;
}

export const WORK_OS_WORKSPACE_COOKIE = "work-os-org";
export const WORK_OS_WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const WORK_OS_WORKSPACE_ROUTE = "/api/work-os/session/workspace";
export const WORK_OS_WORKSPACE_FIELD = "organization_id";
export const WORK_OS_WORKSPACE_NEXT_FIELD = "next";
export const WORK_OS_WORKSPACE_HOME = "/work-os";
export const WORK_OS_WORKSPACE_SELECT = "/work-os/select-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The cookie carries a UUID, never free text or a workspace name. */
export function isWorkOsOrganizationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Keep a post-selection destination inside Work OS.
 *
 * The value arrives from a form field, so it is untrusted input: absolute URLs,
 * scheme-relative URLs, backslashes, the picker itself, and anything outside
 * /work-os fall back to the dispatcher.
 */
export function safeWorkOsWorkspaceNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return WORK_OS_WORKSPACE_HOME;
  }
  let url: URL;
  try {
    url = new URL(value, "https://work-os.invalid");
  } catch {
    return WORK_OS_WORKSPACE_HOME;
  }
  if (url.origin !== "https://work-os.invalid") return WORK_OS_WORKSPACE_HOME;
  if (url.pathname === WORK_OS_WORKSPACE_SELECT) return WORK_OS_WORKSPACE_HOME;
  if (url.pathname !== WORK_OS_WORKSPACE_HOME && !url.pathname.startsWith(`${WORK_OS_WORKSPACE_HOME}/`)) {
    return WORK_OS_WORKSPACE_HOME;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function workOsWorkspaceRoleLabel(role: WorkOsWorkspaceRole): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Employee";
}
