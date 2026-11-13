import { db, dateOnly } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { localDateForTimezone, type WorkOsScheduleRule } from "@/modules/work-os/companion";

/** An official arrangement only: never infer approval from an employee draft. */
export async function currentWorkArrangement(access: WorkOsAccess, at = new Date()) {
  const { data, error } = await db().from("work_schedules").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("active", true)
    .order("effective_from", { ascending: false });
  if (error) throw new Error(`load official work arrangement: ${error.message}`);
  return ((data ?? []) as WorkOsScheduleRule[]).find((rule) => {
    const date = localDateForTimezone(at, rule.timezone);
    return (dateOnly(rule.effective_from) ?? "9999") <= date && (dateOnly(rule.effective_to) ?? "9999") >= date;
  }) ?? null;
}

/** Whether this instant falls on an approved flexible workday. Leave removes
 * the day; an explicit working-day exception restores it. */
export async function isFlexibleWorkingDay(access: WorkOsAccess, at: Date, official?: WorkOsScheduleRule | null) {
  const rule = official === undefined ? await currentWorkArrangement(access, at) : official;
  if (rule?.arrangement !== "flexible") return false;
  const date = localDateForTimezone(at, rule.timezone);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data, error } = await db().from("work_schedule_exceptions").select("kind")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("exception_date", date).maybeSingle();
  if (error) throw new Error(`load flexible workday exception: ${error.message}`);
  if (data?.kind === "leave") return false;
  if (data?.kind === "working_day" || data?.kind === "changed_shift") return true;
  return Array.isArray(rule.days_of_week) && rule.days_of_week.includes(weekday);
}
