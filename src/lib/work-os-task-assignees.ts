export interface WorkOsTaskAssigneeCandidate {
  id: string;
}

export interface TaskAssigneeIdentity {
  personId: string;
  displayName: string;
  email: string | null;
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

export function attachTaskAssigneeIdentities<T extends Record<string, unknown>>(
  tasks: T[],
  people: Array<{ id: string; display_name?: string | null; email?: string | null }>,
): Array<T & { assignees: TaskAssigneeIdentity[] }> {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return tasks.map((task) => ({
    ...task,
    assignees: (Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [])
      .filter((personId): personId is string => typeof personId === "string")
      .map((personId) => peopleById.get(personId))
      .filter((person): person is { id: string; display_name?: string | null; email?: string | null } => !!person)
      .map((person) => ({
        personId: person.id,
        displayName: person.display_name?.trim() || person.email?.trim() || "Organization member",
        email: person.email?.trim() || null,
      })),
  }));
}
