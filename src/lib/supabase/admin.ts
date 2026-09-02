// Postgres data client (Neon Lakebase Postgres via `pg`). Replaces the former
// service-role Supabase client with a PostgREST-compatible query shim so all
// existing call sites keep working unchanged. Server-only — the connection
// string lives only in server env, NEVER in the browser bundle.
// See docs/NEON-MIGRATION-PLAN.md.
import { createDbClient, type DbClient } from "@/lib/db/query";

const globalForDb = globalThis as unknown as { __workOsDbClient?: DbClient };

export function createAdminClient(): DbClient {
  if (!globalForDb.__workOsDbClient) {
    globalForDb.__workOsDbClient = createDbClient();
  }
  return globalForDb.__workOsDbClient;
}
