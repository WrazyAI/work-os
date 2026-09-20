import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageBackend } from "@/lib/db/storage";
import { getEmployeeOnboarding, saveEmployeeAccountSettings } from "@/lib/work-os-onboarding";
import type { WorkOsAccess } from "@/lib/work-os-api";

type Json = Record<string, unknown>;

export const PROFILE_AVATAR_BUCKET = "avatars";
export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateProfileDisplayName(value: unknown) {
  const displayName = typeof value === "string" ? value.trim() : "";
  if (!displayName) throw new Error("display name is required");
  if (displayName.length > 120) throw new Error("display name must be 120 characters or fewer");
  return displayName;
}

export function validateAvatarUpload(contentType: unknown, size: number) {
  if (typeof contentType !== "string" || !PROFILE_AVATAR_TYPES.has(contentType.toLowerCase())) {
    throw new Error("avatar must be a JPEG, PNG, or WebP image");
  }
  if (!Number.isInteger(size) || size <= 0) throw new Error("avatar must not be empty");
  if (size > PROFILE_AVATAR_MAX_BYTES) throw new Error("avatar must be 5MB or smaller");
}

export function profileAvatarObjectPath(userId: string) {
  if (!userId || userId.includes("/") || userId.includes("\\") || userId.includes("..")) {
    throw new Error("invalid profile avatar owner");
  }
  return `${userId}/avatar.webp`;
}

export function profileAvatarUrl(version: string | number = Date.now()) {
  return `/api/work-os/me/profile/avatar?v=${encodeURIComponent(String(version))}`;
}

export type WorkOsProfileUpdate = {
  displayName?: unknown;
  removeAvatar?: boolean;
  avatarBytes?: Uint8Array;
  avatarContentType?: string;
  settings?: Json;
};

function db() {
  return createAdminClient();
}

async function storeAvatar(userId: string, bytes: Uint8Array, contentType: string) {
  validateAvatarUpload(contentType, bytes.byteLength);
  const normalized = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: 512, height: 512, fit: "cover", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  const objectPath = profileAvatarObjectPath(userId);
  const result = await getStorageBackend().upload(PROFILE_AVATAR_BUCKET, objectPath, normalized, {
    contentType: "image/webp",
    upsert: true,
  });
  if (result.error) throw new Error(`save profile avatar: ${result.error.message}`);
  return objectPath;
}

async function removeAvatar(userId: string) {
  const result = await getStorageBackend().remove(PROFILE_AVATAR_BUCKET, [profileAvatarObjectPath(userId)]);
  if (result.error) throw new Error(`remove profile avatar: ${result.error.message}`);
}

export async function updateWorkOsProfile(access: WorkOsAccess, input: WorkOsProfileUpdate) {
  const hasDisplayName = input.displayName !== undefined;
  const hasAvatar = input.avatarBytes !== undefined;
  const shouldRemoveAvatar = input.removeAvatar === true;
  const settings = input.settings ?? {};
  const hasSettings = Object.keys(settings).some((key) => !["displayName", "avatar", "removeAvatar"].includes(key));
  if (!hasDisplayName && !hasAvatar && !shouldRemoveAvatar && !hasSettings) {
    throw new Error("at least one profile setting is required");
  }
  if (hasAvatar && shouldRemoveAvatar) throw new Error("choose an avatar or remove the current avatar, not both");

  if (hasSettings) await saveEmployeeAccountSettings(access, settings);

  const profileUpdate: Json = {};
  if (hasDisplayName) profileUpdate.display_name = validateProfileDisplayName(input.displayName);
  if (hasAvatar) {
    await storeAvatar(access.ctx.user.id, input.avatarBytes!, input.avatarContentType ?? "");
    profileUpdate.avatar_url = profileAvatarUrl();
  } else if (shouldRemoveAvatar) {
    await removeAvatar(access.ctx.user.id);
    profileUpdate.avatar_url = null;
  }

  if (Object.keys(profileUpdate).length) {
    const { error } = await db().from("profiles").update({ ...profileUpdate, updated_at: new Date().toISOString() }).eq("id", access.ctx.user.id);
    if (error) throw new Error(`save profile: ${error.message}`);
  }

  return getEmployeeOnboarding(access);
}
