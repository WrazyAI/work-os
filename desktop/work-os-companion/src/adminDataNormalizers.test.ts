import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { seedAdminFixtures } from "./admin/adminFixtures";
import {
  adminKeys,
  isoDaysAgo,
  normalizeAdminInsights,
  normalizeAdminOverview,
  normalizeAdminTaskDetails,
  normalizeAdminTaskList,
  normalizeBlueprints,
  normalizeConnections,
  normalizeEvidence,
  normalizeFieldMappings,
  normalizeGithubActors,
  normalizeGithubRepos,
  normalizeIntervals,
  normalizeOrganization,
  normalizePeople,
  normalizePersonDetail,
  normalizeProjects,
  normalizeReports,
  normalizeSystemStatus,
  todayIso,
} from "./admin/data";

/** The administration data seam against the partial payloads a live workspace
 * can return: absent collections, null embeds, and missing columns must land
 * as honest empties — never an unguarded read, an "undefined", a "NaN", or an
 * "Invalid Date" on the rendered page. */

const serialized = (value: unknown) => JSON.stringify(value);
const expectNoLeaks = (value: unknown) => {
  const text = serialized(value);
  expect(text).not.toContain("undefined");
  expect(text).not.toContain("NaN");
  expect(text).not.toContain("Invalid Date");
};

