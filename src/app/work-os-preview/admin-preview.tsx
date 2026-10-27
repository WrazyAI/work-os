"use client";

// Dev-only rendered-QA fixtures for the Work OS administration surface
// (design.md §15). `?admin=<section>` renders the real AdminShell and page
// components against stubbed read endpoints so loading, empty, dense, and
// error states can be inspected without a live session. The proxy exposes
// /work-os-preview only outside production.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminShell, { type AdminSection } from "@/modules/work-os/admin/AdminShell";
import AdminOverviewPage from "@/modules/work-os/admin/AdminOverview";
import AdminPeoplePage from "@/modules/work-os/admin/AdminPeople";
import AdminTasksPage from "@/modules/work-os/admin/AdminTasks";
import AdminReviewPage from "@/modules/work-os/admin/AdminReview";
import AdminInsightsPage from "@/modules/work-os/admin/AdminInsights";
import AdminEvidencePage from "@/modules/work-os/admin/AdminEvidence";
import AdminSettingsPage from "@/modules/work-os/admin/AdminSettings";

type PreviewState = "dense" | "empty" | "loading" | "error";

const TODAY = "2026-09-30";
const NOW = `${TODAY}T15:20:00.000Z`;

const PEOPLE = [
  { id: "p-ada", name: "Ada Okafor", role: "Engineering", timezone: "Europe/London" },
  { id: "p-luis", name: "Luis Moreno", role: "Operations", timezone: "America/New_York" },
  { id: "p-mei", name: "Mei Tanaka", role: "Design", timezone: "Asia/Tokyo" },
  { id: "p-sam", name: "Sam Osei", role: "Engineering", timezone: "UTC" },
];

