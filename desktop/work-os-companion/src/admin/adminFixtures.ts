import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { adminKeys, ADMIN_STALE_MS, isoDaysAgo, todayIso } from "./data";
import { workOsKeys } from "../queryClient";
import type { ReadyRecapSummary } from "../NotificationsBell";
import type { ActivityInterval, ActivityIntervalsData, MemoryView, OutstandingEodDay, OutstandingEodsData, PendingSuggestion } from "../types";
import type {
  AdminInsights,
  AdminInsightRange,
  AdminInsightTotals,
  AdminOverview,
  AdminTimeSeriesPoint,
  ConnectionsResponse,
  EvidenceResponse,
  GithubIntegrationActorsResponse,
  GithubIntegrationReposResponse,
  OrganizationResponse,
  PeopleResponse,
  PersonDetailResponse,
  ReportsResponse,
  SessionResponse,
  SystemStatusResponse,
} from "./types";

/** Deterministic fixtures for the dev-only `?preview-admin` harness. The data
 * is synthetic but shaped exactly like the API responses, so the rendered
 * states, empty states, and interactions can be verified without a live org.
 * `state=sparse` deliberately serves partial payloads — the collections and
 * embeds a live response can omit — so the normalizers and empty states are
 * exercised against the shapes the workspace actually returns. */

const PEOPLE = [
  { id: "p-1", name: "Amara Okafor", role: "Design", email: "amara@example.com" },
  { id: "p-2", name: "Ben Sato", role: "Engineering", email: "ben@example.com" },
  { id: "p-3", name: "Chloe Marin", role: "Engineering", email: "chloe@example.com" },
  { id: "p-4", name: "Daniel Osei", role: "Operations", email: "daniel@example.com" },
  { id: "p-5", name: "Elif Kaya", role: "Design", email: "elif@example.com" },
  { id: "p-6", name: "Farid Haddad", role: "Engineering", email: "farid@example.com" },
  { id: "p-7", name: "Grace Lin", role: "Customer", email: "grace@example.com" },
  { id: "p-8", name: "Hugo Berg", role: "Engineering", email: "hugo@example.com" },
] as const;

const DATES = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 9, 14 - (13 - index)));
  return date.toISOString().slice(0, 10);
});

function timeSeries(): AdminTimeSeriesPoint[] {
  return DATES.map((date, index) => {
    const people = PEOPLE.slice(0, 5).map((person, personIndex) => ({
      personId: person.id,
      name: person.name,
      minutes: ((index * 37 + personIndex * 61) % 260) + (personIndex % 2 === 0 ? 60 : 0),
    })).filter((person) => (index + person.personId.length) % 4 !== 0);
    return { date, totalMinutes: people.reduce((sum, person) => sum + person.minutes, 0), people };
  });
}

function overview(): AdminOverview {
  return {
    date: DATES[DATES.length - 1],
    generatedAt: `${DATES[DATES.length - 1]}T09:42:00.000Z`,
    counts: {
      people: PEOPLE.length,
      onShift: 4,
      paused: 1,
      offShift: 2,
      unknown: 1,
      updatesToday: 11,
      substantiveUpdatesToday: 7,
      tasksCompletedToday: 6,
      tasksOpen: 43,
      tasksOverdue: 5,
      evidenceToday: 24,
      evidenceActivityToday: 21,
      evidenceOutputToday: 3,
      reportsDraftedToday: 1,
      reportsSubmittedToday: 3,
      reportsPendingReview: 2,
      pendingReviewOldestAt: `${DATES[DATES.length - 1]}T02:15:00.000Z`,
      eodOutstandingPeople: 2,
      eodOutstandingDays: 3,
      disputedEvidence: 1,
    },
    people: PEOPLE.map((person, index) => ({
      personId: person.id,
      displayName: person.name,
      email: person.email,
      roleProfile: person.role,
      timezone: "Europe/Berlin",
      schedule: { start: "09:00", end: "17:30", daysOfWeek: [1, 2, 3, 4, 5], timezone: "Europe/Berlin" },
      attendance: {
        state: (["active", "active", "paused", "active", "off_shift", "off_shift", "unknown", "active"] as const)[index],
        source: index === 6 ? "none" : "worktivity",
        observedAt: `${DATES[DATES.length - 1]}T09:${String(30 + index).padStart(2, "0")}:00.000Z`,
        freshness: index === 6 ? "unknown" : index === 5 ? "stale" : "fresh",
        clockedInAt: index === 6 ? null : `${DATES[DATES.length - 1]}T07:5${index % 10}:00.000Z`,
        clockedOutAt: null,
      },
      session: index === 6 ? null : { state: index === 2 ? "paused" : "active", clockedInAt: `${DATES[DATES.length - 1]}T07:55:00.000Z`, pausedSeconds: index * 120, observedSeconds: 5400 + index * 900, correctionStatus: index === 5 ? "needs_correction" : "ok" },
      updatesToday: index % 4 === 0 ? 3 : index % 3,
      substantiveUpdatesToday: index % 4 === 0 ? 2 : index % 2,
      evidenceToday: (index * 5) % 7,
      tasksCompletedToday: index % 3 === 0 ? 2 : index % 2,
      lastUpdateAt: `${DATES[DATES.length - 1]}T08:${String(10 + index * 3).padStart(2, "0")}:00.000Z`,
      lastUpdateKind: index % 2 === 0 ? "progress" : "completion_claim",
      eodToday: index === 1 ? "pending_review" : index === 2 ? "approved" : null,
      eodOutstanding: index === 4 || index === 5 ? { days: 2, latest: null } : null,
    })),
    recentActivity: [
      { id: "a-1", kind: "task_completed", at: `${DATES[DATES.length - 1]}T09:12:00.000Z`, personId: "p-2", personName: "Ben Sato", title: "Shipped the billing webhook retry", detail: "Task completed", provenance: "nifty" },
      { id: "a-2", kind: "update", at: `${DATES[DATES.length - 1]}T09:05:00.000Z`, personId: "p-1", personName: "Amara Okafor", title: "Progress update", detail: "Drafted the settings information architecture", provenance: "employee" },
      { id: "a-3", kind: "evidence", at: `${DATES[DATES.length - 1]}T08:58:00.000Z`, personId: "p-3", personName: "Chloe Marin", title: "Pull request opened", detail: "wrazy/agent-os #482", provenance: "github" },
      { id: "a-4", kind: "eod_submitted", at: `${DATES[DATES.length - 1]}T08:40:00.000Z`, personId: "p-2", personName: "Ben Sato", title: "EOD report submitted", detail: "Awaiting review", provenance: "employee" },
      { id: "a-5", kind: "recap", at: `${DATES[DATES.length - 1]}T08:15:00.000Z`, personId: "p-4", personName: "Daniel Osei", title: "Activity recap confirmed", detail: "10:00–11:00 window", provenance: "worktivity" },
      { id: "a-6", kind: "update", at: `${DATES[DATES.length - 1]}T07:50:00.000Z`, personId: "p-6", personName: "Farid Haddad", title: "Blocker raised", detail: "Waiting on staging credentials", provenance: "employee" },
    ],
    attention: [
      { code: "reports_pending", severity: "warn", count: 2, message: "2 EOD reports are waiting for review.", href: "/work-os/admin/review" },
      { code: "eod_outstanding", severity: "warn", count: 3, message: "3 workdays still have an unsubmitted EOD report.", href: "/work-os/admin/review" },
      { code: "tasks_overdue", severity: "info", count: 5, message: "5 open tasks are past their due date.", href: "/work-os/admin/tasks" },
      { code: "disputed_evidence", severity: "error", count: 1, message: "1 evidence item is disputed and needs a decision.", href: "/work-os/admin/evidence" },
    ],
    series: DATES.map((date, index) => ({ date, completed: (index * 3) % 7, updates: 4 + ((index * 5) % 9), evidence: 12 + ((index * 7) % 18) })),
    timeSeries: timeSeries(),
    freshness: {
      niftySyncedAt: `${DATES[DATES.length - 1]}T09:35:00.000Z`,
      niftyTasksToday: 6,
      worktivityObservedAt: `${DATES[DATES.length - 1]}T09:40:00.000Z`,
      githubLastEventAt: `${DATES[DATES.length - 1]}T08:58:00.000Z`,
      githubEventsToday: 4,
      lastPlanAt: `${DATES[DATES.length - 1]}T07:20:00.000Z`,
      lastReportSubmittedAt: `${DATES[DATES.length - 1]}T08:40:00.000Z`,
    },
  };
}

