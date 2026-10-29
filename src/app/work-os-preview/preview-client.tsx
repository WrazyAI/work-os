"use client";

// Dev-only rendered-QA fixture for the employee workspace (design.md §15).
// The proxy exposes it only when NODE_ENV is not production; it stubs the
// Work OS read endpoints so the real destination components can be exercised
// without a live session.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EmployeeToday from "@/modules/work-os/employee/EmployeeToday";
import EmployeeTasks from "@/modules/work-os/employee/EmployeeTasks";
import EmployeeReview from "@/modules/work-os/employee/EmployeeReview";
import EmployeeInsights from "@/modules/work-os/employee/EmployeeInsights";
import EmployeeSettings from "@/modules/work-os/employee/EmployeeSettings";
import EmployeeWorkspaceShell, { EmployeeWorkspaceProvider } from "@/modules/work-os/employee/EmployeeWorkspaceShell";
import WorkspaceChooser from "@/modules/work-os/WorkspaceChooser";
import { CheckInComposer } from "@/modules/work-os/CheckInComposer";
import DesktopConnect, { DesktopConnectView, type ConnectStatus } from "@/app/work-os/desktop/connect/DesktopConnect";
import { VOICE_FAILURE_COPY, type VoiceInput, type VoiceState } from "@/modules/work-os/useVoiceInput";
import AdminPreview from "./admin-preview";

const TODAY = "2026-09-11";

const workspace = (date: string, goal: string) => ({
  date,
  readOnly: date !== TODAY,
  completed: 3,
  total: 9,
  overdueCount: 1,
  goal: { text: goal, provenance: "employee", revision: 1 },
  carryOverGroups: [{ key: "older", label: "Older", tasks: [{ id: "carry-1", title: "Reconcile the August close", due_date: "2026-09-08" }, { id: "carry-2", title: "Update the intake checklist" }] }],
  sessionQuality: { status: "valid", message: null },
});

const taskFixture = (overrides: Record<string, unknown>) => ({
  id: "task-1",
  provider_task_id: "nifty-1",
  title: "Reconcile September settlements",
  completed: false,
  due_date: TODAY,
  priority: "high",
  provider: "nifty",
  synced_at: "2026-09-11T08:05:00.000Z",
  project: { name: "Operations" },
  milestone: { name: "Monthly close" },
  assignees: [{ personId: "p1", displayName: "Preview Employee" }],
  subtasks: [
    { id: "sub-1", provider_task_id: "nifty-sub-1", title: "Pull the provider export", completed: true, provider: "nifty" },
    { id: "sub-2", provider_task_id: "nifty-sub-2", title: "Match the ledger rows", completed: false, provider: "nifty" },
  ],
  subtaskProgress: { completed: 1, total: 2, percentage: 50 },
  ...overrides,
});

const dayTasks = [
  taskFixture({}),
  taskFixture({
    id: "task-2",
    provider_task_id: "local-2",
    title: "Write the handoff note",
    priority: "medium",
    provider: "local",
    synced_at: null,
    project: null,
    milestone: null,
    assignees: [],
    subtasks: [],
    subtaskProgress: { completed: 0, total: 0, percentage: 0 },
    due_date: null,
  }),
  taskFixture({
    id: "task-3",
    provider_task_id: "nifty-3",
    title: "Review the intake queue",
    completed: true,
    due_date: "2026-09-10",
    priority: null,
    subtasks: [],
    subtaskProgress: { completed: 0, total: 0, percentage: 0 },
  }),
];

const manyTaskRows = Array.from({ length: 125 }, (_, index) => {
  const ordinal = index + 1;
  const day = String(ordinal % 28 + 1).padStart(2, "0");
  return taskFixture({
    id: `page-task-${String(ordinal).padStart(3, "0")}`,
    provider_task_id: `page-provider-${ordinal}`,
    title: `Paginated task ${String(ordinal).padStart(3, "0")}`,
    description: ordinal === 119 ? "A searchable record beyond the first two pages." : "Preview row for cursor pagination.",
    completed: ordinal % 5 === 0,
    completed_at: ordinal % 5 === 0 ? `2026-09-${day}T12:00:00.000Z` : null,
    due_date: `2026-09-${day}`,
    provider_created_at: `2026-09-${day}T08:00:00.000Z`,
    subtasks: [],
    subtaskProgress: { completed: 0, total: 0, percentage: 0 },
  });
});