function overviewFixture(state: PreviewState) {
  if (state === "empty") {
    return {
      date: TODAY,
      generatedAt: NOW,
      counts: { people: 0, onShift: 0, paused: 0, offShift: 0, unknown: 0, updatesToday: 0, substantiveUpdatesToday: 0, tasksCompletedToday: 0, tasksOpen: 0, tasksOverdue: 0, evidenceToday: 0, evidenceActivityToday: 0, evidenceOutputToday: 0, reportsDraftedToday: 0, reportsSubmittedToday: 0, reportsPendingReview: 0, pendingReviewOldestAt: null, eodOutstandingPeople: 0, eodOutstandingDays: 0, disputedEvidence: 0 },
      people: [],
      recentActivity: [],
      attention: [],
      series: overviewSeries(0),
      timeSeries: [],
      freshness: { niftySyncedAt: null, niftyTasksToday: 0, worktivityObservedAt: null, githubLastEventAt: null, githubEventsToday: 0, lastPlanAt: null, lastReportSubmittedAt: null },
      readiness: { status: "ready", ready: true, issues: [], checks: { people: { active: 0 }, tasks: { open: 0 }, organization: { activeTeams: 0, activeSchedules: 0 } } },
    };
  }
  const series = overviewSeries(1);
  const people = PEOPLE.map((person, index) => ({
    personId: person.id,
    displayName: person.name,
    email: `${person.name.toLowerCase().replace(" ", ".")}@example.com`,
    roleProfile: person.role,
    timezone: person.timezone,
    schedule: { start: "09:00", end: "17:00", daysOfWeek: [1, 2, 3, 4, 5], timezone: person.timezone },
    attendance: {
      state: index === 0 ? "active" : index === 1 ? "paused" : index === 2 ? "off_shift" : "unknown",
      source: index === 3 ? "none" : "worktivity",
      observedAt: index === 3 ? null : `${TODAY}T15:${10 + index}:00.000Z`,
      freshness: index === 3 ? "unknown" : "fresh",
      clockedInAt: index < 2 ? `${TODAY}T09:0${index}:00.000Z` : null,
      clockedOutAt: null,
    },
    session: index < 2 ? { state: index === 1 ? "paused" : "active", clockedInAt: `${TODAY}T09:0${index}:00.000Z`, pausedSeconds: index === 1 ? 1800 : 0, observedSeconds: 3600 * 5 + index * 600, correctionStatus: null } : null,
    updatesToday: index === 0 ? 3 : index === 1 ? 1 : 0,
    substantiveUpdatesToday: index === 0 ? 2 : 0,
    evidenceToday: index === 0 ? 12 : index === 1 ? 6 : 0,
    tasksCompletedToday: index === 0 ? 3 : index === 1 ? 1 : 0,
    lastUpdateAt: index < 2 ? `${TODAY}T14:4${index}:00.000Z` : null,
    lastUpdateKind: index < 2 ? (index === 0 ? "material_progress" : "blocked") : null,
    eodToday: index === 1 ? "pending_review" : null,
    eodOutstanding: index === 2 ? { days: 2, latest: { date: "2026-09-29", status: "no_draft", reportId: null, observedMinutes: 280, completedTasks: 4, hasPlan: true } } : null,
  }));
  return {
    date: TODAY,
    generatedAt: NOW,
    counts: { people: 4, onShift: 2, paused: 1, offShift: 1, unknown: 1, updatesToday: 5, substantiveUpdatesToday: 3, tasksCompletedToday: 6, tasksOpen: 41, tasksOverdue: 7, evidenceToday: 19, evidenceActivityToday: 14, evidenceOutputToday: 5, reportsDraftedToday: 1, reportsSubmittedToday: 2, reportsPendingReview: 2, pendingReviewOldestAt: `${TODAY}T11:00:00.000Z`, eodOutstandingPeople: 2, eodOutstandingDays: 3, disputedEvidence: 1 },
    people,
    recentActivity: [
      { id: "a1", kind: "update", at: `${TODAY}T14:48:00.000Z`, personId: "p-ada", personName: "Ada Okafor", title: "Progress update", detail: "Finished the settlement reconciliation and moved to the payout edge cases.", provenance: "material progress" },
      { id: "a2", kind: "recap", at: `${TODAY}T14:30:00.000Z`, personId: "p-ada", personName: "Ada Okafor", title: "Reviewed the reconciliation queue and updated three records", detail: "Frames show the reconciliation sheet, a Slack thread with finance, and the payout runbook.", provenance: "employee confirmed" },
      { id: "a3", kind: "task_completed", at: `${TODAY}T13:55:00.000Z`, personId: "p-luis", personName: "Luis Moreno", title: "Reconcile September invoices", detail: "Finance", provenance: "task record" },
      { id: "a4", kind: "eod_submitted", at: `${TODAY}T13:40:00.000Z`, personId: "p-luis", personName: "Luis Moreno", title: "EOD report submitted", detail: "EOD Report: Luis Moreno — Sep 30, 2026", provenance: "pending review" },
      { id: "a5", kind: "evidence", at: `${TODAY}T12:20:00.000Z`, personId: "p-ada", personName: "Ada Okafor", title: "Pull request #482 merged", detail: "Harden payout retries", provenance: "github" },
      { id: "a6", kind: "update", at: `${TODAY}T11:05:00.000Z`, personId: "p-luis", personName: "Luis Moreno", title: "Progress update", detail: "Blocked on the September vendor statement; asked finance for the export.", provenance: "blocked" },
    ],
    attention: [
      { code: "reports_pending_review", severity: "warn", count: 2, message: "2 EOD reports awaiting review", href: "/work-os/admin/review" },
      { code: "eod_outstanding", severity: "warn", count: 2, message: "2 teammates with 3 unsubmitted EOD days", href: "/work-os/admin/review" },
      { code: "tasks_overdue", severity: "warn", count: 7, message: "7 overdue tasks across the workspace", href: "/work-os/admin/tasks" },
      { code: "evidence_disputed", severity: "warn", count: 1, message: "1 disputed evidence item", href: "/work-os/admin/evidence" },
    ],
    readiness: {
      status: "needs_setup",
      ready: false,
      issues: [
        { code: "people_unmapped_provider", severity: "needs_setup", count: 1, message: "active people are not mapped to an evidence account" },
        { code: "schedules_missing", severity: "needs_setup", count: 1, message: "active people have no current schedule" },
      ],
      checks: { people: { active: 4 }, tasks: { open: 41 }, organization: { activeTeams: 2, activeSchedules: 3 } },
    },
    series,
    timeSeries: timeSeriesForDates(series.map((point) => point.date)),
    freshness: {
      niftySyncedAt: `${TODAY}T15:40:00.000Z`,
      niftyTasksToday: 312,
      worktivityObservedAt: `${TODAY}T15:58:00.000Z`,
      githubLastEventAt: `${TODAY}T14:12:00.000Z`,
      githubEventsToday: 60,
      lastPlanAt: `${TODAY}T09:20:00.000Z`,
      lastReportSubmittedAt: `${TODAY}T13:05:00.000Z`,
    },
  };
}

