// Resolve which Postgres database `npm run db:apply` migrates.
//
// The platform's runtime data layer is Neon (`DATABASE_URL` / `DATABASE_URL_UNPOOLED`),
// so migrations must land there by default. New Supabase-side files are the
// lineage of record only; the legacy project stays for rollback. When a change
// deliberately needs the old Supabase project, pass MIGRATION_DATABASE_URL.
//
// Precedence:
//   1. MIGRATION_DATABASE_URL   explicit override for a deliberate target
//   2. DATABASE_URL_UNPOOLED    direct Neon endpoint (preferred for DDL)
//   3. DATABASE_URL             pooled Neon endpoint
//   4. SUPABASE_DB_URL          legacy Supabase connection string
//   5. SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL (legacy direct host)
export function resolveMigrationDbUrl(env = process.env) {
  const explicit = (env.MIGRATION_DATABASE_URL ?? "").trim();
  if (explicit) return explicit;

  const direct = (env.DATABASE_URL_UNPOOLED ?? "").trim();
  if (direct) return direct;

  const neon = (env.DATABASE_URL ?? "").trim();
  if (neon) return neon;

  const supabaseUrl = (env.SUPABASE_DB_URL ?? "").trim();
  if (supabaseUrl) return supabaseUrl;

  const password = env.SUPABASE_DB_PASSWORD;
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (password && publicUrl) {
    const ref = new URL(publicUrl).hostname.split(".")[0];
    return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  }
  return null;
}

// The target host is safe to log (no credentials); operators need to see
// whether a migration is about to hit Neon or the legacy Supabase project.
export function migrationTargetLabel(connectionString) {
  try {
    const { hostname, protocol } = new URL(connectionString);
    const kind = hostname.endsWith(".neon.tech")
      ? "Neon"
      : protocol === "postgresql:" || protocol === "postgres:"
        ? "Postgres"
        : "unknown";
    return `${hostname} (${kind})`;
  } catch {
    return "unparseable connection string";
  }
}
