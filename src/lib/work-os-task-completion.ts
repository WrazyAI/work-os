/**
 * Completing a task also completes the open subtasks beneath it.
 *
 * A finished task never shows open work underneath it: when the employee marks
 * the parent done, the work under it is done too. The rule lives here, away
 * from the surfaces, so every place that can mark a task done — the chat
 * selection card, the companion list and task drawer, the web app's employee
 * list and drawer, and the administration task record — inherits it without any
 * surface having to remember it.
 *
 * The contract:
 *
 *   - the open subtasks close first, deepest first, then the parent closes;
 *   - a subtask that cannot close leaves its parent open, so a completed task
 *     never sits above open work (the caller reports the failure by name);
 *   - one failing subtask never stops the other subtasks from closing;
 *   - reopening a task never reopens or touches its subtasks — reopening a
 *     parent must not undo finished work.
 *
 * The module holds no database or provider code: the caller injects how to
 * find the open children and how to close one task, which keeps the rule
 * testable on its own.
 */

export interface TaskCompletionNode {
  id: string;
  title: string;
}

export interface TaskCompletionFailure<T> {
  /** The task that could not be closed. */
  task: T;
  /** Why it could not be closed. */
  message: string;
}

export interface TaskCompletionOutcome<T> {
  /** The tasks that closed, children before their parent. */
  completed: T[];
  /** The tasks that could not be closed. */
  failures: TaskCompletionFailure<T>[];
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || "The task could not be completed.";
}

export async function applyTaskCompletion<T extends TaskCompletionNode>(input: {
  /** The task the employee marked done (or reopened). */
  task: T;
  /** True when the task is being completed, false when it is being reopened. */
  completed: boolean;
  /** The open subtasks beneath a task. */
  openChildren: (task: T) => Promise<readonly T[]>;
  /** Closes one task. */
  complete: (task: T) => Promise<void>;
  /** Reopens one task. */
  reopen?: (task: T) => Promise<void>;
}): Promise<TaskCompletionOutcome<T>> {
  const completed: T[] = [];
  const failures: TaskCompletionFailure<T>[] = [];

  if (!input.completed) {
    if (!input.reopen) throw new Error("Reopening a task needs a reopen action.");
    await input.reopen(input.task);
    return { completed, failures };
  }

  // A parent link that loops back must never close the same task twice.
  const visited = new Set<string>();

  const close = async (task: T): Promise<void> => {
    if (visited.has(task.id)) return;
    visited.add(task.id);

    let children: readonly T[] = [];
    try {
      children = await input.openChildren(task);
    } catch (error) {
      failures.push({ task, message: failureMessage(error) });
      return;
    }

    let childFailed = false;
    for (const child of children) {
      const failuresBefore = failures.length;
      await close(child);
      if (failures.length > failuresBefore) childFailed = true;
    }
    // A parent stays open while any of its subtasks is still open.
    if (childFailed) return;

    try {
      await input.complete(task);
      completed.push(task);
    } catch (error) {
      failures.push({ task, message: failureMessage(error) });
    }
  };

  await close(input.task);
  return { completed, failures };
}

/**
 * The message a surface shows when the rule stopped a completion: the task
 * stayed open because a subtask under it could not be closed.
 */
export function taskCompletionFailureMessage(failures: ReadonlyArray<TaskCompletionFailure<{ title: string }>>): string {
  const names = failures.map((failure) => `“${failure.task.title}”`).join(", ");
  const reason = failures[0]?.message ?? "The subtask could not be completed.";
  return failures.length === 1
    ? `“${failures[0]?.task.title}” could not be completed, so the task above it stayed open: ${reason}`
    : `${names} could not be completed, so the task above them stayed open: ${reason}`;
}
