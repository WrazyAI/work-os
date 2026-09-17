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
  liveWrites: false,
  enabled: false,
  syncBypass: false,
  companionForce: null,
  planningState: null,
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

/** Canonical shape for comparing two scenarios: keys sorted, array order ignored. */
function canonicalScenario(scenario: DebugScenario): string {
  const entries = Object.entries(scenario)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const);
  return JSON.stringify(entries);
}

export function presetScenarioMatches(preset: { scenario: Partial<DebugScenario> }, scenario: DebugScenario): boolean {
  return canonicalScenario({ ...DEFAULT_DEBUG_SCENARIO, ...preset.scenario }) === canonicalScenario(scenario);
}

/** The preset a scenario was loaded from, or null once any override was touched. */
export function activePresetId(scenario: DebugScenario): string | null {
  if (!scenario.enabled) return null;
  return DEBUG_PRESETS.find((preset) => presetScenarioMatches(preset, scenario))?.id ?? null;
}

export const DEBUG_PRESETS: Array<{ id: string; label: string; description: string; scenario: Partial<DebugScenario> }> = [
  { id: "first_launch", label: "First launch", description: "Signed out with no profile: onboarding from the very start.", scenario: { enabled: true, authState: "unauthenticated", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ALL_ONBOARDING_DETAILS.map((item) => item.key), dayState: "no_shift" } },
  { id: "profile_missing", label: "Incomplete onboarding", description: "Signed in, but onboarding re-asks the employee-owned details.", scenario: { enabled: true, authState: "real", onboardingState: "missing", invalidateOnboardingData: true, missingDetails: ["consentProvided", "profileConfirmed", "timezoneProvided", "scheduleProvided", "notificationsConfigured", "privacyAcknowledged", "roleAssigned", "teamAssigned", "managerAssigned", "officialScheduleConfigured"] } },
  { id: "shift_start", label: "Shift start", description: "Shift begins: clock-in is required before the day opens.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "shift_start" } },
  { id: "planning_required", label: "Planning required", description: "Clocked in with the plan gate open until commitments are confirmed.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in", planningState: "required" } },
  { id: "planning_ai_unavailable", label: "Planning AI unavailable", description: "The planning assistant fails and the deterministic draft takes over.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in", planningState: "ai_unavailable" } },
  { id: "planning_conflict", label: "Planning conflict", description: "A plan revision conflict, to exercise the resolve path.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in", planningState: "conflict" } },
  { id: "planning_offline", label: "Planning offline queue", description: "Plan drafts queue on this device instead of reaching the server.", scenario: { enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in", planningState: "offline" } },
  { id: "explicit_clock_in", label: "Explicit clock-in", description: "A scheduled shift that waits for an explicit clock-in.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "scheduled" } },
  { id: "provider_failure", label: "Provider outage", description: "Nifty sync fails, so degraded provider states are visible.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], niftyFailure: true } },
  { id: "eod", label: "EOD review", description: "End of day: the EOD review is due.", scenario: { enabled: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "eod" } },
  { id: "offline_playground", label: "Offline playground (no backend)", description: "Fixtures only: never contacts the backend, writes stay here.", scenario: { enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", invalidateOnboardingData: false, missingDetails: [], dayState: "clocked_in" } },
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
      // Row-shape coverage for the Tasks workspace layout: a long surfaced row
      // with assignee, subtasks, due date, and description; a plain row; and an
      // overdue row. The surfaced rows come from the plan's selected items.
      {
        id: "debug-task-1",
        title: "Complete the Work OS Phase 1 runtime and document the release checklist for the desktop companion",
        completed: false,
        due_date: new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10),
        description: "Move Chat/Tasks into the shell so the expanded companion stops reading as bloated, and keep the composer clear of the last row.",
        assignees: [{ personId: "debug-person-1", displayName: "David Z", email: "david@example.test" }],
        subtaskProgress: { total: 3, completed: 1 },
      },
      { id: "debug-task-2", title: "Review desktop recovery states", completed: false, description: "Confirm the recovery copy matches the provider's actual state." },
      { id: "debug-task-overdue", title: "Fix the flaky screenshot upload", completed: false, due_date: "2026-08-26" },
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
  if (scenario.dayState === "no_shift") result = { ...result, shift: null, session: null, prompt: { kind: null, nextPromptAt: null, required: false, reason: "No scheduled shift." } };
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
  if (scenario.dayState === "eod" || scenario.dayState === "eod_due") {
    result = {
      ...result,
      report: {
        id: "debug-report-eod", status: "draft", report_date: result.shiftDate,
        markdown: ["# EOD Report: David Z (scenario)", "", "## Summary", "Worked on the debugger fix and desktop recovery states.", "", "## Completed", "- Reviewed desktop recovery states", "", "## Carried forward", "- Complete the Work OS Phase 1 runtime", "", "## Bottleneck", "(needs your input — what prevented you from completing your task list?)"].join("\n"),
      },
    };
  }
  if (scenario.planningState === "required" && result.plan && result.session) {
    result = { ...result, plan: { ...result.plan, status: "draft" }, prompt: { kind: "plan", required: true, reason: "Planning review is required before follow-up prompts.", nextPromptAt: null } };
  }
  return result;
}

/**
 * Offline insights record: computed from the scenario day fixture so the
 * Insights page never dead-ends without a backend (phase plan §7). The
 * brief is explicitly labeled as an on-device fallback — the server's
 * deterministic brief replaces it the moment a real fetch succeeds.
 */
export function insightsFixture(day: DayData, range: "day" | "7d" | "30d"): import("./types").InsightsData {
  const shiftDate = day.shiftDate;
  const session = day.session;
  const clockedIn = session?.clocked_in_at ? Date.parse(session.clocked_in_at) : Number.NaN;
  const clockedOut = session?.clocked_out_at ? Date.parse(session.clocked_out_at) : Number.NaN;
  const end = Number.isFinite(clockedOut) ? clockedOut : Number.isFinite(clockedIn) ? Date.now() : Number.NaN;
  const observedSeconds = Number.isFinite(clockedIn) && Number.isFinite(end) ? Math.max(0, Math.floor((end - clockedIn) / 1000)) : 0;
  const tasks = day.tasks ?? [];
  const plannedCompleted = tasks.filter((task) => task.completed === true).length;
  const planned = tasks.length;
  const open = planned - plannedCompleted;
  const count = range === "day" ? 1 : range === "7d" ? 7 : 30;
  const shiftDateIso = (offset: number) => {
    const parsed = new Date(`${shiftDate}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return shiftDate;
    parsed.setUTCDate(parsed.getUTCDate() - offset);
    return parsed.toISOString().slice(0, 10);
  };
  const buildDay = (offset: number, scale: number): import("./types").InsightDay => {
    const date = shiftDateIso(offset);
    const isToday = offset === 0;
    const seed = (offset * 7 + 3) % 11;
    const dayObserved = isToday ? observedSeconds : Math.round(21600 * scale * (0.55 + ((offset * 13) % 45) / 100));
    const dayPlanned = isToday ? planned : 3 + (seed % 4);
    const dayCompleted = isToday ? plannedCompleted : Math.min(dayPlanned, (seed + offset) % (dayPlanned + 1));
    const dayOutcomes = isToday ? plannedCompleted : Math.max(0, dayCompleted + ((offset % 3 === 0) ? 1 : 0));
    const onTime = Math.max(0, dayOutcomes - (offset % 4 === 0 ? 1 : 0));
    const late = Math.max(0, dayOutcomes - onTime);
    const updates = isToday ? (Number(day.signals?.employeeUpdates ?? 0)) : (offset * 3) % 5;
    const blocked = offset % 5 === 2 ? 1 : 0;
    return {
      date,
      observedSeconds: dayObserved,
      pausedSeconds: Math.round(dayObserved * 0.08),
      pauseRatio: 0.08,
      planStatus: isToday ? ((day.plan?.status as "none" | "draft" | "confirmed" | "closed") ?? "none") : "confirmed",
      planned: dayPlanned,
      plannedCompleted: dayCompleted,
      carryOver: offset % 6 === 1 ? 2 : 0,
      overdue: offset % 7 === 3 ? 1 : 0,
      updates,
      updatesByKind: {
        progress: Math.max(0, updates - (blocked ? 1 : 0) - (offset % 3 === 1 ? 1 : 0)),
        starting: offset % 4 === 0 ? 1 : 0,
        completionClaim: offset % 3 === 1 ? 1 : 0,
        blocked,
        priorityChange: offset % 8 === 5 ? 1 : 0,
        unplannedWork: offset % 6 === 4 ? 1 : 0,
      },
      outputEvidence: isToday ? (day.evidence ?? []).length : (offset % 3 === 0 ? 2 : 1),
      activityContext: isToday && day.attendance ? 1 : offset % 2 === 0 ? 1 : 0,
      trackedMinutes: isToday ? 0 : Math.round(120 * scale * (0.4 + ((offset * 17) % 60) / 100)),
      topApps: [
        { name: "Figma", minutes: Math.round(60 * scale * (0.5 + ((offset * 5) % 40) / 100)) },
        { name: "Chrome", minutes: Math.round(45 * scale * (0.4 + ((offset * 9) % 35) / 100)) },
        { name: "Slack", minutes: Math.round(25 * scale) },
      ],
      tasksCompleted: dayOutcomes,
      tasksOpen: Math.max(0, dayPlanned - dayCompleted),
      goal: isToday
        ? { text: day.plan?.focus_summary ?? day.plan?.freeform_intent ?? null, provenance: day.plan?.goal_provenance ?? null }
        : { text: offset % 3 === 0 ? null : "Ship the client milestone", provenance: offset % 3 === 1 ? "ai_draft" : "employee" },
      goalSet: isToday ? Boolean(day.plan?.freeform_intent || day.plan?.focus_summary) : offset % 3 !== 0,
      completed: dayOutcomes,
      progressed: Math.max(0, updates - 1),
      deferred: offset % 6 === 2 ? 1 : 0,
      carried: offset % 6 === 1 ? 2 : 0,
      unplanned: offset % 5 === 1 ? 1 : 0,
      outcomesOnTime: onTime,
      outcomesLate: late,
      sessionCorrections: offset % 9 === 4 ? 1 : 0,
      planAdherence: { selected: dayPlanned, selectedCompleted: dayCompleted, deferred: offset % 6 === 2 ? 1 : 0, removalProposed: 0 },
      sessionQuality: offset % 9 === 4
        ? { status: "needs_correction", message: "Session end was not observed.", sessionId: `fixture-session-${date}` }
        : { status: "valid", message: null },
      references: isToday
        ? [
            ...(day.plan
              ? [{ type: "plan" as const, id: `plan-${date}`, date, label: day.plan.focus_summary ?? day.plan.freeform_intent ?? "Daily workspace", target: date }]
              : []),
            ...(day.tasks ?? []).map((task) => ({ type: "task" as const, id: String(task.task_id ?? task.id), date, label: String(task.title ?? task.title_snapshot ?? "Task"), target: String(task.id ?? "") })),
            ...(day.evidence ?? []).map((item) => ({ type: "evidence" as const, id: String(item.id), date, label: String(item.title ?? "Output evidence"), target: String(item.id) })),
          ]
        : [],
    };
  };
  const days = Array.from({ length: count }, (_, index) => buildDay(count - 1 - index, 1));
  const previousDays = Array.from({ length: count }, (_, index) => buildDay(count - 1 - index + count, 0.75));
  const sum = (rows: import("./types").InsightDay[], key: keyof import("./types").InsightDay) =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const totalsOf = (rows: import("./types").InsightDay[]) => ({
    observedSeconds: sum(rows, "observedSeconds"),
    pausedSeconds: sum(rows, "pausedSeconds"),
    planned: sum(rows, "planned"),
    plannedCompleted: sum(rows, "plannedCompleted"),
    carryOver: sum(rows, "carryOver"),
    overdue: sum(rows, "overdue"),
    updates: sum(rows, "updates"),
    outputEvidence: sum(rows, "outputEvidence"),
    activityContext: sum(rows, "activityContext"),
    trackedMinutes: sum(rows, "trackedMinutes"),
    tasksCompleted: sum(rows, "tasksCompleted"),
    tasksOpen: sum(rows, "tasksOpen"),
    completed: sum(rows, "completed"),
    progressed: sum(rows, "progressed"),
    deferred: sum(rows, "deferred"),
    carried: sum(rows, "carried"),
    unplanned: sum(rows, "unplanned"),
    outcomesOnTime: sum(rows, "outcomesOnTime"),
    outcomesLate: sum(rows, "outcomesLate"),
    sessionCorrections: sum(rows, "sessionCorrections"),
  });
  const totals = totalsOf(days);
  const updateKinds = days.reduce(
    (acc, row) => {
      const kinds = row.updatesByKind;
      if (!kinds) return acc;
      acc.progress += kinds.progress; acc.starting += kinds.starting; acc.completionClaim += kinds.completionClaim;
      acc.blocked += kinds.blocked; acc.priorityChange += kinds.priorityChange; acc.unplannedWork += kinds.unplannedWork;
      return acc;
    },
    { progress: 0, starting: 0, completionClaim: 0, blocked: 0, priorityChange: 0, unplannedWork: 0 },
  );
  const consistency = {
    dayCount: days.length,
    daysWithGoal: days.filter((row) => row.goalSet === true).length,
    daysWithUpdate: days.filter((row) => Number(row.updates ?? 0) > 0).length,
    daysWithCompletion: days.filter((row) => Number(row.tasksCompleted ?? 0) > 0).length,
    currentStreak: (() => { let streak = 0; for (let index = days.length - 1; index >= 0; index -= 1) { const row = days[index]; if (Number(row.tasksCompleted ?? 0) > 0 || Number(row.updates ?? 0) > 0) streak += 1; else break; } return streak; })(),
    commitmentRate: totals.planned ? Math.round((totals.plannedCompleted / totals.planned) * 100) : null,
    bestDay: days.reduce<{ date: string; tasksCompleted: number } | null>((best, row) => (!best || row.tasksCompleted > best.tasksCompleted ? { date: row.date, tasksCompleted: row.tasksCompleted } : best), null),
  };
  return {
    range,
    from: days[0]?.date ?? shiftDate,
    through: shiftDate,
    days,
    totals,
    updateKinds,
    consistency,
    comparison: { range, from: previousDays[0]?.date ?? shiftDate, through: previousDays.at(-1)?.date ?? shiftDate, days: previousDays, totals: totalsOf(previousDays) },
    brief: {
      generated: false,
      summary: `Offline record — ${open ? `${open} task${open === 1 ? "" : "s"} still open.` : "Everything on today's plate is complete."}`,
      wins: plannedCompleted ? [`${plannedCompleted} task${plannedCompleted === 1 ? "" : "s"} completed today.`] : [],
      attention: open ? [`${open} open task${open === 1 ? "" : "s"} carry forward.`] : [],
      nextFocus: open ? ["Close out the remaining tasks when you are back online."] : [],
      referenceIds: [],
    },
    freshness: { niftySyncedAt: null, worktivityObservedAt: null, stale: true, staleAt: new Date().toISOString(), error: "Offline playground — on-device record" },
  };
}
