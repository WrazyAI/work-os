import type { WorkOsAccess } from "@/lib/work-os-api";
import { db } from "@/lib/work-os-internal";
import { EOD_SHIFT_OPEN_SERVER_MESSAGE, shiftStillOpen } from "@/lib/work-os-shift-gate";
import { localDateForTimezone } from "@/modules/work-os/companion";

/** A Worktivity observation older than this is not evidence of an open shift. */
const STALE_OBSERVATION_MS = 6 * 60_000;

export type EodShiftGate =
  | { blocked: false }
  | { blocked: true; message: string };

/** Whether an EOD for `date` would describe a day that has not ended.
 *
 * The gate is scoped to the employee's current workday: the running shift
 * means today's record is incomplete, so today's report cannot be written
 * yet. An earlier day is never blocked here — its shift has ended, and a
 * backlog of past days must never be stranded by an anomaly in one old
 * session.
 *
 * The provider is the attendance authority, so a fresh Worktivity observation
 * of an active or paused employee blocks the draft even when the mirrored
 * session has not caught up yet. */
export async function eodDraftShiftGate(
  access: WorkOsAccess,
  personId: string,
  date: string,
  at = new Date(),
): Promise<EodShiftGate> {
  const { data: onboarding, error: onboardingError } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", personId).maybeSingle();
  if (onboardingError) throw new Error(`load EOD shift timezone: ${onboardingError.message}`);
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";
  if (date !== localDateForTimezone(at, timezone)) return { blocked: false };

  const [sessionResult, attendanceResult] = await Promise.all([
    db().from("work_sessions").select("state,clocked_in_at,clocked_out_at")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("shift_date", date)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_attendance_observations").select("state,observed_at")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("provider", "worktivity")
      .eq("local_date", date).order("observed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (sessionResult.error) throw new Error(`load EOD shift session: ${sessionResult.error.message}`);
  if (attendanceResult.error) throw new Error(`load EOD shift attendance: ${attendanceResult.error.message}`);
  const observedAt = attendanceResult.data?.observed_at ? Date.parse(String(attendanceResult.data.observed_at)) : Number.NaN;
  const open = shiftStillOpen({
    session: sessionResult.data ?? null,
    attendance: attendanceResult.data
      ? {
        source: "worktivity",
        state: attendanceResult.data.state,
        stale: !Number.isFinite(observedAt) || at.getTime() - observedAt > STALE_OBSERVATION_MS,
        observedAt: attendanceResult.data.observed_at,
      }
      : null,
  });
  return open ? { blocked: true, message: EOD_SHIFT_OPEN_SERVER_MESSAGE } : { blocked: false };
}

/** Whether an editable (unsubmitted) EOD draft exists for the day. A
 * refinement only ever edits a stored draft, so this is what makes the
 * refinement exemption from the open-shift gate safe. */
export async function eodDraftExists(access: WorkOsAccess, personId: string, date: string): Promise<boolean> {
  const { data, error } = await db().from("work_reports")
    .select("id,status,submitted_at")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("kind", "eod")
    .eq("report_date", date).in("status", ["draft", "rejected"]).is("submitted_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`load EOD draft for refinement: ${error.message}`);
  return !!data;
}
