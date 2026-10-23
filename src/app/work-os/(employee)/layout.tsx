import { redirect } from "next/navigation";
import WorkOsProviders from "../providers";
import EmployeeWorkspaceShell from "@/modules/work-os/employee/EmployeeWorkspaceShell";
import { canUseEmployeeWorkspace, resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import { resolveWorkOsViewModeFor } from "@/lib/work-os-view-mode";

/** The employee workspace gate. Employees and mapped administrators in My
 * workspace share it; managers, unmapped administrators, and administrators
 * who are currently in Administration fall back to the dispatcher. */
export default async function EmployeeWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const resolved = await resolveWorkOsPageAccess();
  if (!resolved.ok || !canUseEmployeeWorkspace(resolved.access)) redirect("/work-os");
  const viewMode = await resolveWorkOsViewModeFor(resolved.access);
  if (resolved.access.role === "admin" && viewMode !== "employee") redirect("/work-os/admin");
  const { role, personId, featureFlags, organizationName, workspaces } = resolved.access;
  return (
    <WorkOsProviders>
      <EmployeeWorkspaceShell access={{ role, personId, featureFlags, organizationName, canSwitchWorkspaces: workspaces.length > 1 }}>{children}</EmployeeWorkspaceShell>
    </WorkOsProviders>
  );
}
