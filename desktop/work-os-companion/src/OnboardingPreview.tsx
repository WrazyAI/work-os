import Onboarding from "./Onboarding";
import type { OnboardingData } from "./types";

export const PREVIEW_DATA: OnboardingData = {
  onboardingRequired: true,
  policy: {
    version: "work-tracking-v1",
    purpose: "WrazyOS stores this information only to schedule work prompts, attribute approved work evidence, and prepare employee-reviewable reports.",
    assurance: "It is not used outside Work OS work tracking, and activity evidence alone does not establish productivity or task completion.",
    dataCategories: ["Work identity", "Schedule", "Task and evidence links", "Notification and privacy preferences"],
  },
  profile: {
    displayName: "Jamie Mensah",
    email: "jamie@wrazy.com",
    avatarUrl: null,
    timezone: "Africa/Accra",
    language: "en",
    weekStart: 1,
    timeFormat: "24h",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [{ start: "12:30", end: "13:00" }] },
    notifications: { desktopEnabled: true },
    privacy: { screenshotAnalysisConsent: false, sensitiveAppExclusions: ["1password.com"] },
    workPreferences: { archetypeId: "engineering", inferredArchetypeId: "engineering", customRoleTitle: "", specialtyIds: ["engineering:frontend"], items: [{ id: "engineering:responsibility:product-engineering", kind: "responsibility", label: "Product engineering", source: "suggested" }], responsibilities: ["Product engineering"], outputTypes: ["Pull requests"], evidenceSources: ["Nifty", "GitHub"], voiceUpdatesEnabled: true, githubUsername: "jamie" },
  },
  providerPrefill: {
    nifty: { mapped: true, timezone: "Africa/Accra", language: "en", team: "Product Engineering", role: "Developer" },
    worktivity: { mapped: true, screenshotsConfigured: true, screenshotsBlurred: true },
  },
  employeeRequirements: {
    consentProvided: false,
    profileConfirmed: false,
    timezoneProvided: false,
    scheduleProvided: false,
    notificationsConfigured: false,
    screenshotConsentProvided: false,
    privacyAcknowledged: false,
  },
  managerRequirements: {
    roleAssigned: true,
    teamAssigned: true,
    managerAssigned: true,
    officialScheduleConfigured: false,
  },
  organizationSetup: {
    roleProfile: { id: "role-preview", slug: "developer", name: "Developer" },
    teams: [{ id: "team-preview", name: "Product Engineering", active: true }],
    managers: [{ id: "manager-preview", display_name: "Alex Morgan" }],
    officialSchedule: null,
  },
  employeeComplete: false,
  status: "not_started",
  submittedAt: null,
  draft: { step: "seen", updatedAt: null, revision: 1 },
  breakPolicy: { worktivityAuthoritative: true },
  screenshotPolicy: { retention: "30 day encrypted retention", limitation: "Not a productivity signal", sensitiveCapture: "Sensitive captures are deleted" },
  catalog: { version: "preview", archetypes: [{ id: "engineering", name: "Engineering", description: "Build reliable software.", keywords: [], specialties: [{ id: "engineering:frontend", name: "Frontend" }], items: [{ id: "engineering:responsibility:product-engineering", kind: "responsibility", label: "Product engineering", source: "suggested" }] }, { id: "custom", name: "Something else", description: "Describe your work.", keywords: [], specialties: [], items: [] }] },
};

export default function OnboardingPreview() {
  // `?simulated=0` renders the production path: the scenario banner is a debug
  // surface, so the panel must lay out correctly with and without it.
  const simulated = typeof window === "undefined" || new URLSearchParams(window.location.search).get("simulated") !== "0";
  return <Onboarding data={PREVIEW_DATA} simulated={simulated} busy={false} onSubmit={async () => undefined} onSaveDraft={async () => undefined} onComplete={() => undefined} onOpenDebug={() => undefined} onLogout={() => undefined} onNotify={() => undefined} />;
}
