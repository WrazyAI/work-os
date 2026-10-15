import type { SessionResponse } from "./admin/types";
import { EMPTY_GUIDE_STATE, type GuideState } from "./guideState";

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

/** The guide flags the harness boots with: a brand-new account's, so the
 * administration guides auto-open once each exactly as they would for a first
 * visit. The harness has no backend to hold a durable record, which is the
 * point — a reload is a fresh account. */
export const ADMIN_SHELL_GUIDE_STATE: GuideState = EMPTY_GUIDE_STATE;
