/**
 * Work OS view modes for the web console.
 *
 * A mapped administrator can work in either the administration workspace or
 * their own employee workspace. The choice is a per-device presentation
 * preference (the `work-os-view` cookie), mirroring the companion's
 * `work-os.workspace-mode` setting. It is never an authorization boundary:
 * Work OS administrator APIs keep their role checks and scope every read and
 * write to the authorized organization and person.
 *
 * Defaults preserve the pre-switch behavior: an administrator with no stored
 * preference sees Administration; employees always see the employee workspace.
 */
import { EMPLOYEE_HOME_HREF, isEmployeeWorkspacePath } from "./employee-routes";

export type WorkOsViewMode = "employee" | "admin";

export const WORK_OS_VIEW_COOKIE = "work-os-view";
export const WORK_OS_VIEW_MODE_ROUTE = "/api/work-os/view-mode";
export const WORK_OS_VIEW_MODE_FIELD = "mode";
export const WORK_OS_VIEW_NEXT_FIELD = "next";

/** The one home each view may fall back to. */
export const WORK_OS_VIEW_HOME: Record<WorkOsViewMode, string> = {
  employee: EMPLOYEE_HOME_HREF,
  admin: "/work-os/admin",
};

export interface WorkOsViewAccess {
  role: "employee" | "manager" | "admin";
  personId: string | null;
}

/** Unknown or missing cookie values keep the administrator in Administration. */
export function parseWorkOsViewMode(value: unknown): WorkOsViewMode {
  return value === "employee" ? "employee" : "admin";
}

/**
 * The view the caller can actually use. Employees and managers never enter
 * Administration; an administrator without a mapped person has no employee
 * workspace to enter. Everything else follows the stored preference.
 */
export function effectiveWorkOsViewMode(
  access: WorkOsViewAccess | null | undefined,
  stored: unknown,
): WorkOsViewMode {
  if (!access || access.role !== "admin") return "employee";
  if (!access.personId) return "admin";
  return parseWorkOsViewMode(stored);
}

/**
 * Keep a switch destination inside the view being entered. The value arrives
 * from a form field, so it is untrusted input: absolute URLs, scheme-relative
 * URLs, and cross-workspace destinations all fall back to the view's home.
 */
export function safeWorkOsViewNext(mode: WorkOsViewMode, raw: unknown): string {
  const fallback = WORK_OS_VIEW_HOME[mode];
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw, "https://work-os.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://work-os.invalid") return fallback;
  const destination = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "employee") {
    if (url.pathname === "/work-os" || isEmployeeWorkspacePath(url.pathname)) return destination;
    return fallback;
  }
  if (url.pathname === "/work-os/admin" || url.pathname.startsWith("/work-os/admin/")) return destination;
  return fallback;
}