describe("administration response normalizers", () => {
  it("fills the overview's absent collections, counts, and freshness", () => {
    const overview = normalizeAdminOverview({
      date: "2026-10-15",
      generatedAt: "2026-10-15T09:42:00.000Z",
      counts: { people: 2, onShift: 1 },
      people: [
        { personId: "p-1", displayName: "Amara Okafor", updatesToday: 2 },
        { personId: "p-2", displayName: "Ben Sato", attendance: { state: "unknown", source: "none" } },
      ],
    });
    expect(overview.attention).toEqual([]);
    expect(overview.recentActivity).toEqual([]);
    expect(overview.series).toEqual([]);
    expect(overview.timeSeries).toEqual([]);
    expect(overview.counts.tasksOpen).toBe(0);
    expect(overview.counts.pendingReviewOldestAt).toBeNull();
    expect(overview.freshness).toEqual({
      niftySyncedAt: null, niftyTasksToday: 0, worktivityObservedAt: null,
      githubLastEventAt: null, githubEventsToday: 0, lastPlanAt: null, lastReportSubmittedAt: null,
    });
    // A person row without a schedule, session, or role profile reads as
    // "not mapped / not observed", never as undefined.
    expect(overview.people[0].schedule).toBeNull();
    expect(overview.people[0].session).toBeNull();
    expect(overview.people[0].roleProfile).toBeNull();
    expect(overview.people[0].attendance.state).toBe("unknown");
    expect(overview.people[0].attendance.source).toBe("none");
    expect(overview.people[0].eodOutstanding).toBeNull();
    expectNoLeaks(overview);
  });

  it("keeps a present schedule and session but defaults their missing fields", () => {
    const overview = normalizeAdminOverview({
      people: [{
        personId: "p-1",
        displayName: "Amara Okafor",
        schedule: { start: "08:30" },
        session: { observedSeconds: 5400 },
        attendance: { state: "active", source: "worktivity", freshness: "fresh" },
        email: "",
      }],
    });
    const person = overview.people[0];
    expect(person.schedule).toEqual({ start: "08:30", end: "17:00", daysOfWeek: [1, 2, 3, 4, 5], timezone: "UTC" });
    expect(person.session).toEqual({ state: "scheduled", clockedInAt: null, pausedSeconds: 0, observedSeconds: 5400, correctionStatus: null });
    expect(person.email).toBeNull();
    expect(person.lastUpdateAt).toBeNull();
    expectNoLeaks(overview);
  });

  it("normalizes a sparse overview activity row and attention row", () => {
    const overview = normalizeAdminOverview({
      recentActivity: [{ id: "a-1", at: "2026-10-15T08:00:00.000Z" }],
      attention: [{ code: "tasks_overdue", severity: "nonsense" }],
      series: [{ date: "2026-10-15" }],
    });
    expect(overview.recentActivity[0]).toMatchObject({ kind: "update", title: "Activity", personName: null });
    expect(overview.attention[0]).toMatchObject({ code: "tasks_overdue", severity: "info", count: 0, message: "Tasks overdue" });
    expect(overview.series[0]).toEqual({ date: "2026-10-15", completed: 0, updates: 0, evidence: 0 });
    expectNoLeaks(overview);
  });

  it("gives insights an honest brief when the collections and notes are absent", () => {
    const insights = normalizeAdminInsights({
      range: "30d",
      from: "2026-09-16",
      through: "2026-10-15",
      totals: { outcomesCompleted: 3 },
      previous: {},
      people: [{ personId: "p-1", displayName: "Amara Okafor", outcomesCompleted: 3 }],
    });
    expect(insights.series).toEqual([]);
    expect(insights.timeSeries).toEqual([]);
    expect(insights.updateKinds).toEqual([]);
    expect(insights.topApps).toEqual([]);
    expect(insights.overdueOpen).toBeNull();
    expect(insights.totals.outcomesCompleted).toBe(3);
    expect(insights.totals.updates).toBe(0);
    expect(insights.previous.activePeople).toBe(0);
    expect(insights.notes).toEqual({
      summary: "No summary was recorded for this range.",
      wins: [],
      attention: [],
      nextFocus: [],
    });
    // A rate is only stated when the payload recorded one.
    expect(insights.people[0].commitmentRate).toBeNull();
    expect(insights.people[0].lastActivityAt).toBeNull();
    expect(insights.freshness.generatedAt).toBe("");
    expectNoLeaks(insights);
  });

  it("keeps recorded insight rates and drops unreadable dates", () => {
    const insights = normalizeAdminInsights({
      people: [{ personId: "p-1", displayName: "Amara Okafor", commitmentRate: 0, lastActivityAt: "not-a-date" }],
      overdueOpen: 0,
      notes: { summary: "Recorded.", wins: ["a win", ""], attention: [], nextFocus: [] },
    });
    expect(insights.people[0].commitmentRate).toBe(0);
    expect(insights.people[0].lastActivityAt).toBeNull();
    expect(insights.overdueOpen).toBe(0);
    expect(insights.notes.summary).toBe("Recorded.");
    expect(insights.notes.wins).toEqual(["a win"]);
    expectNoLeaks(insights);
  });

  it("normalizes the roster without role profiles", () => {
    const people = normalizePeople({ people: [{ id: "p-1" }, null] });
    expect(people.roleProfiles).toEqual([]);
    expect(people.people).toHaveLength(2);
    expect(people.people[0]).toMatchObject({ id: "p-1", display_name: "Unknown", email: null });
    expect(people.people[1]).toMatchObject({ id: "", display_name: "Unknown" });
    expectNoLeaks(people);
  });

  it("turns a person detail without its collections into empty sections", () => {
    const detail = normalizePersonDetail({ person: { id: "p-1", display_name: "Amara Okafor" } });
    expect(detail.teams).toEqual([]);
    expect(detail.schedules).toEqual([]);
    expect(detail.exceptions).toEqual([]);
    expect(detail.sessions).toEqual([]);
    expect(detail.reports).toEqual([]);
    expect(detail.updates).toEqual([]);
    expect(detail.intervals).toEqual([]);
    expect(detail.evidenceSummary).toEqual({ total: 0, activity: 0, output: 0, disputed: 0 });
    // An absent flag never silently deactivates a person.
    expect(detail.person.active).toBe(true);
    expect(detail.person.role_profile).toBeNull();
    expectNoLeaks(detail);
  });

  it("derives report counts only when the payload omitted them", () => {
    const listed = normalizeReports({
      reports: [
        { id: "r-1", report_date: "2026-10-15", status: "pending_review" },
        { id: "r-2", report_date: "2026-10-14" },
      ],
    });
    expect(listed.reports[0].person).toBeNull();
    expect(listed.reports[0].metrics).toBeNull();
    expect(listed.reports[0].versions).toEqual([]);
    expect(listed.reports[0].submitted_markdown).toBeNull();
    expect(listed.counts).toEqual({ draft: 1, pending_review: 1, approved: 0, rejected: 0, total: 2 });
    const recorded = normalizeReports({
      reports: [{ id: "r-1", report_date: "2026-10-15", status: "approved" }],
      counts: { approved: 9, total: 12 },
      series: [{ date: "2026-10-15", submitted: 1, drafted: 0 }],
    });
    expect(recorded.counts).toEqual({ draft: 0, pending_review: 0, approved: 9, rejected: 0, total: 12 });
    expect(recorded.series).toHaveLength(1);
    expectNoLeaks(listed);
  });

  it("keeps report versions and person embeds when present", () => {
    const reports = normalizeReports({
      reports: [{
        id: "r-1",
        report_date: "2026-10-15",
        status: "draft",
        person: { id: "p-1", display_name: "Amara Okafor" },
        versions: [{ id: "v-1", version_kind: "generated", created_at: "2026-10-15T08:00:00.000Z" }],
      }],
    });
    expect(reports.reports[0].person).toEqual({ id: "p-1", display_name: "Amara Okafor", email: null });
    expect(reports.reports[0].versions).toEqual([{ id: "v-1", version_kind: "generated", created_at: "2026-10-15T08:00:00.000Z" }]);
  });

  it("normalizes evidence rows without person, event, or screenshot", () => {
    const evidence = normalizeEvidence({ evidence: [{ id: "e-1", source: "github" }] });
    expect(evidence.summary).toBeUndefined();
    expect(evidence.evidence[0]).toMatchObject({
      id: "e-1",
      evidence_date: "",
      source: "github",
      title: "Evidence",
      summary: "",
      url: null,
      person: null,
      task: null,
      event: null,
      created_at: "",
    });
    const summarized = normalizeEvidence({ summary: {} });
    expect(summarized.summary).toEqual({ sources: [], days: [] });
    expectNoLeaks(evidence);
  });

  it("turns an interval without its disclosure collections into empties", () => {
    const intervals = normalizeIntervals({ intervals: [{ id: "i-1", detail: "Recorded detail." }] });
    expect(intervals.intervals[0]).toMatchObject({
      id: "i-1",
      label: "Interval",
      reviewStatus: "inferred",
      promptKind: "follow_up",
      headline: null,
      recordedActivity: [],
      evidence: [],
      evidenceCount: 0,
      personId: "",
      personName: null,
    });
    expect(intervals.intervals[0].detail).toBe("Recorded detail.");
    expectNoLeaks(intervals);
  });

  it("normalizes task rows and their details without projects, assignees, or subtasks", () => {
    const list = normalizeAdminTaskList({ tasks: [{ id: "t-1", name: "Retry handling" }] });
    expect(list.summary).toBeUndefined();
    expect(list.nextOffset).toBeNull();
    expect(list.tasks[0]).toMatchObject({ id: "t-1", name: "Retry handling", title: null, project: null, assignees: [], labels: [], completed: null, due_date: null, created_at: null, provider_created_at: null });
    const details = normalizeAdminTaskDetails({ task: { id: "t-1", title: "Retry handling" } });
    expect(details.subtasks).toEqual([]);
    expect(details.task.project).toBeNull();
    // A present assignee keeps a readable name for the table.
    const named = normalizeAdminTaskList({ tasks: [{ id: "t-2", assignees: [{ display_name: "Amara Okafor" }] }] });
    expect(named.tasks[0].assignees).toEqual([{ display_name: "Amara Okafor", displayName: "Amara Okafor" }]);
    // The created stamps keep their exact field names so the table can read
    // the provider's record first and the local one second.
    const stamped = normalizeAdminTaskList({ tasks: [{ id: "t-3", created_at: "2026-10-01T08:00:00.000Z", provider_created_at: "2026-09-30" }] });
    expect(stamped.tasks[0].created_at).toBe("2026-10-01T08:00:00.000Z");
    expect(stamped.tasks[0].provider_created_at).toBe("2026-09-30");
    expectNoLeaks([list, details, named, stamped]);
  });

  it("normalizes organization, connections, and GitHub payloads without their collections", () => {
    const organization = normalizeOrganization({ organization: { id: "org-1" } });
    expect(organization.organization).toMatchObject({ name: "Workspace", slug: "", feature_flags: null });
    expect(organization.memberships).toEqual([]);
    expect(organization.teams).toEqual([]);
    expect(organization.teamMembers).toEqual([]);
    const connections = normalizeConnections({ connections: [{ id: "conn-1", provider: "github" }] });
    expect(connections.accounts).toEqual([]);
    expect(connections.connections[0]).toMatchObject({ id: "conn-1", provider: "github", active: true, external_workspace_id: null });
    const actors = normalizeGithubActors({});
    expect(actors.actors).toEqual([]);
    expect(actors.people).toEqual([]);
    expect(actors.totals).toEqual({ unattributedEvents: 0, lastEventAt: null });
    expect(actors.configuration).toEqual({ webhookReceiverReady: false, repositoryManagementReady: false });
    const repos = normalizeGithubRepos({});
    expect(repos).toMatchObject({ connection: null, organization: null, repos: [], connectedRepos: [], webhookUrl: "" });
    expect(repos.configuration).toMatchObject({ repositoryManagementReady: false, webhookReceiverReady: false, orgWebhook: false, reason: null });
    expect(normalizeProjects({}).projects).toEqual([]);
    expect(normalizeFieldMappings({}).mappings).toEqual([]);
    expect(normalizeBlueprints({}).blueprints).toEqual([]);
    const status = normalizeSystemStatus({});
    expect(status.schema).toEqual({ ready: false, migration: "" });
    expect(status.nifty).toEqual({ canCallApi: false, hasRefreshToken: false, hasAccessToken: false });
    expectNoLeaks([organization, connections, actors, repos, status]);
  });

  it("is idempotent: normalizing a normalized record changes nothing", () => {
    const sparseOverview = normalizeAdminOverview({ people: [{ personId: "p-1", displayName: "Amara Okafor" }] });
    expect(normalizeAdminOverview(sparseOverview)).toEqual(sparseOverview);
    const sparseInsights = normalizeAdminInsights({ totals: { updates: 2 } });
    expect(normalizeAdminInsights(sparseInsights)).toEqual(sparseInsights);
    const sparseDetail = normalizePersonDetail({ person: { id: "p-1" } });
    expect(normalizePersonDetail(sparseDetail)).toEqual(sparseDetail);
    const sparseEvidence = normalizeEvidence({ evidence: [{ id: "e-1" }] });
    expect(normalizeEvidence(sparseEvidence)).toEqual(sparseEvidence);
    const sparseTasks = normalizeAdminTaskList({ tasks: [{ id: "t-1" }] });
    expect(normalizeAdminTaskList(sparseTasks)).toEqual(sparseTasks);
  });
});

