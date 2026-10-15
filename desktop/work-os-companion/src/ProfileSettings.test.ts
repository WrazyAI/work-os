import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileSettings } from "./ProfileSettings";
import type { OnboardingData, ProviderAccounts } from "./types";

const providerAccounts: ProviderAccounts = {
  nifty: { mapped: true, email: "jamie@wrazy.com" },
  worktivity: { mapped: true, email: "jamie@wrazy.com" },
  github: { accounts: [{ login: "jamie-mensah", id: "1", verified: true, bot: false }] },
};

const data: OnboardingData = {
  policy: { version: "work-tracking-v1", purpose: "Tracking", assurance: "Assurance", dataCategories: [] },
  onboardingRequired: false,
  employeeComplete: true,
  employeeRequirements: {
    consentProvided: true,
    screenshotConsentProvided: true,
    profileConfirmed: true,
    timezoneProvided: true,
    scheduleProvided: true,
    notificationsConfigured: true,
    privacyAcknowledged: true,
  },
  managerRequirements: { roleAssigned: true, teamAssigned: true, managerAssigned: true, officialScheduleConfigured: true },
  profile: {
    displayName: "Jamie Mensah",
    email: "jamie@wrazy.com",
    avatarUrl: null,
    timezone: "Africa/Accra",
    language: "en",
    weekStart: 1,
    timeFormat: "24h",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [] },
    notifications: { desktopEnabled: true },
    privacy: { screenshotAnalysisConsent: true, sensitiveAppExclusions: [] },
    workPreferences: {
      archetypeId: "engineering",
      inferredArchetypeId: "engineering",
      customRoleTitle: "",
      specialtyIds: ["engineering:frontend"],
      items: [
        { id: "engineering:responsibility:design-and-implement-software", kind: "responsibility", label: "Design and implement software", source: "suggested" },
        { id: "custom:evidence:customer-recordings", kind: "evidence", label: "Customer recordings", source: "user" },
      ],
      responsibilities: ["Design and implement software"],
      outputTypes: [],
      evidenceSources: ["Customer recordings"],
      voiceUpdatesEnabled: true,
      githubUsername: "jamie-mensah",
    },
  },
  providerPrefill: { nifty: { mapped: true, timezone: null, language: null, team: null, role: null }, worktivity: { mapped: true, screenshotsConfigured: true, screenshotsBlurred: false } },
  providerAccounts,
  organizationSetup: { roleProfile: null, teams: [], managers: [], officialSchedule: null },
  status: "submitted",
  submittedAt: "2026-09-29T09:00:00.000Z",
  draft: { step: "seen", updatedAt: null, revision: 4 },
  breakPolicy: { worktivityAuthoritative: true },
  screenshotPolicy: { retention: "30 days", limitation: "Context only", sensitiveCapture: "Deleted" },
  catalog: {
    version: "test",
    archetypes: [
      {
        id: "engineering",
        name: "Engineering",
        description: "Build reliable software.",
        keywords: [],
        specialties: [{ id: "engineering:frontend", name: "Frontend" }],
        items: [
          { id: "engineering:responsibility:design-and-implement-software", kind: "responsibility", label: "Design and implement software", source: "suggested" },
          { id: "engineering:responsibility:review-and-improve-code", kind: "responsibility", label: "Review and improve code", source: "suggested" },
          { id: "engineering:deliverable:pull-requests", kind: "deliverable", label: "Pull requests", source: "suggested" },
          { id: "engineering:evidence:github", kind: "evidence", label: "GitHub", source: "suggested" },
        ],
      },
      { id: "custom", name: "Something else", description: "Describe your own role.", keywords: [], specialties: [], items: [] },
    ],
  },
};

describe("ProfileSettings work profile", () => {
  const markup = renderToStaticMarkup(createElement(ProfileSettings, { data, mode: "modal", onSave: async () => undefined, onNotify: () => undefined }));

  it("edits the profile signals as picked pills with remove controls", () => {
    expect(markup).toContain('aria-label="Remove Design and implement software"');
    expect(markup).toContain('aria-label="Remove Customer recordings"');
    expect(markup).toContain("Nothing picked yet.");
  });

  it("offers the selected scope's remaining suggestions as add chips", () => {
    expect(markup).toContain('aria-label="Add Review and improve code"');
    expect(markup).toContain('aria-label="Add Pull requests"');
    expect(markup).toContain('aria-label="Add GitHub"');
    expect(markup).not.toContain('aria-label="Add Design and implement software"');
  });

  it("never presents the signals as typed comma text and drops the username field", () => {
    expect(markup).not.toContain("Comma-separated");
    expect(markup).not.toContain("GitHub username");
    expect(markup).not.toContain('value="Design and implement software, Review and improve code"');
  });

  it("shows the mapped evidence accounts instead of a username input", () => {
    expect(markup).toContain("Connected accounts");
    expect(markup).toContain("jamie@wrazy.com");
    expect(markup).toContain("jamie-mensah");
    expect(markup).toContain("Mapped to you by your workspace");
  });
});

describe("ProfileSettings source guards", () => {
  const source = readFileSync(resolve(import.meta.dirname, "ProfileSettings.tsx"), "utf8");

  it("saves the picked items without re-deriving them from text", () => {
    expect(source).toContain("items: form.items");
    expect(source).not.toContain("form.responsibilities");
    expect(source).not.toContain("githubUsername");
  });

  it("keeps the connected accounts read-only and conditional on the payload", () => {
    expect(source).toContain("<ProviderAccountPills accounts={data.providerAccounts} />");
    expect(source).toMatch(/data\.providerAccounts \?/);
  });
});
