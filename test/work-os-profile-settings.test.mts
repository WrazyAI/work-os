import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { providerAccountsFor } from "../src/lib/work-os-onboarding";
import {
  profileAvatarObjectPath,
  profileAvatarUrl,
  validateAvatarUpload,
  validateProfileDisplayName,
} from "../src/lib/work-os-profile";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("profile values have bounded, user-owned storage contracts", () => {
  assert.equal(validateProfileDisplayName("  Ada Lovelace  "), "Ada Lovelace");
  assert.throws(() => validateProfileDisplayName("   "), /display name is required/);
  assert.throws(() => validateProfileDisplayName("a".repeat(121)), /120 characters/);
  assert.equal(profileAvatarObjectPath("user-123"), "user-123/avatar.webp");
  assert.equal(profileAvatarUrl("2026-09-20T12:00:00.000Z"), "/api/work-os/me/profile/avatar?v=2026-09-20T12%3A00%3A00.000Z");
  assert.doesNotThrow(() => validateAvatarUpload("image/webp", 5 * 1024 * 1024));
  assert.throws(() => validateAvatarUpload("image/svg+xml", 12), /JPEG, PNG, or WebP/);
  assert.throws(() => validateAvatarUpload("image/png", 5 * 1024 * 1024 + 1), /5MB/);
});

test("profile routes require Work OS access and expose only authenticated media", async () => {
  const profileRoute = await source("src/app/api/work-os/me/profile/route.ts");
  const avatarRoute = await source("src/app/api/work-os/me/profile/avatar/route.ts");
  const onboarding = await source("src/lib/work-os-onboarding.ts");
  const profileService = await source("src/lib/work-os-profile.ts");
  const profileSettings = await source("desktop/work-os-companion/src/ProfileSettings.tsx");
  const profileStyles = await source("desktop/work-os-companion/src/styles.css");
  const scheduleMigration = await source("supabase/migrations/0051_work_os_employee_schedule_settings.sql");

  assert.match(profileRoute, /requireWorkOsAccess/);
  assert.match(profileRoute, /export async function GET/);
  assert.match(profileRoute, /export async function PATCH/);
  assert.match(profileRoute, /updateWorkOsProfile/);
  assert.match(profileService, /saveEmployeeAccountSettings/);
  assert.match(profileService, /restoreAvatar/);
  assert.match(avatarRoute, /requireWorkOsAccess/);
  assert.match(avatarRoute, /getStorageBackend/);
  assert.match(avatarRoute, /profileAvatarObjectPath/);
  assert.match(onboarding, /export async function saveEmployeeAccountSettings/);
  assert.match(onboarding, /draft_revision/);
  assert.match(onboarding, /work_employee_onboarding/);
  assert.match(onboarding, /mutationKey[\s\S]*currentRevision/);
  assert.match(onboarding, /work_save_employee_account_settings/);
  assert.doesNotMatch(profileSettings, /scheduleLocked/);
  assert.doesNotMatch(profileStyles, /profile-schedule\.is-locked/);
  assert.match(scheduleMigration, /work_schedules/);
  assert.match(scheduleMigration, /notify\s+pgrst/i);
});

test("the profile payload returns only the person's own mapped accounts", async () => {
  const onboarding = await source("src/lib/work-os-onboarding.ts");
  const profileSettings = await source("desktop/work-os-companion/src/ProfileSettings.tsx");
  const pills = await source("desktop/work-os-companion/src/ProfilePills.tsx");
  const styles = await source("desktop/work-os-companion/src/styles.css");

  assert.match(onboarding, /work_source_accounts/);
  assert.match(onboarding, /eq\("person_id", access\.personId\)/);
  assert.match(onboarding, /providerAccounts: providerAccountsFor/);

  // The three signal groups are pill pickers, never typed comma text.
  assert.match(profileSettings, /<ItemPillGroup kind="responsibility"/);
  assert.match(profileSettings, /<ItemPillGroup kind="deliverable"/);
  assert.match(profileSettings, /<ItemPillGroup kind="evidence"/);
  assert.doesNotMatch(profileSettings, /Comma-separated work signals/);
  assert.doesNotMatch(profileSettings, /githubUsername/);
  assert.doesNotMatch(profileSettings, /profileItems\(data, form\)/);

  // Connected accounts are read-only provider pills owned by the workspace.
  assert.match(profileSettings, /<ProviderAccountPills accounts=\{data\.providerAccounts\} \/>/);
  assert.match(pills, /profile-account-pill/);
  assert.match(pills, /Add your own/);
  assert.match(styles, /\.profile-pill-group legend/);
  assert.match(styles, /\.profile-account-pill\.is-worktivity/);
});

test("mapped provider accounts lead with real accounts and trail the shared bot", () => {
  const accounts = providerAccountsFor({
    niftyMemberId: "_HpMO3uhYI",
    worktivityEmployeeId: "6a15c7d96d1dd938343a837c",
    sourceAccounts: [
      { provider: "github", external_account_id: "41898282", verified: true, metadata: { login: "wrazy-ci[bot]" } },
      { provider: "github", external_account_id: "zahemen9900", verified: true, metadata: { login: "zahemen9900" } },
      { provider: "github", external_account_id: "9001", verified: false, metadata: {} },
      { provider: "nifty", external_account_id: "member-1", verified: true, metadata: { login: "not-github" } },
    ],
    raw: { nifty: { email: "david@maigreeks.com" }, worktivity: { Invitation: { Email: "david@maigreeks.com" } } },
  });
  assert.deepEqual(accounts.github.accounts.map((account) => account.login), ["zahemen9900", "9001", "wrazy-ci[bot]"]);
  assert.equal(accounts.github.accounts[1].verified, false);
  assert.equal(accounts.github.accounts.at(-1)?.bot, true);
  assert.equal(accounts.github.accounts[0].id, "zahemen9900");
  assert.deepEqual(accounts.worktivity, { mapped: true, email: "david@maigreeks.com" });
  assert.deepEqual(accounts.nifty, { mapped: true, email: "david@maigreeks.com" });
});

test("a person without mappings reports empty accounts, never invented ones", () => {
  const accounts = providerAccountsFor({ niftyMemberId: null, worktivityEmployeeId: null, sourceAccounts: null, raw: {} });
  assert.deepEqual(accounts, {
    nifty: { mapped: false, email: null },
    worktivity: { mapped: false, email: null },
    github: { accounts: [] },
  });
  const noEmail = providerAccountsFor({ niftyMemberId: "x", worktivityEmployeeId: "y", sourceAccounts: [], raw: { worktivity: { Invitation: { Email: "not-an-email" } } } });
  assert.equal(noEmail.worktivity.email, null);
  assert.equal(noEmail.nifty.email, null);
});
