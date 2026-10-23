import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { listWorkOsWorkspaces, readWorkOsOrganizationCookie } from "@/lib/work-os-api";
import WorkspaceChooser from "@/modules/work-os/WorkspaceChooser";
import { safeWorkOsWorkspaceNext, WORK_OS_WORKSPACE_HOME } from "@/modules/work-os/workspace";

export const metadata: Metadata = {
  title: "Choose a workspace · Work OS",
};

export const dynamic = "force-dynamic";

export default async function SelectWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const workspaces = await listWorkOsWorkspaces(profile.id);
  // One workspace is never ambiguous, and the resolver already selects it.
  if (workspaces.length <= 1) redirect(WORK_OS_WORKSPACE_HOME);

  const params = await searchParams;
  const currentOrganizationId = await readWorkOsOrganizationCookie();
  const error = params.error === "forbidden"
    ? "That workspace is not available to this account. Choose another one."
    : params.error
      ? "Choose a workspace to continue."
      : null;

  return (
    <WorkspaceChooser
      workspaces={workspaces}
      currentOrganizationId={currentOrganizationId}
      next={safeWorkOsWorkspaceNext(params.next)}
      error={error}
    />
  );
}
