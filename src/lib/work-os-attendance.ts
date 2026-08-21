import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, clockIn, transitionSession } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtActivityLog, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { projectWorktivityAttendanceWithActivity, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";

const CACHE_MS = 55_000;
const cache = new Map<string, { fetchedAt: number; projection: AttendanceProjection; employee: WtEmployee | null; latestActivity: WtActivityLog | null; sessionStartAt: string | null }>();
const db = () => createAdminClient();

/** Reconstruct a provider session when Worktivity omits ClockIn timestamps. */
export function deriveWorktivitySessionStart(logs: Pick<WtActivityLog, "Status" | "CreateDate">[], observedAt: string) {
  const ordered = logs
    .filter((log) => Number.isFinite(Date.parse(log.CreateDate)) && Date.parse(log.CreateDate) <= Date.parse(observedAt) + 60_000)
    .sort((left, right) => Date.parse(left.CreateDate) - Date.parse(right.CreateDate));
  let start: string | null = null;
  for (const log of ordered) {
    if (log.Status === 4 || log.Status === 5) {
      start = null;
    } else if ([0, 1, 2, 3].includes(log.Status) && !start) {
      start = log.CreateDate;
    }
  }
  return start;
}

async function loadActivityHistory(employeeId: string, startDate: string, endDate: string) {
  const first = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", { EmployeeId: employeeId, startDate, endDate, page: 1, pageSize: 200 });
  const items = [...(first.Items ?? [])];
  for (let page = 2; page <= Math.min(first.PageCount ?? 1, 10); page += 1) {
    const next = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", { EmployeeId: employeeId, startDate, endDate, page, pageSize: 200 });
    items.push(...(next.Items ?? []));
  }
  return items;
}

async function employeeAttendance(employeeId: string, observedAt: string): Promise<{ projection: AttendanceProjection; employee: WtEmployee | null; latestActivity: WtActivityLog | null; sessionStartAt: string | null }> {
  const previous = cache.get(employeeId);
  if (previous && Date.now() - previous.fetchedAt < CACHE_MS) {
    return { employee: previous.employee, projection: { ...previous.projection, observedAt }, latestActivity: previous.latestActivity, sessionStartAt: previous.sessionStartAt };
  }
  try {
    const end = new Date(observedAt);
    const start = new Date(end.getTime() - 12 * 60 * 60_000);
    const [data, activityItems] = await Promise.all([
      wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 }),
      loadActivityHistory(employeeId, start.toISOString(), end.toISOString()),
    ]);
    const employee = (data.Items ?? []).find((candidate) => candidate.ID === employeeId) ?? null;
    const activityLogs = activityItems.filter((candidate) => candidate.EmployeeId === employeeId);
    const latestActivity = activityLogs
      .sort((left, right) => Date.parse(right.CreateDate) - Date.parse(left.CreateDate))[0] ?? null;
    const sessionStartAt = deriveWorktivitySessionStart(activityLogs, observedAt);
    const projection = employee
      ? projectWorktivityAttendanceWithActivity(employee.Statistics, latestActivity, observedAt)
      : unknownAttendance("The mapped employee was not returned by Worktivity.", observedAt);
    const result = { fetchedAt: Date.now(), projection, employee, latestActivity, sessionStartAt };
    cache.set(employeeId, result);
    return result;
  } catch (error) {
    if (previous) return { employee: previous.employee, projection: { ...previous.projection, observedAt, stale: true, fallbackAllowed: true, message: "Worktivity could not be refreshed; showing the last observed status." }, latestActivity: previous.latestActivity, sessionStartAt: previous.sessionStartAt };
    return { employee: null, projection: unknownAttendance(error instanceof Error ? error.message : "Worktivity attendance is unavailable.", observedAt), latestActivity: null, sessionStartAt: null };
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

async function recordReconciliation(access: WorkOsAccess, action: string, metadata: Record<string, unknown>) {
  const { error } = await db().from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action,
    target_type: "work_session",
    target_id: access.personId,
    metadata,
  });
  if (error) throw new Error(`record Worktivity reconciliation: ${error.message}`);
}