/** Deterministic fourteen-day activity series for the overview trend. */
function overviewSeries(scale: number) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(`${TODAY}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    return {
      date: date.toISOString().slice(0, 10),
      completed: scale === 0 ? 0 : 2 + (index % 5),
      updates: scale === 0 ? 0 : 1 + (index % 3),
      evidence: scale === 0 ? 0 : 4 + (index % 6),
    };
  });
}

/** Deterministic stacked time series: three or four teammates with different
 * minutes each day, so segments, hover, and legend can be reviewed by hand.
 * The empty preview state returns no points at all, so the pages show their
 * honest empty copy instead of an empty chart. */
function timeSeriesForDates(dates: string[]) {
  return dates.map((date, index) => {
    const people = PEOPLE.slice(0, 3 + (index % 2)).map((person, personIndex) => ({
      personId: person.id,
      name: person.name,
      minutes: 30 + ((index * 37 + personIndex * 53) % 150),
    }));
    return {
      date,
      totalMinutes: people.reduce((sum, person) => sum + person.minutes, 0),
      people,
    };
  });
}

function insightsFixture(state: PreviewState) {
  const empty = state === "empty";
  const people = empty ? [] : PEOPLE.map((person, index) => ({
    personId: person.id,
    displayName: person.name,
    roleProfile: person.role,
    outcomesCompleted: [9, 6, 4, 2][index],
    outcomesLate: [1, 0, 1, 0][index],
    updates: [14, 9, 5, 3][index],
    substantiveUpdates: [10, 6, 3, 2][index],
    eodSubmitted: [5, 4, 3, 1][index],
    eodApproved: [4, 3, 2, 1][index],
    eodRejected: [0, 1, 0, 0][index],
    planned: [12, 8, 6, 3][index],
    plannedCompleted: [9, 6, 4, 2][index],
    commitmentRate: [75, 75, 67, 67][index],
    trackedMinutes: [940, 610, 380, 120][index],
    evidenceOutput: [6, 4, 2, 0][index],
    evidenceActivity: [48, 31, 18, 6][index],
    sessionsNeedingCorrection: index === 1 ? 1 : 0,
    lastActivityAt: `${TODAY}T14:4${index}:00.000Z`,
  }));
  const series = Array.from({ length: 7 }).map((_, index) => ({
    date: `2026-09-${24 + index}`,
    outcomesCompleted: [4, 6, 3, 7, 5, 2, 6][index],
    updates: [8, 11, 6, 12, 9, 4, 10][index],
    eodSubmitted: [3, 4, 3, 4, 4, 2, 3][index],
    trackedMinutes: [820, 960, 720, 1010, 880, 400, 910][index],
  }));
  return {
    range: "7d",
    from: "2026-09-24",
    through: TODAY,
    totals: { outcomesCompleted: empty ? 0 : 33, outcomesLate: empty ? 0 : 2, updates: empty ? 0 : 60, substantiveUpdates: empty ? 0 : 41, eodSubmitted: empty ? 0 : 23, eodApproved: empty ? 0 : 20, eodRejected: empty ? 0 : 1, planned: empty ? 0 : 29, plannedCompleted: empty ? 0 : 21, trackedMinutes: empty ? 0 : 2880, evidenceOutput: empty ? 0 : 12, evidenceActivity: empty ? 0 : 103, sessionsNeedingCorrection: empty ? 0 : 1, activePeople: empty ? 0 : 4 },
    previous: { outcomesCompleted: 28, outcomesLate: 3, updates: 55, substantiveUpdates: 38, eodSubmitted: 21, eodApproved: 18, eodRejected: 2, planned: 26, plannedCompleted: 18, trackedMinutes: 2650, evidenceOutput: 10, evidenceActivity: 96, sessionsNeedingCorrection: 2, activePeople: 4 },
    people,
    series,
    timeSeries: empty ? [] : timeSeriesForDates(series.map((point) => point.date)),
    updateKinds: empty ? [] : [
      { kind: "material_progress", count: 18 },
      { kind: "blocked", count: 4 },
      { kind: "completion_claim", count: 9 },
      { kind: "priority_change", count: 3 },
    ],
    topApps: empty ? [] : [
      { name: "Chrome", minutes: 412 },
      { name: "VS Code", minutes: 388 },
      { name: "Slack", minutes: 96 },
      { name: "Figma", minutes: 74 },
    ],
    overdueOpen: empty ? 0 : 7,
    notes: {
      summary: empty ? "No completed outcomes or updates were recorded in 2026-09-24 to 2026-09-30." : "The workspace recorded 33 completed outcomes and 60 updates in 2026-09-24 to 2026-09-30. Activity context is descriptive and never a score.",
      wins: empty ? [] : ["33 task outcomes completed in this range, up from 28 in the equal earlier period.", "41 substantive progress updates recorded.", "72% of planned commitments were completed (21 of 29).", "23 EOD reports submitted for review."],
      attention: empty ? ["No completed task outcomes were recorded in this range."] : ["2 completed outcomes landed after the recorded due date.", "3 workdays in the last seven days still have an unsubmitted EOD report."],
      nextFocus: ["Review outstanding EOD reports and follow up with the teammate.", "Rebalance or close the overdue backlog."],
    },
    freshness: { generatedAt: NOW },
  };
}

function reportsFixture(state: PreviewState) {
  const empty = state === "empty";
  const markdown = [
    "# EOD Report: Luis Moreno — Sep 30, 2026",
    "",
    "Role profile: Operations",
    "Goal: Close the September vendor reconciliation.",
    "Goal source: written by the employee",
    "",
    "## Completed Work",
    "- 14:05 — Reconcile September invoices — closed the vendor statement for Northwind.",
    "- 12:40 — Update the payout runbook — added the retry table.",
    "",
    "## Progressed Work",
    "- 11:20 — Chase the finance export for the final vendor batch.",
    "",
    "## Deferred Work",
    "- No work was explicitly deferred.",
    "",
    "## Carried Work",
    "- Nothing carries over from this day.",
    "",
    "## Unplanned Work",
    "- 09:50 — Rotate the API credential after the vendor notice.",
    "",
    "## Output Evidence",
    "- Pull request #482 — Harden payout retries (GitHub).",
    "",
    "## Activity Context",
    "- 09:00–10:00 — employee confirmed: Reviewed the reconciliation sheet and finance thread in Chrome.",
    "",
    "Activity context is descriptive and does not prove attendance, productivity, or task completion.",
  ].join("\n");
  const reports = empty ? [] : [
    { id: "r-1", person_id: "p-luis", report_date: TODAY, status: "pending_review", title: "EOD Report: Luis Moreno — Sep 30, 2026", markdown, submitted_markdown: markdown, metrics: { completed: 2, progressed: 1, deferred: 0, carried: 0, unplanned: 1 }, manager_notes: null, submitted_at: `${TODAY}T13:40:00.000Z`, reviewed_at: null, created_at: `${TODAY}T13:10:00.000Z`, person: { id: "p-luis", display_name: "Luis Moreno", email: "luis@example.com" }, versions: [{ id: "v-1", version_kind: "draft", created_at: `${TODAY}T13:10:00.000Z` }, { id: "v-2", version_kind: "employee_submission", created_at: `${TODAY}T13:40:00.000Z` }] },
    { id: "r-2", person_id: "p-ada", report_date: "2026-09-29", status: "pending_review", title: "EOD Report: Ada Okafor — Sep 29, 2026", markdown: markdown.replace("Luis Moreno", "Ada Okafor"), submitted_markdown: null, metrics: { completed: 3, progressed: 2 }, manager_notes: null, submitted_at: "2026-09-29T17:05:00.000Z", reviewed_at: null, created_at: "2026-09-29T16:40:00.000Z", person: { id: "p-ada", display_name: "Ada Okafor", email: "ada@example.com" }, versions: [] },
    { id: "r-3", person_id: "p-mei", report_date: "2026-09-28", status: "approved", title: "EOD Report: Mei Tanaka — Sep 28, 2026", markdown, submitted_markdown: markdown, metrics: { completed: 1 }, manager_notes: "Clean report; keep the vendor thread linked.", submitted_at: "2026-09-28T16:30:00.000Z", reviewed_at: "2026-09-29T09:10:00.000Z", created_at: "2026-09-28T16:00:00.000Z", person: { id: "p-mei", display_name: "Mei Tanaka", email: "mei@example.com" }, versions: [] },
  ];
  return { reports, counts: { draft: empty ? 0 : 1, pending_review: empty ? 0 : 2, approved: empty ? 0 : 1, rejected: empty ? 0 : 1, total: empty ? 0 : 5 },
    series: Array.from({ length: 14 }, (_, index) => {
      const date = new Date(`${TODAY}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (13 - index));
      const submitted = empty ? 0 : [1, 0, 2, 1, 0, 1, 3, 0, 1, 1, 2, 0, 1, 1][index];
      const people = submitted === 0 ? [] : [
        { personId: 'p-ada', name: 'Ada Okafor', submitted: Math.max(1, submitted - 1) },
        ...(submitted > 1 ? [{ personId: 'p-luis', name: 'Luis Moreno', submitted: 1 }] : []),
      ];
      return { date: date.toISOString().slice(0, 10), submitted, drafted: empty ? 0 : [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0][index], people };
    }) };
}

