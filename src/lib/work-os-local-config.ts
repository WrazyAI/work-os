import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, sep, win32 } from "node:path";
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

/** Injected for deterministic cross-platform tests: the runtime's own path
 * flavor, plus the home and working directories to resolve against. */
export interface WorkOsConfigPathOptions {
  cwd?: string;
  home?: string;
  flavor?: "posix" | "win32";
}

/** A Windows drive path (`C:\…`, `C:/…`) or UNC share (`\\server\share`). These
 * are absolute on Windows; on macOS and Linux they are still not something to
 * glue onto the working directory, or a configured override would resolve to a
 * path that cannot exist and the override would silently stop applying. */
function isWindowsAbsolute(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * Resolves one configured path so the same value works on macOS, Linux, and
 * Windows:
 *
 * - a leading `~` means the user's home directory (`~/.work-os.local.json` is
 *   how an operator naturally points at a file in their own account);
 * - separators follow the runtime, so a value written with backslashes still
 *   resolves on macOS and Linux;
 * - a Windows drive or UNC path stays absolute even on macOS/Linux rather than
 *   being joined to the working directory;
 * - everything else resolves against the working directory, which is the
 *   checkout for the bundled server.
 */
export function resolveLocalConfigPath(configured: string, options: WorkOsConfigPathOptions = {}): string {
  // `sep` is the runtime's own separator: Windows is the only flavor that uses
  // a backslash. (Checking `win32.sep` would be true everywhere.)
  const flavor = options.flavor ?? (sep === "\\" ? "win32" : "posix");
  const paths = flavor === "win32" ? win32 : posix;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();

  let value = configured.trim();
  if (value === "~") value = home;
  else if (/^~[\\/]/.test(value)) value = paths.join(home, value.slice(2).replace(/\\/g, "/"));

  if (flavor === "posix" && isWindowsAbsolute(value)) return value.replace(/\\/g, "/");
  if (flavor === "posix" && value.includes("\\") && !paths.isAbsolute(value)) value = value.replace(/\\/g, "/");

  return paths.isAbsolute(value) ? value : paths.resolve(cwd, value);
}

/** The config file lives with the checkout by default so an operator can edit
 * it in place; `WORK_OS_LOCAL_CONFIG_PATH` can point somewhere else. */
export function workOsLocalConfigPath(env: NodeJS.ProcessEnv = process.env, options: WorkOsConfigPathOptions = {}): string {
  const configured = typeof env.WORK_OS_LOCAL_CONFIG_PATH === "string" && env.WORK_OS_LOCAL_CONFIG_PATH.trim()
    ? env.WORK_OS_LOCAL_CONFIG_PATH.trim()
    : DEFAULT_CONFIG_PATH;
  return resolveLocalConfigPath(configured, options);
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
      // Emails match case-insensitively; ids keep their exact spelling.
      const normalized = name.includes("@") ? name.toLowerCase() : name;
      const entry = value as Record<string, unknown>;
      const checkIn = checkInIntervalOption(entry.checkInIntervalMinutes);
      const first = firstFollowUpOption(entry.firstFollowUpMinutes);
      if (checkIn === null && first === null) continue;
      people[normalized] = {
        ...(checkIn !== null ? { checkInIntervalMinutes: checkIn } : {}),
        ...(first !== null ? { firstFollowUpMinutes: first } : {}),
      };
    }
  }
  return { people };
}

let configCache: { path: string; mtimeMs: number; size: number; config: WorkOsLocalConfig } | null = null;
/** Last path already reported as unreadable, so a missing override logs once. */
let warnedUnreadablePath: string | null = null;

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
    // An explicitly configured override that cannot be read would otherwise
    // disappear in silence: the cadence quietly falls back to the environment
    // and the operator sees their setting simply "not apply". Say so once, and
    // only for an override that was actually pointed at, so the default path
    // staying absent is not noise.
    const configured = typeof process.env.WORK_OS_LOCAL_CONFIG_PATH === "string" ? process.env.WORK_OS_LOCAL_CONFIG_PATH.trim() : "";
    if (configured && warnedUnreadablePath !== path) {
      warnedUnreadablePath = path;
      console.warn(`[work-os] WORK_OS_LOCAL_CONFIG_PATH points at ${path}, which cannot be read; per-person cadence overrides are inactive.`);
    }
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
