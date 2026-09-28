import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrationTargetLabel, resolveMigrationDbUrl } from "../scripts/resolve-migration-db-url.mjs";

test("db:apply resolves the Neon runtime database before legacy Supabase", () => {
  const neon = "postgresql://neondb_owner:pw@ep-test-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  const unpooled = "postgresql://neondb_owner:pw@ep-test.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  const supabase = "postgresql://postgres:pw@db.pooler.supabase.co:6543/postgres";
  const legacy = {
    SUPABASE_DB_URL: supabase,
    SUPABASE_DB_PASSWORD: "pw",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklm.supabase.co",
  };

  assert.equal(resolveMigrationDbUrl({ ...legacy, DATABASE_URL: neon }), neon, "Neon beats the legacy Supabase env");
  assert.equal(resolveMigrationDbUrl({ ...legacy, DATABASE_URL: neon, DATABASE_URL_UNPOOLED: unpooled }), unpooled, "the direct Neon endpoint is preferred for DDL");
  assert.equal(resolveMigrationDbUrl({ ...legacy, DATABASE_URL: neon, DATABASE_URL_UNPOOLED: unpooled, MIGRATION_DATABASE_URL: supabase }), supabase, "an explicit override wins");
  assert.equal(resolveMigrationDbUrl(legacy), supabase, "Supabase remains reachable when no runtime URL is present");
  assert.equal(
    resolveMigrationDbUrl({ SUPABASE_DB_PASSWORD: "pw", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklm.supabase.co" }),
    "postgresql://postgres:pw@db.abcdefghijklm.supabase.co:5432/postgres",
    "the legacy password fallback still derives the direct host",
  );
  assert.equal(resolveMigrationDbUrl({}), null, "no connection means a hard failure, never a silent default");
  assert.equal(migrationTargetLabel(neon), "ep-test-pooler.c-6.eu-central-1.aws.neon.tech (Neon)");
});

const migrations = [
  "supabase/migrations/0001_init.sql",
  "supabase/migrations/0002_uploads.sql",
  "supabase/migrations/0003_worktivity_audit.sql",
  "supabase/migrations/0004_worktivity_vision.sql",
  "supabase/migrations/0005_audit_progress.sql",
  "supabase/migrations/0006_admin_controls.sql",
  "supabase/migrations/0007_profile_avatar.sql",
  "supabase/migrations/0008_work_os.sql",
  "supabase/migrations/0009_work_os_people_email_merge.sql",
  "supabase/migrations/0010_work_os_employee_companion.sql",
  "supabase/migrations/0011_work_os_employee_onboarding.sql",
  "supabase/migrations/0014_work_tasks_milestone_id.sql",
  "supabase/migrations/0015_work_os_workday_foundation.sql",
  "supabase/migrations/0030_work_os_attendance_observations.sql",
  "supabase/migrations/0016_work_os_guided_onboarding.sql",
  "supabase/migrations/0017_work_os_phase1_closure.sql",
  "supabase/migrations/0018_work_os_nifty_history.sql",
  "supabase/migrations/0019_work_os_plans_insights.sql",
  "supabase/migrations/0020_work_os_unified_tasks_workspace.sql",
  "supabase/migrations/0021_work_os_onboarding_telemetry_hardening.sql",
  "supabase/migrations/0022_work_os_phase1_reliability.sql",
  "supabase/migrations/0023_work_os_task_event_sync_repair.sql",
  "supabase/migrations/0024_work_os_phase1_ledger_closure.sql",
  "supabase/migrations/0025_work_os_phase1_pilot_corrections.sql",
  "supabase/migrations/0026_work_os_pilot_schedule_correction.sql",
    "supabase/migrations/0027_work_os_multiple_daily_sessions.sql",
    "neon/migrations/0033_adaptive_planning.sql",
    "neon/migrations/0034_adaptive_planning_atomic_save.sql",
    "neon/migrations/0035_ai_plan_build_confirmation_gate.sql",
    "neon/migrations/0036_work_os_query_indexes.sql",
    "neon/migrations/0038_work_reports_daily_eod_unique.sql",
    "neon/migrations/0039_work_screenshot_schedule.sql",
    "supabase/migrations/0050_work_os_profile_atomicity.sql",
    "supabase/migrations/0051_work_os_employee_schedule_settings.sql",
    "supabase/migrations/0052_work_os_sorted_task_history.sql",
    "supabase/migrations/0053_work_activity_intervals.sql",
    "neon/migrations/0041_work_activity_intervals.sql",
  ];

test("Work OS companion migration is complete and idempotent", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema storage;
    create role authenticated nologin;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null);
    create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create publication supabase_realtime;
  `);

  for (const path of migrations) await db.exec(await readFile(path, "utf8"));
  for (const path of migrations.slice(1)) await db.exec(await readFile(path, "utf8"));

  const expectedTables = [
    "work_organizations", "work_org_members", "work_teams", "work_team_members",
    "work_schedules", "work_schedule_exceptions", "work_check_ins", "work_task_proposals",
    "work_evidence_events", "work_screenshot_summaries", "work_screenshot_access_log",
    "work_report_versions", "work_desktop_sessions", "work_audit_log",
    "work_employee_onboarding", "work_consent_records",
    "work_sessions", "work_daily_plans", "work_daily_plan_items", "work_daily_plan_builds", "work_session_events", "work_task_day_events",
    "work_activity_intervals", "work_activity_interval_evidence",
  ];
  const tables = await db.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any($1)
  `, [expectedTables]);
  assert.equal(tables.rows.length, expectedTables.length);
  const exactCompletionIndex = await db.query(`select indexname from pg_indexes where schemaname='public' and indexname='work_task_day_events_exact_completion_uidx'`);
  assert.equal(exactCompletionIndex.rows.length, 1);
  const dailyEodIndex = await db.query(`select indexname from pg_indexes where schemaname='public' and indexname='work_reports_daily_eod_uidx'`);
  assert.equal(dailyEodIndex.rows.length, 1);
  const screenshotScheduleColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_schedules'
      and column_name = any($1)
  `, [["screenshot_analysis_enabled", "screenshot_analysis_interval_minutes", "screenshot_analysis_start", "screenshot_analysis_end", "screenshot_analysis_eod_lead_minutes"]]);
  assert.equal(screenshotScheduleColumns.rows.length, 5);
  const activityIntervalColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_activity_intervals'
      and column_name = any($1)
  `, [["slot_key", "prompt_kind", "prompt_due_at", "window_start", "window_end", "generation_status", "review_status", "headline", "ai_detail", "final_detail", "employee_feedback", "evidence_expired_at"]]);
  assert.equal(activityIntervalColumns.rows.length, 12);
  const activityIntervalUnique = await db.query(`
    select conname from pg_constraint where conname = 'work_activity_intervals_organization_id_person_id_slot_key_key'
  `);
  assert.equal(activityIntervalUnique.rows.length, 1);
  const activityIntervalEvidenceColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_activity_interval_evidence'
      and column_name = any($1)
  `, [["interval_id", "screenshot_summary_id", "evidence_event_id", "captured_at", "ordinal", "used_in_model", "raw_image_shown", "selection_reason", "visible_app_snapshot", "frame_summary_snapshot"]]);
  assert.equal(activityIntervalEvidenceColumns.rows.length, 10);

  const policies = await db.query(`
    select count(*)::int as count from pg_policies where schemaname='public'
      and tablename = any($1)
  `, [[...expectedTables, "work_people", "work_tasks", "work_evidence", "work_reports"]]);
  assert.ok(policies.rows[0].count >= 20, `expected companion RLS policies, found ${policies.rows[0].count}`);

  const taskColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_tasks'
      and column_name = any($1)
  `, [["priority", "estimated_effort_minutes", "expected_outcome", "definition_of_done", "dependency_task_ids", "blocked_reason"]]);
  assert.equal(taskColumns.rows.length, 6);
  const evidenceIdempotencyColumn = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_evidence' and column_name='idempotency_key'
  `);
  assert.equal(evidenceIdempotencyColumn.rows.length, 1);
  const phase1SessionColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_sessions'
      and column_name = any($1)
  `, [["first_follow_up_at", "next_fallback_at", "last_prompt_kind", "last_prompt_at"]]);
  assert.equal(phase1SessionColumns.rows.length, 4);
  const phase1Constraints = await db.query(`
    select conname from pg_constraint where conname = any($1)
  `, [["work_sessions_last_prompt_kind_check", "work_daily_plan_items_disposition_check", "work_task_proposals_operation_check"]]);
  assert.equal(phase1Constraints.rows.length, 3);
  const planColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_daily_plan_items'
      and column_name = any($1)
  `, [["item_kind", "completion_state", "completed_at"]]);
  assert.equal(planColumns.rows.length, 3);
  const planSession = await db.query(`
    select is_nullable from information_schema.columns
    where table_schema='public' and table_name='work_daily_plans' and column_name='session_id'
  `);
  assert.equal(planSession.rows[0].is_nullable, "YES");
  const goalColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_daily_plans'
      and column_name = any($1)
  `, [["goal_provenance", "suggestion_task_ids"]]);
  assert.equal(goalColumns.rows.length, 2);
  const adaptivePlanColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='work_daily_plans'
      and column_name = any($1)
  `, [["focus_summary", "interpretation_metadata", "clarification_answers"]]);
  assert.equal(adaptivePlanColumns.rows.length, 3);
  const atomicPlanSave = await db.query(`select proname from pg_proc where proname='work_save_daily_plan_draft'`);
  assert.equal(atomicPlanSave.rows.length, 1);
  const hardeningColumns = await db.query(`
    select table_name, column_name from information_schema.columns
    where table_schema='public' and (table_name='work_employee_onboarding' and column_name = any($1)
      or table_name='work_sessions' and column_name = any($2))
  `, [["draft_revision", "draft_client_mutation_key"], ["provider_break_seconds", "provider_break_observed_at", "provider_break_provenance"]]);
  assert.equal(hardeningColumns.rows.length, 5);
  const onboardingRpc = await db.query(`select proname from pg_proc where proname='work_submit_employee_onboarding'`);
  assert.equal(onboardingRpc.rows.length, 1);
  const accountSettingsRpc = await db.query(`select proname from pg_proc where proname='work_save_employee_account_settings'`);
  assert.equal(accountSettingsRpc.rows.length, 1);
  const profileUpdatedAt = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='updated_at'`);
  assert.equal(profileUpdatedAt.rows.length, 1);

  const users = await db.query(`
    insert into auth.users(email) values ('owner-a@test.invalid'),('employee-a@test.invalid'),('employee-b@test.invalid') returning id,email
  `);
  const owner = users.rows.find((row) => row.email.startsWith("owner"));
  const employeeA = users.rows.find((row) => row.email.startsWith("employee-a"));
  const employeeB = users.rows.find((row) => row.email.startsWith("employee-b"));
  const orgs = await db.query(`
    insert into work_organizations(name,slug,created_by) values ('A','test-a',$1),('B','test-b',$1) returning id,slug
  `, [owner.id]);
  const orgA = orgs.rows.find((row) => row.slug === "test-a").id;
  const orgB = orgs.rows.find((row) => row.slug === "test-b").id;
  const people = await db.query(`
    insert into work_people(user_id,organization_id,display_name,email,auth_user_id)
    values ($1,$2,'Employee A','employee-a@test.invalid',$3),($1,$4,'Employee B','employee-b@test.invalid',$5)
    returning id,organization_id
  `, [owner.id, orgA, employeeA.id, orgB, employeeB.id]);
  const personA = people.rows.find((row) => row.organization_id === orgA).id;
  const personB = people.rows.find((row) => row.organization_id === orgB).id;
  const admins = await db.query(`
    insert into auth.users(email) values ('admin-a@test.invalid'),('admin-b@test.invalid') returning id,email
  `);
  const adminA = admins.rows.find((row) => row.email.startsWith("admin-a"));
  const adminB = admins.rows.find((row) => row.email.startsWith("admin-b"));
  await db.query(`
    insert into work_org_members(organization_id,user_id,role)
    values ($1,$2,'admin'),($3,$4,'admin')
  `, [orgA, adminA.id, orgB, adminB.id]);

  const tasks = await db.query(`
    insert into work_tasks(user_id,organization_id,provider_task_id,title,assignee_person_ids)
    values ($1,$2,'task-a','Private A',array[$3]::uuid[]),($1,$4,'task-b','Private B',array[$5]::uuid[])
    returning id,organization_id,title
  `, [owner.id, orgA, personA, orgB, personB]);
  const taskA = tasks.rows.find((row) => row.organization_id === orgA);
  const taskB = tasks.rows.find((row) => row.organization_id === orgB);

  const schedules = await db.query(`
    insert into work_schedules(organization_id,person_id,timezone,shift_start,shift_end,created_by)
    values ($1,$2,'UTC','09:00','17:00',$3),($4,$5,'UTC','10:00','18:00',$6)
    returning id,organization_id
  `, [orgA, personA, owner.id, orgB, personB, owner.id]);
  const scheduleA = schedules.rows.find((row) => row.organization_id === orgA).id;
  const scheduleB = schedules.rows.find((row) => row.organization_id === orgB).id;
  const savedAccountSettings = await db.query(`
    select * from work_save_employee_account_settings(
      $1, $2, 0, 'settings-schedule-a',
      '{"timezone":"UTC","draft_step":"profile","schedule_proposal":{"daysOfWeek":[1,2,3,4,5],"shiftStart":"08:30","shiftEnd":"16:30","breaks":[]}}'::jsonb,
      '{}'::jsonb
    )
  `, [orgA, personA]);
  assert.equal(savedAccountSettings.rows[0].draft_revision, 1);
  const updatedSchedule = await db.query(`select timezone, shift_start, shift_end, days_of_week from work_schedules where id=$1`, [scheduleA]);
  assert.deepEqual(updatedSchedule.rows[0], { timezone: "UTC", shift_start: "08:30:00", shift_end: "16:30:00", days_of_week: [1, 2, 3, 4, 5] });
  const workSessions = await db.query(`
    insert into work_sessions(organization_id,person_id,schedule_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at,clocked_in_at,clock_in_idempotency_key)
    values ($1,$2,$3,'2026-08-11','active','UTC','2026-08-11T09:00:00Z','2026-08-11T17:00:00Z','2026-08-11T09:03:00Z','clock-a'),
           ($4,$5,$6,'2026-08-11','active','UTC','2026-08-11T10:00:00Z','2026-08-11T18:00:00Z','2026-08-11T10:02:00Z','clock-b')
    returning id,organization_id
  `, [orgA, personA, scheduleA, orgB, personB, scheduleB]);
  const workSessionA = workSessions.rows.find((row) => row.organization_id === orgA).id;
  const priorSession = await db.query(`
    insert into work_sessions(organization_id,person_id,schedule_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at,clocked_in_at,clocked_out_at,clock_in_idempotency_key)
    values ($1,$2,$3,'2026-08-10','clocked_out','UTC','2026-08-10T09:00:00Z','2026-08-10T17:00:00Z','2026-08-10T09:03:00Z','2026-08-10T17:00:00Z','clock-prior') returning id
  `, [orgA, personA, scheduleA]);
  const restartedSession = await db.query(`
    insert into work_sessions(organization_id,person_id,schedule_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at,clocked_in_at,clocked_out_at,clock_in_idempotency_key)
    values ($1,$2,$3,'2026-08-10','clocked_out','UTC','2026-08-10T09:00:00Z','2026-08-10T17:00:00Z','2026-08-10T18:00:00Z','2026-08-10T19:00:00Z','clock-restarted') returning id
  `, [orgA, personA, scheduleA]);
  assert.ok(restartedSession.rows[0].id, "a second closed interval on the same local day is retained");
  await assert.rejects(() => db.query(`
    insert into work_sessions(organization_id,person_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at)
    values ($1,$2,'2026-08-11','clocked_in','UTC','2026-08-11T09:00:00Z','2026-08-11T17:00:00Z')
  `, [orgA, personA]), /work_sessions_active_person_uidx/);
  await assert.rejects(() => db.query(`
    insert into work_sessions(organization_id,person_id,shift_date,state,timezone,scheduled_starts_at,scheduled_ends_at,clock_in_idempotency_key)
    values ($1,$2,'2026-08-10','clocked_out','UTC','2026-08-10T09:00:00Z','2026-08-10T17:00:00Z','clock-a')
  `, [orgA, personA]), /work_sessions_clock_in_idempotency_uidx/);
  const dailyPlan = await db.query(`
    insert into work_daily_plans(organization_id,person_id,session_id,shift_date,status,confirmation_idempotency_key)
    values ($1,$2,$3,'2026-08-11','confirmed','plan-a') returning id
  `, [orgA, personA, workSessionA]);
  const priorPlan = await db.query(`
    insert into work_daily_plans(organization_id,person_id,session_id,shift_date,status)
    values ($1,$2,$3,'2026-08-10','closed') returning id
  `, [orgA, personA, priorSession.rows[0].id]);
  const preShiftPlan = await db.query(`
    insert into work_daily_plans(organization_id,person_id,shift_date,status)
    values ($1,$2,'2026-08-12','draft') returning id,revision,session_id
  `, [orgA, personA]);
  assert.equal(preShiftPlan.rows[0].revision, 1);
  assert.equal(preShiftPlan.rows[0].session_id, null);
  await db.query(`
    insert into work_daily_plan_items(organization_id,plan_id,person_id,source,title_snapshot,item_kind,completion_state)
    values ($1,$2,$3,'unplanned','Ship the plan page','outcome','open')
  `, [orgA, preShiftPlan.rows[0].id, personA]);
  const preShiftOutcome = await db.query(`select id from work_daily_plan_items where plan_id=$1`, [preShiftPlan.rows[0].id]);
  await assert.rejects(() => db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,1,'atomic-invalid','Intent','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      $4::jsonb,array[]::uuid[],false,null,null,null,null
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, JSON.stringify([{ id: crypto.randomUUID(), rank: 0, disposition: 'selected', title_snapshot: 'Ship the plan page', completion_state: 'open', objective: null, success_criteria: [], estimate_minutes: null, source_refs: [], clarification_state: null }])]), /daily plan item changed/);
  const atomicRollback = await db.query(`select revision, freeform_intent from work_daily_plans where id=$1`, [preShiftPlan.rows[0].id]);
  assert.deepEqual(atomicRollback.rows[0], { revision: 1, freeform_intent: null });
  const atomicSave = await db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,1,'atomic-valid','Ship planning','employee',array[]::text[],null,$5::jsonb,$6::jsonb,
      $4::jsonb,array[]::uuid[],false,null,null,null,null
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, JSON.stringify([{ id: preShiftOutcome.rows[0].id, rank: 0, disposition: 'selected', title_snapshot: 'Ship the plan page', completion_state: 'open', objective: 'Ship the planning page.', success_criteria: ['Review it'], estimate_minutes: 30, source_refs: [], clarification_state: 'resolved' }]), JSON.stringify({ clarifications: [{ id: 'scope', question: 'Which release?', reason: 'ambiguous_scope' }] }), JSON.stringify({ scope: 'This release only.' })]);
  assert.deepEqual(atomicSave.rows[0], { revision: 2, replayed: false });
  const atomicReplay = await db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,1,'atomic-valid','Different intent','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      '[]'::jsonb,array[]::uuid[],false,null,null,null,null
    )
  `, [orgA, personA, preShiftPlan.rows[0].id]);
  assert.deepEqual(atomicReplay.rows[0], { revision: 2, replayed: true });
  const atomicPersisted = await db.query(`select revision, freeform_intent, clarification_answers from work_daily_plans where id=$1`, [preShiftPlan.rows[0].id]);
  assert.deepEqual(atomicPersisted.rows[0], { revision: 2, freeform_intent: 'Ship planning', clarification_answers: { scope: 'This release only.' } });
  const buildId = crypto.randomUUID();
  const intentFingerprint = createHash("sha256").update("Ship planning", "utf8").digest("hex");
  await db.query(`
    insert into work_daily_plan_builds(id,organization_id,person_id,shift_date,intent_fingerprint,expires_at)
    values ($1,$2,$3,'2026-08-12',$4,now() + interval '10 minutes')
  `, [buildId, orgA, personA, intentFingerprint]);
  await assert.rejects(() => db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,2,'invalid-ai-build-confirm','Ship planning','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      $4::jsonb,array[]::uuid[],true,null,null,$5,$6
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, JSON.stringify([{ id: crypto.randomUUID(), rank: 0, disposition: 'selected', title_snapshot: 'Changed after build', completion_state: 'open', objective: null, success_criteria: [], estimate_minutes: null, source_refs: [], clarification_state: null }]), buildId, intentFingerprint]), /daily plan item changed/);
  const unconsumedAfterRollback = await db.query(`select consumed_at from work_daily_plan_builds where id=$1`, [buildId]);
  assert.equal(unconsumedAfterRollback.rows[0].consumed_at, null);
  const confirmedByBuild = await db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,2,'ai-build-confirm','Ship planning','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      null,array[]::uuid[],true,null,null,$4,$5
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, buildId, intentFingerprint]);
  assert.deepEqual(confirmedByBuild.rows[0], { revision: 3, replayed: false });
  const consumedBuild = await db.query(`select consumed_at is not null as consumed, consumed_idempotency_key from work_daily_plan_builds where id=$1`, [buildId]);
  assert.deepEqual(consumedBuild.rows[0], { consumed: true, consumed_idempotency_key: "ai-build-confirm" });
  const confirmationReplay = await db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,2,'ai-build-confirm','Ship planning','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      null,array[]::uuid[],true,null,null,$4,$5
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, buildId, intentFingerprint]);
  assert.deepEqual(confirmationReplay.rows[0], { revision: 3, replayed: true });
  await assert.rejects(() => db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,3,'reused-ai-build','Ship planning','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      null,array[]::uuid[],true,null,null,$4,$5
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, buildId, intentFingerprint]), /AI build confirmation/);
  const mismatchedBuildId = crypto.randomUUID();
  await db.query(`
    insert into work_daily_plan_builds(id,organization_id,person_id,shift_date,intent_fingerprint,expires_at)
    values ($1,$2,$3,'2026-08-12',$4,now() + interval '10 minutes')
  `, [mismatchedBuildId, orgA, personA, intentFingerprint]);
  await assert.rejects(() => db.query(`
    select * from work_save_daily_plan_draft(
      $1,$2,$3,3,'mismatched-ai-intent','Different intent','employee',array[]::text[],null,'{}'::jsonb,'{}'::jsonb,
      null,array[]::uuid[],true,null,null,$4,$5
    )
  `, [orgA, personA, preShiftPlan.rows[0].id, mismatchedBuildId, createHash("sha256").update("Different intent", "utf8").digest("hex")]), /AI build confirmation/);
  await assert.rejects(() => db.query(`
    insert into work_daily_plans(organization_id,person_id,shift_date,status)
    values ($1,$2,'2026-08-12','draft')
  `, [orgA, personA]), /work_daily_plans_person_day_uidx/);
  await db.query(`
    insert into work_daily_plan_items(organization_id,plan_id,person_id,task_id,source,disposition,title_snapshot)
    values ($1,$2,$3,$4,'existing','deferred','Private A carried over')
  `, [orgA, priorPlan.rows[0].id, personA, taskA.id]);
  await db.query(`
    insert into work_daily_plan_items(organization_id,plan_id,person_id,task_id,source,title_snapshot)
    values ($1,$2,$3,$4,'due_today','Private A')
  `, [orgA, dailyPlan.rows[0].id, personA, taskA.id]);
  const checkIns = await db.query(`
    insert into work_check_ins(organization_id,person_id,schedule_id,shift_date,kind,input_text,created_by,client_request_id)
    values ($1,$2,$3,'2026-08-11','plan','Plan A',$4,'check-in-a'),($5,$6,$7,'2026-08-11','plan','Plan B',$8,'check-in-b')
    returning id,organization_id
  `, [orgA, personA, scheduleA, employeeA.id, orgB, personB, scheduleB, employeeB.id]);
  const checkInA = checkIns.rows.find((row) => row.organization_id === orgA).id;
  const checkInB = checkIns.rows.find((row) => row.organization_id === orgB).id;
  const proposals = await db.query(`
    insert into work_task_proposals(organization_id,person_id,check_in_id,task_id,operation,input_text,created_by,idempotency_key)
    values ($1,$2,$3,$4,'log_progress','Proposal A',$5,'proposal-a'),($6,$7,$8,$9,'log_progress','Proposal B',$10,'proposal-b')
    returning id,organization_id
  `, [orgA, personA, checkInA, taskA.id, employeeA.id, orgB, personB, checkInB, taskB.id, employeeB.id]);
  await db.query(`update work_sessions set state='eod_due', first_follow_up_at='2026-08-11T09:30:00Z', next_fallback_at='2026-08-11T10:30:00Z', last_prompt_kind='follow_up', last_prompt_at='2026-08-11T09:30:00Z' where id=$1`, [workSessionA]);
  await db.query(`
    insert into work_session_events(organization_id,person_id,session_id,event_type,from_state,to_state,source,observed_at,idempotency_key)
    values ($1,$2,$3,'eod_due','active','eod_due','system','2026-08-11T16:50:00Z','eod-due-a')
  `, [orgA, personA, workSessionA]);
  const persistedEod = await db.query(`select state, to_char(first_follow_up_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as first_follow_up_at, to_char(next_fallback_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as next_fallback_at, last_prompt_kind from work_sessions where id=$1`, [workSessionA]);
  assert.deepEqual(persistedEod.rows[0], { state: "eod_due", first_follow_up_at: "2026-08-11T09:30:00.000Z", next_fallback_at: "2026-08-11T10:30:00.000Z", last_prompt_kind: "follow_up" });
  const removalProposal = await db.query(`
    update work_task_proposals set operation='remove_from_plan', input_text='No longer a priority',
      before_state=jsonb_build_object('plan_item_id', (select id from work_daily_plan_items where plan_id=$1 and task_id=$2), 'disposition','selected'),
      proposed_change=jsonb_build_object('plan_item_id', (select id from work_daily_plan_items where plan_id=$1 and task_id=$2), 'disposition','removed')
    where id=$3 returning id
  `, [dailyPlan.rows[0].id, taskA.id, proposals.rows.find((row) => row.organization_id === orgA).id]);
  const currentPlanItem = await db.query(`select id from work_daily_plan_items where plan_id=$1 and task_id=$2`, [dailyPlan.rows[0].id, taskA.id]);
  assert.equal(removalProposal.rows.length, 1);
  await db.query(`update work_daily_plan_items set disposition='removal_proposed' where id=$1`, [currentPlanItem.rows[0].id]);
  assert.equal((await db.query(`select disposition from work_daily_plan_items where id=$1`, [currentPlanItem.rows[0].id])).rows[0].disposition, "removal_proposed");
  await db.query(`update work_daily_plan_items set disposition='selected' where id=$1`, [currentPlanItem.rows[0].id]);
  assert.equal((await db.query(`select disposition from work_daily_plan_items where id=$1`, [currentPlanItem.rows[0].id])).rows[0].disposition, "selected");
  await db.query(`update work_daily_plan_items set disposition='removal_proposed' where id=$1`, [currentPlanItem.rows[0].id]);
  await db.query(`update work_daily_plan_items set disposition='removed' where id=$1 and disposition='removal_proposed'`, [currentPlanItem.rows[0].id]);
  assert.equal((await db.query(`select disposition from work_daily_plan_items where id=$1`, [currentPlanItem.rows[0].id])).rows[0].disposition, "removed");

  await db.query(`
    insert into work_provider_connections(organization_id,provider,external_workspace_id)
    values ($1,'github','github-a'),($2,'github','github-b')
  `, [orgA, orgB]);
  await db.query(`
    insert into work_provider_credentials(organization_id,provider,access_token_cipher)
    values ($1,'github','cipher-a'),($2,'github','cipher-b')
  `, [orgA, orgB]);
  await db.query(`
    insert into work_source_accounts(organization_id,provider,external_account_id,person_id,verified)
    values ($1,'github','actor-a',$2,true),($3,'github','actor-b',$4,true)
  `, [orgA, personA, orgB, personB]);
  const evidenceEvents = await db.query(`
    insert into work_evidence_events(organization_id,provider,external_event_id,person_id,evidence_class,occurred_at,title,summary)
    values ($1,'github','event-a',$2,'output_evidence','2026-08-11T12:00:00Z','Evidence A','A'),($3,'github','event-b',$4,'output_evidence','2026-08-11T12:00:00Z','Evidence B','B')
    returning id,organization_id
  `, [orgA, personA, orgB, personB]);
  const evidenceA = evidenceEvents.rows.find((row) => row.organization_id === orgA).id;
  const evidenceB = evidenceEvents.rows.find((row) => row.organization_id === orgB).id;
  await db.query(`
    insert into work_screenshot_summaries(organization_id,person_id,evidence_event_id,storage_path,expires_at,summary,processing_status)
    values ($1,$2,$3,'org-a/private-a.enc','2026-09-10T12:00:00Z','Screenshot A','processed'),($4,$5,$6,'org-b/private-b.enc','2026-09-10T12:00:00Z','Screenshot B','processed')
  `, [orgA, personA, evidenceA, orgB, personB, evidenceB]);
  const reports = await db.query(`
    insert into work_reports(user_id,organization_id,person_id,report_date,title,markdown,draft_idempotency_key)
    values ($1,$2,$3,'2026-08-11','Report A','A','draft-a'),($1,$4,$5,'2026-08-11','Report B','B','draft-b')
    returning id,organization_id
  `, [owner.id, orgA, personA, orgB, personB]);
  const reportA = reports.rows.find((row) => row.organization_id === orgA).id;
  const reportB = reports.rows.find((row) => row.organization_id === orgB).id;
  await db.query(`
    insert into work_evidence(user_id,organization_id,person_id,evidence_date,source,title,idempotency_key)
    values ($1,$2,$3,'2026-08-11','manual','Progress A','progress-a')
  `, [owner.id, orgA, personA]);
  await db.query(`
    insert into work_report_versions(organization_id,report_id,version_kind,markdown,idempotency_key)
    values ($1,$2,'draft','Version A','version-a'),($3,$4,'draft','Version B','version-b')
  `, [orgA, reportA, orgB, reportB]);
  await db.query(`
    insert into work_audit_log(organization_id,actor_user_id,action,target_type,target_id,reason)
    values ($1,$2,'review','report',$3,'A'),($4,$5,'review','report',$6,'B')
  `, [orgA, adminA.id, reportA, orgB, adminB.id, reportB]);

  await db.exec(`
    grant usage on schema public to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    grant usage,select on all sequences in schema public to authenticated;
  `);
  async function asUser(userId, query) {
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [userId]);
    await db.exec("set role authenticated");
    try { return await query(); } finally { await db.exec("reset role"); }
  }
  const ownTasks = await asUser(employeeA.id, () => db.query(`select title from work_tasks order by title`));
  const otherTasks = await asUser(employeeB.id, () => db.query(`select title from work_tasks order by title`));
  assert.deepEqual(ownTasks.rows.map((row) => row.title), ["Private A"]);
  assert.deepEqual(otherTasks.rows.map((row) => row.title), ["Private B"]);

  const employeeAVisibility = await asUser(employeeA.id, () => db.query(`
    select
      (select count(*) from work_people where organization_id=$1)::int as people,
      (select count(*) from work_schedules where organization_id=$1)::int as schedules,
      (select count(*) from work_check_ins where organization_id=$1)::int as check_ins,
      (select count(*) from work_sessions where organization_id=$1)::int as sessions,
      (select count(*) from work_daily_plans where organization_id=$1)::int as daily_plans,
      (select count(*) from work_task_proposals where organization_id=$1)::int as proposals,
      (select count(*) from work_evidence_events where organization_id=$1)::int as evidence_events,
      (select count(*) from work_screenshot_summaries where organization_id=$1)::int as screenshots,
      (select count(*) from work_reports where organization_id=$1)::int as reports,
      (select count(*) from work_report_versions where organization_id=$1)::int as report_versions,
      (select count(*) from work_provider_connections where organization_id=$1)::int as provider_connections,
      (select count(*) from work_provider_credentials where organization_id=$1)::int as provider_credentials,
      (select count(*) from work_source_accounts where organization_id=$1)::int as source_accounts,
      (select count(*) from work_audit_log where organization_id=$1)::int as audit_rows
  `, [orgA]));
  assert.deepEqual(employeeAVisibility.rows[0], {
    people: 1, schedules: 1, check_ins: 1, sessions: 3, daily_plans: 3, proposals: 1, evidence_events: 1, screenshots: 1,
    reports: 1, report_versions: 1, provider_connections: 0, provider_credentials: 0,
    source_accounts: 0, audit_rows: 0,
  });

  const employeeBCrossOrg = await asUser(employeeB.id, () => db.query(`
    select
      (select count(*) from work_people where organization_id=$1)::int as people,
      (select count(*) from work_schedules where organization_id=$1)::int as schedules,
      (select count(*) from work_check_ins where organization_id=$1)::int as check_ins,
      (select count(*) from work_sessions where organization_id=$1)::int as sessions,
      (select count(*) from work_daily_plans where organization_id=$1)::int as daily_plans,
      (select count(*) from work_task_proposals where organization_id=$1)::int as proposals,
      (select count(*) from work_evidence_events where organization_id=$1)::int as evidence_events,
      (select count(*) from work_screenshot_summaries where organization_id=$1)::int as screenshots,
      (select count(*) from work_reports where organization_id=$1)::int as reports,
      (select count(*) from work_report_versions where organization_id=$1)::int as report_versions,
      (select count(*) from work_provider_connections where organization_id=$1)::int as provider_connections,
      (select count(*) from work_provider_credentials where organization_id=$1)::int as provider_credentials,
      (select count(*) from work_source_accounts where organization_id=$1)::int as source_accounts,
      (select count(*) from work_audit_log where organization_id=$1)::int as audit_rows
  `, [orgA]));
  assert.deepEqual(employeeBCrossOrg.rows[0], {
    people: 0, schedules: 0, check_ins: 0, sessions: 0, daily_plans: 0, proposals: 0, evidence_events: 0, screenshots: 0,
    reports: 0, report_versions: 0, provider_connections: 0, provider_credentials: 0,
    source_accounts: 0, audit_rows: 0,
  });

  await db.query(`
    insert into work_activity_intervals(
      organization_id, person_id, work_session_id, local_date, slot_key, prompt_kind, prompt_due_at,
      window_start, window_end, generation_status, review_status, headline, ai_detail, final_detail
    )
    values ($1,$2,$3,'2026-08-11','interval-a','hourly_fallback','2026-08-11T10:00:00Z','2026-08-11T09:00:00Z','2026-08-11T10:00:00Z','ready','inferred','Worked in the editor','Detail A','Detail A'),
           ($4,$5,$6,'2026-08-11','interval-b','hourly_fallback','2026-08-11T10:00:00Z','2026-08-11T09:00:00Z','2026-08-11T10:00:00Z','ready','confirmed','Worked on B','Detail B','Detail B')
  `, [orgA, personA, workSessionA, orgB, personB, workSessions.rows.find((row) => row.organization_id === orgB).id]);
  await db.query(`
    insert into work_activity_interval_evidence(interval_id, organization_id, captured_at, ordinal, visible_app_snapshot, frame_summary_snapshot)
    select id, organization_id, '2026-08-11T09:30:00Z', 0, 'VS Code', 'Editing a file.' from work_activity_intervals where organization_id=$1
  `, [orgA]);
  const intervalVisibility = await asUser(employeeA.id, () => db.query(`
    select
      (select count(*) from work_activity_intervals where organization_id=$1)::int as own_intervals,
      (select count(*) from work_activity_intervals where organization_id=$2)::int as other_intervals,
      (select count(*) from work_activity_interval_evidence)::int as own_evidence
  `, [orgA, orgB]));
  assert.deepEqual(intervalVisibility.rows[0], { own_intervals: 1, other_intervals: 0, own_evidence: 1 });
  await assert.rejects(() => db.query(`
    insert into work_activity_intervals(organization_id, person_id, local_date, slot_key, prompt_kind, prompt_due_at, window_start, window_end)
    values ($1,$2,'2026-08-11','interval-a','hourly_fallback','2026-08-11T10:00:00Z','2026-08-11T09:00:00Z','2026-08-11T10:00:00Z')
  `, [orgA, personA]));

  const adminAVisibility = await asUser(adminA.id, () => db.query(`
    select
      (select count(*) from work_provider_connections where organization_id=$1)::int as provider_connections,
      (select count(*) from work_provider_credentials where organization_id=$1)::int as provider_credentials,
      (select count(*) from work_source_accounts where organization_id=$1)::int as source_accounts,
      (select count(*) from work_audit_log where organization_id=$1)::int as audit_rows,
      (select count(*) from work_provider_connections where organization_id=$2)::int as other_provider_connections,
      (select count(*) from work_provider_credentials where organization_id=$2)::int as other_provider_credentials
  `, [orgA, orgB]));
  assert.deepEqual(adminAVisibility.rows[0], {
    provider_connections: 1, provider_credentials: 1, source_accounts: 1, audit_rows: 1,
    other_provider_connections: 0, other_provider_credentials: 0,
  });

  const forbiddenUpdate = await asUser(employeeB.id, () => db.query(`update work_tasks set title='Bypass' where organization_id=$1`, [orgA]));
  assert.equal(forbiddenUpdate.affectedRows, 0);
  const forbiddenEvidenceUpdate = await asUser(employeeB.id, () => db.query(`update work_evidence_events set title='Bypass' where organization_id=$1`, [orgA]));
  assert.equal(forbiddenEvidenceUpdate.affectedRows, 0);
  const forbiddenCredentialUpdate = await asUser(adminA.id, () => db.query(`update work_provider_credentials set access_token_cipher='cross-org' where organization_id=$1`, [orgB]));
  assert.equal(forbiddenCredentialUpdate.affectedRows, 0);

  await assert.rejects(() => db.query(`
    insert into work_task_proposals(organization_id,person_id,operation,input_text,idempotency_key)
    values ($1,$2,'log_progress','duplicate','proposal-a')
  `, [orgA, personA]));
  await assert.rejects(() => db.query(`
    insert into work_check_ins(organization_id,person_id,shift_date,kind,input_text,client_request_id)
    values ($1,$2,'2026-08-11','plan','duplicate','check-in-a')
  `, [orgA, personA]));
  await assert.rejects(() => db.query(`
    insert into work_evidence_events(organization_id,provider,external_event_id,evidence_class,occurred_at,title)
    values ($1,'github','event-a','output_evidence','2026-08-11T12:00:00Z','duplicate')
  `, [orgA]));
  await assert.rejects(() => db.query(`
    insert into work_tasks(user_id,organization_id,provider_task_id,title)
    values ($1,$2,'task-a','duplicate')
  `, [owner.id, orgA]));
  await assert.rejects(() => db.query(`
    insert into work_reports(user_id,organization_id,person_id,report_date,title,markdown,draft_idempotency_key)
    values ($1,$2,$3,'2026-08-11','duplicate','duplicate','draft-a')
  `, [owner.id, orgA, personA]));
  await assert.rejects(() => db.query(`
    insert into work_evidence(user_id,organization_id,person_id,evidence_date,source,title,idempotency_key)
    values ($1,$2,$3,'2026-08-11','manual','duplicate','progress-a')
  `, [owner.id, orgA, personA]));
  await assert.rejects(() => db.query(`
    insert into work_report_versions(organization_id,report_id,version_kind,markdown,idempotency_key)
    values ($1,$2,'draft','duplicate','version-a')
  `, [orgA, reportA]));
  await db.close();
});

test("Phase 1 ledger closure keeps one canonical exact completion event", async () => {
  const db = new PGlite();
  await db.exec(`
    create table work_task_day_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      person_id uuid,
      task_id uuid not null,
      provider_task_id text not null,
      event_type text not null,
      provenance text not null,
      exact_at timestamptz,
      idempotency_key text not null,
      created_at timestamptz not null default now(),
      unique (organization_id, idempotency_key)
    );
    insert into work_task_day_events(organization_id,person_id,task_id,provider_task_id,event_type,provenance,exact_at,idempotency_key)
    values
      ('00000000-0000-0000-0000-000000000001',null,'00000000-0000-0000-0000-000000000002','provider-task','completed','migration_exact','2026-08-10T20:16:52.120Z','nifty:completed:provider-task:2026-08-10 20:16:52.12+00'),
      ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','provider-task','completed','nifty_exact','2026-08-10T20:16:52.120Z','nifty:completed:provider-task:2026-08-10T20:16:52.120Z');
  `);
  await db.exec(await readFile("supabase/migrations/0024_work_os_phase1_ledger_closure.sql", "utf8"));
  const events = await db.query(`select provenance,person_id,idempotency_key from work_task_day_events`);
  assert.deepEqual(events.rows, [{
    provenance: "nifty_exact",
    person_id: "00000000-0000-0000-0000-000000000003",
    idempotency_key: "nifty:completed:provider-task:2026-08-10T20:16:52.120Z",
  }]);
});
