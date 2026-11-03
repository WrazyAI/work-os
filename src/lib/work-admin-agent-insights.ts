import {
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import { getAdminAgentPerson } from "@/lib/work-admin-agent-directory";
import {
  ADMIN_INSIGHT_RANGES,
  getAdminInsights,
  type AdminInsightRange,
} from "@/lib/work-os-admin-insights";
import { getAdminOverview, type AdminOverview } from "@/lib/work-os-admin-overview";

/** Overview and deterministic insights for admin tokens. Both are read-only
 * wrappers over the administration readers the dashboard already uses, so an
 * API answer and a screen answer cannot drift; this module adds only the
 * authorization, range, and person-in-organization gates the API owns. */

export type { AdminInsightRange, AdminOverview };

export type AdminAgentInsightOptions = {
  /** Optional single-person scope; the whole organization when omitted. */
  personId?: string | null;
  /** Optional inclusive end date for the window; today when omitted. */
  through?: string | null;
};

function requireAdminAccess(access: WorkOsAccess): void {
  if (access.role !== "admin") throw new WorkOsForbiddenError("Administration access is required.");
}

/** `range=7d|30d|90d`; absent means the short window. */
export function parseAdminAgentInsightRange(value: string | null | undefined): AdminInsightRange {
  const range = value?.trim() || "7d";
  if (!(ADMIN_INSIGHT_RANGES as readonly string[]).includes(range)) {
    throw new WorkOsValidationError("range must be 7d, 30d, or 90d");
  }
  return range as AdminInsightRange;
}

export async function getAdminAgentOverview(
  access: WorkOsAccess,
  date?: string,
): Promise<AdminOverview> {
  requireAdminAccess(access);
  if (date !== undefined && !isCalendarDate(date)) {
    throw new WorkOsValidationError("date must be a calendar date");
  }
  // Spread the access object so the shared reader sees this call's resolved
  // organization, role, and feature flags rather than a re-derived copy.
  return getAdminOverview({ ...access }, { date });
}

export async function getAdminAgentInsights(
  access: WorkOsAccess,
  range: AdminInsightRange,
  options: AdminAgentInsightOptions = {},
): Promise<Awaited<ReturnType<typeof getAdminInsights>>> {
  requireAdminAccess(access);
  // Validate the range before any read: an unsupported window is the caller's
  // mistake, not an empty result.
  parseAdminAgentInsightRange(range);
  const personId = options.personId?.trim() || null;
  const through = options.through?.trim() || null;
  if (through !== null && !isCalendarDate(through)) {
    throw new WorkOsValidationError("through must be a calendar date");
  }
  if (personId !== null) {
    // A person outside this organization is indistinguishable from a missing
    // id, exactly like the directory detail route.
    const person = await getAdminAgentPerson(access, personId);
    if (!person) throw new WorkOsNotFoundError("Person not found");
  }
  return getAdminInsights(access, range, { personId, through });
}
