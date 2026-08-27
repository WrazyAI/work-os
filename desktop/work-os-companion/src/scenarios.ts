import type { DayData, DebugOnboardingDetail, DebugScenario, OnboardingData } from "./types";

export const ALL_ONBOARDING_DETAILS: Array<{ key: DebugOnboardingDetail; label: string; owner: "employee" | "manager" }> = [
  { key: "consentProvided", label: "Consent not accepted", owner: "employee" },
  { key: "profileConfirmed", label: "Profile not confirmed", owner: "employee" },
  { key: "timezoneProvided", label: "Timezone not provided", owner: "employee" },
  { key: "scheduleProvided", label: "Schedule not provided", owner: "employee" },
  { key: "notificationsConfigured", label: "Notifications not configured", owner: "employee" },
  { key: "privacyAcknowledged", label: "Privacy notice not acknowledged", owner: "employee" },
  { key: "roleAssigned", label: "Role profile not assigned", owner: "manager" },
  { key: "teamAssigned", label: "Team not assigned", owner: "manager" },
  { key: "managerAssigned", label: "Manager not assigned", owner: "manager" },
  { key: "officialScheduleConfigured", label: "Schedule not approved", owner: "manager" },
];

export const DEFAULT_DEBUG_SCENARIO: DebugScenario = {
  enabled: false,
  syncBypass: false,
  companionForce: null,
  authState: "real",
  onboardingState: "real",
  invalidateOnboardingData: false,
  missingDetails: [],
  dayState: "real",
  niftyFailure: false,
  emptyTasks: false,
  emptyEvidence: false,
  emptyProposals: false,
  queuedUpdates: 0,
};

export const DEBUG_PRESETS: Array<{ id: string; label: string; scenario: Partial<DebugScenario> }> = [
  { id: "first_launch", label: "First launch", scenario: { enabled: true, authState: "unauthenticated", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ALL_ONBOARDING_DETAILS.map((item) => item.key), dayState: "no_shift" } },
  { id: "profile_missing", label: "Incomplete onboarding", scenario: { enabled: true, authState: "real", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ["consentProvided", "profileConfirmed", "timezoneProvided", "scheduleProvided", "notificationsConfigured", "privacyAcknowledged", "roleAssigned", "teamAssigned", "managerAssigned", "officialScheduleConfigured"] } },
  { id: "shift_start", label: "Shift start", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "shift_start" } },
  { id: "explicit_clock_in", label: "Explicit clock-in", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "scheduled" } },
  { id: "provider_failure", label: "Provider outage", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], niftyFailure: true } },
  { id: "eod", label: "EOD review", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "eod" } },
  { id: "offline_playground", label: "Offline playground (no backend)", scenario: { enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in" } },
];

function onboardingFixture(): OnboardingData {
  return {
    policy: { version: "debug-v1", purpose: "Local scenario preview", assurance: "No server data is changed.", dataCategories: [] },
    onboardingRequired: false,
    employeeComplete: true,
    employeeRequirements: {
      consentProvided: true, profileConfirmed: true, timezoneProvided: true,
      scheduleProvided: true, notificationsConfigured: true, screenshotConsentProvided: true, privacyAcknowledged: true,
    },
    managerRequirements: { roleAssigned: true, teamAssigned: true, managerAssigned: true, officialScheduleConfigured: true },
    profile: {
      displayName: "David Z", email: "david@example.com", timezone: "Atlantic/Reykjavik", language: "en", weekStart: 1, timeFormat: "24h",
      schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [{ start: "12:30", end: "13:00" }] },
      notifications: { desktopEnabled: true }, privacy: { screenshotAnalysisConsent: false, sensitiveAppExclusions: [] },
      workPreferences: {
        archetypeId: "engineering", inferredArchetypeId: "engineering", customRoleTitle: "", specialtyIds: ["engineering:frontend"],
        items: [
          { id: "engineering:responsibility:ship", kind: "responsibility", label: "Ship reliable product changes", source: "suggested" },
          { id: "engineering:deliverable:pull-requests", kind: "deliverable", label: "Pull requests", source: "suggested" },
          { id: "engineering:evidence:github", kind: "evidence", label: "GitHub", source: "suggested" },
        ],
        responsibilities: ["Ship reliable product changes", "Review code and unblock delivery"],
        outputTypes: ["code", "pull requests", "reviews", "tests", "deployments", "technical documents", "incident work"],
        evidenceSources: ["nifty", "github"], voiceUpdatesEnabled: true, githubUsername: "david-debug",
      },
    },
    providerPrefill: {
      nifty: { mapped: true, timezone: "Atlantic/Reykjavik", language: "en", team: "Product Engineering", role: "Software Engineer" },
      worktivity: { mapped: true, screenshotsConfigured: true, screenshotsBlurred: true },
    },
    organizationSetup: {
      roleProfile: { id: "debug-engineer", slug: "engineer", name: "Software Engineer" },
      teams: [{ id: "debug-team", name: "Product Engineering", active: true }],
      managers: [{ id: "debug-manager", display_name: "Engineering reviewer" }],
      officialSchedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [{ start: "12:30", end: "13:00" }] },
    },
    status: "complete", submittedAt: new Date().toISOString(),
    draft: { step: "connected", updatedAt: new Date().toISOString(), revision: 1 },
    breakPolicy: { worktivityAuthoritative: false },
    screenshotPolicy: { retention: "30 day encrypted retention", limitation: "Not a productivity signal", sensitiveCapture: "Sensitive captures are deleted" },
    catalog: { version: "debug", archetypes: [
      { id: "engineering", name: "Engineering", description: "Build and operate reliable software systems.", keywords: [], specialties: [{ id: "engineering:frontend", name: "Frontend" }], items: [
        { id: "engineering:responsibility:ship", kind: "responsibility", label: "Ship reliable product changes", source: "suggested" },
        { id: "engineering:deliverable:pull-requests", kind: "deliverable", label: "Pull requests", source: "suggested" },
        { id: "engineering:evidence:github", kind: "evidence", label: "GitHub", source: "suggested" },
      ] },
      { id: "custom", name: "Something else", description: "Describe your work.", keywords: [], specialties: [], items: [] },
    ] },
  };
}

