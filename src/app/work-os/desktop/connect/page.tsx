import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { listWorkOsWorkspaces } from "@/lib/work-os-api";
import DesktopConnect from "./DesktopConnect";

export default async function DesktopConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; state?: string; redirect_uri?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const params = await searchParams;
  const workspaces = await listWorkOsWorkspaces(profile.id);
  return (
    <DesktopConnect
      challenge={params.challenge || ""}
      state={params.state || ""}
      redirectUri={params.redirect_uri || ""}
      workspaces={workspaces}
    />
  );
}
