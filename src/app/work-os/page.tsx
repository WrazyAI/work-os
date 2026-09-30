import { Suspense } from "react";
import { redirect } from "next/navigation";
import WorkOsHome from "@/modules/work-os/WorkOsHome";
import WorkOsProviders from "./providers";
import { employeeDestinationForLegacyTab } from "@/modules/work-os/employee-routes";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The Work OS dispatcher. Employees live in the nested workspace routes
 * (/work-os/today, /work-os/tasks, …); managers and administrators keep the
 * console rendered by WorkOsHome.
 */
export default async function WorkOsRoute({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const resolved = await resolveWorkOsPageAccess();
  if (resolved.ok) {
    const { role, personId } = resolved.access;
    const tab = firstParam(params.tab);
    const adminSurface = firstParam(params.surface) === "admin";
    // Employees always land on their workspace; legacy ?tab= links map onto
    // the nested destinations so old sidebar links and bookmarks keep working.
    if (role === "employee") redirect(employeeDestinationForLegacyTab(tab));
    // A mapped administrator's default surface is their own workspace. The
    // explicit Administration surface and legacy admin tabs still open the
    // console.
    if (role === "admin" && personId && !adminSurface && !tab) redirect("/work-os/today");
  }
  return (
    <WorkOsProviders>
      <Suspense fallback={null}>
        <WorkOsHome />
      </Suspense>
    </WorkOsProviders>
  );
}
