import { redirect } from "next/navigation";
import AdminFrame from "@/modules/work-os/admin/AdminFrame";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import { resolveWorkOsViewModeFor } from "@/lib/work-os-view-mode";
import WorkOsProviders from "../providers";

export default async function WorkOsAdminLayout({ children }: { children: React.ReactNode }) {
  const resolved = await resolveWorkOsPageAccess();
  if (!resolved.ok || resolved.access.role !== "admin") redirect("/work-os");
  // Administration is the other half of the administrator's view switch: while
  // My workspace is active, an administration URL is not a second admin page.
  if (await resolveWorkOsViewModeFor(resolved.access) === "employee") redirect("/work-os/today");
  return (
    <WorkOsProviders>
      <AdminFrame>{children}</AdminFrame>
    </WorkOsProviders>
  );
}
