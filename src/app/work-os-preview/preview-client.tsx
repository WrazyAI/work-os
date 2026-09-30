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
import { CheckInComposer } from "@/modules/work-os/CheckInComposer";
import { VOICE_FAILURE_COPY, type VoiceInput, type VoiceState } from "@/modules/work-os/useVoiceInput";

const TODAY = "2026-09-11";

const workspace = (date: string, goal: string) => ({
  date,
  readOnly: date !== TODAY,
  completed: 3,
  total: 9,
  overdueCount: 1,
  goal: { text: goal, provenance: "employee", revision: 1 },
  carryOverGroups: [{ key: "older", label: "Older", tasks: [{ id: "carry-1" }, { id: "carry-2" }] }],
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
  prompt: { kind: "eod", nextPromptAt: `${TODAY}T17:30:00.000Z`, required: false, reason: "Wrap up the day with your EOD report." },
  report: { id: "report-today", status: "draft", markdown: "## Summary\nOutlined the review flow and drafted the employee workspace routes." },
  tasks: dayTasks,
  evidence: [
    { id: "ev-1", title: "Worktivity interval · 10:00–11:00", summary: "Reconciled settlement rows in the ledger and updated the operations sheet.", source: "screenshot", evidence_event_id: "event-1", event: { correction_status: "original" } },
    { id: "ev-2", title: "Loom recording — settlement walkthrough", summary: "Walked through the reconciliation steps and the open edge cases.", source: "loom", url: "https://www.loom.com/share/preview", evidence_event_id: null, event: null },
  ],
  proposals: [
    { id: "proposal-1", operation: "task_update", status: "pending", input_text: "Mark the provider export as done", proposed_change: { progress: "Completed the provider export and started the ledger match." }, task: { title: "Pull the provider export" }, before_state: null, failure_reason: null },
  ],
  session: { id: "session-today", state: "clocked_in" },
  attendance: { source: "worktivity", state: "active", status: "working", observedAt: `${TODAY}T11:42:00.000Z`, clockedInAt: `${TODAY}T09:04:00.000Z`, clockedOutAt: null, stale: false, message: "Worktivity activity observed; the Work OS workday is synchronized." },
});

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
    { date: "2026-09-10", goal: { text: "Finish the settlement reconciliation.", provenance: "employee" }, completed: 7, progressed: 2, deferred: 1, carried: 1, unplanned: 0, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [] },
    { date: "2026-09-09", goal: { text: "Clear the intake queue.", provenance: "employee" }, completed: 5, progressed: 3, deferred: 0, carried: 2, unplanned: 1, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [{ id: "r1", label: "Intake review", target: "/work-os/tasks" }] },
    { date: TODAY, goal: { text: "Ship the outstanding EOD flow.", provenance: "employee" }, completed: 3, progressed: 1, deferred: 0, carried: 0, unplanned: 0, breakFreshness: "fresh", sessionQuality: { status: "valid", message: null }, references: [] },
  ],
  brief: { summary: "A steady week: the settlement work closed and the intake queue moved. Two carry-over items remain from older work.", wins: ["Settlement reconciliation finished", "Intake backlog reduced"], attention: ["Two older carry-over items are still open"], nextFocus: ["Draft the EOD before the shift ends"] },
  freshness: { stale: false, staleAt: null, error: null },
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
  window.fetch = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/work-os/me/onboarding")) return respond(onboardingFixture);
    if (url.includes("/api/work-os/me/eod/outstanding")) return respond(outstandingFixture);
    if (url.includes("/api/work-os/me/day?date=2026-09-03")) return respond(rejectedFixture("2026-09-03"));
    if (url.includes("/api/work-os/me/day?date=2026-09-10")) return respond(historyFixture("2026-09-10", "Finish the settlement reconciliation."));
    if (url.includes("/api/work-os/me/day")) return respond(todayFixture());
    if (url.includes("/api/work-os/me/tasks?view=day")) return respond({ tasks: dayTasks, workspace: workspace(TODAY, "Ship the outstanding EOD flow."), cursor: { next: null } });
    if (url.includes("/api/work-os/me/tasks?view=open")) return respond({ tasks: dayTasks.filter((task) => !task.completed), counts: { total: 2, open: 2, completed: 0 } });
    if (url.includes("/api/work-os/me/tasks?view=history")) return respond({ tasks: [dayTasks[2]], nextOffset: null });
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
  const voice = useSearchParams().get("voice");
  const [destination, setDestination] = useState<(typeof DESTINATIONS)[number]["id"]>("today");

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
        <nav aria-label="Preview destination" style={{ display: "flex", gap: 6, marginBottom: 20 }}>
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
        {active.render()}
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
