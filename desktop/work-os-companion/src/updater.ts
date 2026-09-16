import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

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

/** Background update checks run on this cadence while the companion is up.
 * The companion is a long-lived tray app, so a launch-only check misses
 * releases dropped mid-session. Internal builds ship a few per day at most,
 * so twenty minutes keeps discovery quick without pointless traffic. */
export const UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000;

/** Human cadence used in settings copy, derived so the text cannot drift
 * from the constant above. */
export const UPDATE_CHECK_CADENCE_COPY = (() => {
  const minutes = Math.round(UPDATE_CHECK_INTERVAL_MS / 60_000);
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
})();

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

/** Live download state folded from the updater plugin's event channel. */
export type UpdateDownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
  status: "idle" | "downloading" | "downloaded";
};

export const INITIAL_UPDATE_DOWNLOAD_PROGRESS: UpdateDownloadProgress = {
  receivedBytes: 0,
  totalBytes: null,
  status: "idle",
};

/** Folds one plugin download event into progress state. `contentLength` is
 * missing when the server omits it; the UI then reports received bytes only. */
export function applyDownloadEvent(current: UpdateDownloadProgress, event: DownloadEvent): UpdateDownloadProgress {
  switch (event.event) {
    case "Started":
      return { receivedBytes: 0, totalBytes: event.data.contentLength ?? null, status: "downloading" };
    case "Progress":
      return { ...current, receivedBytes: current.receivedBytes + event.data.chunkLength, status: "downloading" };
    case "Finished":
      return { ...current, status: "downloaded" };
  }
}

/** "12.4 MB" — one decimal below 100 MB, whole numbers above. */
export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 100 ? `${Math.round(megabytes)} MB` : `${megabytes.toFixed(1)} MB`;
}

/** Progress text and bar values shared by the flyout and the settings row. */
export function updateProgressDetails(progress: UpdateDownloadProgress): {
  percent: number | null;
  valueText: string;
} {
  const { receivedBytes, totalBytes } = progress;
  if (!totalBytes || totalBytes <= 0) {
    return { percent: null, valueText: `${formatMegabytes(receivedBytes)} downloaded` };
  }
  const percent = Math.min(100, Math.floor((receivedBytes / totalBytes) * 100));
  return { percent, valueText: `${formatMegabytes(receivedBytes)} of ${formatMegabytes(totalBytes)}` };
}

/** The settings row renders from the same flow state the flyout uses. */
export type UpdateRowCopyInput =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; progress: UpdateDownloadProgress }
  | { status: "downloaded"; version: string }
  | { status: "failed"; version: string; message: string }
  | { status: "installing"; version: string };

export function updateRowCopy(input: UpdateRowCopyInput, installedVersion: string): string {
  const installed = `Installed version ${installedVersion}`;
  switch (input.status) {
    case "idle":
      return installed;
    case "checking":
      return `Checking securely… · ${installed}`;
    case "available":
      return `Version ${displayUpdateVersion(input.version)} available · ${installed}`;
    case "downloading":
      return `Downloading ${displayUpdateVersion(input.version)}… ${updateProgressDetails(input.progress).valueText}`;
    case "downloaded":
      return `Version ${displayUpdateVersion(input.version)} downloaded — ready to install`;
    case "failed":
      return `Version ${displayUpdateVersion(input.version)} download failed · ${input.message}`;
    case "installing":
      return `Closing Work OS to install ${displayUpdateVersion(input.version)}…`;
  }
}

export function updateAvailableCopy(version: string): {
  title: string;
  message: string;
  actionLabel: string;
} {
  const display = displayUpdateVersion(version);
  return {
    title: `Update ${display} is ready`,
    message: `Version ${display} is ready. Download it now, or start it later from Settings.`,
    actionLabel: "Download update",
  };
}

export function updateDownloadedCopy(version: string): { title: string; message: string } {
  const display = displayUpdateVersion(version);
  return {
    title: "Update downloaded",
    message: `Version ${display} is downloaded. Update now, or install it later from Settings.`,
  };
}

export function updateDownloadFailedCopy(version: string, reason: string): { title: string; message: string } {
  const display = displayUpdateVersion(version);
  return {
    title: "Update download failed",
    message: `Version ${display} could not be downloaded. ${reason} Check your connection and try again.`,
  };
}
