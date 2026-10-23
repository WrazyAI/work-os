import { cookies } from "next/headers";
import { hasMappedWorkOsAdminMembership } from "@/lib/work-os-api";
import {
  effectiveWorkOsViewMode,
  parseWorkOsViewMode,
  WORK_OS_VIEW_COOKIE,
  type WorkOsViewAccess,
  type WorkOsViewMode,
} from "@/modules/work-os/view-mode";

/** The raw per-device preference. Missing or unknown values mean Administration. */
export async function readStoredWorkOsViewMode(): Promise<WorkOsViewMode> {
  const store = await cookies();
  return parseWorkOsViewMode(store.get(WORK_OS_VIEW_COOKIE)?.value);
}

/** The view this caller can actually use right now (see effectiveWorkOsViewMode). */
export async function resolveWorkOsViewModeFor(access: WorkOsViewAccess): Promise<WorkOsViewMode> {
  return effectiveWorkOsViewMode(access, await readStoredWorkOsViewMode());
}

/**
 * The effective view for the administrator-only console gate.
 *
 * A stored `employee` preference only redirects the console while the account
 * still has the mapped Work OS admin membership that made the switch possible.
 * A removed mapping or a demoted role falls back to Administration rather than
 * bouncing Mission Control through the Work OS dispatcher.
 */
export async function resolveWorkOsConsoleViewMode(
  userId: string,
  stored?: WorkOsViewMode,
): Promise<WorkOsViewMode> {
  const preference = stored ?? await readStoredWorkOsViewMode();
  if (preference !== "employee") return "admin";
  return (await hasMappedWorkOsAdminMembership(userId)) ? "employee" : "admin";
}
