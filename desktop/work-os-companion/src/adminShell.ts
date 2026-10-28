import type { SessionResponse } from "./admin/types";
import { EMPTY_GUIDE_STATE, GUIDE_VIEWS, type GuideState } from "./guideState";

/**
 * DEV-only boot harness for the real App shell in the administration
 * workspace. `?admin-shell` (never active in a packaged build) fabricates an
 * admin session so the shell renders the administration branch the way
 * production does — the `?preview-admin` page mounts `AdminWorkspace` alone
 * and therefore cannot reproduce shell-level behavior such as the modal
 * scroll lock. `&overlay=<name>` opens one overlay on boot so rendered QA can
 * exercise open, close, and lock behavior from the admin branch:
 *
 * - `whats-new`, `profile`, `guide`, `memory` — the global layer, now mounted
 *   by both the employee workspace and the administration shell;
 * - `task-composer` — an employee-only flag set while the admin branch is on
 *   screen, to prove a flag with no rendered owner can never strand the lock.
 *
 * `&notifications=<state>` pins the masthead bell's rendered state:
 *
 * - `populated` (default) and `empty` seed the bell's own reads so its badge,
 *   sections, and rows render from real query data;
 * - `loading` and `error` pin the two flags the harness has no backend to
 *   produce, leaving the queries unseeded and disabled.
 */
export const ADMIN_SHELL_PARAM = "admin-shell";

export const ADMIN_SHELL_OVERLAYS = ["whats-new", "profile", "guide", "memory", "task-composer"] as const;
export type AdminShellOverlay = (typeof ADMIN_SHELL_OVERLAYS)[number];

export const ADMIN_SHELL_NOTIFICATION_STATES = ["populated", "empty", "loading", "error"] as const;
export type AdminShellNotificationState = (typeof ADMIN_SHELL_NOTIFICATION_STATES)[number];

export const ADMIN_SHELL_OTTO_STATES = ["chat", "recaps", "single", "multiple", "empty"] as const;
export type AdminShellOttoState = (typeof ADMIN_SHELL_OTTO_STATES)[number];

/** The synthetic follow-settings routes the dev harness can open on the
 * administration Settings page. `&settings-account=two` keeps a second admin
 * account's fixture state and revision independent; neither creates a live
 * account. */
export const ADMIN_SHELL_SETTINGS_STATES = [
  "all",
  "selected-none",
  "selected-inactive",
  "directory-error",
  "save-error",
  "conflict",
  "pagination",
] as const;
export type AdminShellSettingsState = (typeof ADMIN_SHELL_SETTINGS_STATES)[number];

export function isAdminShellBoot(search: string, dev: boolean): boolean {
  return dev && new URLSearchParams(search).has(ADMIN_SHELL_PARAM);
}

export function adminShellOverlayFor(search: string, dev: boolean): AdminShellOverlay | null {
  if (!dev) return null;
  const value = new URLSearchParams(search).get("overlay");
  return ADMIN_SHELL_OVERLAYS.find((overlay) => overlay === value) ?? null;
}

/** The bell state the harness renders; null anywhere but the dev-only boot.
 * An absent or unknown value falls back to `populated`, never to a state that
 * fails the boot. */
export function adminShellNotificationStateFor(search: string, dev: boolean): AdminShellNotificationState | null {
  if (!isAdminShellBoot(search, dev)) return null;
  const value = new URLSearchParams(search).get("notifications");
  return ADMIN_SHELL_NOTIFICATION_STATES.find((state) => state === value) ?? "populated";
}

/** The admin Otto surface this dev boot opens, if any. `chat` opens the normal
 * read-only conversation; `recaps`, `single`, `multiple` and `empty` open the
 * inbox fixture states Task 9 renders. Absent or unknown values keep it closed. */
export function adminShellOttoStateFor(search: string, dev: boolean): AdminShellOttoState | null {
  if (!isAdminShellBoot(search, dev)) return null;
  const value = new URLSearchParams(search).get("otto");
  return ADMIN_SHELL_OTTO_STATES.find((state) => state === value) ?? null;
}

/** The follow-settings fixture route; absent or unknown keeps All, which is
 * also the server's default for a newly unmapped admin. */
export function adminShellSettingsStateFor(search: string, dev: boolean): AdminShellSettingsState | null {
  if (!isAdminShellBoot(search, dev)) return null;
  const value = new URLSearchParams(search).get("settings");
  return ADMIN_SHELL_SETTINGS_STATES.find((state) => state === value) ?? "all";
}

/** `two` selects an independent synthetic admin account for the follow
 * fixture. Any other value keeps the first account. */
export function adminShellSettingsAccountFor(search: string, dev: boolean): string | null {
  if (!isAdminShellBoot(search, dev)) return null;
  return new URLSearchParams(search).get("settings-account") === "two" ? "two" : "one";
}

/** The fabricated session the harness answers the session query with: role
 * `admin` plus the debug scenario's person, so the real shell switches
 * workspaces exactly as a live admin session does. */
export const ADMIN_SHELL_SESSION: SessionResponse = {
  organizationId: "org-preview",
  role: "admin",
  personId: "debug-person-1",
  userId: "user-admin-shell",
  featureFlags: { employee_companion: true, desktop_companion: true },
};

/** The guide flags the harness boots with. `fresh` (the default) is a
 * brand-new account's, so the administration guides auto-open once each
 * exactly as they would for a first visit — the harness has no backend to hold
 * a durable record, which is the point: a reload is a fresh account. `seen`
 * marks every guide seen, which is what the film shooter boots with so a take
 * films the page rather than the guide standing on top of it. */
export const ADMIN_SHELL_GUIDE_STATES = ["fresh", "seen"] as const;
export type AdminShellGuideState = (typeof ADMIN_SHELL_GUIDE_STATES)[number];

const GUIDE_SEEN_AT = "2026-01-01T00:00:00.000Z";

export function adminShellGuideStateFor(search: string, dev: boolean): GuideState | null {
  if (!isAdminShellBoot(search, dev)) return null;
  const value = new URLSearchParams(search).get("guides");
  const state = ADMIN_SHELL_GUIDE_STATES.find((entry) => entry === value) ?? "fresh";
  if (state === "fresh") return EMPTY_GUIDE_STATE;
  return { guides: Object.fromEntries(GUIDE_VIEWS.map((view) => [view, GUIDE_SEEN_AT])), autoOpen: true };
}