async function reconcileSession(
  access: WorkOsAccess,
  session: Record<string, any> | null,
  projection: AttendanceProjection,
  employeeId: string,
  clockInAt: string | null,
) {
  const status = projection.status;
  const idempotencyKey = clockInAt ? `worktivity:${employeeId}:${clockInAt}` : null;
  if (["clock_in", "working", "idle"].includes(status)) {
    if (session && clockInAt && (!session.clocked_in_at || Date.parse(clockInAt) < Date.parse(String(session.clocked_in_at)))) {
      const { data, error } = await db().from("work_sessions").update({
        clocked_in_at: clockInAt,
        updated_at: new Date().toISOString(),
      }).eq("organization_id", access.organizationId).eq("id", session.id).select("*").single();
      if (error) throw new Error(`backfill Worktivity session start: ${error.message}`);
      await recordReconciliation(access, "attendance.worktivity_start_backfilled", { employeeId, clockInAt, sessionId: session.id });
      session = data;
    }
    if (!session && idempotencyKey) {
      const result = await clockIn(access, {
        source: "system",
        observed_at: clockInAt,
        late_acknowledged: true,
        unscheduled_acknowledged: true,
      }, idempotencyKey);
      await recordReconciliation(access, "attendance.worktivity_clock_in_reconciled", { employeeId, clockInAt, sessionId: result.session?.id });
      return result.session;
    }
    if (session && ["paused", "clocked_in"].includes(String(session.state))) {
      const action = session.state === "paused" ? "resume" : "mark_active";
      const result = await transitionSession(access, { action, observed_at: projection.observedAt }, `worktivity:${action}:${employeeId}:${projection.observedAt}`);
      await recordReconciliation(access, "attendance.worktivity_resume_reconciled", { employeeId, sessionId: result.session?.id });
      return result.session;
    }
    return session;
  }
  if (status === "break" && session && ["clocked_in", "active", "eod_due"].includes(String(session.state))) {
    const result = await transitionSession(access, { action: "pause", observed_at: projection.observedAt }, `worktivity:break:${employeeId}:${projection.observedAt}`);
    await recordReconciliation(access, "attendance.worktivity_break_reconciled", { employeeId, sessionId: result.session?.id });
    return result.session;
  }
  if (status === "clock_out" && session && String(session.state) !== "clocked_out") {
    const result = await transitionSession(access, { action: "clock_out", observed_at: projection.observedAt, extended_acknowledged: true }, `worktivity:clock_out:${employeeId}:${projection.observedAt}`);
    await recordReconciliation(access, "attendance.worktivity_clock_out_reconciled", { employeeId, sessionId: result.session?.id });
    return result.session;
  }
  return session;
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
  const { projection, employee, latestActivity, sessionStartAt } = await employeeAttendance(employeeId, at.toISOString());
  const existing = await activeSession(access);
  const clockInAt = projection.clockedInAt ?? employee?.Statistics?.ClockIn ?? latestActivity?.ClockIn ?? sessionStartAt;
  let session = existing;
  if (projection.source === "worktivity" && !projection.stale) {
    session = await reconcileSession(access, existing, projection, employeeId, clockInAt);
    if (["clock_in", "working", "idle"].includes(projection.status) && session) {
      projection.message = "Worktivity session detected; Work OS planning and updates are live.";
    } else if (projection.status === "break") {
      projection.message = "Worktivity break detected; Work OS is paused.";
    } else if (projection.status === "clock_out") {
      projection.message = "Worktivity clock-out detected; Work OS session closed.";
    }
  }
  session = await attachObservedAttendance(access, session, projection);
  return { attendance: projection, session };
}

// Keep the old name for callers outside the focused checkout while preserving
// the new observational semantics.
export const reconcileWorktivityAttendance = observeWorktivityAttendance;
