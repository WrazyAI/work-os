import { requireUserProfile } from "@/lib/supabase/auth";
import DesktopConnect from "./DesktopConnect";

export default async function DesktopConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; state?: string; redirect_uri?: string }>;
}) {
  await requireUserProfile();
  const params = await searchParams;
  return <DesktopConnect challenge={params.challenge || ""} state={params.state || ""} redirectUri={params.redirect_uri || ""} />;
}
