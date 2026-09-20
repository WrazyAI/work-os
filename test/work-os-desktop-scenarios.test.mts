import assert from "node:assert/strict";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO } from "../desktop/work-os-companion/src/scenarios";
import type { DayData, OnboardingData } from "../desktop/work-os-companion/src/types";

const onboarding = {
  onboardingRequired: false,
  employeeComplete: true,
  employeeRequirements: {
    consentProvided: true, profileConfirmed: true, timezoneProvided: true,
    scheduleProvided: true, notificationsConfigured: true, privacyAcknowledged: true,
  },
  managerRequirements: { roleAssigned: true, teamAssigned: true, managerAssigned: true, officialScheduleConfigured: true },
} as OnboardingData;
const missing = applyOnboardingScenario(onboarding, {
  ...DEFAULT_DEBUG_SCENARIO,
  enabled: true,
  onboardingState: "missing",
  missingDetails: ["consentProvided", "officialScheduleConfigured"],
});
assert.equal(missing?.onboardingRequired, true);
assert.equal(missing?.employeeRequirements.consentProvided, false);
assert.equal(missing?.managerRequirements.officialScheduleConfigured, false);
assert.equal(onboarding.employeeRequirements.consentProvided, true, "debug overrides must not mutate server state");

const invalidated = applyOnboardingScenario({
  ...onboarding,
  profile: {
    displayName: "Jamie", email: "jamie@example.com", avatarUrl: null, timezone: "Africa/Accra", language: "en", weekStart: 1, timeFormat: "24h",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [] },
    notifications: { desktopEnabled: true }, privacy: { screenshotAnalysisConsent: true, sensitiveAppExclusions: ["private.example"] },
    workPreferences: {
      archetypeId: null, inferredArchetypeId: null, customRoleTitle: "", specialtyIds: [], items: [],
      responsibilities: [], outputTypes: [], evidenceSources: ["Nifty"], voiceUpdatesEnabled: false, githubUsername: "",
    },
  },
}, {
  ...DEFAULT_DEBUG_SCENARIO,
  enabled: true,
  onboardingState: "missing",
  invalidateOnboardingData: true,
  missingDetails: ["profileConfirmed", "timezoneProvided", "scheduleProvided"],
});
assert.equal(invalidated?.profile.displayName, "");
assert.equal(invalidated?.profile.timezone, "");
assert.deepEqual(invalidated?.profile.schedule.daysOfWeek, []);
assert.equal(invalidated?.profile.privacy.screenshotAnalysisConsent, false);

const day = {
  at: new Date().toISOString(), shiftDate: "2026-07-13", shift: null,
  prompt: { kind: null, nextPromptAt: null, required: false, reason: "No shift" },
  niftySync: { fresh: true, syncedAt: new Date().toISOString() },
  tasks: [{ id: "task-1" }], evidence: [{ id: "evidence-1" }], proposals: [{ id: "proposal-1" }], report: null, session: null, plan: null,
} as DayData;
const eod = applyDayScenario(day, {
  ...DEFAULT_DEBUG_SCENARIO,
  enabled: true,
  dayState: "eod",
  niftyFailure: true,
  emptyTasks: true,
});
assert.equal(eod?.prompt.kind, "eod");
assert.equal(eod?.prompt.required, true);
assert.equal(eod?.tasks.length, 0);
assert.match(eod?.niftySync?.error ?? "", /Simulated/);

const paused = applyDayScenario(day, { ...DEFAULT_DEBUG_SCENARIO, enabled: true, dayState: "paused" });
assert.equal(paused?.session?.state, "paused");
const clockedOut = applyDayScenario(day, { ...DEFAULT_DEBUG_SCENARIO, enabled: true, dayState: "clocked_out" });
assert.equal(clockedOut?.session?.state, "clocked_out");
assert.equal(clockedOut?.prompt.kind, null);
const shiftStart = applyDayScenario(day, { ...DEFAULT_DEBUG_SCENARIO, enabled: true, dayState: "shift_start" });
assert.equal(shiftStart?.session, null);
assert.equal(shiftStart?.plan, null);
assert.equal(shiftStart?.prompt.kind, "plan");
assert.equal(shiftStart?.prompt.required, true);
assert.equal(day.tasks.length, 1, "debug day overrides must not mutate server state");

console.log("Work OS desktop scenario tests passed.");
