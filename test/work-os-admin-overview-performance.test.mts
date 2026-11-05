import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdminOverview } from "../src/lib/work-os-admin-overview";
import { loadWorkOsReadinessReport } from "../src/lib/work-os-readiness-report";
import { evaluateWorkOsReadiness, type WorkOsReadinessInput } from "../src/lib/work-os-readiness";
import { overviewFixture, access, date, now, org, otherOrg, person } from "./helpers/work-os-overview-performance-fixture.mts";

test("Overview exact aggregates survive chart/detail caps and do not reload setup", async (t) => {
  const fixture = await overviewFixture();
  t.after(fixture.close);
  await getAdminOverview(access, { date, now });
  fixture.reset();
  const result = await getAdminOverview(access, { date, now });
  t.diagnostic(JSON.stringify({ path: "overview", queries: fixture.trace.length, rows: fixture.trace.reduce((s, q) => s + q.rows, 0), bytes: fixture.trace.reduce((s, q) => s + q.bytes, 0) }));
  assert.equal(result.counts.updatesToday, 2501);
  assert.equal(result.counts.substantiveUpdatesToday, 1250);
  assert.equal(result.counts.tasksCompletedToday, 2501);
  assert.equal(result.counts.tasksOpen, 2501);
  assert.equal(result.counts.tasksOverdue, 2501);
  assert.equal(result.counts.reportsPendingReview, 251);
  assert.equal(result.series.at(-1)?.updates, 2501, "series must not stop at 2000 source rows");
  assert.equal(result.series.at(-1)?.completed, 2501);
  assert.equal(result.series.at(-1)?.evidence, 2501);
  assert.equal(result.counts.reportsSubmittedToday, 251, "exact reports must not derive from the 200-row list");
  assert.equal(result.counts.reportsDraftedToday, 251);
  assert.equal(result.counts.disputedEvidence, 2501, "correction count must not derive from capped details");
  assert.equal(result.people[0].updatesToday, 2501);
  assert.equal(result.people[0].evidenceToday, 2501);
  assert.equal(result.people[0].tasksCompletedToday, 2501);
  assert.equal(result.timeSeries.at(-2)?.totalMinutes, 50);
  assert.equal(result.counts.eodOutstandingDays, 1);
  assert.equal(result.freshness.githubEventsToday, 2501);
  assert.equal(result.freshness.niftyTasksToday, 2501);
  assert.equal(result.readiness, null, "setup is a separate authenticated read");
  assert.ok(!fixture.trace.some((q) => /work_org_members|work_provider_credentials/.test(q.sql)));
  assert.ok(fixture.trace.length <= 18, "operational dashboard has bounded fan-out");
});

test("readiness aggregates completeness without transferring task text and refreshes setup without a server cache", async (t) => {
  const fixture = await overviewFixture();
  t.after(fixture.close);
  const result = await loadWorkOsReadinessReport(access);
  t.diagnostic(JSON.stringify({ path: "readiness", queries: fixture.trace.length, rows: fixture.trace.reduce((s, q) => s + q.rows, 0), bytes: fixture.trace.reduce((s, q) => s + q.bytes, 0) }));
  assert.deepEqual(result.checks.tasks, {
    open: 2501, withoutAssignee: 2501, withoutDueDate: 0, withoutPriority: 1250,
    withoutEstimatedEffort: 833, withoutExpectedOutcome: 0, withoutDefinitionOfDone: 0, withoutTaskGroup: 2501,
  });
  assert.ok(fixture.trace.reduce((s, q) => s + q.rows, 0) < 30);
  assert.ok(!fixture.trace.some((q) => q.bytes > 20_000), "no unbounded completeness text transfer");
  await fixture.db.query("update work_organizations set feature_flags = '{\"employee_companion\":false}' where id = $1", [org]);
  const refreshed = await loadWorkOsReadinessReport(access);
  assert.ok(refreshed.issues.some((issue) => issue.code === "feature.employee_companion_disabled"));
});

