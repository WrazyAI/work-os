// Better Auth server instance (replaces Supabase Auth).
// - Users/sessions live in OUR Postgres (neon_auth schema, Better Auth tables
//   provisioned by Neon Auth and imported from the legacy Supabase dump).
// - bcrypt password verification keeps every legacy password working.
// - Invite-only: sign-up is disabled; provisioning is an admin operation.
// See docs/NEON-MIGRATION-PLAN.md.
import { betterAuth } from "better-auth";
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

type AnyDB = Record<string, unknown>;

const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
authPool.on("connect", (client) => {
  void client.query("SET search_path TO neon_auth, public");
});

const kysely = new Kysely<AnyDB>({
  dialect: new PostgresDialect({ pool: authPool }),
});

const trustedOrigins = [
  "http://localhost:3000",
  process.env.APP_PUBLIC_ORIGIN ?? "https://app.wrazyos.com",
].filter((o): o is string => Boolean(o));

export const auth = betterAuth({
  database: kyselyAdapter(kysely, { type: "postgres" }),
  // neon_auth tables use uuid primary keys — make Better Auth emit uuids.
  advanced: { database: { generateId: "uuid" } },
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
});
