import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addProfileItem, buildWorkPreferences, profileSetupIssue, removeProfileItem, userProfileItem } from "../src/modules/work-os/employee/onboardingProfile.ts";
import type { WorkProfileItem } from "../src/modules/work-os/onboarding.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const item = (kind: WorkProfileItem["kind"], label: string, source: WorkProfileItem["source"] = "suggested"): WorkProfileItem => ({
  id: `${kind}:${label.toLowerCase().replaceAll(" ", "-")}`,
  kind,
  label,
  source,
});

test("web onboarding requires at least one work-profile signal", () => {
  assert.equal(profileSetupIssue({ archetypeId: "engineering", customRoleTitle: "", items: [] }), "Choose at least one responsibility, output, or evidence source.");
  assert.equal(profileSetupIssue({ archetypeId: "engineering", customRoleTitle: "", items: [item("responsibility", "Review code")] }), null);
});

test("a custom role needs its title before submission", () => {
  assert.equal(profileSetupIssue({ archetypeId: "custom", customRoleTitle: "", items: [item("responsibility", "Own the studio")] }), "Describe your role.");
  assert.equal(profileSetupIssue({ archetypeId: "custom", customRoleTitle: "Producer", items: [item("responsibility", "Own the studio")] }), null);
});

test("the payload splits work-profile items and preserves the saved preferences", () => {
  const payload = buildWorkPreferences({
    archetypeId: "engineering",
    specialtyIds: ["engineering:frontend", "engineering:frontend", "engineering:platform"],
    customRoleTitle: "ignored",
    items: [
      item("responsibility", " Design and implement software ", "suggested"),
      item("deliverable", "Pull requests", "suggested"),
      item("deliverable", "Pull requests", "user"),
      item("evidence", "GitHub", "suggested"),
    ],
    voiceUpdatesEnabled: true,
    githubUsername: " octocat ",
  });
  assert.equal(payload.customRoleTitle, "");
  assert.deepEqual(payload.specialtyIds, ["engineering:frontend", "engineering:platform"]);
  assert.deepEqual(payload.responsibilities, ["Design and implement software"]);
  assert.deepEqual(payload.outputTypes, ["Pull requests"]);
  assert.deepEqual(payload.evidenceSources, ["GitHub"]);
  assert.equal(payload.voiceUpdatesEnabled, true);
  assert.equal(payload.githubUsername, "octocat");
});

test("custom role titles are kept only for the custom archetype", () => {
  const payload = buildWorkPreferences({
    archetypeId: "custom",
    specialtyIds: [],
    customRoleTitle: "  Producer  ",
    items: [item("deliverable", "Launch plans")],
  });
  assert.equal(payload.customRoleTitle, "Producer");
});

test("profile items dedupe within their own kind", () => {
  const first = addProfileItem([], item("responsibility", "Review code"));
  const duplicate = addProfileItem(first, item("responsibility", " review code "));
  assert.equal(duplicate.length, 1);
  assert.equal(addProfileItem(duplicate, item("evidence", "Review code")).length, 2);
  assert.equal(removeProfileItem(duplicate, duplicate[0]!.id).length, 0);
  assert.equal(userProfileItem("deliverable", "  Design spec  ").label, "Design spec");
});

test("the web Settings form sends the work profile and guards the local rule", async () => {
  const settings = await read("src/modules/work-os/employee/EmployeeSettings.tsx");
  assert.match(settings, /PROFILE_KINDS/);
  assert.match(settings, /profileSetupIssue/);
  assert.match(settings, /workPreferences: buildWorkPreferences\(/);
  assert.match(settings, /Work profile/);
  assert.match(settings, /Boolean\(profileIssue\)/);
});

test("Today opens the one-time setup modal and keeps the inline notice", async () => {
  const today = await read("src/modules/work-os/employee/EmployeeToday.tsx");
  const modal = await read("src/modules/work-os/employee/OnboardingSetupModal.tsx");
  assert.match(today, /OnboardingSetupModal/);
  assert.match(today, /onboarding-setup-modal/);
  assert.match(today, /onboardingRequired/);
  assert.match(today, /Finish your Work OS setup/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /\/work-os\/downloads/);
  assert.match(modal, /\/work-os\/settings/);
});
