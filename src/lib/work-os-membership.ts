export type WorkOsMembershipRole = "employee" | "manager" | "admin";

export interface WorkOsMembershipCandidate {
  id: string;
  organization_id: string;
  role: string;
  person_id: string | null;
  feature_flags: unknown;
  created_at: string;
  /** Workspace name resolved by the caller for the selection UI. */
  organization_name?: string | null;
}

export type WorkOsMembershipSelection<T extends WorkOsMembershipCandidate> =
  | { kind: "selected"; membership: T }
  | { kind: "required"; memberships: T[] }
  | { kind: "none" };

/**
 * Resolve one membership only when the caller named it or there is exactly one.
 *
 * Previously the earliest `created_at` won, with a privileged role breaking a
 * tie. That silently put an account with two memberships into one workspace —
 * and after a backfill, the privileged one — so two people on the same team
 * could read different tenants. Now:
 *
 * - an explicit organization selects that membership or nothing;
 * - one active membership selects itself;
 * - more than one active membership without a choice requires the account to
 *   choose, and returns every candidate in a stable order;
 * - no memberships yields nothing.
 *
 * Role never decides the workspace. The picker is the only tie-break.
 */
export function selectWorkOsMembership<T extends WorkOsMembershipCandidate>(
  rows: readonly T[],
  organizationId?: string | null,
): WorkOsMembershipSelection<T> {
  if (organizationId) {
    const match = rows.find((row) => row.organization_id === organizationId);
    return match ? { kind: "selected", membership: match } : { kind: "none" };
  }
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "selected", membership: rows[0] };
  return { kind: "required", memberships: sortMemberships(rows) };
}

/** Stable order for the chooser: workspace name, then membership id. */
function sortMemberships<T extends WorkOsMembershipCandidate>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const byName = (left.organization_name ?? "").localeCompare(right.organization_name ?? "");
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id);
  });
}
