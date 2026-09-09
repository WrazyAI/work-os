import { Suspense } from "react";
import WorkOsHome from "@/modules/work-os/WorkOsHome";
import WorkOsProviders from "./providers";
import { requireUserProfile } from "@/lib/supabase/auth";

export default async function WorkOsRoute() {
  await requireUserProfile();
  return (
    <WorkOsProviders>
      <Suspense fallback={null}>
        <WorkOsHome />
      </Suspense>
    </WorkOsProviders>
  );
}