const historyFixture = (date: string, goal: string) => ({
  shiftDate: date,
  shift: { startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T17:00:00.000Z`, timezone: "Atlantic/Reykjavik", breaks: [] },
  prompt: { kind: "optional", nextPromptAt: null, required: false, reason: "Historical workspace." },
  niftySync: { fresh: true, syncedAt: new Date().toISOString() },
  tasks: [],
  evidence: [],
  proposals: [],
  report: null,
  session: { id: `session-${date}`, state: "clocked_out" },
  plan: null,
  workspaceSummary: workspace(date, goal),
  attendance: null,
  breakPolicy: { worktivityAuthoritative: false },
  /* Voice input is the newest capability on the check-in composer, so the
     fixture keeps it on for rendered review (design §8.8). */
  access: { featureFlags: { voice_input: true, loom_updates: false } },
});

const rejectedFixture = (date: string) => ({
  ...historyFixture(date, "Close the settlement reconciliation."),
  report: {
    id: "report-2026-09-03",
    status: "rejected",
    markdown: "## Summary\nReconciled the settlement batch and documented the handoff.\n\n## Completed\n- Reconcile September 3 payments",
  },
});

const todayFixture = () => ({
  ...historyFixture(TODAY, "Ship the outstanding EOD flow."),
  readOnly: false,
  prompt: { kind: "follow_up", nextPromptAt: `${TODAY}T12:00:00.000Z`, required: false, reason: "Review the last hour before your update." },
  report: { id: "report-today", status: "draft", markdown: "## Summary\nOutlined the review flow and drafted the employee workspace routes." },
  plan: {
    id: "plan-today",
    status: "draft",
    freeform_intent: "Ship the outstanding EOD flow.",
    focus_summary: null,
    revision: 2,
    items: [
      { id: "item-1", task_id: "nifty-1", title_snapshot: "Reconcile September settlements", disposition: "selected", item_kind: "task", completion_state: "open" },
    ],
  },
  niftySync: { fresh: true, syncing: false, syncedAt: `${TODAY}T11:35:00.000Z` },
  tasks: dayTasks,
  evidence: [
    { id: "ev-1", title: "Worktivity interval · 10:00–11:00", summary: "Reconciled settlement rows in the ledger and updated the operations sheet.", source: "screenshot", evidence_event_id: "event-1", event: { correction_status: "original" } },
    { id: "ev-2", title: "Loom recording — settlement walkthrough", summary: "Walked through the reconciliation steps and the open edge cases.", source: "loom", url: "https://www.loom.com/share/preview", evidence_event_id: null, event: null },
  ],
  proposals: [
    { id: "proposal-1", operation: "task_update", status: "pending", input_text: "Mark the provider export as done", proposed_change: { progress: "Completed the provider export and started the ledger match." }, task: { title: "Pull the provider export" }, before_state: null, failure_reason: null },
  ],
  session: { id: "session-today", state: "clocked_in", clocked_in_at: `${TODAY}T09:04:00.000Z`, paused_seconds: 1800 },
  attendance: { source: "worktivity", state: "active", status: "working", observedAt: `${TODAY}T11:42:00.000Z`, clockedInAt: `${TODAY}T09:04:00.000Z`, clockedOutAt: null, stale: false, message: "Worktivity activity observed; the Work OS workday is synchronized." },
  access: { featureFlags: { voice_input: true, loom_updates: true, work_memory: true, screenshot_summaries: true }, capabilities: { voice_input: true } },
});

const memoryFixture = {
  facts: [
    { id: "fact-1", content: "The settlement reconciliation is David's responsibility on Mondays.", summary: null, review_status: "candidate", fact_key: null, local_date: TODAY, occurred_at: `${TODAY}T10:00:00.000Z`, created_at: `${TODAY}T10:00:00.000Z` },
    { id: "fact-2", content: "The intake queue uses the shared ops rotation.", summary: null, review_status: "confirmed", fact_key: null, local_date: "2026-09-28", occurred_at: "2026-09-28T09:00:00.000Z", created_at: "2026-09-28T09:00:00.000Z" },
  ],
  recent: [
    { id: "recent-1", kind: "check_in", content: "Recorded a progress update about the settlement batch.", summary: "Progress update about the settlement batch", local_date: TODAY, occurred_at: `${TODAY}T11:00:00.000Z`, source_table: "work_check_ins", created_at: `${TODAY}T11:00:00.000Z` },
    { id: "recent-2", kind: "completed", content: "Completed the provider export task.", summary: null, local_date: "2026-09-29", occurred_at: "2026-09-29T15:00:00.000Z", source_table: "work_task_events", created_at: "2026-09-29T15:00:00.000Z" },
  ],
};

const intervalsFixture = {
  date: TODAY,
  intervals: [
    {
      id: "interval-1",
      windowStart: `${TODAY}T10:00:00.000Z`,
      windowEnd: `${TODAY}T11:00:00.000Z`,
      label: "10:00 – 11:00",
      promptKind: "hourly_fallback",
      generationStatus: "ready",
      reviewStatus: "inferred",
      headline: "Reconciled the settlement batch and updated the operations sheet",
      detail: "The interval shows ledger work, a short review of the intake queue, and a handoff note draft.",
      activities: ["Ledger reconciliation in the finance sheet", "Intake queue review", "Handoff note drafting"],
      workflow: ["Open provider export", "Match ledger rows", "Draft the handoff note"],
      uncertainties: ["No frame establishes that the reconciliation was approved"],
      employeeFeedback: null,
      failureReason: null,
      generatedAt: `${TODAY}T11:05:00.000Z`,
      reviewedAt: null,
      evidenceExpired: false,
      evidenceCount: 2,
      evidence: [
        { summaryId: "frame-1", capturedAt: `${TODAY}T10:14:00.000Z`, visibleApp: "Sheets", frameSummary: "Settlement rows being matched against the export.", usedInModel: true, rawImageShown: false, selectionReason: "representative", retained: true },
        { summaryId: "frame-2", capturedAt: `${TODAY}T10:41:00.000Z`, visibleApp: "Notes", frameSummary: "Handoff note draft in progress.", usedInModel: true, rawImageShown: false, selectionReason: "representative", retained: true },
      ],
    },
    {
      id: "interval-2",
      windowStart: `${TODAY}T09:00:00.000Z`,
      windowEnd: `${TODAY}T10:00:00.000Z`,
      label: "09:00 – 10:00",
      promptKind: "follow_up",
      generationStatus: "ready",
      reviewStatus: "confirmed",
      headline: "Started the settlement export and cleared the intake queue",
      detail: "The first interval shows the export being pulled and the intake queue triaged.",
      activities: ["Provider export", "Intake triage"],
      workflow: [],
      uncertainties: [],
      employeeFeedback: null,
      failureReason: null,
      generatedAt: `${TODAY}T10:05:00.000Z`,
      reviewedAt: `${TODAY}T10:12:00.000Z`,
      evidenceExpired: true,
      evidenceCount: 0,
      evidence: [],
    },
  ],
};

const screenshotGalleryFixture = {
  processed: 3,
  excludedPolicy: 1,
  excludedSensitive: 0,
  unavailable: 0,
  pending: 2,
  total: 6,
  viewable: [
    { summaryId: "shot-1", capturedAt: `${TODAY}T09:12:00.000Z`, visibleApp: "Sheets", summary: "Provider export open with settlement rows selected.", confidence: 0.82 },
    { summaryId: "shot-2", capturedAt: `${TODAY}T10:14:00.000Z`, visibleApp: "Sheets", summary: "Ledger rows matched against the export.", confidence: 0.66 },
    { summaryId: "shot-3", capturedAt: `${TODAY}T10:41:00.000Z`, visibleApp: "Notes", summary: "Handoff note draft in progress.", confidence: 0.58 },
  ],
  hours: [
    { hourStart: 9, label: "09:00", summary: "Pulled the provider export and triaged the intake queue.", frameCount: 2, summaryId: "hour-9", visibleApp: "Sheets", synthesized: true },
    { hourStart: 10, label: "10:00", summary: "Matched ledger rows and drafted the handoff note.", frameCount: 2, summaryId: "hour-10", visibleApp: "Sheets", synthesized: true },
    { hourStart: 11, label: "11:00", summary: "2 frames recorded.", frameCount: 2, summaryId: null, visibleApp: null, synthesized: false },
  ],
};

const aiDraftFixture = {
  markdown: "## Summary\nClosed the settlement reconciliation and cleared the intake queue.\n\n## Completed\n- Reconciled the September settlements\n- Pulled the provider export\n\n## Carried\n- Update the intake checklist\n\n## Bottleneck\nAwaiting the ops lead's sign-off.",
  model: "preview",
  screenshots: { processed: 3, excluded: 1, failed: 0, pending: 2, hours: [] },
  screenshotSyncUnavailable: false,
};

const interpretationFixture = {
  interpretation: {
    rawIntent: "Ship the outstanding EOD flow.",
    summary: "Close the settlement reconciliation and hand off the EOD flow.",
    commitments: [
      { clientId: "c1", linkedTaskId: "nifty-1", title: "Reconcile September settlements", objective: "Close the September reconciliation today.", successCriteria: ["Ledger matches the export"], sourceRefs: [{ provider: "work_os", type: "task", id: "nifty-1", label: "Reconcile September settlements" }], confidence: 0.9 },
      { clientId: "c2", title: "Write the handoff note", objective: "Document the reconciliation for the team.", successCriteria: ["Note shared with ops"], sourceRefs: [{ provider: "employee", type: "intent", id: "raw_intent" }], confidence: 0.6 },
    ],
    clarifications: [{ id: "q1", commitmentId: "c2", question: "Who needs the handoff note?", reason: "The audience is unclear." }],
    readiness: "needs_one_clarification",
  },
  build_id: "11111111-1111-4111-8111-111111111111",
};

const outstandingFixture = {
  from: "2026-08-28",
  through: "2026-09-10",
  count: 3,
  days: [
    { date: "2026-09-10", status: "no_draft", reportId: null, observedMinutes: 290, completedTasks: 10, hasPlan: true },
    { date: "2026-09-08", status: "draft_unsubmitted", reportId: "report-2026-09-08", observedMinutes: 319, completedTasks: 7, hasPlan: true },
    { date: "2026-09-03", status: "changes_requested", reportId: "report-2026-09-03", observedMinutes: 306, completedTasks: 7, hasPlan: true },
  ],
};

const insightsFixture = {
  range: "7d",
  from: "2026-09-04",
  through: TODAY,
  days: [
    { date: "2026-09-10", goal: { text: "Finish the settlement reconciliation.", provenance: "employee" }, completed: 7, progressed: 2, deferred: 1, carried: 1, unplanned: 0, observedSeconds: 18000, pausedSeconds: 1800, planStatus: "confirmed", planned: 6, plannedCompleted: 5, carryOver: 1, overdue: 0, updates: 3, outputEvidence: 2, activityContext: 2, trackedMinutes: 210, tasksCompleted: 4, tasksOpen: 2, outcomesOnTime: 3, outcomesLate: 1, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [], updatesByKind: { progress: 2, blocked: 1 } },
    { date: "2026-09-09", goal: { text: "Clear the intake queue.", provenance: "employee" }, completed: 5, progressed: 3, deferred: 0, carried: 2, unplanned: 1, observedSeconds: 16200, pausedSeconds: 0, planStatus: "confirmed", planned: 5, plannedCompleted: 4, carryOver: 2, overdue: 1, updates: 2, outputEvidence: 1, activityContext: 1, trackedMinutes: 150, tasksCompleted: 3, tasksOpen: 3, outcomesOnTime: 2, outcomesLate: 1, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [{ id: "r1", label: "Intake review", target: "/work-os/tasks" }], updatesByKind: { progress: 2 } },
    { date: TODAY, goal: { text: "Ship the outstanding EOD flow.", provenance: "employee" }, completed: 3, progressed: 1, deferred: 0, carried: 0, unplanned: 0, observedSeconds: 10800, pausedSeconds: 1800, planStatus: "draft", planned: 3, plannedCompleted: 1, carryOver: 0, overdue: 0, updates: 2, outputEvidence: 1, activityContext: 1, trackedMinutes: 90, tasksCompleted: 2, tasksOpen: 1, outcomesOnTime: 1, outcomesLate: 0, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [], updatesByKind: { progress: 2 } },
  ],
  totals: { observedSeconds: 45000, pausedSeconds: 3600, planned: 14, plannedCompleted: 10, carryOver: 3, overdue: 1, updates: 7, outputEvidence: 4, activityContext: 4, trackedMinutes: 450, tasksCompleted: 9, tasksOpen: 6, progressed: 6, deferred: 1, carried: 3, unplanned: 1, outcomesOnTime: 6, outcomesLate: 2, completed: 15 },
  updateKinds: { progress: 6, blocked: 1 },
  comparison: { from: "2026-08-28", through: "2026-09-03", totals: { planned: 12, plannedCompleted: 7, tasksCompleted: 7, observedSeconds: 41000, updates: 5, outputEvidence: 3, activityContext: 3, trackedMinutes: 380 }, days: [] },
  consistency: { dayCount: 3, daysWithGoal: 3, daysWithUpdate: 3, daysWithCompletion: 3, bestDay: { date: "2026-09-10", tasksCompleted: 4 }, currentStreak: 3, commitmentRate: 71 },
  brief: { summary: "A steady week: the settlement work closed and the intake queue moved. Two carry-over items remain from older work.", wins: ["Settlement reconciliation finished", "Intake backlog reduced"], attention: ["Two older carry-over items are still open"], nextFocus: ["Draft the EOD before the shift ends"] },
  freshness: { stale: false, staleAt: null, error: null, niftySyncedAt: `${TODAY}T11:35:00.000Z`, worktivityObservedAt: `${TODAY}T11:42:00.000Z` },
};

const onboardingFixture = {
  status: "complete",
  onboardingRequired: false,
  profile: {
    displayName: "Preview Employee",
    email: "preview@example.com",
    timezone: "Atlantic/Reykjavik",
    language: "en",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [] },
    notifications: { desktopEnabled: true },
    privacy: { sensitiveAppExclusions: ["password manager"] },
  },
  organizationSetup: {
    roleProfile: { name: "Operations" },
    teams: [{ name: "Core" }],
    managers: [{ display_name: "Manager" }],
    officialSchedule: { shiftStart: "09:00", shiftEnd: "17:00", timezone: "Atlantic/Reykjavik" },
  },
  employeeRequirements: { consentProvided: true, screenshotConsentProvided: true, privacyAcknowledged: true },
};

function installFetchStub() {
  if (typeof window === "undefined" || (window as unknown as { __workOsPreviewStub?: boolean }).__workOsPreviewStub) return;
  (window as unknown as { __workOsPreviewStub?: boolean }).__workOsPreviewStub = true;
  const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  const calls: string[] = [];
  (window as unknown as { __workOsPreviewCalls?: string[] }).__workOsPreviewCalls = calls;
  const passthroughFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
    // Static art the confirmation player fetches (animation + wasm) must reach
    // the server, not the fixture stub.
    if (/\.(?:lottie|wasm)(?:\?|$)/.test(url)) return passthroughFetch(input, init);
    if (url.includes("/api/work-os/desktop/authorize")) {
      if (new URLSearchParams(window.location.search).get("connect-result") === "error") {
        return Promise.resolve(new Response(JSON.stringify({ error: "Preview fixture: the authorization request expired." }), { status: 500, headers: { "content-type": "application/json" } }));
      }
      return respond({ callbackUrl: "wrazy-workos://auth?code=preview-code&state=preview-state", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    }
    if (url.includes("/api/work-os/me/onboarding")) return respond(onboardingFixture);
    if (url.includes("/api/work-os/me/eod/outstanding")) return respond(outstandingFixture);
    if (url.includes("/api/work-os/me/eod/ai-draft")) return respond(aiDraftFixture);
    if (url.includes("/api/work-os/me/eod/screenshots/prepare")) return respond({ date: TODAY, analyzed: 2, failed: 0, pending: 1, total: 6, sampled: 2, unavailable: false });
    if (url.includes("/api/work-os/me/eod/screenshots")) return respond(screenshotGalleryFixture);
    if (url.includes("/api/work-os/me/memory/")) return respond({});
    if (url.includes("/api/work-os/me/memory")) return respond(memoryFixture);
    if (url.includes("/api/work-os/me/activity-intervals/")) return respond({ interval: intervalsFixture.intervals[0] });
    if (url.includes("/api/work-os/me/activity-intervals")) return respond(intervalsFixture);
    if (url.includes("/api/work-os/me/plan/interpret")) return respond(interpretationFixture);
    if (url.includes("/api/work-os/me/plan/refine")) {
      let answers: Record<string, string> = {};
      try {
        answers = (JSON.parse(String(init?.body ?? "{}")) as { clarificationAnswers?: Record<string, string> }).clarificationAnswers ?? {};
      } catch {
        answers = {};
      }
      const applied = Object.values(answers).map((answer) => answer.trim()).filter(Boolean);
      const remaining = interpretationFixture.interpretation.clarifications.filter((question) => !answers[question.id]?.trim());
      return respond({
        ...interpretationFixture,
        interpretation: {
          ...interpretationFixture.interpretation,
          summary: applied.length ? `${interpretationFixture.interpretation.summary} First focus: ${applied.join("; ")}.` : interpretationFixture.interpretation.summary,
          clarifications: remaining,
          readiness: remaining.length === 0 ? "ready" : remaining.length === 1 ? "needs_one_clarification" : "needs_multiple_clarifications",
        },
      });
    }
    if (url.includes("/api/work-os/me/plan")) return respond(todayFixture().plan);
    if (url.includes("/api/work-os/me/day?date=2026-09-03")) return respond(rejectedFixture("2026-09-03"));
    if (url.includes("/api/work-os/me/day?date=2026-09-10")) return respond(historyFixture("2026-09-10", "Finish the settlement reconciliation."));
    if (url.includes("/api/work-os/me/day")) return respond(todayFixture());
    if (url.includes("/api/work-os/me/tasks?view=day") || url.includes("/api/work-os/me/tasks?view=open") || url.includes("/api/work-os/me/tasks?view=history")) {
      const requestUrl = new URL(url, window.location.origin);
      const params = requestUrl.searchParams;
      const many = new URLSearchParams(window.location.search).has("many-tasks");
      const view = params.get("view");
      const source = many ? manyTaskRows : dayTasks;
      const completedOnly = params.get("completed") === "true";
      const openOnly = view === "open" || params.get("completed") === "false";
      const search = params.get("search")?.trim().toLowerCase() ?? "";
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";
      const filtered = source.filter((raw) => {
        const task = raw as Record<string, any>;
        if (completedOnly && task.completed !== true) return false;
        if (openOnly && task.completed === true) return false;
        if (search && !`${task.title ?? ""} ${task.description ?? ""} ${task.project?.name ?? ""}`.toLowerCase().includes(search)) return false;
        const taskDate = String(task.due_date ?? task.provider_created_at ?? "").slice(0, 10);
        if (from && (!taskDate || taskDate < from)) return false;
        if (to && (!taskDate || taskDate > to)) return false;
        return true;
      });
      const limit = Math.min(50, Math.max(1, Number(params.get("limit") ?? "50") || 50));
      const offset = Number(params.get("cursor") ?? "0") || 0;
      const tasks = filtered.slice(offset, offset + limit);
      const nextCursor = offset + tasks.length < filtered.length ? String(offset + tasks.length) : null;
      const counts = {
        total: filtered.length,
        open: filtered.filter((task) => task.completed !== true).length,
        completed: filtered.filter((task) => task.completed === true).length,
      };
      if (view === "day") return respond({ tasks, totalCount: filtered.length, counts, workspace: workspace(params.get("date") || TODAY, "Ship the outstanding EOD flow."), cursor: { next: nextCursor }, nextCursor });
      return respond({ tasks, totalCount: filtered.length, counts, cursor: { next: nextCursor }, nextCursor });
    }
    if (url.includes("/api/work-os/me/insights/synthesize")) return respond({ synthesis: "The range closed six outcomes and carried three items forward.\n\nPlan reliability stayed steady, and the intake queue moved on three of the recorded days.", mode: "ai" });
    if (url.includes("/api/work-os/me/insights")) return respond(insightsFixture);
    if (url.includes("/api/work-os/attendance/observe")) return respond({ changed: false });
    return respond({});
  };
}

if (typeof window !== "undefined") installFetchStub();

export default function WorkOsPreviewClient() {
  const [client] = useState(() => {
    const instance = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    instance.setQueryData(["work-os", "my-day"], todayFixture());
    instance.setQueryData(["work-os", "employee-onboarding"], onboardingFixture);
    return instance;
  });
  return <QueryClientProvider client={client}><PreviewBody /></QueryClientProvider>;
}

const DESTINATIONS = [
  { id: "today", label: "Today", render: () => <EmployeeToday /> },
  { id: "tasks", label: "Tasks", render: () => <EmployeeTasks /> },
  { id: "review", label: "Review", render: () => <EmployeeReview /> },
  { id: "insights", label: "Insights", render: () => <EmployeeInsights /> },
  { id: "settings", label: "Settings", render: () => <EmployeeSettings /> },
] as const;

/** `?voice` renders the check-in composer's voice states on their own;
 * `?voice=<state>` renders just one. The dev harness never hydrates here, so
 * these fixtures are reached through the server render, not by clicking
 * (design §8.8). */
function PreviewBody() {
  const searchParams = useSearchParams();
  const [destination, setDestination] = useState<(typeof DESTINATIONS)[number]["id"]>("today");
  const admin = searchParams.get("admin");
  if (admin) return <AdminPreview section={admin} />;
  if (searchParams.has("workspace-chooser")) {
    return (
      <div data-work-os-workspace="" style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>
        <WorkspaceChooser
          currentOrganizationId="org-1"
          workspaces={[
            { organizationId: "org-1", name: "David Yeboah Workspace", role: "admin", personId: "p-1" },
            { organizationId: "org-2", name: "WrazyAI Owner Workspace", role: "employee", personId: "p-1" },
          ]}
        />
      </div>
    );
  }
  if (searchParams.has("desktop-connect")) {
    const connectWorkspaces = [
      { organizationId: "org-1", name: "David Yeboah Workspace", role: "admin" as const, personId: "p-1" },
      { organizationId: "org-2", name: "WrazyAI Owner Workspace", role: "employee" as const, personId: "p-2" },
    ];
    const workspaces = searchParams.get("connect-workspaces") === "one" ? connectWorkspaces.slice(0, 1) : connectWorkspaces;
    const connectState = searchParams.get("connect-state");
    if (connectState) {
      const status: ConnectStatus = connectState === "authorized" || connectState === "working" || connectState === "error" ? connectState : "idle";
      const props = {
        accountLabel: "David Yeboah",
        workspaces,
        organizationId: "org-1",
        onOrganizationChange: () => undefined,
        requestValid: true,
        requestPresent: true,
        status,
        error: status === "error" ? "Could not authorize this device. The request expired before it reached Work OS." : "",
        callbackUrl: status === "authorized" ? "wrazy-workos://auth?code=preview&state=preview" : null,
        onApprove: () => undefined,
        onOpenCompanion: () => undefined,
        onStartOver: () => undefined,
        onReturnToWorkOs: () => undefined,
      };
      return <DesktopConnectView {...props} />;
    }
    return (
      <DesktopConnect
        challenge={"a".repeat(43)}
        state={"b".repeat(16)}
        redirectUri="wrazy-workos://auth"
        workspaces={workspaces}
        accountLabel="David Yeboah"
      />
    );
  }
  if (searchParams.has("employee-shell")) {
    return (
      <EmployeeWorkspaceShell
        access={{
          role: "employee",
          personId: "preview-person",
          featureFlags: { voice_input: true, loom_updates: true, work_memory: true, screenshot_summaries: true },
          organizationName: "David Yeboah Workspace",
          canSwitchWorkspaces: true,
        }}
      >
        <EmployeeToday />
      </EmployeeWorkspaceShell>
    );
  }
  const multiWorkspace = searchParams.has("multi-workspace");
  const voice = searchParams.get("voice");
  if (voice) {
    const entries = VOICE_FIXTURES[voice] ? [[voice, VOICE_FIXTURES[voice]] as const] : Object.entries(VOICE_FIXTURES);
    return (
      <div style={{ display: "grid", gap: 20, maxWidth: 760, padding: 24 }}>
        <strong style={{ fontSize: 13 }}>Check-in composer voice states</strong>
        {entries.map(([key, fixture]) => (
          <section key={key} style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{fixture.label}</span>
            <div data-voice-fixture={key} style={{ border: "1px solid var(--border)", background: "var(--bg-card)", padding: 16 }}>
              <CheckInComposer
                value={fixture.draft}
                onChange={() => undefined}
                onSend={() => undefined}
                onSnooze={() => undefined}
                busy={false}
                voiceEnabled
                voice={voiceStub(fixture)}
              />
            </div>
          </section>
        ))}
      </div>
    );
  }

  const active = DESTINATIONS.find((item) => item.id === destination) ?? DESTINATIONS[0];
  return (
    <div data-work-os-workspace="" style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 24px 64px" }}>
        <nav aria-label="Preview destination" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
          {DESTINATIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDestination(item.id)}
              aria-current={destination === item.id ? "true" : undefined}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: destination === item.id ? "color-mix(in srgb, var(--accent-deep) 12%, var(--bg-card))" : "var(--bg-card)",
                color: destination === item.id ? "var(--accent-deep)" : "var(--text-secondary)",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <EmployeeWorkspaceProvider
          access={{ role: "employee", personId: "preview-person", featureFlags: { voice_input: true, loom_updates: true, work_memory: true, screenshot_summaries: true }, organizationName: "WrazyAI", canSwitchWorkspaces: multiWorkspace }}
        >
          {active.render()}
        </EmployeeWorkspaceProvider>
      </div>
    </div>
  );
}

interface VoiceFixture {
  label: string;
  state: VoiceState;
  draft: string;
  error?: string;
  receipt?: boolean;
  supported?: boolean;
}

const VOICE_FIXTURES: Record<string, VoiceFixture> = {
  empty: { label: "Empty draft — record takes the send slot", state: "idle", draft: "" },
  typed: { label: "Draft present — send returns", state: "idle", draft: "Shipped the audit fix and picked up the next ticket." },
  requesting: { label: "Requesting the microphone", state: "requesting", draft: "" },
  recording: { label: "Recording", state: "recording", draft: "" },
  transcribing: { label: "Transcribing", state: "transcribing", draft: "" },
  receipt: { label: "Transcribed receipt", state: "idle", draft: "Refined the onboarding copy for the pilot review.", receipt: true },
  permission: { label: "Permission denied", state: "idle", draft: "", error: VOICE_FAILURE_COPY.permission },
  nospeech: { label: "No speech detected", state: "idle", draft: "", error: VOICE_FAILURE_COPY.transcribe },
  unsupported: { label: "Capture unavailable in this browser", state: "idle", draft: "", supported: false },
};

function voiceStub(fixture: VoiceFixture): VoiceInput {
  return {
    state: fixture.state,
    level: fixture.state === "recording" ? 0.62 : 0,
    elapsedMs: fixture.state === "recording" ? 7_400 : 0,
    maxMs: 120_000,
    error: fixture.error ?? null,
    receipt: fixture.receipt ?? false,
    supported: fixture.supported !== false,
    dismissError: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    cancel: () => undefined,
  };
}
