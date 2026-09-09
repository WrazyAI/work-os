// Server-side data client. Historically this was the Supabase SSR session
// client; with the Neon/Better Auth migration there are no Supabase JWTs and
// isolation is enforced at the application level (explicit user_id /
// organization_id filters — the platform's stated authz model). All callers
// must gate with requireUser()/requireUserProfile() first.
// See docs/NEON-MIGRATION-PLAN.md.
import { createAdminClient } from "./admin";

export async function createClient() {
  return createAdminClient();
}
