import { redirect } from "next/navigation";
import WorkOsProviders from "../providers";
import EmployeeWorkspaceShell from "@/modules/work-os/employee/EmployeeWorkspaceShell";
import { canUseEmployeeWorkspace, resolveWorkOsPageAccess } from "@/lib/work-os-page-access";

/** The employee workspace gate. Employees and mapped administrators share it;
 * managers and unmapped administrators fall back to the Work OS dispatcher. */
export default async function EmployeeWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const resolved = await resolveWorkOsPageAccess();
  if (!resolved.ok || !canUseEmployeeWorkspace(resolved.access)) redirect("/work-os");
  const { role, personId, featureFlags } = resolved.access;
  return (
    <WorkOsProviders>
      <EmployeeWorkspaceShell access={{ role, personId, featureFlags }}>{children}</EmployeeWorkspaceShell>
    </WorkOsProviders>
  );
}
