import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getPool } from "@/lib/db/pool";

/** Minimal query surface accepted by both `pg.Pool`, `pg.PoolClient`, and PGlite test doubles. */
export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Executes a parameterized SQL query and returns typed rows. */
export async function queryRows<TRow extends QueryResultRow>(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<TRow[]> {
  const { rows } = await db.query<TRow>(sql, params as unknown[]);
  return rows;
}

/** Executes a parameterized SQL query and returns the first row or null. */
export async function queryOne<TRow extends QueryResultRow>(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<TRow | null> {
  const rows = await queryRows<TRow>(db, sql, params);
  return rows[0] ?? null;
}

/** Executes a parameterized SQL query and throws when no row is returned. */
export async function queryRequired<TRow extends QueryResultRow>(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = [],
  notFoundMessage = "Record not found",
): Promise<TRow> {
  const row = await queryOne<TRow>(db, sql, params);
  if (!row) throw new Error(notFoundMessage);
  return row;
}

/** Executes a write statement and returns the affected row count. */
export async function execSql(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  const result = await db.query(sql, params as unknown[]);
  return result.rowCount ?? 0;
}

/** Runs `fn` inside a `BEGIN` / `COMMIT` transaction, always rolling back on failure and releasing the client. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
