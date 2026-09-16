import { check, type Update } from "@tauri-apps/plugin-updater";

/* Update-channel rules for the internal companion builds. The launch
 * auto-check stays silent unless an update is actually available; the
 * flyout is the only surface it may raise, and Settings can turn the
 * check off entirely. */

/** Server origin that owns the signed internal update catalog. */
export function updateChannelOrigin(): string {
  return new URL(import.meta.env.VITE_WORK_OS_UPDATE_ORIGIN || "https://app.wrazyos.com").origin;
}

/** True when the signed-in server manages updates itself, so the
 * companion catalog must not be consulted. */
export function isManagedUpdateChannel(apiBase: string): boolean {
  try {
    return new URL(apiBase).origin !== updateChannelOrigin();
  } catch {
    return true;
  }
}

export function updateAuthHeaders(session: {
  token: string;
  organizationId: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${session.token}`,
    "X-Work-OS-Organization-Id": session.organizationId,
  };
}

export type UpdateQuery =
  | { status: "managed" }
  | { status: "current" }
  | { status: "available"; update: Update; headers: Record<string, string> };

export async function queryAvailableUpdate(session: {
  apiBase: string;
  token: string;
  organizationId: string;
}): Promise<UpdateQuery> {
  if (isManagedUpdateChannel(session.apiBase)) return { status: "managed" };
  const headers = updateAuthHeaders(session);
  const update = await check({ headers });
  if (!update) return { status: "current" };
  return { status: "available", update, headers };
}

/** Launch auto-check gate: real native runtime, no debug scenario, a
 * signed-in session, and the Settings opt-out left on. */
export function shouldAutoCheckUpdate(input: {
  supported: boolean;
  debugEnabled: boolean;
  hasSession: boolean;
  autoCheckUpdates: boolean;
}): boolean {
  return input.supported && !input.debugEnabled && input.hasSession && input.autoCheckUpdates;
}

export const UPDATE_AVAILABLE_KEY = "work-os-update-available";

/** Human-facing release naming convention: the patch segment renders with
 * two digits (0.3.1 displays as 0.3.01). SemVer itself forbids leading
 * zeros, so canonical versions stay unpadded wherever tools compare them;
 * only UI copy pads. Patches of ten or more keep their natural width. */
export function displayUpdateVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return version;
  const [, major, minor, patch, suffix] = match;
  return patch.length < 2 ? `${major}.${minor}.0${patch}${suffix}` : version;
}

export function updateAvailableCopy(version: string): {
  title: string;
  message: string;
  actionLabel: string;
} {
  const display = displayUpdateVersion(version);
  return {
    title: `Update ${display} is ready`,
    message: `Version ${display} is ready to install. Work OS restarts itself; if it does not come back, run the setup again.`,
    actionLabel: "Install & restart",
  };
}
