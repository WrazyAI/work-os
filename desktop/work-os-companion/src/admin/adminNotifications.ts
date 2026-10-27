import { relativeTime } from "./data";
import type { SystemStatusResponse } from "./types";

/** Notification keys and copy for the administration workspace.
 *
 * Flyout receipts name exactly the outcome the API confirmed, so a card can
 * never claim more than the write it reports. Failures stay on the page's own
 * inline notice,
 * and standing conditions use stable persistent keys so the same state is
 * announced once instead of on every render. */

export const ADMIN_OVERVIEW_STALE_KEY = "admin-overview-stale";
export const ADMIN_STATUS_DEGRADED_KEY = "admin-status-degraded";

/** The overview is rebuilt per request and refreshes every minute while it is
 * open, so five missed refreshes mean the surface is no longer live. */
export const ADMIN_OVERVIEW_STALE_AFTER_MS = 10 * 60 * 1000;

/** The standing stale-overview message, or null while the snapshot is recent
 * or its timestamp is unusable (an invalid instant never claims staleness). */
export function overviewStaleMessage(generatedAt: string | null | undefined, now = Date.now()): string | null {
  const parsed = Date.parse(String(generatedAt ?? ""));
  if (!Number.isFinite(parsed)) return null;
  if (now - parsed < ADMIN_OVERVIEW_STALE_AFTER_MS) return null;
  return `This snapshot was generated ${relativeTime(String(generatedAt), now)} and may not reflect the current record.`;
}

/** The standing workspace-degradation notice the status endpoint supports:
 * schema readiness. Healthy status stays quiet. */
export function workspaceDegradedNotice(status: SystemStatusResponse | null | undefined): { title: string; message: string } | null {
  if (!status) return null;
  if (!status.schema?.ready) {
    return {
      title: "Work OS schema is not ready",
      message: "The required migration has not run, so parts of the record may be missing until it does.",
    };
  }
  return null;
}

/** The workspace role names the members table and the invite select share. */
export function adminRoleLabel(role: string): string {
  if (role === "admin") return "Administrator";
  if (role === "manager") return "Manager";
  if (role === "employee") return "Employee";
  return role || "member";
}