function peopleResponse(): PeopleResponse {
  return {
    people: PEOPLE.map((person, index) => ({
      id: person.id,
      display_name: person.name,
      email: person.email,
      role_profile_id: index === 5 ? null : `role-${person.role.toLowerCase()}`,
      role_profile: index === 5 ? null : { id: `role-${person.role.toLowerCase()}`, name: person.role },
      active: index !== 5,
      nifty_member_id: index === 5 ? null : `nifty-${person.id}`,
      worktivity_employee_id: index === 5 ? null : `wt-${person.id}`,
    })),
    roleProfiles: [
      { id: "role-design", name: "Design" },
      { id: "role-engineering", name: "Engineering" },
      { id: "role-operations", name: "Operations" },
      { id: "role-customer", name: "Customer" },
    ],
  };
}

function personDetail(personId: string): PersonDetailResponse {
  const person = PEOPLE.find((entry) => entry.id === personId) ?? PEOPLE[0];
  // The day's report id matches reportsResponse for mapped people, so a
  // People update's "Open EOD review" action opens the same report the
  // Review queue serves.
  const personReportIds: Record<string, string> = { "p-1": "r-2", "p-2": "r-1" };
  return {
    person: {
      id: person.id,
      display_name: person.name,
      email: person.email,
      role_profile_id: `role-${person.role.toLowerCase()}`,
      role_profile: { id: `role-${person.role.toLowerCase()}`, name: person.role },
      nifty_member_id: `nifty-${person.id}`,
      worktivity_employee_id: `wt-${person.id}`,
      active: true,
    },
    teams: [{ team_id: "team-1", is_manager: personId === "p-2", team: { id: "team-1", name: "Product", active: true } }],
    schedules: [{ start: "09:00", end: "17:30", timezone: "Europe/Berlin", effective_from: DATES[0] }],
    exceptions: [{ date: DATES[3], kind: "adjusted" }],
    sessions: DATES.slice(-5).reverse().map((date, index) => ({ shift_date: date, state: "closed", observed_seconds: 21600 + index * 600, updates: 2 + (index % 3) })),
    reports: DATES.slice(-4).reverse().map((date, index) => {
      const id = index === 0 ? personReportIds[personId] ?? `report-${personId}-${date}` : `report-${personId}-${date}`;
      const status = index === 0 && personReportIds[personId] ? "pending_review" : ["approved", "pending_review", "rejected", "draft"][index];
      return { id, report_date: date, status };
    }),
    // `work_check_ins` shape: the live column is `input_text`, with the kind,
    // substance flag, and workday beside it.
    updates: Array.from({ length: 4 }, (_, index) => ({
      id: `chk-${personId}-${index}`,
      shift_date: DATES[DATES.length - 1],
      kind: "check_in",
      substantive: [true, true, true, false][index],
      input_text: ["Drafted the settings IA", "Reviewed the billing retries", "Paired on the migration script", "Blocked on staging credentials"][index],
      update_kind: ["progress", "completion_claim", "progress", "blocked"][index],
      occurred_at: `${DATES[DATES.length - 1]}T0${8 - index}:10:00.000Z`,
    })),
    intervals: [],
    evidenceSummary: { total: 42, activity: 37, output: 5, disputed: personId === "p-5" ? 1 : 0 },
  };
}

