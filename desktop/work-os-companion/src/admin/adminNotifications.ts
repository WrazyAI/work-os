import { relativeTime } from "./data";
import type { SystemStatusResponse } from "./types";

/** Notification keys and copy for the administration workspace.
 *
 * Flyout receipts name exactly the outcome the API confirmed, so a card can
 * never claim more than the write it reports. Failures stay on the page's own
 * inline notice (with the fired-and-forgotten Nifty sync as the one exception),
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
 * schema readiness and the Nifty connection. Healthy status stays quiet. */
export function workspaceDegradedNotice(status: SystemStatusResponse | null | undefined): { title: string; message: string } | null {
  if (!status) return null;
  if (!status.schema?.ready) {
    return {
      title: "Work OS schema is not ready",
      message: "The required migration has not run, so parts of the record may be missing until it does.",
    };
  }
  if (!status.nifty?.canCallApi) {
    return {
      title: "Nifty needs a connection",
      message: "The task record cannot sync with Nifty until the connection is restored.",
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

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** The Nifty sync response reports what was read from the provider; the
 * receipt repeats exactly that and never more. An unrecognised shape falls
 * back to a plain finished line instead of inventing counts. */
export function niftySyncReceipt(result: unknown): string {
  if (!result || typeof result !== "object") return "The task record finished syncing with Nifty.";
  const nifty = (result as { nifty?: unknown }).nifty;
  if (!nifty || typeof nifty !== "object") return "The task record finished syncing with Nifty.";
  const { tasks, projects, members } = nifty as Record<string, unknown>;
  if (typeof tasks !== "number" || typeof projects !== "number" || typeof members !== "number") {
    return "The task record finished syncing with Nifty.";
  }
  const parts = [
    tasks > 0 ? countLabel(tasks, "task") : null,
    projects > 0 ? countLabel(projects, "project") : null,
    members > 0 ? countLabel(members, "member") : null,
  ].filter((part): part is string => !!part);
  if (!parts.length) return "Nifty returned no tasks, projects, or members to mirror.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `The sync read ${list} from Nifty and refreshed the mirror.`;
}
