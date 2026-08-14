import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, ensureDailyPlan, shiftFor } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { projectWorktivityAttendance, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";

const CACHE_MS = 55_000;
const cache = new Map<string, { fetchedAt: number; projection: AttendanceProjection; employee: WtEmployee | null }>();
const db = () => createAdminClient();

async function employeeAttendance(employeeId: string): Promise<{ projection: AttendanceProjection; employee: WtEmployee | null }> {
  const previous = cache.get(employeeId);
  if (previous && Date.now() - previous.fetchedAt < CACHE_MS) return previous;
  try {
    const data = await wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 });
    const employee = (data.Items ?? []).find((candidate) => candidate.ID === employeeId) ?? null;
    const projection = employee
      ? projectWorktivityAttendance(employee.Statistics, new Date().toISOString())
      : unknownAttendance("The mapped employee was not returned by Worktivity.");
    const result = { fetchedAt: Date.now(), projection, employee };
    cache.set(employeeId, result);
    return result;
  } catch (error) {
    if (previous) return { employee: previous.employee, projection: { ...previous.projection, stale: true, fallbackAllowed: true, message: "Worktivity could not be refreshed; showing the last observed status." } };
    return { employee: null, projection: unknownAttendance(error instanceof Error ? error.message : "Worktivity attendance is unavailable.") };
  }
}

async function audit(access: WorkOsAccess, action: string, sessionId: string | null, metadata: Record<string, unknown>) {
  const { error } = await db().from("work_audit_log").insert({
    organization_id: access.organizationId, actor_user_id: access.ctx.user.id,
    action, target_type: "work_session", target_id: sessionId, metadata,
  });
  if (error) throw new Error(`audit attendance reconciliation: ${error.message}`);
}

export async function reconcileWorktivityAttendance(access: WorkOsAccess, at = new Date()) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  if (!worktivityConfigured()) return { attendance: unknownAttendance("Worktivity is not configured."), session: await activeSession(access) };
  const { data: person, error } = await db().from("work_people").select("worktivity_employee_id")
    .eq("organization_id", access.organizationId).eq("id", access.personId).single();
  if (error) throw new Error(`load Worktivity person mapping: ${error.message}`);
  const employeeId = person.worktivity_employee_id as string | null;
  if (!employeeId) return { attendance: unknownAttendance("This employee is not mapped to Worktivity."), session: await activeSession(access) };
  const { projection } = await employeeAttendance(employeeId);
  let session = await activeSession(access);
  if ((projection.state === "active" || projection.state === "paused") && projection.clockedInAt) {
    const observedClockIn = new Date(projection.clockedInAt);
    if (Number.isNaN(observedClockIn.getTime())) return { attendance: unknownAttendance("Worktivity returned an invalid clock-in timestamp."), session };
    const desiredState = projection.state === "paused" ? "paused" : "active";
    if (!session) {
      const shift = await shiftFor(access, observedClockIn);
      const { data: onboarding } = await db().from("work_employee_onboarding").select("timezone")
        .eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle();
      const timezone = shift?.timezone ?? onboarding?.timezone ?? "UTC";
      const key = `worktivity:${employeeId}:${observedClockIn.toISOString()}`;
      const { data: created, error: createError } = await db().from("work_sessions").insert({
        organization_id: access.organizationId, person_id: access.personId, schedule_id: shift?.scheduleId ?? null,
        shift_date: shift?.shiftDate ?? localDateForTimezone(observedClockIn, timezone), state: desiredState,
        timezone, scheduled_starts_at: shift?.startsAt ?? null, scheduled_ends_at: shift?.endsAt ?? null,
        clocked_in_at: observedClockIn.toISOString(), paused_at: desiredState === "paused" ? projection.observedAt : null,
        source: "worktivity", attendance_status: projection.status, attendance_observed_at: projection.observedAt,
        clock_in_idempotency_key: key, created_by: access.ctx.user.id,
      }).select("*").single();
      if (createError) {
        if (!/duplicate/i.test(createError.message)) throw new Error(`mirror Worktivity clock-in: ${createError.message}`);
        session = await activeSession(access);
      } else {
        session = created;
        await audit(access, "attendance.worktivity_mirrored", created.id as string, { status: projection.status, employeeId, observedClockIn: observedClockIn.toISOString(), scheduled: !!shift });
      }
    } else if (session.state !== desiredState || session.attendance_status !== projection.status) {
      const { data: updated, error: updateError } = await db().from("work_sessions").update({
        state: desiredState, paused_at: desiredState === "paused" ? projection.observedAt : null,
        attendance_status: projection.status, attendance_observed_at: projection.observedAt, updated_at: projection.observedAt,
      }).eq("organization_id", access.organizationId).eq("id", session.id).select("*").single();
      if (updateError) throw new Error(`reconcile Worktivity attendance: ${updateError.message}`);
      session = updated;
    }
    if (session) await ensureDailyPlan(access, session);
  } else if (projection.status === "clock_out" && projection.clockedOutAt && session) {
    const clockedOutAt = new Date(projection.clockedOutAt);
    if (!Number.isNaN(clockedOutAt.getTime()) && (!session.clocked_in_at || clockedOutAt.getTime() >= Date.parse(session.clocked_in_at as string))) {
      const key = `worktivity-out:${employeeId}:${clockedOutAt.toISOString()}`;
      const { data: updated, error: closeError } = await db().from("work_sessions").update({
        state: "clocked_out", clocked_out_at: clockedOutAt.toISOString(), clock_out_idempotency_key: key,
        paused_at: null, attendance_status: "clock_out", attendance_observed_at: projection.observedAt, updated_at: projection.observedAt,
      }).eq("organization_id", access.organizationId).eq("id", session.id).select("*").single();
      if (closeError) throw new Error(`mirror Worktivity clock-out: ${closeError.message}`);
      await db().from("work_daily_plans").update({ status: "closed", updated_at: projection.observedAt }).eq("session_id", session.id);
      await audit(access, "attendance.worktivity_clock_out", session.id as string, { employeeId, clockedOutAt: clockedOutAt.toISOString(), idempotencyKeyHash: createHash("sha256").update(key).digest("hex").slice(0, 12) });
      session = updated;
    }
  }
  return { attendance: projection, session };
}