function reportsResponse(status: string): ReportsResponse {
  const all = [
    { id: "r-1", person: "p-2", date: DATES[DATES.length - 1], status: "pending_review", title: "EOD · Platform reliability" },
    { id: "r-2", person: "p-1", date: DATES[DATES.length - 1], status: "pending_review", title: "EOD · Settings IA" },
    { id: "r-3", person: "p-3", date: DATES[DATES.length - 2], status: "approved", title: "EOD · Webhook retries" },
    { id: "r-4", person: "p-6", date: DATES[DATES.length - 2], status: "rejected", title: "EOD · Staging access" },
    { id: "r-5", person: "p-4", date: DATES[DATES.length - 3], status: "draft", title: "EOD · Vendor review" },
    { id: "r-6", person: "p-8", date: DATES[DATES.length - 3], status: "approved", title: "EOD · Search indexing" },
  ] as const;
  const rows = (status ? all.filter((row) => row.status === status) : all).map((row) => {
    const person = PEOPLE.find((entry) => entry.id === row.person)!;
    const markdown = [
      `# ${row.title}`,
      `Role profile: ${person.role}`,
      "Goal: keep the week's outcomes moving",
      "",
      "## Completed work",
      `- ${["Shipped retry handling for failed billing webhooks", "Confirmed the settings information architecture", "Resolved the flaky upload test"][row.id.length % 3]}`,
      "- Reviewed two pull requests and left substantive comments",
      "",
      "## In progress",
      "- Migration dry-run against the staging snapshot",
      "",
      "## Activity context",
      "Activity context is descriptive and never proves attendance, productivity, or task completion.",
    ].join("\n");
    return {
      id: row.id,
      person_id: row.person,
      report_date: row.date,
      status: row.status,
      title: row.title,
      markdown,
      submitted_markdown: row.status === "draft" ? null : markdown,
      metrics: { completed: 4, progressed: 2, deferred: 1, carried: 3, unplanned: 1 },
      manager_notes: row.status === "rejected" ? "Add the staging plan before resubmitting." : null,
      submitted_at: row.status === "draft" ? null : `${row.date}T08:40:00.000Z`,
      reviewed_at: row.status === "approved" || row.status === "rejected" ? `${row.date}T09:10:00.000Z` : null,
      created_at: `${row.date}T08:00:00.000Z`,
      person: { id: person.id, display_name: person.name, email: person.email },
      versions: [{ id: `${row.id}-v1`, version_kind: "generated", created_at: `${row.date}T08:00:00.000Z` }],
    };
  });
  const counts = { draft: 1, pending_review: 2, approved: 2, rejected: 1, total: 6 };
  return { reports: rows, counts };
}

function evidenceResponse(): EvidenceResponse {
  const rows = [
    { id: "e-1", person: "p-2", date: DATES[DATES.length - 1], source: "github", title: "Pull request merged", summary: "wrazy/agent-os #480 — billing webhook retries", disputed: false },
    { id: "e-2", person: "p-1", date: DATES[DATES.length - 1], source: "worktivity", title: "Observed design session", summary: "Figma and Notion in one drafting block", disputed: false, shot: true },
    { id: "e-3", person: "p-3", date: DATES[DATES.length - 1], source: "worktivity", title: "Observed review block", summary: "GitHub review comments on two pull requests", disputed: false, shot: true },
    { id: "e-4", person: "p-5", date: DATES[DATES.length - 2], source: "worktivity", title: "Observed research block", summary: "Long browsing block; flagged for review", disputed: true, shot: true },
    { id: "e-5", person: "p-4", date: DATES[DATES.length - 2], source: "nifty", title: "Task completed", summary: "Vendor comparison matrix", disputed: false },
    { id: "e-6", person: "p-8", date: DATES[DATES.length - 3], source: "github", title: "Workflow run passed", summary: "wrazy/agent-os main · lint and tests", disputed: false },
  ];
  return {
    evidence: rows.map((row) => {
      const person = PEOPLE.find((entry) => entry.id === row.person)!;
      return {
        id: row.id,
        person_id: row.person,
        task_id: null,
        evidence_date: row.date,
        source: row.source,
        title: row.title,
        summary: row.summary,
        url: row.source === "github" ? "https://github.com/wrazy/agent-os/pull/480" : null,
        metrics: null,
        created_at: `${row.date}T09:30:00.000Z`,
        person: { id: person.id, display_name: person.name },
        event: {
          correction_status: row.disputed ? "disputed" : "none",
          evidence_class: row.source === "worktivity" ? "activity" : "output",
          metadata: {},
          screenshot: (row as { shot?: boolean }).shot
            ? { id: `${row.id}-shot`, processing_status: "ready", summary: "Editor and design tools with a task document open", confidence: 0.72, storage_path: "preview", deleted_at: null }
            : null,
        },
      };
    }),
    summary: {
      sources: [
        { source: "worktivity", count: 21 },
        { source: "github", count: 9 },
        { source: "nifty", count: 6 },
      ],
      days: DATES.slice(-7).map((date, index) => ({ date, count: 4 + (index % 5) })),
    },
  };
}

