// Browser-side Supabase client. Holds only the public anon key + the user's
// session (RLS enforces per-user isolation server-side). Use in Client
// Components. See WEB-PLATFORM-SPEC.md §6/§9.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
