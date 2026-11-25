import { readFile } from "node:fs/promises";
import { fixture, org, otherOrg, person, otherPerson } from "./work-os-admin-otto-fixture.mts";
export { org, otherOrg, person, otherPerson };
export const payrollMigration = async () => [
  await readFile(new URL("../../supabase/migrations/0078_work_payroll_review.sql", import.meta.url), "utf8"),
  await readFile(new URL("../../supabase/migrations/0084_work_payroll_app_usage.sql", import.meta.url), "utf8"),
].join("\n");

/** Real SQL, isolated memory DB. This fixture cannot prove row-lock races. */
export async function payrollFixture() {
  const f = await fixture();
  try {
    await f.db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      alter table work_screenshot_summaries add organization_id uuid, add person_id uuid, add evidence_event_id uuid,
        add summary text default '', add visible_context jsonb default '{}', add confidence numeric default 0,
        add processing_status text default 'pending', add model text, add prompt_version text;
      create unique index on work_screenshot_summaries(organization_id,person_id,id);
      create table work_evidence_events(id uuid primary key,organization_id uuid not null,person_id uuid not null,
        unique(organization_id,person_id,id));
      alter table work_people add worktivity_employee_id text;
      create table work_provider_connections(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_workspace_id text not null,active boolean not null default true,config jsonb not null default '{}');
      create table work_source_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_account_id text not null,person_id uuid,verified boolean not null default false);
      create table work_schedules(id uuid primary key default gen_random_uuid(),organization_id uuid not null,person_id uuid not null,
        timezone text not null default 'UTC',days_of_week int[] not null default '{1,2,3,4,5}',arrangement text not null default 'scheduled',
        shift_start text,shift_end text,break_windows jsonb not null default '[]',effective_from date not null,effective_to date,
        active boolean not null default true);
      create table work_schedule_exceptions(id uuid primary key default gen_random_uuid(),organization_id uuid not null,person_id uuid not null,
        exception_date date not null,kind text not null check(kind in ('leave','changed_shift','working_day')),shift_start text,shift_end text,
        break_windows jsonb,unique(organization_id,person_id,exception_date));
      alter table work_sessions add organization_id uuid,add person_id uuid,add shift_date date,add state text,
        add clocked_in_at timestamptz,add clocked_out_at timestamptz,add scheduled_starts_at timestamptz,add scheduled_ends_at timestamptz,
        add schedule_id uuid,add correction_status text,add paused_seconds int not null default 0,add provider_break_seconds int not null default 0;
      create table work_session_events(id uuid primary key default gen_random_uuid(),organization_id uuid not null,person_id uuid not null,
        session_id int,event_type text not null,observed_at timestamptz,from_state text,to_state text,metadata jsonb not null default '{}');
      create table work_consent_records(id uuid primary key default gen_random_uuid(),organization_id uuid not null,person_id uuid not null,
        purpose text not null,policy_version text not null,decision text not null,occurred_at timestamptz not null default now());
      create table work_screenshot_access_log(id uuid primary key default gen_random_uuid(),organization_id uuid not null,
        screenshot_summary_id uuid not null,accessed_by uuid,reason text not null,accessed_at timestamptz not null default now());
    `);
    await f.db.exec(await payrollMigration());
    await f.db.exec(`
      insert into work_consent_records(organization_id,person_id,purpose,policy_version,decision,occurred_at)
      values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Employee work planning, task coordination, evidence collection, and manager-reviewable reporting within Work OS.','work-tracking-v1','accepted','2026-01-01T00:00:00Z'),
             ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Neutral screenshot summaries for approved Work OS activity context only.','work-tracking-v1','accepted','2026-01-01T00:00:00Z'),
             ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Employee work planning, task coordination, evidence collection, and manager-reviewable reporting within Work OS.','work-tracking-v1','accepted','2026-01-01T00:00:00Z'),
             ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Neutral screenshot summaries for approved Work OS activity context only.','work-tracking-v1','accepted','2026-01-01T00:00:00Z');
    `);
    return f;
  } catch (error) { await f.close(); throw error; }
}

export async function seedPayroll(f: Awaited<ReturnType<typeof payrollFixture>>) {
  const reviewId = "60000000-0000-4000-8000-000000000001";
  const approvalId = "60000000-0000-4000-8000-000000000002";
  const dayId = "60000000-0000-4000-8000-000000000003";
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,retention_expires_at)
    values($1,$2,$3,'2026-11-16','2026-11-01','2026-11-15','UTC','2026-12-16Z')`, [reviewId,org,person]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
    values($1,$2,$3,1,'source-a','v1',now(),'{}','{}')`, [org,reviewId,person]);
  await f.db.query(`insert into work_payroll_days
    (id,organization_id,review_id,person_id,analysis_revision,local_date,week,source_hash)
    values($1,$2,$3,$4,1,'2026-11-01',1,'source-a')`, [dayId,org,reviewId,person]);
  await f.db.query(`insert into work_payroll_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,required_action,reason,source_hash)
    values($1,$2,$3,1,$4,'gap-1','unverified_gap','needs_review','acknowledge','acknowledge','Missing captures','source-a')`, [org,reviewId,person,dayId]);
  await f.db.query(`insert into work_payroll_approvals
    (id,organization_id,review_id,person_id,analysis_revision,revision,snapshot,approved_minutes,approved_by,snapshot_hash,export_schema_version,request_key)
    values($1,$2,$3,$4,1,1,'{}',60,$4,'hash','v1','approve-1')`, [approvalId,org,reviewId,person]);
  return { reviewId, approvalId, dayId };
}
