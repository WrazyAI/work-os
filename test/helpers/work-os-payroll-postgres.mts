import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migration, prerequisites } from "./work-os-admin-otto-fixture.mts";
import { payrollMigration } from "./work-os-payroll-fixture.mts";

/** Explicit, loopback-only disposable target. Never read DATABASE_URL. */
export function disposablePayrollTarget(env: Record<string,string|undefined> = process.env): URL {
  if (!env.WORK_OS_TEST_POSTGRES_URL || env.WORK_OS_TEST_POSTGRES_DISPOSABLE !== "1") {
    throw new Error("Explicit disposable PostgreSQL URL and opt-in are required");
  }
  const url = new URL(env.WORK_OS_TEST_POSTGRES_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Only loopback disposable PostgreSQL is permitted");
  }
  if (!/(^|_)(test|disposable)(_|$)/i.test(decodeURIComponent(url.pathname.slice(1)))) {
    throw new Error("Disposable PostgreSQL requires a test/disposable database name marker");
  }
  // libpq query options can override the visible host/database; prohibit these
  // rather than letting a loopback-looking URL redirect writes elsewhere.
  for (const key of url.searchParams.keys()) {
    if (!["sslmode", "connect_timeout"].includes(key)) throw new Error("Unexpected disposable PostgreSQL URL option");
  }
  return url;
}

/** Fresh DATABASE (not search_path substitution): the actual DDL deliberately
 * schema-qualifies security-definer SQL. All connections are independent pg
 * clients, so this can prove locks. Requires local CREATE DATABASE/ROLE rights. */
export async function withDisposablePayrollPostgres<T>(fn: (f: { pool: Pool; database: string }) => Promise<T>): Promise<T> {
  const target = disposablePayrollTarget();
  const setup = new Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 10000 });
  const database = `work_payroll_test_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  let pool: Pool | undefined;
  try {
    const actual = await setup.query("select inet_server_addr()::text as host,current_database() as database");
    if (!["127.0.0.1", "::1"].includes(actual.rows[0].host) || actual.rows[0].database !== decodeURIComponent(target.pathname.slice(1))) {
      throw new Error("Resolved disposable database host/name does not match explicit loopback target");
    }
    await setup.query(`create database ${database}`);
    created = true;
    target.pathname = `/${database}`;
    pool = new Pool({ connectionString: target.href, max: 6, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
    await pool.query(prerequisites);
    await pool.query(await migration());
    await pool.query(`
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      end $$;
      alter table work_screenshot_summaries add organization_id uuid,add person_id uuid,add evidence_event_id uuid;
      alter table work_people add worktivity_employee_id text;
      create table work_evidence_events(id uuid primary key,organization_id uuid not null,person_id uuid not null,unique(organization_id,person_id,id));
      create table work_provider_connections(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_workspace_id text not null,active boolean not null default true,config jsonb not null default '{}');
      create table work_source_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_account_id text not null,person_id uuid,verified boolean not null default false);
    `);
    await pool.query(await payrollMigration());
    return await fn({pool,database});
  } finally {
    if (pool) await pool.end();
    if (created) await setup.query(`drop database ${database}`);
    await setup.end();
  }
}
