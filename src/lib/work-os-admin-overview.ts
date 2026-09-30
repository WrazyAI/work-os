import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysIso, todayIso } from "@/lib/work-os-dates";
import { classifyOutstandingEodDays, type OutstandingEodCandidate, type OutstandingEodDay } from "@/lib/work-os-eod";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { loadWorkOsReadinessReport } from "@/lib/work-os-readiness-report";

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
  readiness: Awaited<ReturnType<typeof loadWorkOsReadinessReport>> | null;
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

function observedSecondsForSession(session: Json, now: Date): number {
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start)) return 0;
  const rawEnd = session.clocked_out_at ? Date.parse(String(session.clocked_out_at)) : now.getTime();
  if (!Number.isFinite(rawEnd)) return 0;
  const paused = Number(session.paused_seconds ?? 0) || 0;
  return Math.max(0, Math.round((rawEnd - start) / 1000) - paused);
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
    sessionsResult,
    observationsResult,
    checkInsResult,
    intervalsResult,
    evidenceResult,
    reportsTodayResult,
    pendingReportsResult,
    completedEventsResult,
    openTasksResult,
    overdueTasksResult,
    windowSessionsResult,
    windowPlansResult,
    windowReportsResult,
    windowEventsResult,
    readiness,
  ] = await Promise.all([
    db.from("work_people")
      .select("id,display_name,email,role_profile_id,nifty_member_id,worktivity_employee_id,role_profile:work_role_profiles(id,name)")
      .eq("organization_id", organizationId).eq("active", true).order("display_name"),
    db.from("work_schedules")
      .select("id,person_id,timezone,shift_start,shift_end,days_of_week,effective_from,effective_to,active")
      .eq("organization_id", organizationId).eq("active", true).order("effective_from", { ascending: false }),
    db.from("work_sessions")
      .select("id,person_id,state,clocked_in_at,clocked_out_at,paused_seconds,attendance_status,attendance_observed_at,correction_status,correction_reason,last_substantive_update_at")
      .eq("organization_id", organizationId).eq("shift_date", date),
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
      .select("id,person_id,source,title,summary,evidence_date,created_at,metrics,event:work_evidence_events(correction_status,evidence_class,screenshot:work_screenshot_summaries(id,processing_status,deleted_at))")
      .eq("organization_id", organizationId).eq("evidence_date", date).order("created_at", { ascending: false }).limit(300),
    db.from("work_reports")
      .select("id,person_id,report_date,status,title,submitted_at,reviewed_at,manager_notes")
      .eq("organization_id", organizationId).eq("report_date", date).limit(200),
    db.from("work_reports")
      .select("id,person_id,report_date,status,title,submitted_at,person:work_people(id,display_name)")
      .eq("organization_id", organizationId).eq("status", "pending_review").order("submitted_at", { ascending: true }).limit(200),
    db.from("work_task_day_events")
      .select("id,person_id,local_date,event_type,exact_at,observed_at,task_snapshot")
      .eq("organization_id", organizationId).eq("local_date", date).eq("event_type", "completed")
      .order("observed_at", { ascending: false }).limit(300),
    db.from("work_tasks").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("completed", false).not("status", "in", "(archived,deleted)"),
    db.from("work_tasks").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("completed", false).not("status", "in", "(archived,deleted)")
      .not("due_date", "is", null).lt("due_date", date),
    db.from("work_sessions")
      .select("person_id,shift_date,clocked_in_at,clocked_out_at,paused_seconds,correction_status")
      .eq("organization_id", organizationId).gte("shift_date", outstandingFrom).lte("shift_date", outstandingThrough),
    db.from("work_daily_plans")
      .select("person_id,shift_date")
      .eq("organization_id", organizationId).gte("shift_date", outstandingFrom).lte("shift_date", outstandingThrough),
    db.from("work_reports")
      .select("id,person_id,report_date,status,submitted_at")
      .eq("organization_id", organizationId).gte("report_date", outstandingFrom).lte("report_date", outstandingThrough),
    db.from("work_task_day_events")
      .select("person_id,local_date")
      .eq("organization_id", organizationId).eq("event_type", "completed")
      .gte("local_date", outstandingFrom).lte("local_date", outstandingThrough),
    loadWorkOsReadinessReport(access).catch(() => null),
  ]);

  for (const [label, result] of [
    ["people", peopleResult], ["schedules", schedulesResult], ["sessions", sessionsResult], ["attendance", observationsResult],
    ["check-ins", checkInsResult], ["activity intervals", intervalsResult], ["evidence", evidenceResult],
    ["reports", reportsTodayResult], ["pending reports", pendingReportsResult], ["completed events", completedEventsResult],
    ["open tasks", openTasksResult], ["overdue tasks", overdueTasksResult], ["outstanding sessions", windowSessionsResult],
    ["outstanding plans", windowPlansResult], ["outstanding reports", windowReportsResult], ["outstanding events", windowEventsResult],
  ] as const) {
    if (result.error) throw new Error(`load admin overview ${label}: ${result.error.message}`);
  }

  const people = (peopleResult.data ?? []) as Json[];
  const schedules = (schedulesResult.data ?? []) as Json[];
  const sessions = (sessionsResult.data ?? []) as Json[];
  const observations = (observationsResult.data ?? []) as Json[];
  const checkIns = (checkInsResult.data ?? []) as Json[];
  const intervals = (intervalsResult.data ?? []) as Json[];
  const evidence = (evidenceResult.data ?? []) as Json[];
  const reportsToday = (reportsTodayResult.data ?? []) as Json[];
  const pendingReports = (pendingReportsResult.data ?? []) as Json[];
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
  const updatesByPerson = new Map<string, Json[]>();
  for (const row of checkIns) {
    const personId = String(row.person_id);
    const list = updatesByPerson.get(personId) ?? [];
    list.push(row);
    updatesByPerson.set(personId, list);
  }
  const evidenceByPerson = new Map<string, number>();
  for (const row of evidence) {
    const personId = String(row.person_id ?? "");
    if (personId) evidenceByPerson.set(personId, (evidenceByPerson.get(personId) ?? 0) + 1);
  }
  const completedByPerson = new Map<string, number>();
  for (const row of completedEvents) {
    const personId = String(row.person_id ?? "");
    if (personId) completedByPerson.set(personId, (completedByPerson.get(personId) ?? 0) + 1);
  }

  // Outstanding EOD days across the lookback window.
  const outstandingCandidates: Array<OutstandingEodCandidate & { personId: string }> = [];
  const plansByPersonDate = new Map<string, number>();
  for (const plan of (windowPlansResult.data ?? []) as Json[]) {
    plansByPersonDate.set(`${plan.person_id}:${plan.shift_date}`, (plansByPersonDate.get(`${plan.person_id}:${plan.shift_date}`) ?? 0) + 1);
  }
  const reportsByPersonDate = new Map<string, Json>();
  for (const report of (windowReportsResult.data ?? []) as Json[]) {
    reportsByPersonDate.set(`${report.person_id}:${report.report_date}`, report);
  }
  const completedByPersonDate = new Map<string, number>();
  for (const event of (windowEventsResult.data ?? []) as Json[]) {
    const key = `${event.person_id}:${event.local_date}`;
    completedByPersonDate.set(key, (completedByPersonDate.get(key) ?? 0) + 1);
  }
  const sessionKeys = new Set<string>();
  for (const session of (windowSessionsResult.data ?? []) as Json[]) {
    const key = `${session.person_id}:${session.shift_date}`;
    if (sessionKeys.has(key)) continue;
    sessionKeys.add(key);
    const report = reportsByPersonDate.get(key) ?? null;
    outstandingCandidates.push({
      personId: String(session.person_id),
      date: String(session.shift_date),
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
    const personUpdates = updatesByPerson.get(personId) ?? [];
    const substantive = personUpdates.filter((row) => row.substantive === true);
    const latestUpdate = personUpdates[0] ?? null;
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
      updatesToday: personUpdates.length,
      substantiveUpdatesToday: substantive.length,
      evidenceToday: evidenceByPerson.get(personId) ?? 0,
      tasksCompletedToday: completedByPerson.get(personId) ?? 0,
      lastUpdateAt: isoOrNull(latestUpdate?.occurred_at ?? latestUpdate?.created_at),
      lastUpdateKind: latestUpdate?.update_kind ? String(latestUpdate.update_kind) : latestUpdate?.kind ? String(latestUpdate.kind) : null,
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
    updatesToday: checkIns.length,
    substantiveUpdatesToday: checkIns.filter((row) => row.substantive === true).length,
    tasksCompletedToday: completedEvents.length,
    tasksOpen: openTasksResult.count ?? 0,
    tasksOverdue: overdueTasksResult.count ?? 0,
    evidenceToday: evidence.length,
    evidenceActivityToday: evidence.filter((row) => String(row.source) === "worktivity").length,
    evidenceOutputToday: evidence.filter((row) => String(row.source) !== "worktivity").length,
    reportsDraftedToday: reportsToday.filter((row) => String(row.status) === "draft").length,
    reportsSubmittedToday: reportsToday.filter((row) => ["pending_review", "approved"].includes(String(row.status))).length,
    reportsPendingReview: pendingReports.length,
    pendingReviewOldestAt: isoOrNull(pendingReports[0]?.submitted_at ?? pendingReports[0]?.report_date),
    eodOutstandingPeople: outstandingByPerson.size,
    eodOutstandingDays,
    disputedEvidence: evidence.filter((row) => {
      const event = Array.isArray(row.event) ? row.event[0] : row.event;
      return String(event?.correction_status ?? "") === "disputed";
    }).length,
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
  const blockedIssues = (readiness?.issues ?? []).filter((issue) => issue.severity === "blocked");
  if (blockedIssues.length) {
    const total = blockedIssues.reduce((sum, issue) => sum + issue.count, 0);
    attention.push({
      code: "readiness_blocked",
      severity: "error",
      count: total,
      message: `${total} configuration blocker${total === 1 ? "" : "s"} prevent${total === 1 ? "s" : ""} the full employee workflow`,
      href: "/work-os/admin/settings",
    });
  }

  return { date, generatedAt: now.toISOString(), counts, people: personRows, recentActivity: recentActivity.slice(0, 24), attention, readiness };
}
