import { readFile } from "node:fs/promises";
import { fixture, org, otherOrg, person, otherPerson } from "./work-os-admin-otto-fixture.mts";
export { org, otherOrg, person, otherPerson };
export const payrollMigration = () => readFile(new URL("../../supabase/migrations/0075_work_payroll_review.sql", import.meta.url), "utf8");

/** Real SQL, isolated memory DB. This fixture cannot prove row-lock races. */
export async function payrollFixture() {
  const f = await fixture();
  try {
    await f.db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      alter table work_screenshot_summaries add organization_id uuid, add person_id uuid, add evidence_event_id uuid;
      create unique index on work_screenshot_summaries(organization_id,person_id,id);
      create table work_evidence_events(id uuid primary key,organization_id uuid not null,person_id uuid not null,
        unique(organization_id,person_id,id));
      alter table work_people add worktivity_employee_id text;
      create table work_provider_connections(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_workspace_id text not null,active boolean not null default true,config jsonb not null default '{}');
      create table work_source_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null,provider text not null,
        external_account_id text not null,person_id uuid,verified boolean not null default false);
    `);
    await f.db.exec(await payrollMigration());
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
