// Service-role Supabase client. BYPASSES RLS — use ONLY in trusted server code
// (the agent-runner, admin scripts, owner-only routes). The service role key
// lives only on this machine / in server env, NEVER in the browser bundle.
// See WEB-PLATFORM-SPEC.md §6/§9.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set for the admin client.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
