import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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

  assert.match(profileRoute, /requireWorkOsAccess/);
  assert.match(profileRoute, /export async function GET/);
  assert.match(profileRoute, /export async function PATCH/);
  assert.match(profileRoute, /updateWorkOsProfile/);
  assert.match(profileService, /saveEmployeeAccountSettings/);
  assert.match(avatarRoute, /requireWorkOsAccess/);
  assert.match(avatarRoute, /getStorageBackend/);
  assert.match(avatarRoute, /profileAvatarObjectPath/);
  assert.match(onboarding, /export async function saveEmployeeAccountSettings/);
  assert.match(onboarding, /draft_revision/);
  assert.match(onboarding, /work_employee_onboarding/);
});