function dayFixture(): DayData {
  const now = new Date();
  const shift = debugShift("clocked_in");
  return {
    at: now.toISOString(), shiftDate: now.toISOString().slice(0, 10), shift,
    prompt: { kind: "optional", nextPromptAt: new Date(now.getTime() + 45 * 60_000).toISOString(), required: false, reason: "Optional hourly check-in." },
    niftySync: { fresh: true, syncedAt: now.toISOString() },
    tasks: [
      { id: "debug-task-1", title: "Complete the Work OS Phase 1 runtime", completed: false },
      { id: "debug-task-2", title: "Review desktop recovery states", completed: false },
    ],
    evidence: [{ id: "debug-evidence", source: "github", title: "Desktop build verified", summary: "Windows GUI artifact passed packaging checks.", occurred_at: now.toISOString() }],
    proposals: [{ id: "debug-proposal", operation: "progress_update", proposed_change: { summary: "Phase 1 runtime is ready for review" }, input_text: "Finished the runtime flow.", status: "pending" }],
    report: null,
    session: {
      id: "debug-clocked-in", state: "active", scheduled_starts_at: shift.startsAt, scheduled_ends_at: shift.endsAt,
      clocked_in_at: shift.startsAt, clocked_out_at: null, paused_seconds: 0,
    },
    plan: {
      id: "debug-plan", shift_date: now.toISOString().slice(0, 10), revision: 1, status: "confirmed", freeform_intent: "Ship a dependable Phase 1 workday loop.",
      items: [
        { id: "debug-plan-1", task_id: "debug-task-1", source: "carry_over", disposition: "selected", rank: 0, title_snapshot: "Complete the Work OS Phase 1 runtime", blocker: null, item_kind: "nifty_task", completion_state: "open" },
        { id: "debug-plan-2", task_id: "debug-task-2", source: "due_today", disposition: "selected", rank: 1, title_snapshot: "Review desktop recovery states", blocker: null, item_kind: "nifty_task", completion_state: "open" },
      ],
    },
    attendance: { source: "worktivity", state: "active", status: "working", observedAt: now.toISOString(), clockedInAt: shift.startsAt, clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Worktivity activity observed; Work OS clock-in is explicit." },
  };
}

export function applyOnboardingScenario(data: OnboardingData | null, scenario: DebugScenario): OnboardingData | null {
  if (!scenario.enabled) return data;
  data ??= onboardingFixture();
  if (scenario.onboardingState === "real") return data;
  const employeeRequirements = { ...data.employeeRequirements };
  const managerRequirements = { ...data.managerRequirements };
  if (scenario.onboardingState === "complete") {
    for (const key of Object.keys(employeeRequirements) as Array<keyof typeof employeeRequirements>) employeeRequirements[key] = true;
    for (const key of Object.keys(managerRequirements) as Array<keyof typeof managerRequirements>) managerRequirements[key] = true;
  } else {
    for (const key of Object.keys(employeeRequirements) as Array<keyof typeof employeeRequirements>) employeeRequirements[key] = !scenario.missingDetails.includes(key);
    for (const key of Object.keys(managerRequirements) as Array<keyof typeof managerRequirements>) managerRequirements[key] = !scenario.missingDetails.includes(key);
  }
  const employeeComplete = Object.values(employeeRequirements).every(Boolean);
  const profile = scenario.invalidateOnboardingData ? {
    ...data.profile,
    displayName: "",
    timezone: "",
    schedule: { daysOfWeek: [], shiftStart: "", shiftEnd: "", breaks: [] },
    notifications: { desktopEnabled: true },
    privacy: { screenshotAnalysisConsent: false, sensitiveAppExclusions: [] },
  } : data.profile;
  return { ...data, profile, employeeRequirements, managerRequirements, employeeComplete, onboardingRequired: !employeeComplete };
}

function debugShift(kind: Exclude<DebugScenario["dayState"], "real" | "no_shift">) {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 30 * 60_000);
  const endsAt = new Date(now.getTime() + (kind === "eod_due" ? 5 : kind === "eod" ? 10 : kind === "final_hour" ? 40 : 7 * 60) * 60_000);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", breaks: [] };
}

