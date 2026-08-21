import { Suspense } from "react";
import WorkOsHome from "@/modules/work-os/WorkOsHome";
import { requireUserProfile } from "@/lib/supabase/auth";

export default async function WorkOsRoute() {
  await requireUserProfile();
  return (
    <Suspense fallback={null}>
      <WorkOsHome />
    </Suspense>
  );
}
