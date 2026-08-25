import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, clockIn, transitionSession } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtActivityLog, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { projectWorktivityAttendanceWithActivity, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";
import { localDateForTimezone, zonedDateTimeToUtc } from "@/modules/work-os/companion";

const CACHE_MS = 55_000;
const cache = new Map<string, { fetchedAt: number; projection: AttendanceProjection; employee: WtEmployee | null; latestActivity: WtActivityLog | null; activityLogs: WtActivityLog[]; sessionStartAt: string | null }>();
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
  for (let page = 2; page <= (first.PageCount ?? 1); page += 1) {
    const next = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", { EmployeeId: employeeId, startDate, endDate, page, pageSize: 200 });
    items.push(...(next.Items ?? []));
  }
  return items;
}

/** The provider filter is repeated locally because an upstream page can contain
 * another employee. Provider IDs are the deduplication authority across pages. */
export function normalizeWorktivityActivityLogs(logs: WtActivityLog[], employeeId: string) {
  return [...new Map(logs
    .filter((candidate) => candidate.EmployeeId === employeeId)
    .map((candidate) => [String(candidate.ID), candidate])).values()];
}

/** Worktivity Status=2 is the only provider signal counted as a break. Idle is
 * deliberately excluded: it is neither a break nor a productivity judgement. */
export function deriveWorktivityBreakSeconds(logs: Pick<WtActivityLog, "ID" | "Status" | "CreateDate">[]) {
  const ordered = [...new Map(logs
    .filter((log) => Number.isFinite(Date.parse(log.CreateDate)))
    .map((log) => [String(log.ID), log])).values()]
    .sort((left, right) => Date.parse(left.CreateDate) - Date.parse(right.CreateDate));
  const gaps = ordered.slice(1).map((log, index) => Date.parse(log.CreateDate) - Date.parse(ordered[index].CreateDate))
    .filter((gap) => gap >= 30_000 && gap <= 15 * 60_000).sort((left, right) => left - right);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60_000;
  // A status capture represents no more than one observed provider cadence.
  // This reconstructs contiguous Status=2 runs without treating Idle as a
  // break or inventing long time for missing provider observations.
  const cadenceMs = Math.max(60_000, Math.min(15 * 60_000, medianGap));
  const samples = new Map<number, Pick<WtActivityLog, "ID" | "Status" | "CreateDate">>();
  for (const log of ordered) {
    if (log.Status !== 2) continue;
    const bucket = Math.floor(Date.parse(log.CreateDate) / cadenceMs);
    if (!samples.has(bucket)) samples.set(bucket, log);
  }
  let seconds = 0;
  for (const [bucket, sample] of samples) {
    const sampleAt = Date.parse(sample.CreateDate);
    const boundary = ordered.find((candidate) => {
      const at = Date.parse(candidate.CreateDate);
      return at > sampleAt && (candidate.Status !== 2 || Math.floor(at / cadenceMs) > bucket);
    });
    seconds += Math.max(0, Math.round(Math.min(cadenceMs, boundary ? Date.parse(boundary.CreateDate) - sampleAt : cadenceMs) / 1000));
  }
  return seconds;
}

