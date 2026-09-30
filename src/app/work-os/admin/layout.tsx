import { redirect } from "next/navigation";
import AdminFrame from "@/modules/work-os/admin/AdminFrame";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import WorkOsProviders from "../providers";

export default async function WorkOsAdminLayout({ children }: { children: React.ReactNode }) {
  const resolved = await resolveWorkOsPageAccess();
  if (!resolved.ok || resolved.access.role !== "admin") redirect("/work-os");
  return (
    <WorkOsProviders>
      <AdminFrame>{children}</AdminFrame>
    </WorkOsProviders>
  );
}
