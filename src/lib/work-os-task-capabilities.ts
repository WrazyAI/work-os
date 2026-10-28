import { employeeTaskToday } from "@/lib/work-os-employee-tasks";
import { taskCapabilities, type TaskActor, type TaskCapabilities } from "@/lib/work-os-task-permissions";
import type { WorkOsAccess } from "@/lib/work-os-api";

export function withTaskCapabilities<T extends Record<string, any>>(tasks: T[], actor: TaskActor, today: string): Array<T & { capabilities: TaskCapabilities }> {
  return tasks.map((task) => ({ ...task, capabilities: taskCapabilities(task, actor, today) }));
}

export async function employeeToday(access: WorkOsAccess): Promise<string> {
  return employeeTaskToday(access);
}
