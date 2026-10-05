// Better Auth server instance (replaces Supabase Auth).
// - Users/sessions live in OUR Postgres (neon_auth schema, Better Auth tables
//   provisioned by Neon Auth and imported from the legacy Supabase dump).
// - bcrypt password verification keeps every legacy password working.
// - Invite-only: sign-up is disabled; provisioning is an admin operation.
// See docs/NEON-MIGRATION-PLAN.md.
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

type AnyDB = Record<string, unknown>;

const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// withSchema fully qualifies every generated table reference into neon_auth.
// (A search_path connect-hook raced Better Auth's first query on fresh pool
// connections and a startup `options` param is rejected by Neon's pooler.)
const kysely = new Kysely<AnyDB>({
  dialect: new PostgresDialect({ pool: authPool }),
}).withSchema("neon_auth");

const trustedOrigins = [
  "http://localhost:3000",
  process.env.APP_PUBLIC_ORIGIN ?? "https://app.wrazyos.com",
].filter((o): o is string => Boolean(o));

export const auth = betterAuth({
  database: kyselyAdapter(kysely, { type: "postgres" }),
  // neon_auth tables use uuid primary keys — make Better Auth emit uuids.
  advanced: { database: { generateId: "uuid" } },
  // Cache the session in a signed cookie for 5 minutes: every API route's
  // requireUser() then avoids a DB round-trip (major transfer/CU saver).
  // Trade-off: bans/revocations take effect within ≤5 minutes.
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    password: {
      hash: async (password: string) => bcrypt.hash(password, 10),
      verify: async ({ password, hash }: { password: string; hash: string }) => {
        if (!hash) return false;
        if (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
          return bcrypt.compare(password, hash);
        }
        return false;
      },
    },
  },
  // Apply Better Auth's Set-Cookie headers inside Next.js Server Actions.
  // Without it, `logout()`'s server-side signOut invalidated the session row
  // but left the `__Secure-` session cookies in the browser, so the 5-minute
  // signed session cache kept the user signed in. Must stay the last plugin.
  plugins: [nextCookies()],
});
