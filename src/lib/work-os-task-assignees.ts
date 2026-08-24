export interface WorkOsTaskAssigneeCandidate {
  id: string;
}

/**
 * Keep admin-only identities out of employee task assignment while preserving
 * the authenticated worker's own person mapping when they also hold admin
 * privileges for the organization.
 */
export function filterAssignableTaskPeople<T extends WorkOsTaskAssigneeCandidate>(
  people: T[],
  adminPersonIds: Iterable<string>,
  actorPersonId: string | null,
) {
  const administrators = new Set(adminPersonIds);
  return people.filter((person) => person.id === actorPersonId || !administrators.has(person.id));
}