function nextLocalDate(date: string) {
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Exact employee-local calendar-day bounds for the provider request. This is
 * deliberately not a trailing duration: DST days are 23 or 25 hours. */
export function worktivityLocalDayBounds(timezone: string, at: Date) {
  const date = localDateForTimezone(at, timezone);
  return {
    date,
    start: zonedDateTimeToUtc(date, "00:00", timezone).toISOString(),
    end: zonedDateTimeToUtc(nextLocalDate(date), "00:00", timezone).toISOString(),
  };
}

async function employeeAttendance(employeeId: string, timezone: string, observedAt: string): Promise<{ projection: AttendanceProjection; employee: WtEmployee | null; latestActivity: WtActivityLog | null; activityLogs: WtActivityLog[]; sessionStartAt: string | null }> {
  const bounds = worktivityLocalDayBounds(timezone, new Date(observedAt));
  const cacheKey = `${employeeId}:${timezone}:${bounds.date}`;
  const previous = cache.get(cacheKey);
  if (previous && Date.now() - previous.fetchedAt < CACHE_MS) {
    return { employee: previous.employee, projection: { ...previous.projection, observedAt }, latestActivity: previous.latestActivity, activityLogs: previous.activityLogs, sessionStartAt: previous.sessionStartAt };
  }
  try {
    // Fetch the full employee-local day (including periods before Work OS
    // launched), with real UTC boundaries and unbounded provider pagination.
    const [data, activityItems] = await Promise.all([
      wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 }),
      loadActivityHistory(employeeId, bounds.start, bounds.end),
    ]);
    const employee = (data.Items ?? []).find((candidate) => candidate.ID === employeeId) ?? null;
    const activityLogs = normalizeWorktivityActivityLogs(activityItems, employeeId);
    const latestActivity = activityLogs
      .sort((left, right) => Date.parse(right.CreateDate) - Date.parse(left.CreateDate))[0] ?? null;
    const sessionStartAt = deriveWorktivitySessionStart(activityLogs, observedAt);
    const projection = employee
      ? projectWorktivityAttendanceWithActivity(employee.Statistics, latestActivity, observedAt)
      : unknownAttendance("The mapped employee was not returned by Worktivity.", observedAt);
    const result = { fetchedAt: Date.now(), projection, employee, latestActivity, activityLogs, sessionStartAt };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (previous) return { employee: previous.employee, projection: { ...previous.projection, observedAt, stale: true, fallbackAllowed: true, message: "Worktivity could not be refreshed; showing the last observed status." }, latestActivity: previous.latestActivity, activityLogs: previous.activityLogs, sessionStartAt: previous.sessionStartAt };
    return { employee: null, projection: unknownAttendance(error instanceof Error ? error.message : "Worktivity attendance is unavailable.", observedAt), latestActivity: null, activityLogs: [], sessionStartAt: null };
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

async function persistProviderBreaks(access: WorkOsAccess, session: Record<string, any> | null, logs: WtActivityLog[], observedAt: string, stale: boolean) {
  if (!session || stale) return session;
  const providerBreakSeconds = deriveWorktivityBreakSeconds(logs);
  const { data, error } = await db().from("work_sessions").update({
    provider_break_seconds: providerBreakSeconds,
    provider_break_observed_at: observedAt,
    provider_break_provenance: { provider: "worktivity", status: 2, logCount: logs.length, calculation: "deduped-cadence-bounded-intervals" },
    updated_at: observedAt,
  }).eq("organization_id", access.organizationId).eq("id", session.id).select("*").single();
  if (error) throw new Error(`persist Worktivity provider breaks: ${error.message}`);
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
      const result = await transitionSession(access, { action, observed_at: projection.observedAt }, `worktivity:${action}:${employeeId}:${projection.observedAt}`, "system", true);
      await recordReconciliation(access, "attendance.worktivity_resume_reconciled", { employeeId, sessionId: result.session?.id });
      return result.session;
    }
    return session;
  }
  if (status === "break" && session && ["clocked_in", "active", "eod_due"].includes(String(session.state))) {
    const result = await transitionSession(access, { action: "pause", observed_at: projection.observedAt }, `worktivity:break:${employeeId}:${projection.observedAt}`, "system", true);
    await recordReconciliation(access, "attendance.worktivity_break_reconciled", { employeeId, sessionId: result.session?.id });
    return result.session;
  }
  if (status === "clock_out" && session && String(session.state) !== "clocked_out") {
    const result = await transitionSession(access, { action: "clock_out", observed_at: projection.observedAt, extended_acknowledged: true }, `worktivity:clock_out:${employeeId}:${projection.observedAt}`, "system", true);
    await recordReconciliation(access, "attendance.worktivity_clock_out_reconciled", { employeeId, sessionId: result.session?.id });
    return result.session;
  }
  return session;
}

/**
 * Worktivity is an observational provider. Its explicit attendance states
 * reconcile the matching Work OS session idempotently, but never judge an
 * employee productive or unproductive.
 */
export async function observeWorktivityAttendance(access: WorkOsAccess, at = new Date()) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  if (!worktivityConfigured()) return { attendance: unknownAttendance("Worktivity is not configured.", at.toISOString()), session: await activeSession(access) };
  const { data: person, error } = await db().from("work_people").select("worktivity_employee_id")
    .eq("organization_id", access.organizationId).eq("id", access.personId).single();
  if (error) throw new Error(`load Worktivity person mapping: ${error.message}`);
  const employeeId = person.worktivity_employee_id as string | null;
  if (!employeeId) return { attendance: unknownAttendance("This employee is not mapped to Worktivity.", at.toISOString()), session: await activeSession(access) };
  const { data: onboarding, error: onboardingError } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle();
  if (onboardingError) throw new Error(`load Worktivity employee timezone: ${onboardingError.message}`);
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";
  const { projection, employee, latestActivity, activityLogs, sessionStartAt } = await employeeAttendance(employeeId, timezone, at.toISOString());
  const existing = await activeSession(access);
  const clockInAt = projection.clockedInAt ?? employee?.Statistics?.ClockIn ?? latestActivity?.ClockIn ?? sessionStartAt;
  // Reconcile only explicit provider attendance states. Idle stays neutral and
  // is never converted into a break or productivity judgment.
  let session = existing;
  if (projection.source === "worktivity" && !projection.stale) {
    session = await reconcileSession(access, session, projection, employeeId, clockInAt);
    session = await persistProviderBreaks(access, session, activityLogs, projection.observedAt, false);
    if (projection.status === "break") projection.message = "Worktivity OnBreak observed; provider-derived break time is refreshed.";
  }
  session = await attachObservedAttendance(access, session, projection);
  return { attendance: projection, session };
}

/** Refresh a just-closed Work OS session without reopening or otherwise
 * reconciling it. Provider failures leave the last observed break total intact. */
export async function refreshWorktivityProviderBreaks(access: WorkOsAccess, session: Record<string, any>) {
  if (!session?.id || !worktivityConfigured()) return session;
  const { data: person, error } = await db().from("work_people").select("worktivity_employee_id")
    .eq("organization_id", access.organizationId).eq("id", access.personId as string).single();
  if (error) throw new Error(`load Worktivity person mapping: ${error.message}`);
  if (!person.worktivity_employee_id) return session;
  const timezone = typeof session.timezone === "string" && session.timezone.trim() ? session.timezone : "UTC";
  const at = new Date(String(session.clocked_out_at || new Date().toISOString()));
  const result = await employeeAttendance(String(person.worktivity_employee_id), timezone, at.toISOString());
  if (result.projection.stale || result.projection.source !== "worktivity") return session;
  return persistProviderBreaks(access, session, result.activityLogs, result.projection.observedAt, false);
}

// Keep the old name for callers outside the focused checkout while preserving
// the provider's neutral observation semantics.
export const reconcileWorktivityAttendance = observeWorktivityAttendance;
