import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __workOsPgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__workOsPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }
    globalThis.__workOsPgPool = new Pool({
      connectionString,
      // Background mirror syncs share this pool with interactive reads; a
      // modest ceiling plus timeouts keeps a runaway sync from starving the UI.
      max: Number(process.env.WORK_OS_DB_POOL_MAX ?? 16),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: Number(process.env.WORK_OS_DB_STATEMENT_TIMEOUT_MS ?? 30_000),
      query_timeout: Number(process.env.WORK_OS_DB_STATEMENT_TIMEOUT_MS ?? 30_000),
    });
  }
  return globalThis.__workOsPgPool;
}
