export interface WorkOsTaskAssigneeCandidate {
  id: string;
}

export interface TaskAssigneeIdentity {
  personId: string;
  displayName: string;
  email: string | null;
}

/** Restrict assignment to the caller's canonical organization/team scope. */
export function scopedAssignableTaskPeople<T extends WorkOsTaskAssigneeCandidate>(
  people: T[],
  allowedPersonIds: string[] | null,
): T[] {
  if (allowedPersonIds === null) return people;
  const allowed = new Set(allowedPersonIds);
  return people.filter((person) => allowed.has(person.id));
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
