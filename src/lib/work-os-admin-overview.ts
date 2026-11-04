import { createAdminClient } from "@/lib/supabase/admin";
import { getPool } from "@/lib/db/pool";
import { dateOnly } from "@/lib/work-os-internal";
import { addDaysIso, todayIso } from "@/lib/work-os-dates";
import { classifyOutstandingEodDays, type OutstandingEodCandidate, type OutstandingEodDay } from "@/lib/work-os-eod";
import { observedSecondsForSession, timeSeriesFromSessions, type AdminTimeSeriesPoint } from "@/lib/work-os-admin-time-series";
import type { WorkOsAccess } from "@/lib/work-os-api";
import type { WorkOsReadinessReport } from "@/lib/work-os-readiness";

type Json = Record<string, any>;

export type AttendanceState = "active" | "paused" | "off_shift" | "unknown";
export type AttendanceFreshness = "fresh" | "stale" | "unknown";

export interface AdminOverviewPerson {
  personId: string;
  displayName: string;
  email: string | null;
  roleProfile: string | null;
  timezone: string | null;
  schedule: { start: string; end: string; daysOfWeek: number[]; timezone: string } | null;
  attendance: {
    state: AttendanceState;
    source: "worktivity" | "none";
    observedAt: string | null;
    freshness: AttendanceFreshness;
    clockedInAt: string | null;
    clockedOutAt: string | null;
  };
  session: { state: string; clockedInAt: string | null; pausedSeconds: number; observedSeconds: number; correctionStatus: string | null } | null;
  updatesToday: number;
  substantiveUpdatesToday: number;
  evidenceToday: number;
  tasksCompletedToday: number;
  lastUpdateAt: string | null;
  lastUpdateKind: string | null;
  eodToday: string | null;
  eodOutstanding: { days: number; latest: OutstandingEodDay | null } | null;
}

export interface AdminOverviewActivity {
  id: string;
  kind: "update" | "recap" | "task_completed" | "evidence" | "eod_submitted";
  at: string;
  personId: string | null;
  personName: string | null;
  title: string;
  detail: string | null;
  provenance: string | null;
}

export interface AdminOverviewAttention {
  code: string;
  severity: "info" | "warn" | "error";
  count: number;
  message: string;
  href: string | null;
}

export interface AdminOverview {
  date: string;
  generatedAt: string;
  counts: {
    people: number;
    onShift: number;
    paused: number;
    offShift: number;
    unknown: number;
    updatesToday: number;
    substantiveUpdatesToday: number;
    tasksCompletedToday: number;
    tasksOpen: number;
    tasksOverdue: number;
    evidenceToday: number;
    evidenceActivityToday: number;
    evidenceOutputToday: number;
    reportsDraftedToday: number;
    reportsSubmittedToday: number;
    reportsPendingReview: number;
    pendingReviewOldestAt: string | null;
    eodOutstandingPeople: number;
    eodOutstandingDays: number;
    disputedEvidence: number;
  };
  people: AdminOverviewPerson[];
  recentActivity: AdminOverviewActivity[];
  attention: AdminOverviewAttention[];
  /** Fourteen-day daily counts for the overview trend chart. */
  series: Array<{ date: string; completed: number; updates: number; evidence: number }>;
  /** Fourteen-day observed work time split by teammate for the stacked time chart. */
  timeSeries: AdminTimeSeriesPoint[];
  /** When each source last delivered data, so "is it syncing?" is answerable
   * without reading the database. */
  freshness: {
    niftySyncedAt: string | null;
    niftyTasksToday: number;
    worktivityObservedAt: string | null;
    githubLastEventAt: string | null;
    githubEventsToday: number;
    lastPlanAt: string | null;
    lastReportSubmittedAt: string | null;
  };
  /** Setup is read independently through /api/work-os/readiness. Kept nullable
   * for older consumers of the snapshot contract. */
  readiness: WorkOsReadinessReport | null;
}

const ATTENDANCE_STALE_MS = 10 * 60_000;
const OUTSTANDING_LOOKBACK_DAYS = 7;

/** Observation freshness uses the same ten-minute boundary as the employee
 * surfaces: a Worktivity state older than that is last-known, not current. */
