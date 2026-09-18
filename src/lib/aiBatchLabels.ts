/** Status names for the batch review card.
 *
 * The employee's own task rows already carry both the column id and the human
 * status, so a proposed status move can be labelled "In review → Done" with no
 * extra query. An entry we cannot name is left unlabelled: a raw column id must
 * never reach the card. This is display-only metadata; the applied change is
 * still the validated column id. */
export interface BatchLabelEntry {
  taskId?: string;
  taskGroupId?: string;
  fromStatus?: string;
  toStatus?: string;
}

export function annotateBatchStatusNames(
  interpretation: { operations?: Array<{ tasks?: BatchLabelEntry[] }> } | undefined,
  tasks: Array<Record<string, unknown>>,
): void {
  const labelByColumn = new Map<string, string>();
  const taskById = new Map<string, Record<string, unknown>>();
  for (const task of tasks) {
    const id = typeof task.id === "string" ? task.id : null;
    if (id) taskById.set(id, task);
    const column = typeof task.task_group_id === "string" ? task.task_group_id : null;
    const label = typeof task.status === "string" ? task.status : null;
    if (column && label && !labelByColumn.has(column)) labelByColumn.set(column, label);
  }
  for (const operation of interpretation?.operations ?? []) {
    for (const entry of operation.tasks ?? []) {
      const target = entry.taskId ? taskById.get(entry.taskId) : undefined;
      const from = target && typeof target.status === "string" ? target.status : null;
      if (from) entry.fromStatus = from;
      if (entry.taskGroupId) {
        const to = labelByColumn.get(entry.taskGroupId);
        if (to) entry.toStatus = to;
      }
    }
  }
}
