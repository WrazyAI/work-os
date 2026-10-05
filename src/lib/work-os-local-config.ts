import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_CHECK_IN_INTERVAL_MINUTES,
  FIRST_FOLLOW_UP_MINUTES,
  checkInIntervalOption,
  firstFollowUpOption,
} from "@/modules/work-os/workday";

/** A per-person cadence override from the local config file. Absent fields
 * fall back to the deployment environment and then to the built-in defaults. */
export interface WorkOsPersonCadence {
  checkInIntervalMinutes?: number;
  firstFollowUpMinutes?: number;
}

export interface WorkOsLocalConfig {
  people: Record<string, WorkOsPersonCadence>;
}

export interface WorkOsCadenceIdentity {
  personId?: string | null;
  email?: string | null;
}

export interface ResolvedWorkOsCadence {
  checkInIntervalMinutes: number;
  firstFollowUpMinutes: number;
  /** True when a person-specific entry applied (either field). */
  personOverride: boolean;
}

const DEFAULT_CONFIG_PATH = "config/work-os.local.json";

/** The config file lives with the checkout by default so an operator can edit
 * it in place; `WORK_OS_LOCAL_CONFIG_PATH` can point somewhere else. */
export function workOsLocalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = typeof env.WORK_OS_LOCAL_CONFIG_PATH === "string" && env.WORK_OS_LOCAL_CONFIG_PATH.trim()
    ? env.WORK_OS_LOCAL_CONFIG_PATH.trim()
    : DEFAULT_CONFIG_PATH;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/** Parse and validate the file defensively: malformed JSON, unknown keys, and
 * out-of-range values are ignored so a bad edit can never storm or silence a
 * workday. Values must fit the same bounds as the environment overrides. */
export function parseWorkOsLocalConfig(text: string): WorkOsLocalConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { people: {} };
  }
  const peopleRaw = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).people
    : null;
  const people: Record<string, WorkOsPersonCadence> = {};
  if (peopleRaw && typeof peopleRaw === "object" && !Array.isArray(peopleRaw)) {
    for (const [key, value] of Object.entries(peopleRaw as Record<string, unknown>)) {
      const name = key.trim();
      if (!name || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const checkIn = checkInIntervalOption(entry.checkInIntervalMinutes);
      const first = firstFollowUpOption(entry.firstFollowUpMinutes);
      if (checkIn === null && first === null) continue;
      people[name] = {
        ...(checkIn !== null ? { checkInIntervalMinutes: checkIn } : {}),
        ...(first !== null ? { firstFollowUpMinutes: first } : {}),
      };
    }
  }
  return { people };
}

let configCache: { path: string; mtimeMs: number; size: number; config: WorkOsLocalConfig } | null = null;

/** Reads the checkout-local config, refreshing when the file changes so an
 * edit applies without a rebuild. A missing or unreadable file is empty. */
export function loadWorkOsLocalConfig(path = workOsLocalConfigPath()): WorkOsLocalConfig {
  try {
    const stat = statSync(path);
    if (configCache && configCache.path === path && configCache.mtimeMs === stat.mtimeMs && configCache.size === stat.size) {
      return configCache.config;
    }
    const config = parseWorkOsLocalConfig(readFileSync(path, "utf8"));
    configCache = { path, mtimeMs: stat.mtimeMs, size: stat.size, config };
    return config;
  } catch {
    return { people: {} };
  }
}

/** Person entries match by user id or email, case-insensitively for emails. */
export function personCadenceOverride(config: WorkOsLocalConfig, identity: WorkOsCadenceIdentity): WorkOsPersonCadence | null {
  const keys = [identity.personId, identity.email].flatMap((value) => (
    typeof value === "string" && value.trim() ? [value.trim(), value.trim().toLowerCase()] : []
  ));
  for (const key of keys) {
    const entry = config.people[key];
    if (entry) return entry;
  }
  return null;
}

/** Effective cadence for one person. Precedence: local config entry > deployment
 * environment override > built-in default (60 minutes / 75 minutes). */
export function resolveWorkOsCadence(
  identity: WorkOsCadenceIdentity,
  env: NodeJS.ProcessEnv = process.env,
  config: WorkOsLocalConfig = loadWorkOsLocalConfig(),
): ResolvedWorkOsCadence {
  const override = personCadenceOverride(config, identity);
  return {
    checkInIntervalMinutes: override?.checkInIntervalMinutes ?? checkInIntervalOption(env.WORK_OS_CHECK_IN_INTERVAL_MINUTES) ?? DEFAULT_CHECK_IN_INTERVAL_MINUTES,
    firstFollowUpMinutes: override?.firstFollowUpMinutes ?? firstFollowUpOption(env.WORK_OS_FIRST_FOLLOW_UP_MINUTES) ?? FIRST_FOLLOW_UP_MINUTES,
    personOverride: Boolean(override),
  };
}
