import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { WorkOsAccess } from "../../src/lib/work-os-api";

export const org = "00000000-0000-4000-8000-000000000001";
export const otherOrg = "00000000-0000-4000-8000-000000000002";
export const person = "00000000-0000-4000-8000-000000000003";
export const access = { organizationId: org } as WorkOsAccess;
export const date = "2026-11-03";
export const now = new Date("2026-11-03T15:00:00Z");

/** Only replaces pg transport. Production predicates, embeds and aggregates
 * execute in PostgreSQL WASM, never against a live database host. */
export async function overviewFixture() {
  const db = new PGlite();
  await db.exec(`
    create table work_organizations (id uuid primary key, name text, slug text, feature_flags jsonb);
    create table work_role_profiles (id uuid primary key, organization_id uuid, name text);
    create table work_people (id uuid primary key, organization_id uuid, display_name text, email text, active boolean,
      auth_user_id uuid, nifty_member_id text, worktivity_employee_id text, role_profile_id uuid references work_role_profiles);
    create table work_org_members (organization_id uuid, person_id uuid, role text, active boolean);
    create table work_teams (id uuid primary key, organization_id uuid, active boolean);
    create table work_team_members (team_id uuid references work_teams, person_id uuid, is_manager boolean);
    create table work_schedules (id uuid primary key, organization_id uuid, person_id uuid, timezone text, shift_start time,
      shift_end time, days_of_week int[], effective_from date, effective_to date, active boolean);
    create table work_provider_connections (organization_id uuid, provider text, active boolean);
    create table work_provider_credentials (organization_id uuid, provider text, expires_at timestamptz);
    create table work_source_accounts (organization_id uuid, provider text, person_id uuid, verified boolean, metadata jsonb);
    create table work_tasks (id uuid primary key default gen_random_uuid(), organization_id uuid, completed boolean, status text,
      assignee_person_ids uuid[], due_date date, priority text, estimated_effort numeric, estimated_effort_minutes int,
      expected_outcome text, definition_of_done text, task_group_id uuid, created_at timestamptz, updated_at timestamptz);
    create table work_sessions (id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid, shift_date date,
      state text, clocked_in_at timestamptz, clocked_out_at timestamptz, paused_seconds int, attendance_status text,
      attendance_observed_at timestamptz, correction_status text, correction_reason text, last_substantive_update_at timestamptz);
    create table work_attendance_observations (organization_id uuid, person_id uuid, local_date date, state text, observed_at timestamptz,
      clocked_in_at timestamptz, clocked_out_at timestamptz, activity_observed_at timestamptz, provider_break_seconds int);
    create table work_check_ins (id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid, shift_date date,
      kind text, substantive boolean, input_text text, update_kind text, occurred_at timestamptz, created_at timestamptz);
    create table work_activity_intervals (id uuid primary key, organization_id uuid, person_id uuid, local_date date, window_start timestamptz,
      window_end timestamptz, prompt_kind text, generation_status text, review_status text, headline text, ai_detail text,
      final_detail text, employee_feedback text, timezone text, structured_summary jsonb, evidence_expired_at timestamptz);
    create table work_evidence_events (id uuid primary key default gen_random_uuid(), organization_id uuid, provider text, occurred_at timestamptz,
      correction_status text, evidence_class text);
    create table work_screenshot_summaries (id uuid primary key, evidence_event_id uuid references work_evidence_events,
      processing_status text, deleted_at timestamptz);
    create table work_evidence (id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid, source text,
      title text, summary text, evidence_date date, created_at timestamptz, metrics jsonb, evidence_event_id uuid references work_evidence_events);
    create table work_reports (id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid references work_people,
      report_date date, status text, title text, submitted_at timestamptz, reviewed_at timestamptz, manager_notes text);
    create table work_task_day_events (id uuid primary key default gen_random_uuid(), organization_id uuid, person_id uuid,
      local_date date, event_type text, exact_at timestamptz, observed_at timestamptz, task_snapshot jsonb);
    create table work_daily_plans (organization_id uuid, person_id uuid, shift_date date, updated_at timestamptz);
    insert into work_organizations values ('${org}', 'Fixture', 'fixture', '{"employee_companion":true}');
    insert into work_people (id,organization_id,display_name,active) values ('${person}','${org}','Fixture person',true);
    insert into work_teams values ('00000000-0000-4000-8000-000000000004','${org}',true);
    insert into work_team_members values ('00000000-0000-4000-8000-000000000004','${person}',true);
    insert into work_tasks (organization_id,completed,status,assignee_person_ids,due_date,priority,estimated_effort_minutes,
      expected_outcome,definition_of_done,created_at,updated_at)
      select '${org}',false,'open','{}', '2026-11-02',case when n % 2 = 0 then E'\\t\\n ' else 'high' end,
        case when n % 3 = 0 then null else 0 end, repeat('outcome ',128), repeat('done ',128),
        '2026-11-03T10:00:00Z','2026-11-03T12:00:00Z' from generate_series(1,2501) n;
    insert into work_tasks (organization_id,completed,status) values ('${org}',false,'archived'),('${org}',false,'deleted'),
      ('${org}',true,'open'),('${otherOrg}',false,'open');
    insert into work_check_ins (organization_id,person_id,shift_date,substantive,input_text,occurred_at)
      select '${org}','${person}','${date}',n % 2 = 0,'Update','2026-11-03T12:00:00Z'::timestamptz + n * interval '1 second'
      from generate_series(1,2501) n;
    insert into work_check_ins (organization_id,person_id,shift_date,substantive) values
      ('${otherOrg}','${person}','${date}',true),('${org}','${person}','2026-10-20',true),('${org}','${person}','2026-11-04',true);
    insert into work_task_day_events (organization_id,person_id,local_date,event_type,observed_at,task_snapshot)
      select '${org}','${person}','${date}','completed','2026-11-03T12:00:00Z','{"title":"Completed"}' from generate_series(1,2501);
    insert into work_evidence_events (organization_id,provider,occurred_at,correction_status)
      select '${org}','github','2026-11-03T12:00:00Z','disputed' from generate_series(1,2501);
    insert into work_evidence (organization_id,person_id,source,title,evidence_date,created_at,evidence_event_id)
      select '${org}','${person}','github','Evidence','${date}','2026-11-03T12:00:00Z',id from work_evidence_events;
    insert into work_reports (organization_id,person_id,report_date,status,title,submitted_at)
      select '${org}','${person}','${date}','pending_review','EOD','2026-11-03T12:00:00Z' from generate_series(1,251);
    insert into work_reports (organization_id,person_id,report_date,status,title)
      select '${org}','${person}','${date}','draft','Draft' from generate_series(1,251);
    insert into work_sessions (organization_id,person_id,shift_date,clocked_in_at,clocked_out_at,paused_seconds,correction_status) values
      ('${org}','${person}','2026-11-02','2026-11-02T09:00Z','2026-11-02T10:00Z',600,'disputed');
  `);
  const trace: Array<{ sql: string; rows: number; bytes: number }> = [];
  globalThis.__workOsPgPool = {
    query: async (sql: string, values?: unknown[]) => {
      const result = await db.query(sql, values);
      trace.push({ sql, rows: result.rows.length, bytes: Buffer.byteLength(JSON.stringify(result.rows)) });
      return result;
    },
  } as unknown as Pool;
  return { db, trace, reset: () => { trace.length = 0; }, close: async () => { globalThis.__workOsPgPool = undefined; await db.close(); } };
}