export function seedAdminFixtures(queryClient: QueryClient, state: "dense" | "empty" | "sparse") {
  const today = todayIso();
  const evidenceFrom = isoDaysAgo(13);
  const reportFrom = isoDaysAgo(30);
  // The personal settings' suggestions read mounts inside the administration
  // shell's Settings section; seed it empty so the fixture boot never shows a
  // failure the harness has no backend to answer.
  queryClient.setQueryData(workOsKeys.suggestions(), [] satisfies PendingSuggestion[]);
  if (state === "sparse") {
    seedSparseFixtures(queryClient, today);
    return;
  }
  if (state === "empty") {
    queryClient.setQueryData(adminKeys.overview(today), {
      ...overview(),
      counts: { people: 1, onShift: 0, paused: 0, offShift: 0, unknown: 1, updatesToday: 0, substantiveUpdatesToday: 0, tasksCompletedToday: 0, tasksOpen: 0, tasksOverdue: 0, evidenceToday: 0, evidenceActivityToday: 0, evidenceOutputToday: 0, reportsDraftedToday: 0, reportsSubmittedToday: 0, reportsPendingReview: 0, pendingReviewOldestAt: null, eodOutstandingPeople: 0, eodOutstandingDays: 0, disputedEvidence: 0 },
      people: [],
      recentActivity: [],
      attention: [],
      series: DATES.map((date) => ({ date, completed: 0, updates: 0, evidence: 0 })),
      timeSeries: DATES.map((date) => ({ date, totalMinutes: 0, people: [] })),
    } satisfies AdminOverview);
    queryClient.setQueryData(adminKeys.people(), { people: [], roleProfiles: [] } satisfies PeopleResponse);
    queryClient.setQueryData(adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false", date: today }), { tasks: [], nextOffset: null, summary: { open: 0, overdue: 0, completedWeek: 0 } });
    queryClient.setQueryData(adminKeys.reports({ status: "pending_review", personId: "", from: reportFrom, to: today }), { reports: [], counts: { draft: 0, pending_review: 0, approved: 0, rejected: 0, total: 0 } } satisfies ReportsResponse);
    queryClient.setQueryData(adminKeys.evidence({ personId: "", source: "", from: evidenceFrom, to: today, correction: "", summary: "1", limit: "100" }), { evidence: [], summary: { sources: [], days: [] } } satisfies EvidenceResponse);
    // Insights needs its own honest empty record; without it the page shows a
    // load error instead of the empty state every other section renders.
    for (const range of ["7d", "30d", "90d"] as const) queryClient.setQueryData(adminKeys.insights(range, ""), emptyInsights(range, today));
    return;
  }

  queryClient.setQueryData(adminKeys.overview(today), overview());
  queryClient.setQueryData(adminKeys.people(), peopleResponse());
  for (const person of PEOPLE) queryClient.setQueryData(adminKeys.person(person.id), personDetail(person.id));
  const insightsFor = (range: "7d" | "30d" | "90d"): AdminInsights => {
    const totals = { outcomesCompleted: 34, outcomesLate: 3, updates: 61, substantiveUpdates: 44, eodSubmitted: 21, eodApproved: 17, eodRejected: 2, planned: 48, plannedCompleted: 41, trackedMinutes: 9120, evidenceOutput: 38, evidenceActivity: 214, sessionsNeedingCorrection: 1, activePeople: 7 };
    const previous = { ...totals, outcomesCompleted: 28, updates: 52, substantiveUpdates: 36, eodSubmitted: 18, trackedMinutes: 8340, outcomesLate: 4, plannedCompleted: 33, planned: 46, sessionsNeedingCorrection: 2 };
    return {
      range,
      from: DATES[0],
      through: today,
      totals,
      previous,
      people: PEOPLE.map((person, index) => ({
        personId: person.id,
        displayName: person.name,
        roleProfile: person.role,
        outcomesCompleted: 7 - (index % 4),
        outcomesLate: index % 3,
        updates: 9 - (index % 3),
        substantiveUpdates: 7 - (index % 4),
        eodSubmitted: 3 - (index % 2),
        eodApproved: 2,
        eodRejected: index % 4 === 0 ? 1 : 0,
        planned: 7,
        plannedCompleted: 6 - (index % 2),
        commitmentRate: 86 - index * 3,
        trackedMinutes: 1500 - index * 90,
        evidenceOutput: 6 - (index % 3),
        evidenceActivity: 34 - index * 2,
        sessionsNeedingCorrection: index === 5 ? 1 : 0,
        lastActivityAt: `${today}T09:${String(40 - index).padStart(2, "0")}:00.000Z`,
      })),
      series: DATES.map((date, index) => ({ date, outcomesCompleted: (index * 2) % 5, updates: 3 + (index % 6), eodSubmitted: index % 4 === 0 ? 1 : 0, trackedMinutes: 500 + (index * 90) % 700 })),
      timeSeries: timeSeries(),
      updateKinds: [
        { kind: "progress", count: 28 },
        { kind: "completion_claim", count: 15 },
        { kind: "blocked", count: 7 },
        { kind: "priority_change", count: 6 },
        { kind: "unplanned_work", count: 5 },
      ],
      topApps: [
        { name: "Visual Studio Code", minutes: 2240 },
        { name: "Figma", minutes: 980 },
        { name: "GitHub", minutes: 640 },
        { name: "Slack", minutes: 310 },
        { name: "Notion", minutes: 240 },
      ],
      overdueOpen: 5,
      notes: {
        summary: `The workspace recorded 34 completed outcomes and 61 updates in ${DATES[0]} to ${today}. Activity context is descriptive and never a score.`,
        wins: [
          "34 task outcomes completed in this range, up from 28 in the equal earlier period.",
          "44 substantive progress updates recorded.",
          "85% of planned commitments were completed (41 of 48).",
          "21 EOD reports submitted for review.",
        ],
        attention: [
          "3 completed outcomes landed after the recorded due date.",
          "3 workdays in the last seven days still have an unsubmitted EOD report.",
          "5 open tasks are past their due date.",
        ],
        nextFocus: ["Review outstanding EOD reports and follow up with the teammate.", "Rebalance or close the overdue backlog."],
      },
      freshness: { generatedAt: `${today}T09:42:00.000Z` },
    };
  };
  queryClient.setQueryData(adminKeys.insights("7d", ""), insightsFor("7d"));
  queryClient.setQueryData(adminKeys.insights("30d", ""), insightsFor("30d"));
  queryClient.setQueryData(adminKeys.insights("90d", ""), insightsFor("90d"));
  for (const status of ["pending_review", "draft", "rejected", "approved", "all"]) {
    queryClient.setQueryData(adminKeys.reports({ status: status === "all" ? "" : status, personId: "", from: reportFrom, to: today }), reportsResponse(status === "all" ? "" : status));
  }
  queryClient.setQueryData(adminKeys.reportEvidence("p-2", today), evidenceResponse());
  queryClient.setQueryData(adminKeys.reportEvidence("p-1", today), evidenceResponse());
  queryClient.setQueryData(adminKeys.reportIntervals("p-2", today), { intervals: [] });
  const seedIntervals = [
    { id: "i-1", person: "p-2", label: "10:00–11:00", reviewStatus: "confirmed", headline: "Worked through the webhook retry test suite and left review comments.", evidenceCount: 6, recordedActivity: [{ description: "Pushed commits to wrazy/agent-os", relation: "performed" as const, url: null }, { description: "CI run on wrazy/agent-os passed", relation: "triggered" as const, url: null }] },
    { id: "i-2", person: "p-1", label: "11:00–12:00", reviewStatus: "inferred", headline: "Drafted the settings IA in Figma with a Notion outline open.", evidenceCount: 5, recordedActivity: [] },
  ];
  queryClient.setQueryData(adminKeys.evidence({ personId: "", source: "", from: evidenceFrom, to: today, correction: "", summary: "1", limit: "100" }), evidenceResponse());
  queryClient.setQueryData(adminKeys.intervals({ personId: "", from: evidenceFrom, to: today, limit: "60" }), {
    intervals: seedIntervals.map((entry) => ({
      ...entry,
      windowStart: `${today}T10:00:00.000Z`,
      windowEnd: `${today}T11:00:00.000Z`,
      promptKind: "follow_up" as const,
      generationStatus: "ready",
      detail: "The window shows one drafting block and one review pass; the record does not establish completion.",
      employeeFeedback: null,
      failureReason: null,
      generatedAt: `${today}T11:05:00.000Z`,
      reviewedAt: entry.reviewStatus === "confirmed" ? `${today}T11:10:00.000Z` : null,
      evidenceExpired: false,
      evidence: [],
      personId: entry.person,
      personName: PEOPLE.find((person) => person.id === entry.person)?.name ?? null,
    })),
  });
  queryClient.setQueryData(adminKeys.githubActors(), {
    actors: [{ key: "gh-1", id: "66123", login: "chloe-m", events: 12, firstSeen: `${DATES[2]}T10:00:00.000Z`, lastSeen: `${today}T08:58:00.000Z`, titles: ["chore: bump runners"], suggestion: null }],
    people: PEOPLE.map((person) => ({ id: person.id, displayName: person.name, githubUsername: person.id === "p-3" ? "chloe-m" : null })),
    totals: { unattributedEvents: 12, lastEventAt: `${today}T08:58:00.000Z` },
    configuration: { webhookReceiverReady: true, repositoryManagementReady: true },
  } satisfies GithubIntegrationActorsResponse);
  queryClient.setQueryData(adminKeys.githubRepos(), {
    connection: { id: "conn-1", workspace: "wrazy" },
    organization: "wrazy",
    repos: [
      { full_name: "wrazy/agent-os", private: true, default_branch: "main", pushed_at: `${today}T08:58:00.000Z` },
      { full_name: "wrazy/work-os", private: true, default_branch: "main", pushed_at: `${DATES[12]}T16:20:00.000Z` },
    ],
    connectedRepos: [{ full_name: "wrazy/agent-os", hook_id: "1", created_at: `${DATES[4]}T10:00:00.000Z` }],
    webhookUrl: "https://app.wrazyos.com/api/work-os/integrations/github/webhook",
    configuration: { repositoryManagementReady: true, webhookReceiverReady: true },
  } satisfies GithubIntegrationReposResponse);
  queryClient.setQueryData(adminKeys.connections(), {
    connections: [{ id: "conn-1", provider: "github", active: true, external_workspace_id: "wrazy" }],
    accounts: PEOPLE.slice(0, 3).map((person) => ({ id: `acct-${person.id}`, provider: "github", person_id: person.id })),
  } satisfies ConnectionsResponse);
  queryClient.setQueryData(adminKeys.fieldMappings(), { mappings: [{ id: "m-1", field: "priority", provider_field_id: "customfield_10012" }] });
  queryClient.setQueryData(adminKeys.blueprints(), { blueprints: [{ id: "bp-1", name: "Client onboarding", kind: "template", updated_at: `${DATES[6]}T10:00:00.000Z` }] });
  queryClient.setQueryData(adminKeys.status(), { schema: { ready: true, migration: "0021" } } satisfies SystemStatusResponse);
  queryClient.setQueryData(adminKeys.organization(), {
    organization: { id: "org-preview", name: "Wrazy Internal", slug: "wrazy", feature_flags: { employee_companion: true, desktop_companion: true, screenshot_summaries: true, github_evidence: true, ghl_evidence: false, seo_mission_control: false, voice_input: true }, created_at: `${DATES[0]}T10:00:00.000Z` },
    memberships: PEOPLE.slice(0, 3).map((person, index) => ({ id: `mem-${index}`, user_id: `user-${index}`, person_id: person.id, role: index === 0 ? "admin" : index === 1 ? "manager" : "employee", active: true, feature_flags: null, person: { id: person.id, display_name: person.name, email: person.email } })),
    teams: [{ id: "team-1", name: "Product" }, { id: "team-2", name: "Platform" }],
    teamMembers: [
      { team_id: "team-1", person_id: "p-1", is_manager: false },
      { team_id: "team-1", person_id: "p-2", is_manager: true },
      { team_id: "team-2", person_id: "p-3", is_manager: true },
    ],
  } satisfies OrganizationResponse);
  const taskFilters = { filter: "open", personId: "", projectId: "", limit: "200", completed: "false", date: today };
  // The dense record exercises the task-date rules: created stamps in both the
  // provider and local shapes, one task with no created date (both cells keep
  // their dash), and two tasks with no recorded due date — one created
  // recently (its effective due date is created + 1 day) and one created days
  // ago (that default has already passed, so the row reads Overdue).
  const taskCreated: Array<{ created_at?: string; provider_created_at?: string }> = [
    { provider_created_at: "2026-09-28T09:15:00.000Z" },
    { created_at: "2026-10-01T10:20:00.000Z" },
    { provider_created_at: "2026-10-05T08:05:00.000Z" },
    { created_at: `${isoDaysAgo(4)}T09:00:00.000Z` },
    { provider_created_at: "2026-10-07T12:00:00.000Z" },
    { created_at: "2026-10-08T09:30:00.000Z" },
    { provider_created_at: "2026-10-09T14:10:00.000Z" },
    {},
    { provider_created_at: `${isoDaysAgo(1)}T08:30:00.000Z` },
  ];
  queryClient.setQueryData(adminKeys.tasks(taskFilters), {
    tasks: Array.from({ length: 9 }, (_, index) => ({
      id: `t-${index + 1}`,
      title: [
        "Retry handling for failed billing webhooks",
        "Settings information architecture",
        "Search indexing backfill",
        "Vendor comparison matrix",
        "Migration dry-run script",
        "Design review for the admin surface",
        "Accessibility pass on the composer",
        "Deployment runbook for staging",
        "Quarterly retention policy review",
      ][index],
      completed: false,
      due_date: index === 3 || index === 8 ? null : new Date(Date.UTC(2026, 9, 12 + (index % 6))).toISOString().slice(0, 10),
      ...taskCreated[index],
      priority: ["high", "medium", "low"][index % 3],
      description: index === 0 ? "Add bounded retries with backoff for failed billing webhook deliveries." : null,
      labels: index % 2 === 0 ? ["platform"] : [],
      project: index % 3 === 0 ? { id: "proj-1", name: "Platform" } : index % 3 === 1 ? { id: "proj-2", name: "Product" } : { id: "proj-3", name: "Operations" },
      assignees: [{ displayName: PEOPLE[index % PEOPLE.length].name }],
      updated_at: `${DATES[DATES.length - 1]}T08:${String(40 - index).padStart(2, "0")}:00.000Z`,
    })),
    nextOffset: null,
    summary: { open: 43, overdue: 5, completedWeek: 17 },
  });
  queryClient.setQueryData(adminKeys.taskDetails("t-1"), {
    task: { id: "t-1", title: "Retry handling for failed billing webhooks", completed: false, due_date: `${today}`, priority: "high", description: "Add bounded retries with backoff for failed billing webhook deliveries.", updated_at: `${today}T08:40:00.000Z`, project: { id: "proj-1", name: "Platform" } },
    subtasks: [
      { id: "s-1", title: "Exponential backoff for 5xx responses", completed: true },
      { id: "s-2", title: "Dead-letter queue for exhausted retries", completed: false },
    ],
  });
  queryClient.setQueryData(adminKeys.projects(), { projects: [{ id: "proj-1", name: "Platform" }, { id: "proj-2", name: "Product" }, { id: "proj-3", name: "Operations" }] });
  void ADMIN_STALE_MS;
}

/* --- Sparse state -------------------------------------------------------- */

/** The empty insights record: zero totals, no people, and the brief the record
 * builder writes when nothing was recorded in the range. */
function emptyInsights(range: AdminInsightRange, today: string): AdminInsights {
  const totals: AdminInsightTotals = {
    outcomesCompleted: 0, outcomesLate: 0, updates: 0, substantiveUpdates: 0, eodSubmitted: 0, eodApproved: 0, eodRejected: 0,
    planned: 0, plannedCompleted: 0, trackedMinutes: 0, evidenceOutput: 0, evidenceActivity: 0, sessionsNeedingCorrection: 0, activePeople: 0,
  };
  return {
    range,
    from: DATES[0],
    through: today,
    totals,
    previous: { ...totals },
    people: [],
    series: DATES.map((date) => ({ date, outcomesCompleted: 0, updates: 0, eodSubmitted: 0, trackedMinutes: 0 })),
    timeSeries: DATES.map((date) => ({ date, totalMinutes: 0, people: [] })),
    updateKinds: [],
    topApps: [],
    overdueOpen: 0,
    notes: {
      summary: `No completed outcomes or updates were recorded in ${DATES[0]} to ${today}.`,
      wins: [],
      attention: ["No completed task outcomes were recorded in this range."],
      nextFocus: ["Keep the review queue clear and confirm the week's outcomes."],
    },
    freshness: { generatedAt: `${DATES[DATES.length - 1]}T09:42:00.000Z` },
  };
}

/** Deliberately partial payloads for the same query keys as `dense`. The
 * collections and embeds a live response can omit are left out here, so the
 * normalizers at the data seam turn them into the honest empty states the
 * pages already render. */
function seedSparseFixtures(queryClient: QueryClient, today: string) {
  const evidenceFrom = isoDaysAgo(13);
  const reportFrom = isoDaysAgo(30);
  const yesterday = DATES[DATES.length - 2];

  // Overview: attention, recentActivity, series, timeSeries, and freshness are
  // absent; counts are partial; person rows carry no roleProfile, schedule,
  // session, or outstanding EOD.
  queryClient.setQueryData(adminKeys.overview(today), {
    date: today,
    generatedAt: `${DATES[DATES.length - 1]}T09:42:00.000Z`,
    counts: { people: 2, onShift: 1, unknown: 1, updatesToday: 3, tasksCompletedToday: 1 },
    people: [
      {
        personId: "p-1",
        displayName: "Amara Okafor",
        email: "amara@example.com",
        attendance: { state: "active", source: "worktivity", observedAt: `${today}T08:10:00.000Z`, freshness: "fresh", clockedInAt: null, clockedOutAt: null },
        updatesToday: 2,
        substantiveUpdatesToday: 1,
        evidenceToday: 1,
        tasksCompletedToday: 0,
        lastUpdateAt: `${today}T08:10:00.000Z`,
      },
      { personId: "p-2", displayName: "Ben Sato", attendance: { state: "unknown", source: "none" } },
    ],
  });

  // People: rows without role_profile or worktivity/nifty mappings; the
  // role-profile collection is absent.
  queryClient.setQueryData(adminKeys.people(), {
    people: [
      { id: "p-1", display_name: "Amara Okafor", email: "amara@example.com", active: true },
      { id: "p-2", display_name: "Ben Sato", role_profile_id: null, active: false },
    ],
  });

  // Person detail: no teams, schedules, exceptions, sessions, reports,
  // updates, intervals, or evidence summary.
  queryClient.setQueryData(adminKeys.person("p-1"), {
    person: { id: "p-1", display_name: "Amara Okafor", email: "amara@example.com", active: true },
  });
  queryClient.setQueryData(adminKeys.person("p-2"), {
    person: { id: "p-2", display_name: "Ben Sato" },
  });

  // Insights: no series, timeSeries, updateKinds, topApps, notes, or freshness;
  // partial totals and a partial person row.
  for (const range of ["7d", "30d", "90d"] as const) {
    queryClient.setQueryData(adminKeys.insights(range, ""), {
      range,
      from: DATES[0],
      through: today,
      totals: { outcomesCompleted: 3, updates: 2 },
      previous: { outcomesCompleted: 2 },
      people: [{ personId: "p-1", displayName: "Amara Okafor", outcomesCompleted: 3, updates: 2 }],
    });
  }

  // Reports: rows without versions, person, or metrics; one keeps person_id so
  // its drawer still loads the day's sourced evidence and recaps.
  queryClient.setQueryData(adminKeys.reports({ status: "pending_review", personId: "", from: reportFrom, to: today }), {
    reports: [
      {
        id: "r-s1",
        person_id: "p-2",
        report_date: today,
        status: "pending_review",
        title: "EOD · Platform reliability",
        markdown: ["# EOD · Platform reliability", "", "## Completed work", "- Shipped retry handling for failed billing webhooks"].join("\n"),
      },
      { id: "r-s2", person_id: null, report_date: yesterday, status: "approved" },
    ],
    counts: { draft: 0, pending_review: 1, approved: 1, rejected: 0, total: 2 },
  });
  for (const status of ["draft", "rejected", "approved", "all"]) {
    queryClient.setQueryData(
      adminKeys.reports({ status: status === "all" ? "" : status, personId: "", from: reportFrom, to: today }),
      { reports: [], counts: { draft: 0, pending_review: 0, approved: 0, rejected: 0, total: 0 } },
    );
  }
  queryClient.setQueryData(adminKeys.reportEvidence("p-2", today), {
    evidence: [
      { id: "e-s1", evidence_date: today, source: "github" },
      { id: "e-s2", evidence_date: today, source: "worktivity" },
    ],
  });
  queryClient.setQueryData(adminKeys.reportIntervals("p-2", today), {
    intervals: [{ id: "i-s1", reviewStatus: "inferred" }],
  });

  // Evidence: rows without person, summary, event, or screenshot; no summary
  // collection and no GitHub actor rows.
  queryClient.setQueryData(adminKeys.evidence({ personId: "", source: "", from: evidenceFrom, to: today, correction: "", summary: "1", limit: "100" }), {
    evidence: [
      { id: "e-s1", evidence_date: today, source: "github" },
      { id: "e-s2", evidence_date: yesterday, source: "worktivity" },
    ],
  });
  queryClient.setQueryData(adminKeys.intervals({ personId: "", from: evidenceFrom, to: today, limit: "60" }), {
    intervals: [
      { id: "i-s2", reviewStatus: "confirmed", personName: "Ben Sato" },
      { id: "i-s3" },
    ],
  });
  queryClient.setQueryData(adminKeys.githubActors(), {});
  queryClient.setQueryData(adminKeys.githubRepos(), { connection: null, organization: null });
  // Connections without accounts.
  queryClient.setQueryData(adminKeys.connections(), {
    connections: [{ id: "conn-1", provider: "github", active: true, external_workspace_id: "wrazy" }],
  });

  // Tasks: rows without project, assignees, labels, or due dates; no summary.
  queryClient.setQueryData(adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false", date: today }), {
    tasks: [
      { id: "t-s1", name: "Retry handling for failed billing webhooks" },
      { id: "t-s2", title: "Design review for the admin surface", completed: false },
    ],
  });
  queryClient.setQueryData(adminKeys.taskDetails("t-s1"), {
    task: { id: "t-s1", title: "Retry handling for failed billing webhooks", completed: false },
  });
  queryClient.setQueryData(adminKeys.projects(), { projects: [{ id: "proj-1", name: "Platform" }] });

  // Settings: organization without slug, feature flags, memberships, teams, or
  // team members; no field mappings or blueprints.
  queryClient.setQueryData(adminKeys.organization(), {
    organization: { id: "org-preview", name: "Wrazy Internal" },
  });
  queryClient.setQueryData(adminKeys.fieldMappings(), {});
  queryClient.setQueryData(adminKeys.blueprints(), {});
  queryClient.setQueryData(adminKeys.status(), { schema: { ready: true, migration: "0021" } } satisfies SystemStatusResponse);
}

