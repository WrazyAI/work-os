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
    globalThis.__workOsPgPool = new Pool({ connectionString, max: 10 });
  }
  return globalThis.__workOsPgPool;
}