export function attendanceFreshness(observedAt: string | null | undefined, now: Date): AttendanceFreshness {
  const parsed = Date.parse(String(observedAt ?? ""));
  if (!Number.isFinite(parsed)) return "unknown";
  return now.getTime() - parsed > ATTENDANCE_STALE_MS ? "stale" : "fresh";
}

export function currentScheduleForDate(schedules: Json[], personId: string, date: string): Json | null {
  const rows = schedules
    .filter((row) => String(row.person_id) === personId)
    .filter((row) => String(row.effective_from ?? "") <= date && (!row.effective_to || String(row.effective_to) >= date))
    .sort((left, right) => String(right.effective_from ?? "").localeCompare(String(left.effective_from ?? "")));
  return rows[0] ?? null;
}

function timeValue(value: unknown): string | null {
  const raw = String(value ?? "");
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  return match ? `${match[1]}:${match[2]}` : null;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Groups outstanding-EOD candidates per person and classifies each day with
 * the canonical employee rule (a submitted report clears the day; drafts and
 * rejected reports keep it visible). */
export function classifyOutstandingByPerson(candidates: Array<OutstandingEodCandidate & { personId: string }>): Map<string, OutstandingEodDay[]> {
  const byPerson = new Map<string, OutstandingEodCandidate[]>();
  for (const candidate of candidates) {
    const list = byPerson.get(candidate.personId) ?? [];
    list.push(candidate);
    byPerson.set(candidate.personId, list);
  }
  const result = new Map<string, OutstandingEodDay[]>();
  for (const [personId, list] of byPerson) {
    const days = classifyOutstandingEodDays(list).sort((left, right) => String(right.date).localeCompare(String(left.date)));
    if (days.length) result.set(personId, days);
  }
  return result;
}

export async function getAdminOverview(access: WorkOsAccess, options: { date?: string; now?: Date } = {}): Promise<AdminOverview> {
  const now = options.now ?? new Date();
  const date = options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : todayIso(now);
  const db = createAdminClient();
  const organizationId = access.organizationId;
  const outstandingFrom = addDaysIso(date, -OUTSTANDING_LOOKBACK_DAYS);
  const outstandingThrough = addDaysIso(date, -1);

  const [
    peopleResult,
    schedulesResult,
    observationsResult,
    checkInsResult,
    intervalsResult,
    evidenceResult,
    reportsTodayResult,
    completedEventsResult,
    timeSeriesSessionsResult,
    windowPlansResult,
    windowReportsResult,
    taskStatsResult,
    checkInStatsResult,
    evidenceStatsResult,
    eventStatsResult,
    reportStatsResult,
    githubStatsResult,
  ] = await Promise.all([
    db.from("work_people")
      .select("id,display_name,email,role_profile_id,nifty_member_id,worktivity_employee_id,role_profile:work_role_profiles(id,name)")
      .eq("organization_id", organizationId).eq("active", true).order("display_name"),
    db.from("work_schedules")
      .select("id,person_id,timezone,shift_start,shift_end,days_of_week,effective_from,effective_to,active")
      .eq("organization_id", organizationId).eq("active", true).order("effective_from", { ascending: false }),
    db.from("work_attendance_observations")
      .select("person_id,state,observed_at,clocked_in_at,clocked_out_at,activity_observed_at,provider_break_seconds")
      .eq("organization_id", organizationId).eq("local_date", date).order("observed_at", { ascending: false }).limit(500),
    db.from("work_check_ins")
      .select("id,person_id,kind,substantive,input_text,update_kind,occurred_at,created_at")
      .eq("organization_id", organizationId).eq("shift_date", date).order("occurred_at", { ascending: false }).limit(300),
    db.from("work_activity_intervals")
      .select("id,person_id,window_start,window_end,prompt_kind,generation_status,review_status,headline,ai_detail,final_detail,employee_feedback,timezone,structured_summary,evidence_expired_at")
      .eq("organization_id", organizationId).eq("local_date", date).order("window_end", { ascending: false }).limit(80),
    db.from("work_evidence")
      .select("id,person_id,source,title,summary,evidence_date,created_at")
      .eq("organization_id", organizationId).eq("evidence_date", date).order("created_at", { ascending: false }).limit(300),
    db.from("work_reports")
      .select("id,person_id,report_date,status,title,submitted_at,reviewed_at,manager_notes")
      .eq("organization_id", organizationId).eq("report_date", date).limit(200),
    db.from("work_task_day_events")
      .select("id,person_id,local_date,event_type,exact_at,observed_at,task_snapshot")
      .eq("organization_id", organizationId).eq("local_date", date).eq("event_type", "completed")
      .order("observed_at", { ascending: false }).limit(300),
    // Fourteen-day observed work time per person for the stacked time chart.
    db.from("work_sessions")
      .select("id,person_id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,attendance_status,attendance_observed_at,correction_status")
      .eq("organization_id", organizationId)
      .gte("shift_date", addDaysIso(date, -13)).lte("shift_date", date),
    db.from("work_daily_plans")
      .select("person_id,shift_date")
      .eq("organization_id", organizationId).gte("shift_date", outstandingFrom).lte("shift_date", outstandingThrough),
    db.from("work_reports")
      .select("id,person_id,report_date,status,submitted_at")
      .eq("organization_id", organizationId).gte("report_date", outstandingFrom).lte("report_date", outstandingThrough),
    // Counts and source freshness share a scan; detail caps never bound totals.
    getPool().query(`select
      count(*) filter (where completed = false and status not in ('archived','deleted'))::int as open,
      count(*) filter (where completed = false and status not in ('archived','deleted') and due_date < $2::date)::int as overdue,
      count(*) filter (where created_at >= $2::date::timestamp at time zone 'UTC')::int as created,
      max(updated_at) as updated_at from work_tasks where organization_id = $1`, [organizationId, date]),
    getPool().query(`select shift_date, person_id, count(*)::int as total,
      count(*) filter (where substantive = true)::int as substantive,
      (array_agg(coalesce(occurred_at, created_at) order by occurred_at desc))[1] as last_at,
      (array_agg(coalesce(nullif(update_kind, ''), kind) order by occurred_at desc))[1] as last_kind
      from work_check_ins where organization_id = $1 and shift_date between $2::date and $3::date
      group by shift_date, person_id`, [organizationId, addDaysIso(date, -13), date]),
    getPool().query(`select e.evidence_date, e.person_id, count(*)::int as total,
      count(*) filter (where e.source = 'worktivity')::int as activity,
      count(*) filter (where exists (select 1 from work_evidence_events event
        where event.id = e.evidence_event_id and event.organization_id = e.organization_id
          and event.correction_status = 'disputed'))::int as disputed
      from work_evidence e where e.organization_id = $1 and e.evidence_date between $2::date and $3::date
      group by e.evidence_date, e.person_id`, [organizationId, addDaysIso(date, -13), date]),
    getPool().query(`select local_date, person_id, count(*)::int as total from work_task_day_events
      where organization_id = $1 and event_type = 'completed' and local_date between $2::date and $3::date
      group by local_date, person_id`, [organizationId, addDaysIso(date, -13), date]),
    getPool().query(`select
      count(*) filter (where report_date = $2::date and status = 'draft')::int as drafted,
      count(*) filter (where report_date = $2::date and status in ('pending_review','approved'))::int as submitted,
      count(*) filter (where status = 'pending_review')::int as pending,
      coalesce(min(submitted_at) filter (where status = 'pending_review'),
        (min(report_date) filter (where status = 'pending_review'))::timestamp at time zone 'UTC') as oldest_at,
      max(submitted_at) as submitted_at from work_reports where organization_id = $1`, [organizationId, date]),
    getPool().query(`select max(occurred_at) as occurred_at,
      (select max(observed_at) from work_attendance_observations where organization_id = $1) as attendance_at,
      (select max(updated_at) from work_daily_plans where organization_id = $1) as plan_at,
      count(*) filter (where occurred_at >= $2::date::timestamp at time zone 'UTC')::int as total
      from work_evidence_events where organization_id = $1 and provider = 'github'`, [organizationId, date]),
  ]);

  for (const [label, result] of [
    ["people", peopleResult], ["schedules", schedulesResult], ["attendance", observationsResult],
    ["check-ins", checkInsResult], ["activity intervals", intervalsResult], ["evidence", evidenceResult],
    ["reports", reportsTodayResult], ["completed events", completedEventsResult],
    ["time series sessions", timeSeriesSessionsResult],
    ["outstanding plans", windowPlansResult], ["outstanding reports", windowReportsResult],
  ] as const) {
    if (result.error) throw new Error(`load admin overview ${label}: ${result.error.message}`);
  }

  const people = (peopleResult.data ?? []) as Json[];
  const schedules = (schedulesResult.data ?? []) as Json[];
  const sessions = ((timeSeriesSessionsResult.data ?? []) as Json[]).filter((row) => dateOnly(row.shift_date) === date);
  const observations = (observationsResult.data ?? []) as Json[];
  const checkIns = (checkInsResult.data ?? []) as Json[];
  const intervals = (intervalsResult.data ?? []) as Json[];
  const evidence = (evidenceResult.data ?? []) as Json[];
  const reportsToday = (reportsTodayResult.data ?? []) as Json[];
  const completedEvents = (completedEventsResult.data ?? []) as Json[];

  const personName = new Map(people.map((person) => [String(person.id), String(person.display_name)]));
  const latestObservation = new Map<string, Json>();
  for (const row of observations) {
    const personId = String(row.person_id);
    if (!latestObservation.has(personId)) latestObservation.set(personId, row);
  }
  const latestSession = new Map<string, Json>();
  for (const row of sessions) {
    const personId = String(row.person_id);
    const existing = latestSession.get(personId);
    const rowAt = Date.parse(String(row.clocked_in_at ?? "")) || 0;
    const existingAt = existing ? Date.parse(String(existing.clocked_in_at ?? "")) || 0 : -1;
    if (!existing || rowAt >= existingAt) latestSession.set(personId, row);
  }
  const reportByPerson = new Map<string, Json>();
  for (const row of reportsToday) {
    const personId = String(row.person_id ?? "");
    if (!personId) continue;
    const existing = reportByPerson.get(personId);
    // Prefer the furthest-along status when several reports exist for a day.
    const rank = (status: string) => (["draft", "rejected", "pending_review", "approved"].indexOf(status) + 1);
    if (!existing || rank(String(row.status)) > rank(String(existing.status))) reportByPerson.set(personId, row);
  }
  const evidenceByPerson = new Map<string, number>();
  for (const row of evidenceStatsResult.rows.filter((row) => dateOnly(row.evidence_date) === date)) {
    const personId = String(row.person_id ?? "");
    if (personId) evidenceByPerson.set(personId, Number(row.total));
  }
  const completedByPerson = new Map<string, number>();
  for (const row of eventStatsResult.rows.filter((row) => dateOnly(row.local_date) === date)) {
    const personId = String(row.person_id ?? "");
    if (personId) completedByPerson.set(personId, Number(row.total));
  }
  const checkInStatsByPerson = new Map(checkInStatsResult.rows
    .filter((row) => dateOnly(row.shift_date) === date).map((row) => [String(row.person_id), row]));
  const todayCheckIns = checkInStatsResult.rows.filter((row) => dateOnly(row.shift_date) === date);
  const todayEvidence = evidenceStatsResult.rows.filter((row) => dateOnly(row.evidence_date) === date);
  const todayEvents = eventStatsResult.rows.filter((row) => dateOnly(row.local_date) === date);
  const sum = (rows: Json[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const taskStats = taskStatsResult.rows[0];
  const reportStats = reportStatsResult.rows[0];

  // Outstanding EOD days across the lookback window.
  const outstandingCandidates: Array<OutstandingEodCandidate & { personId: string }> = [];
  const plansByPersonDate = new Map<string, number>();
  for (const plan of (windowPlansResult.data ?? []) as Json[]) {
    const key = `${plan.person_id}:${dateOnly(plan.shift_date)}`;
    plansByPersonDate.set(key, (plansByPersonDate.get(key) ?? 0) + 1);
  }
  const reportsByPersonDate = new Map<string, Json>();
  for (const report of (windowReportsResult.data ?? []) as Json[]) {
    reportsByPersonDate.set(`${report.person_id}:${dateOnly(report.report_date)}`, report);
  }
  const completedByPersonDate = new Map<string, number>();
  for (const event of eventStatsResult.rows) {
    const eventDate = dateOnly(event.local_date);
    if (!eventDate || eventDate < outstandingFrom || eventDate > outstandingThrough) continue;
    completedByPersonDate.set(`${event.person_id}:${eventDate}`, Number(event.total));
  }
  const sessionKeys = new Set<string>();
  for (const session of (timeSeriesSessionsResult.data ?? []) as Json[]) {
    const sessionDate = dateOnly(session.shift_date);
    if (!sessionDate || sessionDate < outstandingFrom || sessionDate > outstandingThrough) continue;
    const key = `${session.person_id}:${sessionDate}`;
    if (sessionKeys.has(key)) continue;
    sessionKeys.add(key);
    const report = reportsByPersonDate.get(key) ?? null;
    outstandingCandidates.push({
      personId: String(session.person_id),
      date: sessionDate,
      hasSession: true,
      observedMinutes: Math.round(observedSecondsForSession(session, now) / 60),
      hasPlan: plansByPersonDate.has(key),
      completedTasks: completedByPersonDate.get(key) ?? 0,
      report: report ? { id: String(report.id), status: String(report.status), submitted: Boolean(report.submitted_at) } : null,
    });
  }
  // A plan without a session still represents a day of intent.
  for (const [key] of plansByPersonDate) {
    if (sessionKeys.has(key)) continue;
    const [personId, planDate] = key.split(":");
    const report = reportsByPersonDate.get(key) ?? null;
    outstandingCandidates.push({
      personId,
      date: planDate,
      hasSession: false,
      observedMinutes: 0,
      hasPlan: true,
      completedTasks: completedByPersonDate.get(key) ?? 0,
      report: report ? { id: String(report.id), status: String(report.status), submitted: Boolean(report.submitted_at) } : null,
    });
  }
  const outstandingByPerson = classifyOutstandingByPerson(outstandingCandidates);
  let eodOutstandingDays = 0;
  for (const days of outstandingByPerson.values()) eodOutstandingDays += days.length;

  const personRows: AdminOverviewPerson[] = people.map((person) => {
    const personId = String(person.id);
    const observation = latestObservation.get(personId) ?? null;
    const session = latestSession.get(personId) ?? null;
    const schedule = currentScheduleForDate(schedules, personId, date);
    const personUpdates = checkInStatsByPerson.get(personId);
    const state = (String(observation?.state ?? session?.attendance_status ?? "unknown")) as AttendanceState;
    const outstandingDays = outstandingByPerson.get(personId) ?? [];
    const roleProfile = Array.isArray(person.role_profile) ? person.role_profile[0] : person.role_profile;
    return {
      personId,
      displayName: String(person.display_name),
      email: person.email ? String(person.email) : null,
      roleProfile: roleProfile?.name ? String(roleProfile.name) : null,
      timezone: schedule ? String(schedule.timezone ?? "UTC") : null,
      schedule: schedule
        ? {
            start: timeValue(schedule.shift_start) ?? "09:00",
            end: timeValue(schedule.shift_end) ?? "17:00",
            daysOfWeek: Array.isArray(schedule.days_of_week) ? schedule.days_of_week.map(Number) : [1, 2, 3, 4, 5],
            timezone: String(schedule.timezone ?? "UTC"),
          }
        : null,
      attendance: {
        state: ["active", "paused", "off_shift", "unknown"].includes(state) ? state : "unknown",
        source: observation ? "worktivity" : "none",
        observedAt: isoOrNull(observation?.observed_at),
        freshness: attendanceFreshness(observation?.observed_at, now),
        clockedInAt: isoOrNull(observation?.clocked_in_at ?? session?.clocked_in_at),
        clockedOutAt: isoOrNull(observation?.clocked_out_at ?? session?.clocked_out_at),
      },
      session: session
        ? {
            state: String(session.state ?? "scheduled"),
            clockedInAt: isoOrNull(session.clocked_in_at),
            pausedSeconds: Number(session.paused_seconds ?? 0) || 0,
            observedSeconds: observedSecondsForSession(session, now),
            correctionStatus: session.correction_status ? String(session.correction_status) : null,
          }
        : null,
      updatesToday: Number(personUpdates?.total ?? 0),
      substantiveUpdatesToday: Number(personUpdates?.substantive ?? 0),
      evidenceToday: evidenceByPerson.get(personId) ?? 0,
      tasksCompletedToday: completedByPerson.get(personId) ?? 0,
      lastUpdateAt: isoOrNull(personUpdates?.last_at),
      lastUpdateKind: personUpdates?.last_kind ? String(personUpdates.last_kind) : null,
      eodToday: reportByPerson.get(personId)?.status ? String(reportByPerson.get(personId)?.status) : null,
      eodOutstanding: outstandingDays.length
        ? { days: outstandingDays.length, latest: outstandingDays[0] ?? null }
        : null,
    };
  });

  const recentActivity: AdminOverviewActivity[] = [];
  for (const update of checkIns.slice(0, 20)) {
    recentActivity.push({
      id: `update:${update.id}`,
      kind: "update",
      at: isoOrNull(update.occurred_at ?? update.created_at) ?? new Date().toISOString(),
      personId: update.person_id ? String(update.person_id) : null,
      personName: update.person_id ? personName.get(String(update.person_id)) ?? null : null,
      title: update.substantive === true ? "Progress update" : "Check-in",
      detail: String(update.input_text ?? "").slice(0, 220) || null,
      provenance: update.update_kind ? String(update.update_kind).replaceAll("_", " ") : null,
    });
  }
  for (const interval of intervals.slice(0, 20)) {
    if (String(interval.generation_status) !== "ready" && !interval.headline) continue;
    recentActivity.push({
      id: `recap:${interval.id}`,
      kind: "recap",
      at: isoOrNull(interval.window_end) ?? new Date().toISOString(),
      personId: interval.person_id ? String(interval.person_id) : null,
      personName: interval.person_id ? personName.get(String(interval.person_id)) ?? null : null,
      title: interval.headline ? String(interval.headline) : "Activity recap",
      detail: String(interval.final_detail ?? interval.ai_detail ?? "").slice(0, 260) || null,
      provenance:
        String(interval.review_status) === "confirmed"
          ? "employee confirmed"
          : String(interval.review_status) === "amended"
            ? "employee amended"
            : "AI-inferred, not reviewed",
    });
  }
  for (const event of completedEvents.slice(0, 20)) {
    const snapshot = (event.task_snapshot ?? {}) as Json;
    recentActivity.push({
      id: `task:${event.id}`,
      kind: "task_completed",
      at: isoOrNull(event.exact_at ?? event.observed_at) ?? new Date().toISOString(),
      personId: event.person_id ? String(event.person_id) : null,
      personName: event.person_id ? personName.get(String(event.person_id)) ?? null : null,
      title: String(snapshot.title ?? "Task completed"),
      detail: snapshot.project_name ? String(snapshot.project_name) : null,
      provenance: "task record",
    });
  }
  for (const item of evidence.slice(0, 20)) {
    recentActivity.push({
      id: `evidence:${item.id}`,
      kind: "evidence",
      at: isoOrNull(item.created_at) ?? new Date().toISOString(),
      personId: item.person_id ? String(item.person_id) : null,
      personName: item.person_id ? personName.get(String(item.person_id)) ?? null : null,
      title: String(item.title ?? "Evidence"),
      detail: String(item.summary ?? "").slice(0, 200) || null,
      provenance: String(item.source ?? "evidence"),
    });
  }
  for (const report of reportsToday) {
    if (!report.submitted_at) continue;
    recentActivity.push({
      id: `report:${report.id}`,
      kind: "eod_submitted",
      at: isoOrNull(report.submitted_at) ?? new Date().toISOString(),
      personId: report.person_id ? String(report.person_id) : null,
      personName: report.person_id ? personName.get(String(report.person_id)) ?? null : null,
      title: "EOD report submitted",
      detail: String(report.title ?? ""),
      provenance: String(report.status ?? "").replaceAll("_", " "),
    });
  }
  recentActivity.sort((left, right) => right.at.localeCompare(left.at));

  const counts = {
    people: people.length,
    onShift: personRows.filter((person) => person.attendance.state === "active" || person.attendance.state === "paused").length,
    paused: personRows.filter((person) => person.attendance.state === "paused").length,
    offShift: personRows.filter((person) => person.attendance.state === "off_shift").length,
    unknown: personRows.filter((person) => person.attendance.state === "unknown").length,
    updatesToday: sum(todayCheckIns, "total"),
    substantiveUpdatesToday: sum(todayCheckIns, "substantive"),
    tasksCompletedToday: sum(todayEvents, "total"),
    tasksOpen: Number(taskStats.open),
    tasksOverdue: Number(taskStats.overdue),
    evidenceToday: sum(todayEvidence, "total"),
    evidenceActivityToday: sum(todayEvidence, "activity"),
    evidenceOutputToday: sum(todayEvidence, "total") - sum(todayEvidence, "activity"),
    reportsDraftedToday: Number(reportStats.drafted),
    reportsSubmittedToday: Number(reportStats.submitted),
    reportsPendingReview: Number(reportStats.pending),
    pendingReviewOldestAt: isoOrNull(reportStats.oldest_at),
    eodOutstandingPeople: outstandingByPerson.size,
    eodOutstandingDays,
    disputedEvidence: sum(todayEvidence, "disputed"),
  };

  const seriesDates = Array.from({ length: 14 }, (_, index) => addDaysIso(date, index - 13));
  const seriesBuckets = new Map(seriesDates.map((day) => [day, { date: day, completed: 0, updates: 0, evidence: 0 }]));
  for (const row of eventStatsResult.rows) {
    const bucket = seriesBuckets.get(dateOnly(row.local_date) ?? "");
    if (bucket) bucket.completed += Number(row.total);
  }
  for (const row of checkInStatsResult.rows) {
    const bucket = seriesBuckets.get(dateOnly(row.shift_date) ?? "");
    if (bucket) bucket.updates += Number(row.total);
  }
  for (const row of evidenceStatsResult.rows) {
    const bucket = seriesBuckets.get(dateOnly(row.evidence_date) ?? "");
    if (bucket) bucket.evidence += Number(row.total);
  }
  const series = seriesDates.map((day) => seriesBuckets.get(day)!);
  const timeSeries = timeSeriesFromSessions(
    (timeSeriesSessionsResult.data ?? []) as Json[],
    seriesDates,
    now,
    (personId) => personName.get(personId) ?? null,
  );
  const freshness = {
    niftySyncedAt: isoOrNull(taskStats.updated_at),
    niftyTasksToday: Number(taskStats.created),
    worktivityObservedAt: isoOrNull(githubStatsResult.rows[0].attendance_at),
    githubLastEventAt: isoOrNull(githubStatsResult.rows[0].occurred_at),
    githubEventsToday: Number(githubStatsResult.rows[0].total),
    lastPlanAt: isoOrNull(githubStatsResult.rows[0].plan_at),
    lastReportSubmittedAt: isoOrNull(reportStats.submitted_at),
  };

  const attention: AdminOverviewAttention[] = [];
  if (counts.reportsPendingReview > 0) {
    attention.push({
      code: "reports_pending_review",
      severity: "warn",
      count: counts.reportsPendingReview,
      message: `${counts.reportsPendingReview} EOD report${counts.reportsPendingReview === 1 ? "" : "s"} awaiting review`,
      href: "/work-os/admin/review",
    });
  }
  if (counts.eodOutstandingPeople > 0) {
    attention.push({
      code: "eod_outstanding",
      severity: "warn",
      count: counts.eodOutstandingPeople,
      message: `${counts.eodOutstandingPeople} teammate${counts.eodOutstandingPeople === 1 ? "" : "s"} with ${counts.eodOutstandingDays} unsubmitted EOD day${counts.eodOutstandingDays === 1 ? "" : "s"}`,
      href: "/work-os/admin/review",
    });
  }
  if (counts.tasksOverdue > 0) {
    attention.push({
      code: "tasks_overdue",
      severity: "warn",
      count: counts.tasksOverdue,
      message: `${counts.tasksOverdue} overdue task${counts.tasksOverdue === 1 ? "" : "s"} across the workspace`,
      href: "/work-os/admin/tasks",
    });
  }
  if (counts.disputedEvidence > 0) {
    attention.push({
      code: "evidence_disputed",
      severity: "warn",
      count: counts.disputedEvidence,
      message: `${counts.disputedEvidence} disputed evidence item${counts.disputedEvidence === 1 ? "" : "s"}`,
      href: "/work-os/admin/evidence",
    });
  }
  return { date, generatedAt: now.toISOString(), counts, people: personRows, recentActivity: recentActivity.slice(0, 24), attention, series, timeSeries, freshness, readiness: null };
}
