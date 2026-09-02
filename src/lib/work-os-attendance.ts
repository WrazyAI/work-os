import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, syncWorktivitySession } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtActivityLog, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { projectWorktivityAttendanceWithActivity, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";
import { localDateForTimezone, zonedDateTimeToUtc } from "@/modules/work-os/companion";

const CACHE_MS = 55_000;
const STALE_OBSERVATION_MS = 6 * 60_000;
const POLL_INTERVAL_MS = 5 * 60_000;
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

/** Reconstruct the latest provider-observed session window without creating or
 * transitioning a Work OS attendance session. */
export function deriveWorktivitySessionWindow(logs: Pick<WtActivityLog, "Status" | "CreateDate">[], observedAt: string) {
  const ordered = logs
    .filter((log) => Number.isFinite(Date.parse(log.CreateDate)) && Date.parse(log.CreateDate) <= Date.parse(observedAt) + 60_000)
    .sort((left, right) => Date.parse(left.CreateDate) - Date.parse(right.CreateDate));
  let activeStart: string | null = null;
  let clockedInAt: string | null = null;
  let clockedOutAt: string | null = null;
  for (const log of ordered) {
    if ([0, 1, 2, 3].includes(log.Status)) {
      if (!activeStart) activeStart = log.CreateDate;
      clockedInAt = activeStart;
      clockedOutAt = null;
    } else if (log.Status === 4) {
      if (activeStart) clockedInAt = activeStart;
      if (clockedInAt) clockedOutAt = log.CreateDate;
      activeStart = null;
    } else if (log.Status === 5) {
      activeStart = null;
    }
  }
  return { clockedInAt, clockedOutAt };
}

/** Last provider sample that represents an observed active session. Status 5
 * means no attendance and must never extend an earlier session's duration. */
export function deriveWorktivityLastActivityAt(logs: Pick<WtActivityLog, "Status" | "CreateDate">[], observedAt: string) {
  const observationAt = Date.parse(observedAt);
  return logs
    .filter((log) => [0, 1, 2, 3].includes(log.Status) && Number.isFinite(Date.parse(log.CreateDate)) && Date.parse(log.CreateDate) <= observationAt + 60_000)
    .sort((left, right) => Date.parse(right.CreateDate) - Date.parse(left.CreateDate))[0]?.CreateDate ?? null;
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
    const sessionWindow = deriveWorktivitySessionWindow(activityLogs, observedAt);
    const activityObservedAt = deriveWorktivityLastActivityAt(activityLogs, observedAt);
    const projection = employee
      ? projectWorktivityAttendanceWithActivity(employee.Statistics, latestActivity, observedAt)
      : unknownAttendance("The mapped employee was not returned by Worktivity.", observedAt);
    if (projection.source === "worktivity") {
      projection.activityObservedAt = activityObservedAt;
      projection.clockedInAt ??= sessionWindow.clockedInAt;
      if (projection.state === "off_shift") {
        projection.clockedOutAt ??= sessionWindow.clockedOutAt ?? (projection.status === "clock_out" ? latestActivity?.CreateDate ?? null : null);
      }
      projection.providerBreakSeconds = deriveWorktivityBreakSeconds(activityLogs);
    }
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

async function persistAttendanceObservation(access: WorkOsAccess, timezone: string, projection: AttendanceProjection) {
  if (projection.source !== "worktivity" || projection.stale) return;
  const { error } = await db().from("work_attendance_observations").upsert({
    organization_id: access.organizationId,
    person_id: access.personId as string,
    provider: "worktivity",
    local_date: localDateForTimezone(new Date(projection.observedAt), timezone),
    observed_at: projection.observedAt,
    status: projection.status,
    state: projection.state,
    clocked_in_at: projection.clockedInAt,
    clocked_out_at: projection.clockedOutAt,
    activity_observed_at: projection.activityObservedAt ?? null,
    provider_break_seconds: projection.providerBreakSeconds ?? 0,
    raw: { source: "worktivity" },
  }, { onConflict: "organization_id,person_id,provider,observed_at" });
  if (error) throw new Error(`persist Worktivity attendance observation: ${error.message}`);
}

/** Reads the latest durable provider observation. This is intentionally free of
 * provider I/O so an employee's Work OS view stays available during an outage. */
export async function loadPersistedWorktivityAttendance(access: WorkOsAccess, at = new Date()) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  const { data: onboarding, error: onboardingError } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle();
  if (onboardingError) throw new Error(`load Worktivity employee timezone: ${onboardingError.message}`);
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";
  const localDate = localDateForTimezone(at, timezone);
  const { data, error } = await db().from("work_attendance_observations")
    .select("status,state,observed_at,clocked_in_at,clocked_out_at,activity_observed_at,provider_break_seconds")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).eq("provider", "worktivity")
    .eq("local_date", localDate).order("observed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`load persisted Worktivity attendance: ${error.message}`);
  if (!data) return unknownAttendance("No Worktivity observation has been received for this workday.", at.toISOString());
  const stale = at.getTime() - Date.parse(data.observed_at) > STALE_OBSERVATION_MS;
  const status = data.status as AttendanceProjection["status"];
  const state = data.state as AttendanceProjection["state"];
  return {
    source: "worktivity" as const,
    status,
    state,
    observedAt: data.observed_at,
    clockedInAt: data.clocked_in_at,
    clockedOutAt: data.clocked_out_at,
    activityObservedAt: data.activity_observed_at,
    providerBreakSeconds: data.provider_break_seconds ?? 0,
    stale,
    fallbackAllowed: stale,
    message: stale ? "Worktivity has not refreshed recently; showing the last observed status." : "Worktivity status is current.",
  } satisfies AttendanceProjection;
}

/** Fresh Worktivity attendance converges into the Work OS interval ledger.
 * Provider facts retain their provenance, while stale or unknown observations
 * never create or transition a session. */
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
  void employee;
  void latestActivity;
  void sessionStartAt;
  let session = existing;
  if (projection.source === "worktivity" && !projection.stale) {
    await persistAttendanceObservation(access, timezone, projection);
    session = await syncWorktivitySession(access, projection);
    session = await persistProviderBreaks(access, session, activityLogs, projection.observedAt, false);
    if (projection.status === "break") projection.message = "Worktivity OnBreak observed; the active workday and provider break time are synchronized.";
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

/** Reconcile a bounded set of overdue mapped employees. This runs behind the
 * scheduler; reads in the employee app consume the durable observations above. */
export async function syncDueWorktivityAttendance(limit = 8) {
  if (!worktivityConfigured()) return { attempted: 0, synced: 0, failed: 0, skipped: true };
  const now = new Date();
  const { data: people, error: peopleError } = await db().from("work_people")
    .select("id,organization_id").eq("active", true).not("worktivity_employee_id", "is", null).limit(Math.max(limit * 4, limit));
  if (peopleError) throw new Error(`load Worktivity attendance candidates: ${peopleError.message}`);
  const candidates = people ?? [];
  if (!candidates.length) return { attempted: 0, synced: 0, failed: 0, skipped: false };
  const personIds = candidates.map((person) => person.id);
  const { data: observations, error: observationsError } = await db().from("work_attendance_observations")
    .select("person_id,observed_at").eq("provider", "worktivity").in("person_id", personIds)
    .order("observed_at", { ascending: false });
  if (observationsError) throw new Error(`load Worktivity attendance freshness: ${observationsError.message}`);
  const latestByPerson = new Map<string, string>();
  for (const observation of observations ?? []) if (!latestByPerson.has(observation.person_id)) latestByPerson.set(observation.person_id, observation.observed_at);
  const due = candidates.filter((person) => {
    const observedAt = latestByPerson.get(person.id);
    return !observedAt || now.getTime() - Date.parse(observedAt) >= POLL_INTERVAL_MS;
  }).slice(0, limit);
  if (!due.length) return { attempted: 0, synced: 0, failed: 0, skipped: false };
  const organizationIds = [...new Set(due.map((person) => person.organization_id))];
  const { data: organizations, error: organizationsError } = await db().from("work_organizations")
    .select("id,legacy_owner_id,created_by").in("id", organizationIds);
  if (organizationsError) throw new Error(`load Worktivity attendance organizations: ${organizationsError.message}`);
  const actorByOrganization = new Map((organizations ?? []).map((organization) => [organization.id, organization.legacy_owner_id || organization.created_by]));
  let synced = 0;
  let failed = 0;
  for (const person of due) {
    const actorId = actorByOrganization.get(person.organization_id);
    if (!actorId) { failed += 1; continue; }
    const access = {
      ctx: { user: { id: actorId }, profile: { id: actorId } },
      organizationId: person.organization_id,
      organizationOwnerId: actorId,
      role: "admin",
      personId: person.id,
      membershipId: `system-worktivity:${person.id}`,
      featureFlags: {},
    } as unknown as WorkOsAccess;
    try {
      await observeWorktivityAttendance(access, now);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error("[work-os] background Worktivity attendance sync failed", { organizationId: person.organization_id, personId: person.id, message: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { attempted: due.length, synced, failed, skipped: false };
}

// Keep the old name for callers outside the focused checkout.
export const reconcileWorktivityAttendance = observeWorktivityAttendance;
