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
