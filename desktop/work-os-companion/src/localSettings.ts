import { invoke } from "@tauri-apps/api/core";

/** The installed app's own config file.
 *
 * A fresh install has no file: the host creates `work-os.local.json` beside the
 * vault from the cadence the workspace reports, so the deployment's policy is
 * the starting point. From then on the file is the machine's own setting — an
 * edit there wins over the workspace for this machine only, which is why it is
 * what the app reports on its requests.
 *
 * A hand edit is not trusted: only values inside the shared bounds are used, and
 * anything else falls back to the workspace's own resolution. */

export interface MachineCadence {
  checkInIntervalMinutes?: number;
  firstFollowUpMinutes?: number;
}

export const CADENCE_HEADER = "x-work-os-cadence-minutes";
export const FIRST_FOLLOW_UP_HEADER = "x-work-os-first-follow-up-minutes";
/** The same bounds the deployment applies, so a bad edit cannot storm or
 * silence a workday. */
export const MIN_CADENCE_MINUTES = 5;
export const MAX_CADENCE_MINUTES = 240;

function boundedMinutes(value: unknown): number | undefined {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= MIN_CADENCE_MINUTES && minutes <= MAX_CADENCE_MINUTES ? minutes : undefined;
}

/** Parses the config file defensively. Returns null when it holds nothing
 * usable, so the workspace's own cadence stays in charge. */
export function parseMachineCadence(text: string): MachineCadence | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const checkInIntervalMinutes = boundedMinutes(entry.checkInIntervalMinutes);
  const firstFollowUpMinutes = boundedMinutes(entry.firstFollowUpMinutes);
  if (checkInIntervalMinutes === undefined && firstFollowUpMinutes === undefined) return null;
  return {
    ...(checkInIntervalMinutes !== undefined ? { checkInIntervalMinutes } : {}),
    ...(firstFollowUpMinutes !== undefined ? { firstFollowUpMinutes } : {}),
  };
}

let current: MachineCadence | null = null;

/** Headers that carry this machine's cadence to the workspace. */
export function machineCadenceHeaders(): Record<string, string> {
  if (!current) return {};
  return {
    ...(current.checkInIntervalMinutes !== undefined ? { [CADENCE_HEADER]: String(current.checkInIntervalMinutes) } : {}),
    ...(current.firstFollowUpMinutes !== undefined ? { [FIRST_FOLLOW_UP_HEADER]: String(current.firstFollowUpMinutes) } : {}),
  };
}

export function machineCadence(): MachineCadence | null {
  return current;
}

/** Creates the file from the workspace cadence the first time and then honours
 * whatever it holds. A failure is never fatal: without a value the workspace's
 * own cadence applies. */
export async function loadMachineCadence(seed: MachineCadence | null): Promise<MachineCadence | null> {
  try {
    const contents = await invoke<string>("ensure_local_settings", {
      seed: `${JSON.stringify(seed ?? {}, null, 2)}\n`,
    });
    current = parseMachineCadence(contents);
    return current;
  } catch {
    current = null;
    return null;
  }
}
