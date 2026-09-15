import {
  validateWorkOsBreakWindows,
  validateWorkOsDate,
  validateWorkOsDateRange,
  validateWorkOsTime,
  validateWorkOsTimezone,
} from "@/lib/work-os-schedule-validation";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { audit, db, nonEmptyString as text, type Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";

export async function listWorkOsSchedules(access: WorkOsAccess, personId?: string | string[] | null) {
  let query = db()
    .from("work_schedules")
    .select("*, person:work_people(id, display_name)")
    .eq("organization_id", access.organizationId)
    .order("effective_from", { ascending: false });
  if (Array.isArray(personId)) query = query.in("person_id", personId);
  else if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS schedules: ${error.message}`);
  return data ?? [];
}

export async function listWorkOsScheduleExceptions(access: WorkOsAccess, personId?: string | string[] | null) {
  let query = db()
    .from("work_schedule_exceptions")
    .select("*, person:work_people(id, display_name)")
    .eq("organization_id", access.organizationId)
    .gte("exception_date", new Date().toISOString().slice(0, 10))
    .order("exception_date", { ascending: true })
    .limit(200);
  if (Array.isArray(personId)) query = query.in("person_id", personId);
  else if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS schedule exceptions: ${error.message}`);
  return data ?? [];
}

export async function saveWorkOsSchedule(access: WorkOsAccess, body: Json) {
  const personId = text(body.person_id);
  if (!personId) throw new Error("person_id is required");
  const days = Array.isArray(body.days_of_week)
    ? [...new Set(body.days_of_week.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5];
  if (!days.length) throw new Error("days_of_week must include at least one day");
  const shiftStart = validateWorkOsTime(body.shift_start, "shift_start");
  const shiftEnd = validateWorkOsTime(body.shift_end, "shift_end");
  if (shiftStart === shiftEnd) throw new Error("shift_start and shift_end must be different");
  const effectiveFrom = body.effective_from ? validateWorkOsDate(body.effective_from, "effective_from") : new Date().toISOString().slice(0, 10);
  const effectiveTo = body.effective_to ? validateWorkOsDate(body.effective_to, "effective_to") : null;
  validateWorkOsDateRange(effectiveFrom, effectiveTo);
  const authoritativeBreaks = await worktivityAuthoritativeBreaks(access.organizationId);
  if (authoritativeBreaks && Array.isArray(body.break_windows) && body.break_windows.length) {
    throw new Error("Scheduled break windows are disabled because Worktivity is the break source for this organization.");
  }
  const screenshotEnabled = body.screenshot_analysis_enabled !== false;
  const screenshotInterval = Number(body.screenshot_analysis_interval_minutes ?? 60);
  if (!Number.isInteger(screenshotInterval) || screenshotInterval < 15 || screenshotInterval > 240) {
    throw new Error("screenshot_analysis_interval_minutes must be an integer between 15 and 240");
  }
  const screenshotEodLead = Number(body.screenshot_analysis_eod_lead_minutes ?? 30);
  if (!Number.isInteger(screenshotEodLead) || screenshotEodLead < 0 || screenshotEodLead > 180) {
    throw new Error("screenshot_analysis_eod_lead_minutes must be an integer between 0 and 180");
  }
  const screenshotStart = body.screenshot_analysis_start ? validateWorkOsTime(body.screenshot_analysis_start, "screenshot_analysis_start") : null;
  const screenshotEnd = body.screenshot_analysis_end ? validateWorkOsTime(body.screenshot_analysis_end, "screenshot_analysis_end") : null;
  if (!!screenshotStart !== !!screenshotEnd) throw new Error("screenshot_analysis_start and screenshot_analysis_end must be provided together");
  if (screenshotStart && screenshotStart === screenshotEnd) throw new Error("screenshot_analysis_start and screenshot_analysis_end must be different");
  const payload = {
    organization_id: access.organizationId,
    person_id: personId,
    timezone: validateWorkOsTimezone(body.timezone),
    days_of_week: days,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    break_windows: authoritativeBreaks ? [] : validateWorkOsBreakWindows(body.break_windows, shiftStart, shiftEnd),
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    active: body.active !== false,
    screenshot_analysis_enabled: screenshotEnabled,
    screenshot_analysis_interval_minutes: screenshotInterval,
    screenshot_analysis_start: screenshotStart,
    screenshot_analysis_end: screenshotEnd,
    screenshot_analysis_eod_lead_minutes: screenshotEodLead,
    created_by: access.ctx.user.id,
    updated_at: new Date().toISOString(),
  };
  const scheduleId = text(body.id);
  const query = scheduleId
    ? db().from("work_schedules").update(payload).eq("organization_id", access.organizationId).eq("id", scheduleId)
    : db().from("work_schedules").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw new Error(`save Work OS schedule: ${error.message}`);
  await audit(access, scheduleId ? "schedule.updated" : "schedule.created", "schedule", data.id as string, { personId });
  return data;
}

export async function saveWorkOsScheduleException(access: WorkOsAccess, body: Json) {
  const personId = text(body.person_id);
  const exceptionDate = body.exception_date ? validateWorkOsDate(body.exception_date, "exception_date") : null;
  const kind = text(body.kind);
  if (!personId || !exceptionDate) throw new Error("person_id and exception_date are required");
  if (!kind || !["leave", "changed_shift", "working_day"].includes(kind)) throw new Error("invalid schedule exception kind");
  const shiftStart = body.shift_start ? validateWorkOsTime(body.shift_start, "shift_start") : null;
  const shiftEnd = body.shift_end ? validateWorkOsTime(body.shift_end, "shift_end") : null;
  if (!!shiftStart !== !!shiftEnd) throw new Error("shift_start and shift_end must be provided together");
  if (shiftStart === shiftEnd && shiftStart) throw new Error("shift_start and shift_end must be different");
  const authoritativeBreaks = await worktivityAuthoritativeBreaks(access.organizationId);
  if (authoritativeBreaks && Array.isArray(body.break_windows) && body.break_windows.length) {
    throw new Error("Scheduled breaks are disabled: Worktivity OnBreak is the organization break source.");
  }
  const payload = {
    organization_id: access.organizationId,
    person_id: personId,
    exception_date: exceptionDate,
    kind,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    break_windows: authoritativeBreaks ? [] : validateWorkOsBreakWindows(body.break_windows, shiftStart ?? undefined, shiftEnd ?? undefined),
    note: text(body.note),
    created_by: access.ctx.user.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("work_schedule_exceptions")
    .upsert(payload, { onConflict: "organization_id,person_id,exception_date" })
    .select("*")
    .single();
  if (error) throw new Error(`save Work OS schedule exception: ${error.message}`);
  await audit(access, "schedule.exception_saved", "schedule_exception", data.id as string, { personId, exceptionDate, kind });
  return data;
}