export function applyDayScenario(data: DayData | null, scenario: DebugScenario): DayData | null {
  if (!scenario.enabled) return data;
  data ??= dayFixture();
  let result: DayData = {
    ...data,
    tasks: scenario.emptyTasks ? [] : data.tasks,
    evidence: scenario.emptyEvidence ? [] : data.evidence,
    proposals: scenario.emptyProposals ? [] : data.proposals,
    niftySync: scenario.niftyFailure ? { fresh: false, syncedAt: data.niftySync?.syncedAt ?? null, error: "Simulated Nifty provider failure" } : data.niftySync,
  };
  if (scenario.dayState === "no_shift") result = { ...result, shift: null, prompt: { kind: null, nextPromptAt: null, required: false, reason: "No scheduled shift." } };
  if (scenario.dayState !== "real" && scenario.dayState !== "no_shift") {
    const kind = scenario.dayState;
    const prompt = kind === "scheduled" || kind === "shift_start"
      ? { kind: "plan" as const, required: true, reason: "Shift has started." }
      : kind === "catch_up"
        ? { kind: "catch_up" as const, required: true, reason: "No valid plan was recorded in the first hour." }
        : kind === "clocked_in"
          ? { kind: "plan" as const, required: true, reason: "Confirm the plan for this clocked-in session." }
          : kind === "optional" || kind === "paused"
          ? { kind: "optional" as const, required: false, reason: "Optional hourly check-in." }
          : kind === "final_hour"
            ? { kind: null, required: false, reason: "Final-hour planning suppression." }
            : { kind: "eod" as const, required: true, reason: "Review your end-of-day draft." };
    const shift = debugShift(kind);
    const sessionState = kind === "paused" ? "paused" : kind === "clocked_out" ? "clocked_out" : kind === "scheduled" || kind === "shift_start" ? null : kind === "clocked_in" ? "clocked_in" : kind === "eod_due" || kind === "eod" ? "eod_due" : "active";
    result = {
      ...result,
      shift,
      session: sessionState ? {
        id: `debug-${kind}`, state: sessionState, scheduled_starts_at: shift.startsAt, scheduled_ends_at: shift.endsAt,
        clocked_in_at: shift.startsAt, clocked_out_at: kind === "clocked_out" ? new Date().toISOString() : null, paused_seconds: kind === "paused" ? 900 : 0,
      } : null,
      plan: sessionState ? { ...result.plan!, status: sessionState === "clocked_in" ? "draft" : result.plan?.status ?? "draft" } : null,
      prompt: kind === "clocked_out" ? { kind: null, required: false, reason: "Shift ended.", nextPromptAt: null } : { ...prompt, nextPromptAt: null },
    };
  }
  return result;
}
