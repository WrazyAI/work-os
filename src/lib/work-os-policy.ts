import { createAdminClient } from "@/lib/supabase/admin";

export async function worktivityAuthoritativeBreaks(organizationId: string) {
  const { data, error } = await createAdminClient().from("work_organizations").select("feature_flags")
    .eq("id", organizationId).single();
  if (error) throw new Error(`load Work OS feature flags: ${error.message}`);
  const flags = data.feature_flags && typeof data.feature_flags === "object" ? data.feature_flags as Record<string, unknown> : {};
  return flags.worktivity_authoritative_breaks === true;
}
