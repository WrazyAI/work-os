import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, clockIn, insertHistoricalWorktivitySession, syncWorktivitySession, transitionSession } from "@/lib/work-os-workday";
import { worktivityConfigured, wtPost, type WtActivityLog, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { attendanceSignature, projectWorktivityAttendanceWithActivity, unknownAttendance, type AttendanceProjection } from "@/modules/work-os/attendance";
import { localDateForTimezone, zonedDateTimeToUtc } from "@/modules/work-os/companion";
import { worktivityClockOutBoundary } from "@/modules/work-os/worktivity-control";

/** How long a provider read stays authoritative for interactive checks. The
 * companion and dashboard re-check at 30s while a clock transition is expected,
 * so this window must stay below that cadence; the 5-minute cron still filters
 * background work independently. */
const CACHE_MS = 25_000;
const ATTENDANCE_PROVIDER_TIMEOUT_MS = 12_000;
const STALE_OBSERVATION_MS = 6 * 60_000;
const POLL_INTERVAL_MS = 5 * 60_000;
type EmployeeAttendanceRead = { projection: AttendanceProjection; employee: WtEmployee | null; latestActivity: WtActivityLog | null; activityLogs: WtActivityLog[]; sessionStartAt: string | null };
const cache = new Map<string, EmployeeAttendanceRead & { fetchedAt: number }>();
/** One provider read per employee-local day at a time, so two windows polling
 * at the same moment cannot stampede Worktivity. */
const inflight = new Map<string, Promise<EmployeeAttendanceRead>>();
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

async function loadActivityHistory(employeeId: string, startDate: string, endDate: string, signal?: AbortSignal) {
  const first = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", { EmployeeId: employeeId, startDate, endDate, page: 1, pageSize: 200 }, { signal });
  const items = [...(first.Items ?? [])];
  for (let page = 2; page <= (first.PageCount ?? 1); page += 1) {
    const next = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", { EmployeeId: employeeId, startDate, endDate, page, pageSize: 200 }, { signal });
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

async function fetchEmployeeAttendance(employeeId: string, observedAt: string, cacheKey: string, bounds: { start: string; end: string }, previous: (EmployeeAttendanceRead & { fetchedAt: number }) | undefined, forceRefresh: boolean): Promise<EmployeeAttendanceRead> {
  try {
    // Fetch the full employee-local day (including periods before Work OS
    // launched), with real UTC boundaries and unbounded provider pagination.
    const signal = AbortSignal.timeout(ATTENDANCE_PROVIDER_TIMEOUT_MS);
    const [data, activityItems] = await Promise.all([
      wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 }, { signal }),
      loadActivityHistory(employeeId, bounds.start, bounds.end, signal),
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
    if (!forceRefresh && previous) return { employee: previous.employee, projection: { ...previous.projection, observedAt, stale: true, fallbackAllowed: true, message: "Worktivity could not be refreshed; showing the last observed status." }, latestActivity: previous.latestActivity, activityLogs: previous.activityLogs, sessionStartAt: previous.sessionStartAt };
    return { employee: null, projection: unknownAttendance(error instanceof Error ? error.message : "Worktivity attendance is unavailable.", observedAt), latestActivity: null, activityLogs: [], sessionStartAt: null };
  }
}

async function employeeAttendance(employeeId: string, timezone: string, observedAt: string, forceRefresh = false): Promise<EmployeeAttendanceRead> {
  const bounds = worktivityLocalDayBounds(timezone, new Date(observedAt));
  const cacheKey = `${employeeId}:${timezone}:${bounds.date}`;
  const previous = cache.get(cacheKey);
  if (!forceRefresh && previous && Date.now() - previous.fetchedAt < CACHE_MS) {
    return { employee: previous.employee, projection: { ...previous.projection, observedAt }, latestActivity: previous.latestActivity, activityLogs: previous.activityLogs, sessionStartAt: previous.sessionStartAt };
  }
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const request = fetchEmployeeAttendance(employeeId, observedAt, cacheKey, bounds, previous, forceRefresh);
  inflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (inflight.get(cacheKey) === request) inflight.delete(cacheKey);
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
    raw: { source: "worktivity", clockedOutAtInferred: projection.clockedOutAtInferred === true },
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
export async function observeWorktivityAttendance(access: WorkOsAccess, at = new Date(), options: { forceRefresh?: boolean; clockInContext?: Record<string, unknown> } = {}) {
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
  const { projection, employee, latestActivity, activityLogs, sessionStartAt } = await employeeAttendance(employeeId, timezone, at.toISOString(), options.forceRefresh === true);
  const existing = await activeSession(access);
  void employee;
  void latestActivity;
  void sessionStartAt;
  let session = existing;
  if (projection.source === "worktivity" && !projection.stale) {
    if (projection.state === "off_shift" && !projection.clockedOutAt && existing?.clocked_in_at) {
      const boundary = worktivityClockOutBoundary({ clockedInAt: String(existing.clocked_in_at), clockedOutAt: null, observedAt: projection.observedAt });
      if (boundary) {
        projection.clockedOutAt = boundary.at;
        projection.clockedOutAtInferred = boundary.inferred;
      }
    }
    await persistAttendanceObservation(access, timezone, projection);
    // A session left open on an earlier day would otherwise block today's
    // clock-in forever; close it from the stored observations first.
    await closeStaleWorktivitySessions(access).catch((error) => {
      console.error("[work-os] stale Worktivity session repair failed", { personId: access.personId, message: error instanceof Error ? error.message : "unknown" });
    });
    session = await syncWorktivitySession(access, projection, options.clockInContext);
    session = await persistProviderBreaks(access, session, activityLogs, projection.observedAt, false);
    if (projection.status === "break") projection.message = "Worktivity OnBreak observed; the active workday and provider break time are synchronized.";
  }
  session = await attachObservedAttendance(access, session, projection);
  return { attendance: projection, session };
}

/** Interactive attendance check for clients that poll at a low cadence without
 * the full day payload. It converges the session from fresh provider activity
 * (the same path a full refresh takes) and reports whether the tracked state
 * actually moved, so clients refresh their workspace only on a real transition. */
export async function observeAttendanceChange(access: WorkOsAccess, at = new Date()) {
  const beforeAttendance = await loadPersistedWorktivityAttendance(access, at);
  const beforeSession = await activeSession(access);
  const result = await observeWorktivityAttendance(access, at);
  const changed = attendanceSignature(beforeAttendance, beforeSession) !== attendanceSignature(result.attendance, result.session);
  return { attendance: result.attendance, session: result.session, changed };
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

/* ── Historical reconciliation ───────────────────────────────────────────────
 * The live observer only ever runs for "now", so a session left open (or
 * never created) on a past day blocks every later session and disappears from
 * observed-time insights. These helpers repair history from authentic provider
 * data only: stored five-minute observations, or the provider's own activity
 * logs for days before observations existed. Nothing is fabricated. */

const MIN_RECONCILED_SESSION_MS = 5 * 60_000;

/** pg returns `date` columns as local-midnight Date objects; normalize without
 * any timezone re-interpretation. */
function dateOnlyString(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value ?? "").slice(0, 10);
}

type AttendanceObservationRow = {
  observed_at: string;
  state: string | null;
  status: string | null;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
};

/** First/last observed active moment for one employee-local day. Idle and
 * break captures still belong to the observed workday; off-shift does not.
 * Always returns ISO strings: pg may hand back Date objects, and the session
 * writers only accept string timestamps. */
export function activeObservationWindow(observations: Array<Pick<AttendanceObservationRow, "observed_at" | "state">>) {
  const toIso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  const active = observations
    .filter((observation) => observation.state === "active" || observation.state === "paused")
    .sort((left, right) => Date.parse(toIso(left.observed_at)) - Date.parse(toIso(right.observed_at)));
  if (!active.length) return null;
  const clockedInAt = toIso(active[0].observed_at);
  const clockedOutAt = toIso(active[active.length - 1].observed_at);
  if (Date.parse(clockedOutAt) - Date.parse(clockedInAt) < MIN_RECONCILED_SESSION_MS) return null;
  return { clockedInAt, clockedOutAt };
}

async function observationsForLocalDate(access: WorkOsAccess, date: string) {
  const { data, error } = await db().from("work_attendance_observations")
    .select("observed_at,state,status,clocked_in_at,clocked_out_at")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("provider", "worktivity").eq("local_date", date)
    .order("observed_at", { ascending: true });
  if (error) throw new Error(`load Worktivity observations for repair: ${error.message}`);
  return (data ?? []) as AttendanceObservationRow[];
}

/** Provider activity logs for one employee-local day (used before persisted
 * observations existed). */
export async function fetchWorktivityActivityForLocalDate(employeeId: string, timezone: string, date: string) {
  const start = zonedDateTimeToUtc(date, "00:00", timezone).toISOString();
  const end = zonedDateTimeToUtc(nextLocalDate(date), "00:00", timezone).toISOString();
  const logs = await loadActivityHistory(employeeId, start, end);
  return normalizeWorktivityActivityLogs(logs, employeeId);
}

async function providerSessionWindow(employeeId: string, timezone: string, date: string) {
  const logs = await fetchWorktivityActivityForLocalDate(employeeId, timezone, date);
  const dayEnd = zonedDateTimeToUtc(nextLocalDate(date), "00:00", timezone).toISOString();
  const window = deriveWorktivitySessionWindow(logs, dayEnd);
  const lastActive = logs
    .filter((log) => [0, 1, 2, 3].includes(log.Status) && Number.isFinite(Date.parse(log.CreateDate)))
    .map((log) => log.CreateDate)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1) ?? null;
  const clockedInAt = window.clockedInAt ?? lastActive;
  const clockedOutAt = window.clockedOutAt ?? lastActive;
  if (!clockedInAt || !clockedOutAt) return null;
  if (Date.parse(clockedOutAt) - Date.parse(clockedInAt) < MIN_RECONCILED_SESSION_MS) return null;
  return { clockedInAt, clockedOutAt };
}

/** Close every open session that belongs to a day before the employee's local
 * today, using that day's last observed active moment. A stale eod_due session
 * otherwise blocks all future Worktivity clock-ins for the employee. */
export async function closeStaleWorktivitySessions(access: WorkOsAccess) {
  if (!access.personId) return { closed: 0 };
  const { data: onboarding, error: onboardingError } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).maybeSingle();
  if (onboardingError) throw new Error(`load repair timezone: ${onboardingError.message}`);
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";
  const today = localDateForTimezone(new Date(), timezone);
  const { data: open, error } = await db().from("work_sessions").select("id,shift_date")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .is("clocked_out_at", null).neq("correction_status", "needs_correction")
    .lt("shift_date", today);
  if (error) throw new Error(`load stale work sessions: ${error.message}`);
  let closed = 0;
  for (const session of open ?? []) {
    const date = dateOnlyString(session.shift_date);
    const window = activeObservationWindow(await observationsForLocalDate(access, date));
    if (!window) continue;
    await transitionSession(access, { action: "clock_out", observed_at: window.clockedOutAt, extended_acknowledged: true }, `worktivity:repair:clock-out:${session.id}`, "worktivity", true);
    closed += 1;
  }
  return { closed };
}

/** Create or close the one session for an employee-local day from authentic
 * provider evidence. Idempotent: existing closed sessions are left untouched,
 * and the transition keys make re-runs safe. */
export async function reconcileWorktivitySessionForDate(access: WorkOsAccess, date: string, options: { preferProvider?: boolean } = {}) {
  if (!access.personId || !worktivityConfigured()) return { status: "skipped" as const };
  const [{ data: person, error: personError }, { data: onboarding, error: onboardingError }] = await Promise.all([
    db().from("work_people").select("worktivity_employee_id").eq("organization_id", access.organizationId).eq("id", access.personId as string).single(),
    db().from("work_employee_onboarding").select("timezone").eq("organization_id", access.organizationId).eq("person_id", access.personId as string).maybeSingle(),
  ]);
  if (personError) throw new Error(`load repair person mapping: ${personError.message}`);
  if (onboardingError) throw new Error(`load repair timezone: ${onboardingError.message}`);
  const employeeId = person.worktivity_employee_id as string | null;
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";

  const { data: existing, error: existingError } = await db().from("work_sessions").select("id,shift_date,clocked_out_at,correction_status")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("shift_date", date)
    .order("created_at", { ascending: true });
  if (existingError) throw new Error(`load repair sessions: ${existingError.message}`);
  const rows = existing ?? [];
  const openRows = rows.filter((row) => !row.clocked_out_at && row.correction_status !== "needs_correction");
  if (rows.length && !openRows.length) return { status: "present" as const };

  const observations = await observationsForLocalDate(access, date);
  let window = activeObservationWindow(observations);
  if (!window && employeeId && (options.preferProvider === true || !observations.length)) {
    window = await providerSessionWindow(employeeId, timezone, date);
  }
  if (!window) return { status: "no_window" as const };

  if (openRows.length) {
    await transitionSession(access, { action: "clock_out", observed_at: window.clockedOutAt, extended_acknowledged: true }, `worktivity:repair:clock-out:${openRows[0].id}`, "worktivity", true);
    return { status: "closed" as const };
  }

  await closeStaleWorktivitySessions(access);
  const live = await activeSession(access);
  if (live) {
    // A live session (today) blocks the normal clock-in path. A closed
    // historical row does not violate the one-active-session invariant.
    await insertHistoricalWorktivitySession(access, { date, clockedInAt: window.clockedInAt, clockedOutAt: window.clockedOutAt, timezone });
    return { status: "created_closed" as const };
  }
  await clockIn(access, {
    observed_at: window.clockedInAt,
    source: "worktivity",
    late_acknowledged: true,
    exception_acknowledged: true,
    exception_reason: "Backfilled from stored Worktivity activity",
  }, `worktivity:repair:clock-in:${access.personId}:${date}`);
  const created = await activeSession(access);
  if (created && dateOnlyString(created.shift_date) === date) {
    await transitionSession(access, { action: "clock_out", observed_at: window.clockedOutAt, extended_acknowledged: true }, `worktivity:repair:clock-out:${created.id}`, "worktivity", true);
  }
  return { status: "created" as const };
}
