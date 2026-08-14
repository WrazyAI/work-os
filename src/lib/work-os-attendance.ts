import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtActivityLog, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { projectWorktivityAttendanceWithActivity, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";

const CACHE_MS = 55_000;
const cache = new Map<string, { fetchedAt: number; projection: AttendanceProjection; employee: WtEmployee | null }>();
const db = () => createAdminClient();

async function employeeAttendance(employeeId: string, observedAt: string): Promise<{ projection: AttendanceProjection; employee: WtEmployee | null }> {
  const previous = cache.get(employeeId);
  if (previous && Date.now() - previous.fetchedAt < CACHE_MS) {
    return { employee: previous.employee, projection: { ...previous.projection, observedAt } };
  }
  try {
    const end = new Date(observedAt);
    const start = new Date(end.getTime() - 12 * 60 * 60_000);
    const [data, activity] = await Promise.all([
      wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 }),
      wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", {
        EmployeeId: employeeId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        page: 1,
        pageSize: 20,
      }),
    ]);
    const employee = (data.Items ?? []).find((candidate) => candidate.ID === employeeId) ?? null;
    const latestActivity = (activity.Items ?? [])
      .filter((candidate) => candidate.EmployeeId === employeeId)
      .sort((left, right) => Date.parse(right.CreateDate) - Date.parse(left.CreateDate))[0] ?? null;
    const projection = employee
      ? projectWorktivityAttendanceWithActivity(employee.Statistics, latestActivity, observedAt)
      : unknownAttendance("The mapped employee was not returned by Worktivity.", observedAt);
    const result = { fetchedAt: Date.now(), projection, employee };
    cache.set(employeeId, result);
    return result;
  } catch (error) {
    if (previous) return { employee: previous.employee, projection: { ...previous.projection, observedAt, stale: true, fallbackAllowed: true, message: "Worktivity could not be refreshed; showing the last observed status." } };
    return { employee: null, projection: unknownAttendance(error instanceof Error ? error.message : "Worktivity attendance is unavailable.", observedAt) };
  }
}

async function attachObservedAttendance(access: WorkOsAccess, session: Record<string, any> | null, projection: AttendanceProjection) {
  if (!session || (session.attendance_status === projection.status && session.attendance_observed_at === projection.observedAt)) return session;
  const { data, error } = await db().from("work_sessions").update({
    attendance_status: projection.status,
    attendance_observed_at: projection.observedAt,
  }).eq("organization_id", access.organizationId).eq("id", session.id).select("*").single();
  if (error) throw new Error(`record Worktivity attendance context: ${error.message}`);
  return data;
}

/**
 * Worktivity is an observational provider. It may describe observed activity
 * beside an explicit Work OS session, but it never creates, clocks, pauses, or
 * closes that session.
 */
export async function observeWorktivityAttendance(access: WorkOsAccess, at = new Date()) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  if (!worktivityConfigured()) return { attendance: unknownAttendance("Worktivity is not configured.", at.toISOString()), session: await activeSession(access) };
  const { data: person, error } = await db().from("work_people").select("worktivity_employee_id")
    .eq("organization_id", access.organizationId).eq("id", access.personId).single();
  if (error) throw new Error(`load Worktivity person mapping: ${error.message}`);
  const employeeId = person.worktivity_employee_id as string | null;
  if (!employeeId) return { attendance: unknownAttendance("This employee is not mapped to Worktivity.", at.toISOString()), session: await activeSession(access) };
  const { projection } = await employeeAttendance(employeeId, at.toISOString());
  const session = await attachObservedAttendance(access, await activeSession(access), projection);
  return { attendance: projection, session };
}

// Keep the old name for callers outside the focused checkout while preserving
// the new observational semantics.
export const reconcileWorktivityAttendance = observeWorktivityAttendance;