test("SQL completeness matches the evaluator for whitespace, nullable arrays, zero effort and archived/deleted rows", async (t) => {
  const fixture = await overviewFixture();
  t.after(fixture.close);
  await fixture.db.exec(`delete from work_tasks;
    insert into work_tasks (organization_id,completed,status,assignee_person_ids,due_date,priority,estimated_effort,
      estimated_effort_minutes,expected_outcome,definition_of_done,task_group_id) values
      ('${org}',false,'open',array['${person}'::uuid],'2026-11-03','high',0,null,'Expected','Done','${person}'),
      ('${org}',false,'open',null,null,E'\\t\\n',null,0,E'\\u00a0',E'\\ufeff',null),
      ('${org}',false,'open','{}',null,'',null,null,null,null,null),
      ('${org}',false,'archived','{}',null,null,null,null,null,null,null),
      ('${org}',false,'deleted','{}',null,null,null,null,null,null,null),
      ('${org}',true,'open','{}',null,null,null,null,null,null,null),
      ('${otherOrg}',false,'open','{}',null,null,null,null,null,null,null);`);
  const report = await loadWorkOsReadinessReport(access);
  assert.deepEqual(report.checks.tasks, {
    open: 3, withoutAssignee: 2, withoutDueDate: 2, withoutPriority: 2,
    withoutEstimatedEffort: 1, withoutExpectedOutcome: 2, withoutDefinitionOfDone: 2, withoutTaskGroup: 2,
  });
  const rows = await fixture.db.query<WorkOsReadinessInput["tasks"][number]>(`select completed,status,assignee_person_ids as "assigneePersonIds",due_date as "dueDate",
    priority,estimated_effort as "estimatedEffort",estimated_effort_minutes as "estimatedEffortMinutes",
    expected_outcome as "expectedOutcome",definition_of_done as "definitionOfDone",task_group_id as "taskGroupId"
    from work_tasks where organization_id = $1`, [org]);
  const canonical = evaluateWorkOsReadiness({ organization: { id: org, name: "", slug: "" }, people: [], memberships: [], teams: [],
    teamMembers: [], schedules: [], roleProfiles: [], connections: [], credentials: [], sourceAccounts: [],
    tasks: rows.rows, providerReady: {}, runtime: report.checks.runtime });
  assert.deepEqual(report.checks.tasks, canonical.checks.tasks);
});

test("Overview historical buckets isolate tenants, keep window edges and do not attribute foreign corrections", async (t) => {
  const fixture = await overviewFixture();
  t.after(fixture.close);
  await fixture.db.exec(`
    update work_check_ins set kind = 'focus', update_kind = '' where organization_id = '${org}' and shift_date = '${date}';
    insert into work_task_day_events (organization_id,person_id,local_date,event_type) values
      ('${otherOrg}','${person}','${date}','completed'),('${org}','${person}','2026-10-20','completed'),
      ('${org}','${person}','2026-11-04','completed'),('${org}','${person}','2026-10-21','completed'),
      ('${org}','${person}','${date}','reopened');
    insert into work_evidence_events (id,organization_id,provider,occurred_at,correction_status) values
      ('00000000-0000-4000-8000-000000000099','${otherOrg}','github','2026-11-03T14:00Z','disputed');
    insert into work_evidence (organization_id,person_id,source,evidence_date,evidence_event_id) values
      ('${org}','${person}','manual','${date}','00000000-0000-4000-8000-000000000099'),
      ('${org}','${person}','worktivity','2026-10-21',null),('${org}','${person}','github','2026-10-20',null),
      ('${org}','${person}','github','2026-11-04',null),('${otherOrg}','${person}','github','${date}',null);
    insert into work_reports (organization_id,person_id,report_date,status,submitted_at) values
      ('${otherOrg}','${person}','${date}','pending_review','2026-11-03T14:00Z');
  `);
  const report = await getAdminOverview(access, { date, now });
  assert.equal(report.people[0].lastUpdateKind, "focus", "empty update_kind retains the recorded kind fallback");
  assert.equal(report.series[0].date, "2026-10-21");
  assert.equal(report.series[0].completed, 1);
  assert.equal(report.series[0].evidence, 1);
  assert.equal(report.series.reduce((sum, day) => sum + day.completed, 0), 2502);
  assert.equal(report.series.reduce((sum, day) => sum + day.evidence, 0), 2503);
  assert.equal(report.counts.disputedEvidence, 2501, "foreign event references never count as this tenant's correction");
  assert.equal(report.counts.reportsPendingReview, 251);
  assert.equal(report.freshness.githubEventsToday, 2501);
  const historical = await getAdminOverview(access, { date: "2026-10-21", now });
  assert.equal(historical.counts.tasksCompletedToday, 1);
  assert.equal(historical.counts.evidenceToday, 1);
  assert.equal(historical.counts.evidenceActivityToday, 1);
  assert.equal(historical.counts.updatesToday, 0);
  assert.equal(historical.counts.tasksOverdue, 0);
  assert.equal(historical.counts.reportsSubmittedToday, 0);
  assert.equal(historical.counts.reportsPendingReview, 251, "pending queue remains current, not date-filtered");
});