/* --- The account's own review notifications (the masthead bell) ----------
   The administration bell lists the signed-in admin's own notifications, read
   from the same owner-scoped employee queries the employee masthead uses. The
   `?admin-shell` harness seeds those keys so the badge, sections, and rows
   render from real query data; `?preview-admin` mounts the workspace alone and
   takes the same data as props. */

function notificationMemory(): MemoryView {
  const today = todayIso();
  return {
    facts: [
      { id: "mem-shell-1", content: "Prefers TypeScript for companion changes.", review_status: "candidate", fact_key: "prefers-typescript", local_date: today, occurred_at: `${today}T09:20:00.000Z` },
      { id: "mem-shell-2", content: "Keeps Friday afternoons for review work.", review_status: "candidate", fact_key: "friday-reviews", local_date: isoDaysAgo(2), occurred_at: `${isoDaysAgo(2)}T15:40:00.000Z` },
      { id: "mem-shell-3", content: "Owns the billing webhook retries.", review_status: "confirmed", fact_key: "owns-webhook-retries", local_date: isoDaysAgo(5), occurred_at: `${isoDaysAgo(5)}T11:00:00.000Z` },
    ],
    recent: [],
  };
}

function notificationRecap(shiftDate: string): ActivityInterval {
  return {
    id: `recap-shell-${shiftDate}`,
    windowStart: `${shiftDate}T10:00:00.000Z`,
    windowEnd: `${shiftDate}T11:00:00.000Z`,
    label: "10:00–11:00",
    promptKind: "follow_up",
    generationStatus: "ready",
    reviewStatus: "inferred",
    headline: "Worked through the webhook retry test suite and left review comments.",
    detail: "The window shows one drafting block and one review pass; the record does not establish completion.",
    employeeFeedback: null,
    failureReason: null,
    generatedAt: `${shiftDate}T11:05:00.000Z`,
    reviewedAt: null,
    evidenceExpired: false,
    evidenceCount: 5,
    evidence: [],
  };
}