function evidenceFixture(state: PreviewState) {
  const empty = state === "empty";
  const rows = empty ? [] : [
    { id: "e-1", person_id: "p-ada", task_id: null, evidence_date: TODAY, source: "github", title: "Pull request #482 merged", summary: "Harden payout retries — 6 files changed.", url: null, metrics: {}, created_at: `${TODAY}T12:20:00.000Z`, person: { id: "p-ada", display_name: "Ada Okafor" }, task: { id: "t-1", title: "Harden payout retries" }, event: { correction_status: "original", evidence_class: "output_evidence", metadata: { repository: "WrazyAI/work-os", event: "pull_request", actor: { id: "288747123", login: "david-z-9900" } }, screenshot: null } },
    { id: "e-2", person_id: "p-luis", task_id: null, evidence_date: TODAY, source: "worktivity", title: "Activity context 13:00–14:00", summary: "Chrome, Slack, and the reconciliation sheet.", url: null, metrics: { totalMinutes: 58, topApps: [{ name: "Chrome", minutes: 41 }] }, created_at: `${TODAY}T14:00:00.000Z`, person: { id: "p-luis", display_name: "Luis Moreno" }, task: null, event: { correction_status: "disputed", evidence_class: "activity_observation", metadata: { needsReview: true }, screenshot: { id: "s-1", processing_status: "processed", summary: "Reconciliation sheet with the vendor table.", confidence: 0.82, storage_path: "screenshots/x", deleted_at: null } } },
    { id: "e-3", person_id: "p-ada", task_id: null, evidence_date: "2026-09-29", source: "loom", title: "Settlement walkthrough", summary: "Recorded walkthrough of the settlement close.", url: "https://www.loom.com/share/example", metrics: {}, created_at: "2026-09-29T15:00:00.000Z", person: { id: "p-ada", display_name: "Ada Okafor" }, task: null, event: { correction_status: "original", evidence_class: "output_evidence", metadata: {}, screenshot: null } },
  ];
  return { evidence: rows, summary: empty ? { sources: [], days: [] } : {
    sources: [{ source: "worktivity", count: 96 }, { source: "github", count: 31 }, { source: "loom", count: 6 }, { source: "manual", count: 3 }],
    days: Array.from({ length: 14 }, (_, index) => {
      const date = new Date(`${TODAY}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (13 - index));
      return { date: date.toISOString().slice(0, 10), count: [4, 6, 3, 8, 5, 2, 7, 9, 4, 6, 3, 8, 5, 7][index] };
    }),
  } };
}

function intervalsFixture(state: PreviewState) {
  const empty = state === "empty";
  return {
    intervals: empty ? [] : [
      { id: "i-1", personId: "p-ada", personName: "Ada Okafor", label: "13:30 – 14:30", windowStart: `${TODAY}T13:30:00.000Z`, windowEnd: `${TODAY}T14:30:00.000Z`, promptKind: "follow_up", generationStatus: "ready", reviewStatus: "confirmed", headline: "Reviewed the reconciliation queue and updated three records", detail: "Frames show the reconciliation sheet, a finance thread, and the payout runbook. No deployment or completion is established by these frames.", employeeFeedback: null, failureReason: null, generatedAt: NOW, reviewedAt: NOW, evidenceExpired: false, evidenceCount: 4, evidence: [
        { summaryId: "s-1", capturedAt: `${TODAY}T13:34:00.000Z`, visibleApp: "Chrome", frameSummary: "Reconciliation sheet with three rows highlighted.", usedInModel: true, rawImageShown: false, selectionReason: null, retained: true },
        { summaryId: "s-2", capturedAt: `${TODAY}T13:52:00.000Z`, visibleApp: "Slack", frameSummary: "Finance thread about the vendor export.", usedInModel: true, rawImageShown: false, selectionReason: null, retained: true },
      ] },
      { id: "i-2", personId: "p-luis", personName: "Luis Moreno", label: "11:00 – 12:00", windowStart: `${TODAY}T11:00:00.000Z`, windowEnd: `${TODAY}T12:00:00.000Z`, promptKind: "hourly_fallback", generationStatus: "ready", reviewStatus: "inferred", headline: "Worked through the invoice batch", detail: "Frames show the invoice spreadsheet and a vendor statement PDF.", employeeFeedback: null, failureReason: null, generatedAt: NOW, reviewedAt: null, evidenceExpired: false, evidenceCount: 3, evidence: [] },
    ],
  };
}

function peopleFixture(state: PreviewState) {
  const empty = state === "empty";
  return {
    people: empty ? [] : PEOPLE.map((person) => ({ id: person.id, display_name: person.name, email: `${person.name.toLowerCase().replace(" ", ".")}@example.com`, role_profile_id: null, nifty_member_id: `nifty-${person.id}`, worktivity_employee_id: `wt-${person.id}`, active: true })),
    roleProfiles: [{ id: "rp-1", name: "Engineering" }, { id: "rp-2", name: "Operations" }, { id: "rp-3", name: "Design" }],
  };
}

function personDetailFixture() {
  return {
    person: { id: "p-ada", display_name: "Ada Okafor", email: "ada.okafor@example.com", role_profile_id: "rp-1", nifty_member_id: "nifty-p-ada", worktivity_employee_id: "wt-p-ada", active: true, role_profile: { id: "rp-1", name: "Engineering" } },
    teams: [{ team_id: "t-1", is_manager: false, team: { id: "t-1", name: "Core", active: true } }],
    schedules: [{ id: "sc-1", shift_start: "09:00:00", shift_end: "17:00:00", timezone: "Europe/London", days_of_week: [1, 2, 3, 4, 5], effective_from: "2026-09-01", effective_to: null }],
    exceptions: [{ id: "ex-1", exception_date: "2026-10-02", kind: "leave", note: "Public holiday" }],
    sessions: [{ id: "se-1", shift_date: TODAY, state: "active", clocked_in_at: `${TODAY}T09:00:00.000Z`, clocked_out_at: null, paused_seconds: 0, correction_status: "original" }, { id: "se-2", shift_date: "2026-09-29", state: "clocked_out", clocked_in_at: "2026-09-29T09:05:00.000Z", clocked_out_at: "2026-09-29T17:10:00.000Z", paused_seconds: 1800, correction_status: "original" }],
    reports: [{ id: "r-2", report_date: "2026-09-29", status: "pending_review", submitted_at: "2026-09-29T17:05:00.000Z" }],
    updates: [{ id: "u-1", shift_date: TODAY, kind: "catch_up", input_text: "Finished the settlement reconciliation and moved to the payout edge cases.", occurred_at: `${TODAY}T14:48:00.000Z` }],
    intervals: [{ id: "i-1", local_date: TODAY, headline: "Reviewed the reconciliation queue", review_status: "confirmed" }],
    evidenceSummary: { total: 12, activity: 8, output: 4, disputed: 1 },
  };
}

function tasksFixture(state: PreviewState) {
  const empty = state === "empty";
  const rows = empty ? [] : [
    { id: "t-1", title: "Harden payout retries", description: "Add bounded retries to the payout worker.", completed: false, due_date: "2026-10-02", priority: "high", project: { name: "Platform" }, assignees: [{ displayName: "Ada Okafor" }], provider: "local", synced_at: NOW, url: null },
    { id: "t-2", title: "Reconcile September invoices", description: "", completed: true, due_date: "2026-09-29", priority: "medium", project: { name: "Finance" }, assignees: [{ displayName: "Luis Moreno" }], provider: "nifty", synced_at: NOW, url: "https://nifty.pm/task/example" },
    { id: "t-3", title: "Refresh the onboarding screenshots", description: "", completed: false, due_date: null, priority: null, project: { name: "Design" }, assignees: [], provider: "nifty", synced_at: null, url: null },
  ];
  return { tasks: rows, nextOffset: null, summary: empty ? { open: 0, overdue: 0, completedWeek: 0 } : { open: 41, overdue: 7, completedWeek: 12 } };
}

function organizationFixture(state: PreviewState) {
  const empty = state === "empty";
  return {
    organization: { id: "org-1", name: "Preview Workspace", slug: "preview", feature_flags: { employee_companion: true, desktop_companion: true, screenshot_summaries: true, github_evidence: true, ghl_evidence: false, voice_input: true, seo_mission_control: false } },
    memberships: empty ? [] : [
      { id: "m-1", user_id: "u-1", person_id: "p-ada", role: "admin", active: true, feature_flags: {}, person: { id: "p-ada", display_name: "Ada Okafor", email: "ada.okafor@example.com" } },
      { id: "m-2", user_id: "u-2", person_id: "p-luis", role: "employee", active: true, feature_flags: { desktop_companion: true }, person: { id: "p-luis", display_name: "Luis Moreno", email: "luis.moreno@example.com" } },
    ],
    teams: empty ? [] : [{ id: "t-1", name: "Core" }],
    teamMembers: empty ? [] : [{ team_id: "t-1", person_id: "p-ada", is_manager: true, person: { id: "p-ada", display_name: "Ada Okafor" } }],
  };
}

function connectionsFixture() {
  return {
    connections: [{ id: "c-1", provider: "github", external_workspace_id: "WrazyAI", active: true, config: { repos: [{ full_name: "WrazyAI/work-os", hook_id: "h-1", created_at: NOW }] } }],
    accounts: [{ id: "sa-1", provider: "github", external_account_id: "david-z-9900", person: { id: "p-ada", display_name: "Ada Okafor" }, verified: true, metadata: { login: "david-z-9900" } }],
  };
}

function githubActorsFixture(state: PreviewState) {
  const empty = state === "empty";
  return {
    actors: empty ? [] : [
      {
        key: "login:david-z-9900",
        id: "288747123",
        login: "david-z-9900",
        events: 6,
        firstSeen: `${TODAY}T08:40:00.000Z`,
        lastSeen: `${TODAY}T14:12:00.000Z`,
        titles: ["Pushed 3 commits to main", "Pull request merged: Add evidence band", "Pull request review approved: Ship it"],
        suggestion: { personId: "p-ada", displayName: "Ada Okafor", githubUsername: "david-z-9900" },
      },
      {
        key: "login:unknown-dev",
        id: null,
        login: "unknown-dev",
        events: 2,
        firstSeen: `${TODAY}T10:02:00.000Z`,
        lastSeen: `${TODAY}T11:30:00.000Z`,
        titles: ["Workflow success: CI", "Issue opened: Flaky payout test"],
        suggestion: null,
      },
    ],
    people: PEOPLE.map((person) => ({ id: person.id, displayName: person.name, githubUsername: person.id === "p-ada" ? "david-z-9900" : null })),
    totals: { unattributedEvents: empty ? 0 : 8, lastEventAt: empty ? null : `${TODAY}T14:12:00.000Z` },
    configuration: { webhookReceiverReady: true, repositoryManagementReady: true },
  };
}

function githubReposFixture(state: PreviewState) {
  const empty = state === "empty";
  return {
    connection: empty ? null : { id: "c-1", workspace: "WrazyAI" },
    organization: empty ? null : "WrazyAI",
    repos: empty ? [] : [
      { full_name: "WrazyAI/work-os", private: true, default_branch: "main", pushed_at: NOW },
      { full_name: "WrazyAI/agent-os", private: true, default_branch: "main", pushed_at: NOW },
      { full_name: "WrazyAI/launchloom", private: true, default_branch: "main", pushed_at: null },
    ],
    connectedRepos: empty ? [] : [{ full_name: "WrazyAI/work-os", hook_id: "h-1", created_at: NOW }],
    webhookUrl: "https://app.wrazyos.com/api/work-os/integrations/github/webhook",
    configuration: { repositoryManagementReady: !empty, webhookReceiverReady: true, reason: empty ? "No GitHub repository-management token is configured for this deployment." : null },
  };
}

function blueprintsFixture() {
  return { blueprints: [{ id: "b-1", name: "Client onboarding", description: "Kickoff, access, audit, and first reporting cycle." }] };
}

function statusFixture() {
  return { schema: { ready: true, migration: "0054_work_os_voice_input.sql" }, nifty: { canCallApi: true, hasRefreshToken: true, hasAccessToken: true } };
}

function projectsFixture() {
  return { projects: [{ id: "pr-1", name: "Platform", provider_project_id: "nifty-pr-1" }, { id: "pr-2", name: "Finance", provider_project_id: "nifty-pr-2" }] };
}

function fieldMappingsFixture() {
  return { mappings: [{ id: "fm-1", semantic_field: "priority", provider_field_id: "field-123" }] };
}

function installAdminFetchStub(state: PreviewState) {
  if (typeof window === "undefined") return;
  const flag = window as unknown as { __adminPreviewStub?: boolean };
  if (flag.__adminPreviewStub) return;
  flag.__adminPreviewStub = true;
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const fail = () => Promise.resolve(new Response(JSON.stringify({ error: "Preview fixture: this request failed." }), { status: 500, headers: { "content-type": "application/json" } }));
  const never = () => new Promise<Response>(() => undefined);
  window.fetch = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (state === "loading") return never();
    if (state === "error") return fail();
    if (url.includes("/api/work-os/session")) return json({
      requiresWorkspaceSelection: false,
      organizationId: "org-1",
      organizationName: "David Yeboah Workspace",
      role: "admin",
      personId: "p-ada",
      userId: "u-1",
      featureFlags: {},
      viewMode: "admin",
      organizations: [
        { organizationId: "org-1", name: "David Yeboah Workspace", role: "admin", personId: "p-ada" },
        { organizationId: "org-2", name: "WrazyAI Owner Workspace", role: "employee", personId: "p-ada" },
      ],
    });
    if (url.includes("/api/work-os/status")) return json(statusFixture());
    if (url.includes("/api/work-os/admin/overview")) return json(overviewFixture(state));
    if (url.includes("/api/work-os/admin/insights")) return json(insightsFixture(state));
    if (url.includes("/api/work-os/admin/activity-intervals")) return json(intervalsFixture(state));
    if (url.includes("/api/work-os/admin/integrations/github/actors")) return json(githubActorsFixture(state));
    if (url.includes("/api/work-os/admin/integrations/github/repos")) return json(githubReposFixture(state));
    if (url.includes("/api/work-os/admin/people/")) return json(personDetailFixture());
    if (url.includes("/api/work-os/reports")) return json(reportsFixture(state));
    if (url.includes("/api/work-os/evidence")) return json(evidenceFixture(state));
    if (url.includes("/api/work-os/people")) return json(peopleFixture(state));
    if (url.includes("/api/work-os/tasks")) return json(tasksFixture(state));
    if (url.includes("/api/work-os/projects")) return json(projectsFixture());
    if (url.includes("/api/work-os/organization")) return json(organizationFixture(state));
    if (url.includes("/api/work-os/integrations/connections")) return json(connectionsFixture());
    if (url.includes("/api/work-os/field-mappings")) return json(fieldMappingsFixture());
    if (url.includes("/api/work-os/blueprints")) return json(blueprintsFixture());
    if (url.includes("/api/work-os/readiness")) return json(overviewFixture(state).readiness);
    return json({});
  };
}

const SECTIONS: Record<string, { section: AdminSection; label: string; render: () => React.ReactNode }> = {
  overview: { section: "overview", label: "Overview", render: () => <AdminOverviewPage /> },
  people: { section: "people", label: "People", render: () => <AdminPeoplePage /> },
  tasks: { section: "tasks", label: "Tasks", render: () => <AdminTasksPage /> },
  review: { section: "review", label: "EOD Review", render: () => <AdminReviewPage /> },
  insights: { section: "insights", label: "Insights", render: () => <AdminInsightsPage /> },
  evidence: { section: "evidence", label: "Evidence", render: () => <AdminEvidencePage /> },
  settings: { section: "settings", label: "Settings", render: () => <AdminSettingsPage /> },
};

export default function AdminPreview({ section }: { section: string }) {
  const params = useSearchParams();
  const stateParam = params.get("state");
  const state: PreviewState = stateParam === "empty" || stateParam === "loading" || stateParam === "error" ? stateParam : "dense";
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }));
  const [active, setActive] = useState(section in SECTIONS ? section : "overview");
  installAdminFetchStub(state);
  const entry = SECTIONS[active] ?? SECTIONS.overview;
  return (
    <QueryClientProvider client={client}>
      <div data-work-os-workspace="" style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
        {/* The deployed shell carries the section destinations; this preview
            nav stands in for it so every admin page is reachable here. */}
        <nav aria-label="Preview destination" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "16px 24px 0" }}>
          {Object.entries(SECTIONS).map(([id, item]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              aria-current={id === active ? "page" : undefined}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: id === active ? "var(--bg-card)" : "transparent",
                color: id === active ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <AdminShell section={entry.section}>{entry.render()}</AdminShell>
      </div>
    </QueryClientProvider>
  );
}