describe("preview fixture states", () => {
  const evidenceFilters = { personId: "", source: "", from: isoDaysAgo(13), to: todayIso(), correction: "", summary: "1", limit: "100" };
  const reportFilters = { status: "pending_review", personId: "", from: isoDaysAgo(30), to: todayIso() };
  const taskFilters = { filter: "open", personId: "", projectId: "", limit: "200", completed: "false" };

  it("seeds every section for dense and sparse, and insights for empty", () => {
    const keys = [
      adminKeys.overview(todayIso()),
      adminKeys.people(),
      adminKeys.insights("7d", ""),
      adminKeys.insights("30d", ""),
      adminKeys.insights("90d", ""),
      adminKeys.reports(reportFilters),
      adminKeys.evidence(evidenceFilters),
      adminKeys.organization(),
      adminKeys.tasks(taskFilters),
    ];
    for (const state of ["dense", "sparse"] as const) {
      const client = new QueryClient();
      seedAdminFixtures(client, state);
      for (const key of keys) expect(client.getQueryData(key), `${state} ${JSON.stringify(key)}`).toBeTruthy();
    }
    // The empty state must seed insights too, or the page reports a load
    // error instead of its honest empty state.
    const emptyClient = new QueryClient();
    seedAdminFixtures(emptyClient, "empty");
    for (const range of ["7d", "30d", "90d"] as const) {
      const insights = normalizeAdminInsights(emptyClient.getQueryData(adminKeys.insights(range, "")));
      expect(insights.totals.outcomesCompleted).toBe(0);
      expect(insights.people).toEqual([]);
      expect(insights.notes.wins).toEqual([]);
    }
  });

  it("normalizes every sparse fixture payload without a leak", () => {
    const client = new QueryClient();
    seedAdminFixtures(client, "sparse");
    const normalized = [
      normalizeAdminOverview(client.getQueryData(adminKeys.overview(todayIso()))),
      normalizeAdminInsights(client.getQueryData(adminKeys.insights("7d", ""))),
      normalizePeople(client.getQueryData(adminKeys.people())),
      normalizePersonDetail(client.getQueryData(adminKeys.person("p-1"))),
      normalizeReports(client.getQueryData(adminKeys.reports(reportFilters))),
      normalizeEvidence(client.getQueryData(adminKeys.evidence(evidenceFilters))),
      normalizeEvidence(client.getQueryData(adminKeys.reportEvidence("p-2", todayIso()))),
      normalizeIntervals(client.getQueryData(adminKeys.intervals({ personId: "", from: isoDaysAgo(13), to: todayIso(), limit: "60" }))),
      normalizeIntervals(client.getQueryData(adminKeys.reportIntervals("p-2", todayIso()))),
      normalizeAdminTaskList(client.getQueryData(adminKeys.tasks(taskFilters))),
      normalizeAdminTaskDetails(client.getQueryData(adminKeys.taskDetails("t-s1"))),
      normalizeProjects(client.getQueryData(adminKeys.projects())),
      normalizeOrganization(client.getQueryData(adminKeys.organization())),
      normalizeConnections(client.getQueryData(adminKeys.connections())),
      normalizeGithubActors(client.getQueryData(adminKeys.githubActors())),
      normalizeGithubRepos(client.getQueryData(adminKeys.githubRepos())),
      normalizeFieldMappings(client.getQueryData(adminKeys.fieldMappings())),
      normalizeBlueprints(client.getQueryData(adminKeys.blueprints())),
      normalizeSystemStatus(client.getQueryData(adminKeys.status())),
    ];
    for (const value of normalized) expectNoLeaks(value);
    // The sparse overview person row carries no attendance object at all; the
    // normalizer must supply the "not observed" reading the page renders.
    const overview = normalized[0] as ReturnType<typeof normalizeAdminOverview>;
    expect(overview.people[1].attendance.state).toBe("unknown");
    expect(overview.attention).toEqual([]);
    expect(overview.timeSeries).toEqual([]);
  });
});
