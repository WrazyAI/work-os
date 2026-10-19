export type WorkOsMembershipRole = "employee" | "manager" | "admin";

export interface WorkOsMembershipCandidate {
  id: string;
  organization_id: string;
  role: string;
  person_id: string | null;
  feature_flags: unknown;
  created_at: string;
}

/** Privilege order used only to break `created_at` ties. */
const ROLE_RANK: Record<WorkOsMembershipRole, number> = { admin: 0, manager: 1, employee: 2 };
const UNKNOWN_ROLE_RANK = 3;

function roleRank(role: string): number {
  return ROLE_RANK[role as WorkOsMembershipRole] ?? UNKNOWN_ROLE_RANK;
}

function createdAtMs(row: WorkOsMembershipCandidate): number {
  const parsed = Date.parse(row.created_at);
  // An unparseable timestamp must never outrank a real one.
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Choose the membership that represents a signed-in user.
 *
 * Earliest membership wins, exactly as before — that keeps an established
 * organization stable. The change is the tie: memberships created by one
 * statement share `created_at`, and leaving the choice to row order made a
 * user's organization (and therefore their role) arbitrary from one request to
 * the next. A privileged role breaks the tie, and the membership id breaks the
 * remaining one, so the result is deterministic for any input order.
 */
export function pickMembership<T extends WorkOsMembershipCandidate>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    if (compareCandidates(row, best) < 0) best = row;
  }
  return best;
}

function compareCandidates(a: WorkOsMembershipCandidate, b: WorkOsMembershipCandidate): number {
  const byCreated = createdAtMs(a) - createdAtMs(b);
  if (byCreated !== 0) return byCreated;
  const byRole = roleRank(a.role) - roleRank(b.role);
  if (byRole !== 0) return byRole;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
