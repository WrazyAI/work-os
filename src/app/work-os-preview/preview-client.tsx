"use client";

// Dev-only rendered-QA fixture for the employee EOD outstanding surface
// (design.md §29.1c, §32.2). The proxy exposes it only when NODE_ENV is not
// production; it stubs the Work OS read endpoints so the real component can be
// exercised without a live session.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EmployeeWorkOsHome from "@/modules/work-os/EmployeeWorkOsHome";
import { CheckInComposer } from "@/modules/work-os/CheckInComposer";
import { VOICE_FAILURE_COPY, type VoiceInput, type VoiceState } from "@/modules/work-os/useVoiceInput";

const TODAY = "2026-09-11";

const workspace = (date: string, goal: string) => ({
  date,
  readOnly: date !== TODAY,
  completed: 0,
  total: 0,
  overdueCount: 0,
  goal: { text: goal, provenance: "employee", revision: 1 },
  carryOverGroups: [],
  sessionQuality: { status: "valid", message: null },
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
  prompt: { kind: "eod", nextPromptAt: null, required: false, reason: "Wrap up the day with your EOD report." },
  report: null,
  session: { id: "session-today", state: "clocked_out" },
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
    privacy: { sensitiveAppExclusions: [] },
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
  if (typeof window === "undefined" || (window as unknown as { __eodPreviewStub?: boolean }).__eodPreviewStub) return;
  (window as unknown as { __eodPreviewStub?: boolean }).__eodPreviewStub = true;
  const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  window.fetch = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/work-os/me/onboarding")) return respond(onboardingFixture);
    if (url.includes("/api/work-os/me/eod/outstanding")) return respond(outstandingFixture);
    if (url.includes("/api/work-os/me/day?date=2026-09-03")) return respond(rejectedFixture("2026-09-03"));
    if (url.includes("/api/work-os/me/day?date=2026-09-10")) return respond(historyFixture("2026-09-10", "Finish the settlement reconciliation."));
    if (url.includes("/api/work-os/me/day")) return respond(todayFixture());
    if (url.includes("/api/work-os/me/tasks?view=day&date=2026-09-03")) return respond({ tasks: [], workspace: workspace("2026-09-03", "Close the settlement reconciliation."), cursor: { next: null } });
    if (url.includes("/api/work-os/me/tasks?view=day&date=2026-09-10")) return respond({ tasks: [], workspace: workspace("2026-09-10", "Finish the settlement reconciliation."), cursor: { next: null } });
    if (url.includes("/api/work-os/me/insights")) return respond({ range: "7d", from: "2026-09-04", through: "2026-09-10", days: [], brief: { summary: "Preview fixture.", wins: [], attention: [], nextFocus: [] }, freshness: { stale: false, staleAt: null, error: null } });
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

/** `?voice` renders the check-in composer's voice states on their own;
 * `?voice=<state>` renders just one. The dev harness never hydrates here, so
 * these fixtures are reached through the server render, not by clicking
 * (design §8.8). */
function PreviewBody() {
  const voice = useSearchParams().get("voice");
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
  return <EmployeeWorkOsHome />;
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
