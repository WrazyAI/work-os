import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

export const org = "60000000-0000-4000-8000-000000000001";
export const otherOrg = "60000000-0000-4000-8000-000000000002";
export const person = "70000000-0000-4000-8000-000000000001";
export const david = "70000000-0000-4000-8000-000000000002";
export const otherPerson = "70000000-0000-4000-8000-000000000003";
export const connection = "80000000-0000-4000-8000-000000000001";
export const locationId = "kIBcQo8BT0retpfdsHc7";
export const companyId = "90000000-0000-4000-8000-000000000001";
export const actorSam = "VN13egA2TXXCZk90XewJ";
export const actorShared = "Z0hBqXq4ncN34D20H4W2";
export const actorDavid = "iRVuCaXZPdlSXiROT6W1";
export const actorUnknown = "user-not-in-directory";
export const scope = { organizationId: org, connectionId: connection, locationId };

const prerequisites = `
create table work_organizations (
  id uuid primary key,
  name text,
  legacy_owner_id uuid,
  created_by uuid,
  feature_flags jsonb not null default '{"employee_companion":true,"ghl_evidence":true}'::jsonb
);
create table work_people (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  display_name text,
  active boolean not null default true
);
create table work_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null,
  external_workspace_id text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_workspace_id)
);
create table work_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null,
  access_token_cipher text not null,
  refresh_token_cipher text,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider)
);
create table work_source_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null,
  external_account_id text not null,
  external_email text,
  person_id uuid references work_people(id) on delete set null,
  verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider, external_account_id)
);
create table work_evidence_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_type text,
  evidence_class text not null check(evidence_class in ('activity_observation','output_evidence','work_claim')),
  person_id uuid references work_people(id) on delete set null,
  task_id uuid,
  attribution_method text not null default 'unattributed',
  attribution_confidence numeric not null default 0 check(attribution_confidence between 0 and 1),
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  artifact_url text,
  title text not null,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  correction_status text not null default 'original' check(correction_status in ('original','corrected','disputed','retracted')),
  corrected_by uuid,
  corrected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(organization_id, provider, external_event_id)
);
create table work_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid references work_people(id) on delete cascade,
  task_id uuid,
  evidence_event_id uuid unique references work_evidence_events(id) on delete set null,
  evidence_date date not null,
  source text not null,
  title text not null,
  summary text not null default '',
  url text,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_user_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb default '{}'
);
create table work_team_members (
  team_id uuid not null,
  person_id uuid not null,
  is_manager boolean not null default false
);
create table work_activity_intervals (
  id uuid primary key,
  organization_id uuid not null,
  headline text,
  ai_detail text,
  final_detail text,
  structured_summary jsonb,
  review_status text not null default 'inferred',
  updated_at timestamptz not null default now()
);
create table work_reports (
  id uuid primary key,
  organization_id uuid not null,
  status text not null default 'draft',
  generated_markdown text,
  submitted_markdown text,
  updated_at timestamptz not null default now()
);
create table work_report_versions (
  id uuid primary key,
  report_id uuid not null,
  markdown text,
  created_at timestamptz not null default now()
);
insert into work_organizations (id, name, legacy_owner_id, created_by) values
  ('${org}', 'Wrazy', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('${otherOrg}', 'Other', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002');
insert into work_people (id, organization_id, display_name) values
  ('${person}', '${org}', 'Sam Adly'),
  ('${david}', '${org}', 'David Z'),
  ('${otherPerson}', '${otherOrg}', 'Other Person');
insert into work_provider_connections (id, organization_id, provider, external_workspace_id, config, active) values
  ('${connection}', '${org}', 'ghl', '${locationId}', '{}', true);
insert into work_source_accounts (organization_id, provider, external_account_id, person_id, verified, metadata) values
  ('${org}', 'ghl', '${actorSam}', '${person}', true, '{"revision":"r1"}'),
  ('${org}', 'ghl', '${actorShared}', null, false, '{"shared":true,"revision":"r1"}'),
  ('${org}', 'ghl', '${actorDavid}', '${david}', false, '{"revision":"r1"}');
`;

export const ghlMigration = () => readFile(new URL("../../supabase/migrations/0073_work_os_ghl_evidence.sql", import.meta.url), "utf8");

export async function fixture() {
  const db = new PGlite();
  await db.exec(prerequisites);
  await db.exec(await ghlMigration());
  globalThis.__workOsPgPool = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => ({
      query: (sql: string, values?: unknown[]) => db.query(sql, values),
      release: () => {},
    }),
  } as unknown as Pool;
  return {
    db,
    close: async () => {
      globalThis.__workOsPgPool = undefined;
      await db.close();
    },
  };
}

export async function setIdentityRevision(db: PGlite, externalId: string, revision: string, verified: boolean) {
  await db.query(
    `update work_source_accounts set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{revision}', to_jsonb($1::text)), verified = $2
      where organization_id = $3 and provider = 'ghl' and external_account_id = $4`,
    [revision, verified, org, externalId],
  );
}
