/**
 * Employee workspace destinations.
 *
 * The five destinations are nested routes under /work-os and mirror the
 * companion's navigation nouns (design.md §4.2). This module is the single
 * source of truth for the employee routes, the workspace shell, and the legacy
 * `?tab=` deep links the sidebar used before the routes existed.
 */
export type EmployeeDestination = "today" | "tasks" | "review" | "insights" | "settings";

export interface EmployeeDestinationMeta {
  id: EmployeeDestination;
  label: string;
  href: string;
}

export const EMPLOYEE_WORKSPACE_ROOT = "/work-os";

export const EMPLOYEE_HOME_HREF = "/work-os/today";

export const EMPLOYEE_DESTINATIONS: EmployeeDestinationMeta[] = [
  { id: "today", label: "Today", href: "/work-os/today" },
  { id: "tasks", label: "Tasks", href: "/work-os/tasks" },
  { id: "review", label: "Review", href: "/work-os/review" },
  { id: "insights", label: "Insights", href: "/work-os/insights" },
  { id: "settings", label: "Settings", href: "/work-os/settings" },
];

/** Legacy admin tab links keep working for employees by mapping onto the
 * employee destinations. Tabs that never applied to employees land on Today. */
const LEGACY_TAB_DESTINATIONS: Record<string, EmployeeDestination> = {
  today: "today",
  tasks: "tasks",
  reports: "review",
  evidence: "review",
  settings: "settings",
  people: "today",
  schedules: "today",
  blueprints: "today",
};

export function employeeDestinationForLegacyTab(tab: string | null | undefined): string {
  if (!tab) return EMPLOYEE_HOME_HREF;
  const destination = LEGACY_TAB_DESTINATIONS[tab];
  return destination ? `${EMPLOYEE_WORKSPACE_ROOT}/${destination}` : EMPLOYEE_HOME_HREF;
}

/** True when a pathname already lives inside the employee workspace routes. */
export function isEmployeeWorkspacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return EMPLOYEE_DESTINATIONS.some((destination) => pathname === destination.href || pathname.startsWith(`${destination.href}/`));
}
