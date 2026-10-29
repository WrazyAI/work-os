import { employeeTaskToday } from "@/lib/work-os-employee-tasks";
import { taskCapabilities, type TaskActor, type TaskCapabilities } from "@/lib/work-os-task-permissions";
import type { WorkOsAccess } from "@/lib/work-os-api";

/** Attach the capability payload every surface gates on. Embedded subtasks are
 * decorated one level deep too: a client that renders `task.subtasks` directly
 * must never fall back to "allowed" because only the parent carried flags. */
export function withTaskCapabilities<T extends Record<string, any>>(tasks: T[], actor: TaskActor, today: string): Array<T & { capabilities: TaskCapabilities }> {
  return tasks.map((task) => ({
    ...task,
    capabilities: taskCapabilities(task, actor, today),
    ...(Array.isArray(task.subtasks)
      ? {
        subtasks: task.subtasks.map((subtask: Record<string, any>) => ({
          ...subtask,
          capabilities: taskCapabilities(subtask, actor, today),
        })),
      }
      : {}),
  }));
}

export async function employeeToday(access: WorkOsAccess): Promise<string> {
  return employeeTaskToday(access);
}