function notificationDays(): OutstandingEodDay[] {
  return [
    { date: isoDaysAgo(1), status: "draft_unsubmitted", reportId: "shell-report-1", observedMinutes: 296, completedTasks: 4, hasPlan: true },
    { date: isoDaysAgo(4), status: "changes_requested", reportId: "shell-report-2", observedMinutes: 332, completedTasks: 6, hasPlan: true },
  ];
}

/** Seed the bell's owner-scoped reads for the `?admin-shell` harness: two
 * memory candidates, one ready undecided recap, and two outstanding EOD days
 * for `populated`; honest empty payloads for `empty`. The shift date keeps the
 * recap under the same activity-interval key the live query reads. */
export function seedAdminShellNotifications(queryClient: QueryClient, state: "populated" | "empty", shiftDate: string | null) {
  const empty = state === "empty";
  queryClient.setQueryData(workOsKeys.memory(), empty ? { facts: [], recent: [] } satisfies MemoryView : notificationMemory());
  if (shiftDate) {
    // The recap stream is an infinite query: the seeded cache must carry the
    // page container, not a single page, or the observer cannot read it.
    queryClient.setQueryData<InfiniteData<ActivityIntervalsData, string | null>>(workOsKeys.activityIntervals(shiftDate), empty
      ? { pages: [{ date: shiftDate, intervals: [], nextCursor: null, total: 0 }], pageParams: [null] }
      : { pages: [{ date: shiftDate, intervals: [notificationRecap(shiftDate)], nextCursor: null, total: 1 }], pageParams: [null] });
  }
  queryClient.setQueryData(workOsKeys.outstandingEods(), empty
    ? { from: isoDaysAgo(14), through: shiftDate ?? todayIso(), count: 0, days: [] } satisfies OutstandingEodsData
    : { from: isoDaysAgo(14), through: shiftDate ?? todayIso(), count: 2, days: notificationDays() } satisfies OutstandingEodsData);
}

/** The bell's rendered data for `?preview-admin`: populated, empty, or the
 * deliberately partial `sparse` day row the fallbacks must normalize. */
export function adminPreviewNotifications(state: "dense" | "empty" | "sparse"): {
  memoryCandidates: number;
  recap: ReadyRecapSummary | null;
  overdueTasks: number;
  days: OutstandingEodDay[];
} {
  if (state === "empty") return { memoryCandidates: 0, recap: null, overdueTasks: 0, days: [] };
  if (state === "sparse") {
    return {
      memoryCandidates: 1,
      recap: null,
      overdueTasks: 0,
      days: [{ date: isoDaysAgo(1), status: "no_draft", reportId: null, observedMinutes: 0, completedTasks: 0, hasPlan: false }],
    };
  }
  const memory = notificationMemory();
  const recap = notificationRecap(todayIso());
  return {
    memoryCandidates: memory.facts.filter((fact) => fact.review_status === "candidate").length,
    recap: { id: recap.id, label: recap.label },
    overdueTasks: 2,
    days: notificationDays(),
  };
}
