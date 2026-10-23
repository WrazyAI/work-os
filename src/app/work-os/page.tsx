import { Suspense } from "react";
import { redirect } from "next/navigation";
import WorkOsHome from "@/modules/work-os/WorkOsHome";
import WorkOsProviders from "./providers";
import { employeeDestinationForLegacyTab } from "@/modules/work-os/employee-routes";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import { resolveWorkOsViewModeFor } from "@/lib/work-os-view-mode";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// Legacy sidebar links used `/work-os?tab=…`. Administrators now own real
// routes; old links land on the closest new destination instead of a dead tab.
const LEGACY_ADMIN_TAB_ROUTES: Record<string, string> = {
  today: "/work-os/admin",
  tasks: "/work-os/admin/tasks",
  people: "/work-os/admin/people",
  schedules: "/work-os/admin/people",
  blueprints: "/work-os/admin/settings",
  evidence: "/work-os/admin/evidence",
  reports: "/work-os/admin/review",
  settings: "/work-os/admin/settings",
};

/**
 * The Work OS dispatcher. Employees live in the nested workspace routes
 * (/work-os/today, /work-os/tasks, …) and administrators live in the
 * administration workspace (/work-os/admin/…). Managers keep the console
 * rendered by WorkOsHome.
 */
export default async function WorkOsRoute({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const resolved = await resolveWorkOsPageAccess();
  if (resolved.ok) {
    const { role } = resolved.access;
    const tab = firstParam(params.tab);
    // Employees always land on their workspace; legacy ?tab= links map onto
    // the nested destinations so old sidebar links and bookmarks keep working.
    if (role === "employee") redirect(employeeDestinationForLegacyTab(tab));
    if (role === "admin") {
      // Administrators follow the per-device view they are already in. My
      // workspace keeps the employee destinations; Administration keeps the
      // administration workspace and its legacy admin tab mapping.
      const viewMode = await resolveWorkOsViewModeFor(resolved.access);
      if (viewMode === "employee") redirect(employeeDestinationForLegacyTab(tab));
      redirect(tab ? LEGACY_ADMIN_TAB_ROUTES[tab] ?? "/work-os/admin" : "/work-os/admin");
    }
  }
  return (
    <WorkOsProviders>
      <Suspense fallback={null}>
        <WorkOsHome />
      </Suspense>
    </WorkOsProviders>
  );
}
