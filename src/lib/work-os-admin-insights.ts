import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysIso, todayIso } from "@/lib/work-os-dates";
import { classifyOutstandingEodDays, type OutstandingEodCandidate } from "@/lib/work-os-eod";
import type { WorkOsAccess } from "@/lib/work-os-api";

type Json = Record<string, any>;

export type AdminInsightRange = "7d" | "30d" | "90d";

export const ADMIN_INSIGHT_RANGES: AdminInsightRange[] = ["7d", "30d", "90d"];

export interface AdminInsightPersonRow {
  personId: string;
  displayName: string;
  roleProfile: string | null;
  outcomesCompleted: number;
  outcomesLate: number;
  updates: number;
  substantiveUpdates: number;
  eodSubmitted: number;
  eodApproved: number;
  eodRejected: number;
  planned: number;
  plannedCompleted: number;
  commitmentRate: number | null;
  trackedMinutes: number;
  evidenceOutput: number;
  evidenceActivity: number;
  sessionsNeedingCorrection: number;
  lastActivityAt: string | null;
}

export interface AdminInsightTotals {
  outcomesCompleted: number;
  outcomesLate: number;
  updates: number;
  substantiveUpdates: number;
  eodSubmitted: number;
  eodApproved: number;
  eodRejected: number;
  planned: number;
  plannedCompleted: number;
  trackedMinutes: number;
  evidenceOutput: number;
  evidenceActivity: number;
  sessionsNeedingCorrection: number;
  activePeople: number;
}

export interface AdminInsightNotes {
  summary: string;
  wins: string[];
  attention: string[];
  nextFocus: string[];
}

export function adminInsightWindow(range: AdminInsightRange, throughValue?: string | null, now = new Date()) {
  const through = throughValue && /^\d{4}-\d{2}-\d{2}$/.test(throughValue) ? throughValue : todayIso(now);
  const count = range === "90d" ? 90 : range === "30d" ? 30 : 7;
  return { through, count, from: addDaysIso(through, -(count - 1)) };
}

export function previousAdminInsightWindow(range: AdminInsightRange, throughValue?: string | null, now = new Date()) {
  const current = adminInsightWindow(range, throughValue, now);
  const previousThrough = addDaysIso(current.from, -1);
  return adminInsightWindow(range, previousThrough, now);
}

function dateRange(from: string, through: string) {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDaysIso(date, 1)) dates.push(date);
  return dates;
}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "");
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : null;
}

/** Completion timing uses the task snapshot's due date: a completed outcome is
 * late only when it carried a due date it missed; undated work is neither. */
export function outcomeTimingFromEvents(events: Json[]) {
  let onTime = 0;
  let late = 0;
  for (const event of events) {
    const snapshot = (event.task_snapshot ?? {}) as Json;
    const due = dateOnly(snapshot.due_date);
    const completedOn = dateOnly(event.local_date ?? event.exact_at ?? event.observed_at);
    if (!due || !completedOn) continue;
    if (completedOn <= due) onTime += 1;
    else late += 1;
  }
  return { onTime, late };
}

export function buildAdminInsightNotes(input: {
  rangeLabel: string;
  totals: AdminInsightTotals;
  previous: AdminInsightTotals;
  outstandingDays: number;
  overdueOpen: number;
}): AdminInsightNotes {
  const { totals, previous, outstandingDays, overdueOpen } = input;
  const wins: string[] = [];
  const attention: string[] = [];
  const nextFocus: string[] = [];

  if (totals.outcomesCompleted > 0) {
    const direction = totals.outcomesCompleted === previous.outcomesCompleted
      ? ""
      : totals.outcomesCompleted > previous.outcomesCompleted
        ? `, up from ${previous.outcomesCompleted} in the equal earlier period`
        : `, down from ${previous.outcomesCompleted} in the equal earlier period`;
    wins.push(`${totals.outcomesCompleted} task outcome${totals.outcomesCompleted === 1 ? "" : "s"} completed in this range${direction}.`);
  } else {
    attention.push("No completed task outcomes were recorded in this range.");
  }
  if (totals.substantiveUpdates > 0) {
    wins.push(`${totals.substantiveUpdates} substantive progress update${totals.substantiveUpdates === 1 ? "" : "s"} recorded.`);
  }
  if (totals.planned > 0) {
    const rate = Math.round((totals.plannedCompleted / totals.planned) * 100);
    wins.push(`${rate}% of planned commitments were completed (${totals.plannedCompleted} of ${totals.planned}).`);
  }
  if (totals.eodSubmitted > 0) {
    wins.push(`${totals.eodSubmitted} EOD report${totals.eodSubmitted === 1 ? "" : "s"} submitted for review.`);
  }
  if (totals.trackedMinutes > 0) {
    wins.push(`${totals.trackedMinutes} tracked minute${totals.trackedMinutes === 1 ? "" : "s"} of app/site activity context recorded (observed context, not a productivity score).`);
  }
  if (totals.outcomesLate > 0) {
    attention.push(`${totals.outcomesLate} completed outcome${totals.outcomesLate === 1 ? "" : "s"} landed after the recorded due date.`);
  }
  if (outstandingDays > 0) {
    attention.push(`${outstandingDays} workday${outstandingDays === 1 ? "" : "s"} in the last seven days still have an unsubmitted EOD report.`);
    nextFocus.push("Review outstanding EOD reports and follow up with the teammate.");
  }
  if (overdueOpen > 0) {
    attention.push(`${overdueOpen} open task${overdueOpen === 1 ? "" : "s"} are past their due date.`);
    nextFocus.push("Rebalance or close the overdue backlog.");
  }
  if (totals.sessionsNeedingCorrection > 0) {
    attention.push(`${totals.sessionsNeedingCorrection} session${totals.sessionsNeedingCorrection === 1 ? "" : "s"} still need a correction; unresolved time is excluded.`);
    nextFocus.push("Resolve the sessions that need correction.");
  }
  if (!nextFocus.length) nextFocus.push("Keep the review queue clear and confirm the week's outcomes.");

  const summary = totals.outcomesCompleted || totals.updates
    ? `The workspace recorded ${totals.outcomesCompleted} completed outcome${totals.outcomesCompleted === 1 ? "" : "s"} and ${totals.updates} update${totals.updates === 1 ? "" : "s"} in ${input.rangeLabel}. Activity context is descriptive and never a score.`
    : `No completed outcomes or updates were recorded in ${input.rangeLabel}.`;

  return { summary, wins, attention, nextFocus };
}

export async function getAdminInsights(access: WorkOsAccess, range: AdminInsightRange, options: { through?: string | null; now?: Date; personId?: string | null; allowedPersonIds?: string[] | null } = {}) {
  const now = options.now ?? new Date();
  const personFilter = options.personId && /^[0-9a-f-]{36}$/i.test(options.personId) ? options.personId : null;
  const allowedSet = options.allowedPersonIds == null ? null : new Set(options.allowedPersonIds);
  const current = adminInsightWindow(range, options.through ?? null, now);
  const previous = previousAdminInsightWindow(range, options.through ?? null, now);
  const windowFrom = previous.from < current.from ? previous.from : current.from;
  const db = createAdminClient();
  const organizationId = access.organizationId;
  // Overdue pressure follows the same people scope as every other row set:
  // a specific person, the allowed team scope, or the whole organization.
  const scopedPersonIds = personFilter ? [personFilter] : allowedSet ? [...allowedSet] : null;
  const overdueBase = () => db.from("work_tasks").select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId).eq("completed", false).not("status", "in", "(archived,deleted)")
    .not("due_date", "is", null).lt("due_date", current.through);

  const [peopleResult, eventsResult, checkInsResult, reportsResult, evidenceResult, sessionsResult, plansResult, overdueResult] = await Promise.all([
    db.from("work_people")
      .select("id,display_name,active,role_profile:work_role_profiles(id,name)")
      .eq("organization_id", organizationId).eq("active", true).order("display_name"),
    db.from("work_task_day_events")
      .select("id,person_id,local_date,event_type,task_snapshot,observed_at")
      .eq("organization_id", organizationId).eq("event_type", "completed")
      .gte("local_date", windowFrom).lte("local_date", current.through),
    db.from("work_check_ins")
      .select("id,person_id,shift_date,substantive,update_kind,occurred_at")
      .eq("organization_id", organizationId)
      .gte("shift_date", windowFrom).lte("shift_date", current.through),
    db.from("work_reports")
      .select("id,person_id,report_date,status,submitted_at,reviewed_at")
      .eq("organization_id", organizationId)
      .gte("report_date", windowFrom).lte("report_date", current.through),
    db.from("work_evidence")
      .select("id,person_id,evidence_date,source,metrics")
      .eq("organization_id", organizationId)
      .gte("evidence_date", windowFrom).lte("evidence_date", current.through),
    db.from("work_sessions")
      .select("id,person_id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,correction_status")
      .eq("organization_id", organizationId)
      .gte("shift_date", windowFrom).lte("shift_date", current.through),
    db.from("work_daily_plan_items")
      .select("id,person_id,disposition,completion_state,item_kind,task_id,plan:work_daily_plans!inner(shift_date)")
      .eq("organization_id", organizationId)
      .gte("plan.shift_date", windowFrom).lte("plan.shift_date", current.through),
    scopedPersonIds && scopedPersonIds.length === 0
      ? Promise.resolve({ count: 0, error: null })
      : personFilter
        ? overdueBase().contains("assignee_person_ids", [personFilter])
        : allowedSet
          // The query shim cannot express array overlap, so a team-scoped view
          // reports no overdue count instead of an organization-wide one.
          ? Promise.resolve({ count: null, error: null })
          : overdueBase(),
  ]);
  for (const [label, result] of [
    ["people", peopleResult], ["events", eventsResult], ["check-ins", checkInsResult], ["reports", reportsResult],
    ["evidence", evidenceResult], ["sessions", sessionsResult], ["plans", plansResult], ["overdue", overdueResult],
  ] as const) {
    if (result.error) throw new Error(`load admin insights ${label}: ${result.error.message}`);
  }

  const people = ((peopleResult.data ?? []) as Json[]).filter((person) => !allowedSet || allowedSet.has(String(person.id)));
  const events = (eventsResult.data ?? []) as Json[];
  const checkIns = (checkInsResult.data ?? []) as Json[];
  const reports = (reportsResult.data ?? []) as Json[];
  const evidence = (evidenceResult.data ?? []) as Json[];
  const sessions = (sessionsResult.data ?? []) as Json[];

  const personIds = new Set(people.map((person) => String(person.id)));
  const matchesPerson = (row: Json) => {
    const personId = String(row.person_id ?? "");
    if (personFilter && personId !== personFilter) return false;
    if (allowedSet && !allowedSet.has(personId)) return false;
    return true;
  };
  const inRange = (value: unknown, from: string, through: string) => {
    const date = dateOnly(value);
    return !!date && date >= from && date <= through;
  };

  const currentEvents = events.filter((row) => inRange(row.local_date, current.from, current.through) && matchesPerson(row));
  const previousEvents = events.filter((row) => inRange(row.local_date, previous.from, previous.through) && matchesPerson(row));
  const currentUpdates = checkIns.filter((row) => inRange(row.shift_date, current.from, current.through) && matchesPerson(row));
  const previousUpdates = checkIns.filter((row) => inRange(row.shift_date, previous.from, previous.through) && matchesPerson(row));
  const currentReports = reports.filter((row) => inRange(row.report_date, current.from, current.through) && matchesPerson(row));
  const previousReports = reports.filter((row) => inRange(row.report_date, previous.from, previous.through) && matchesPerson(row));
  const currentEvidence = evidence.filter((row) => inRange(row.evidence_date, current.from, current.through) && matchesPerson(row));
  const previousEvidence = evidence.filter((row) => inRange(row.evidence_date, previous.from, previous.through) && matchesPerson(row));
  const currentSessions = sessions.filter((row) => inRange(row.shift_date, current.from, current.through) && matchesPerson(row));
  const previousSessions = sessions.filter((row) => inRange(row.shift_date, previous.from, previous.through) && matchesPerson(row));

  // Plan commitment uses selected plan items for plans inside the current
  // window and the allowed people scope; disposition and completion state are
  // the reliable fields for the commitment rate.
  const planDate = (item: Json) => {
    const plan = Array.isArray(item.plan) ? item.plan[0] : item.plan;
    return dateOnly(plan?.shift_date);
  };
  const planItems = ((plansResult.data ?? []) as Json[])
    .filter((item) => personIds.has(String(item.person_id)) && matchesPerson(item))
    .filter((item) => {
      const date = planDate(item);
      return !!date && date >= current.from && date <= current.through;
    });

  const countBy = <T>(rows: T[], key: (row: T) => string | null) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const value = key(row);
      if (!value) continue;
      map.set(value, (map.get(value) ?? 0) + 1);
    }
    return map;
  };

  const completedByPerson = countBy(currentEvents, (row) => (row.person_id ? String(row.person_id) : null));
  const updatesByPerson = countBy(currentUpdates, (row) => (row.person_id ? String(row.person_id) : null));
  const substantiveByPerson = countBy(currentUpdates.filter((row) => row.substantive === true), (row) => (row.person_id ? String(row.person_id) : null));
  const reportsByPerson = new Map<string, { submitted: number; approved: number; rejected: number }>();
  for (const report of currentReports) {
    const personId = report.person_id ? String(report.person_id) : null;
    if (!personId) continue;
    const entry = reportsByPerson.get(personId) ?? { submitted: 0, approved: 0, rejected: 0 };
    if (["pending_review", "approved"].includes(String(report.status))) entry.submitted += 1;
    if (String(report.status) === "approved") entry.approved += 1;
    if (String(report.status) === "rejected") entry.rejected += 1;
    reportsByPerson.set(personId, entry);
  }
  const evidenceByPerson = new Map<string, { output: number; activity: number }>();
  for (const item of currentEvidence) {
    const personId = item.person_id ? String(item.person_id) : null;
    if (!personId) continue;
    const entry = evidenceByPerson.get(personId) ?? { output: 0, activity: 0 };
    if (String(item.source) === "worktivity") entry.activity += 1;
    else entry.output += 1;
    evidenceByPerson.set(personId, entry);
  }
  const trackedByPerson = new Map<string, number>();
  let trackedMinutesTotal = 0;
  let trackedMinutesPrevious = 0;
  const topApps = new Map<string, number>();
  const addTrackedMinutes = (rows: Json[], target: "current" | "previous") => {
    for (const item of rows) {
      if (String(item.source) !== "worktivity") continue;
      const metrics = item.metrics && typeof item.metrics === "object" ? (item.metrics as Json) : {};
      const minutes = Number(metrics.totalMinutes ?? 0) || 0;
      if (target === "current") {
        trackedMinutesTotal += minutes;
        const personId = item.person_id ? String(item.person_id) : null;
        if (personId) trackedByPerson.set(personId, (trackedByPerson.get(personId) ?? 0) + minutes);
        for (const app of Array.isArray(metrics.topApps) ? (metrics.topApps as Json[]) : []) {
          const name = typeof app.name === "string" && app.name.trim() ? app.name.trim() : null;
          const appMinutes = Number(app.minutes ?? 0) || 0;
          if (name && appMinutes > 0) topApps.set(name, (topApps.get(name) ?? 0) + appMinutes);
        }
      } else {
        trackedMinutesPrevious += minutes;
      }
    }
  };
  addTrackedMinutes(currentEvidence, "current");
  addTrackedMinutes(previousEvidence, "previous");

  const correctionsByPerson = countBy(currentSessions.filter((row) => String(row.correction_status) === "needs_correction"), (row) => (row.person_id ? String(row.person_id) : null));
  const previousCorrections = previousSessions.filter((row) => String(row.correction_status) === "needs_correction").length;

  const selectedItems = planItems.filter((item) => String(item.disposition) === "selected");
  const completedItems = selectedItems.filter((item) => String(item.completion_state) === "completed");
  const plannedByPerson = countBy(selectedItems, (row) => (row.person_id ? String(row.person_id) : null));
  const plannedCompletedByPerson = countBy(completedItems, (row) => (row.person_id ? String(row.person_id) : null));

  const timing = outcomeTimingFromEvents(currentEvents);
  const previousTiming = outcomeTimingFromEvents(previousEvents);

  const lastActivityByPerson = new Map<string, string>();
  const recordActivity = (personId: string | null, at: unknown) => {
    if (!personId) return;
    const iso = dateOnly(at);
    if (!iso) return;
    const existing = lastActivityByPerson.get(personId);
    if (!existing || iso > existing) lastActivityByPerson.set(personId, iso);
  };
  for (const row of [...currentEvents, ...currentUpdates, ...currentReports]) recordActivity(row.person_id ? String(row.person_id) : null, row.local_date ?? row.shift_date ?? row.report_date);

  const peopleRows: AdminInsightPersonRow[] = people.map((person) => {
    const personId = String(person.id);
    const roleProfile = Array.isArray(person.role_profile) ? person.role_profile[0] : person.role_profile;
    const planned = plannedByPerson.get(personId) ?? 0;
    const plannedCompleted = plannedCompletedByPerson.get(personId) ?? 0;
    const reportsEntry = reportsByPerson.get(personId) ?? { submitted: 0, approved: 0, rejected: 0 };
    const evidenceEntry = evidenceByPerson.get(personId) ?? { output: 0, activity: 0 };
    return {
      personId,
      displayName: String(person.display_name),
      roleProfile: roleProfile?.name ? String(roleProfile.name) : null,
      outcomesCompleted: completedByPerson.get(personId) ?? 0,
      outcomesLate: outcomeTimingFromEvents(currentEvents.filter((row) => String(row.person_id) === personId)).late,
      updates: updatesByPerson.get(personId) ?? 0,
      substantiveUpdates: substantiveByPerson.get(personId) ?? 0,
      eodSubmitted: reportsEntry.submitted,
      eodApproved: reportsEntry.approved,
      eodRejected: reportsEntry.rejected,
      planned,
      plannedCompleted,
      commitmentRate: planned ? Math.round((plannedCompleted / planned) * 100) : null,
      trackedMinutes: Math.round(trackedByPerson.get(personId) ?? 0),
      evidenceOutput: evidenceEntry.output,
      evidenceActivity: evidenceEntry.activity,
      sessionsNeedingCorrection: correctionsByPerson.get(personId) ?? 0,
      lastActivityAt: lastActivityByPerson.get(personId) ?? null,
    };
  });
  peopleRows.sort((left, right) => right.outcomesCompleted - left.outcomesCompleted || left.displayName.localeCompare(right.displayName));

  const totals: AdminInsightTotals = {
    outcomesCompleted: currentEvents.length,
    outcomesLate: timing.late,
    updates: currentUpdates.length,
    substantiveUpdates: currentUpdates.filter((row) => row.substantive === true).length,
    eodSubmitted: currentReports.filter((row) => ["pending_review", "approved"].includes(String(row.status))).length,
    eodApproved: currentReports.filter((row) => String(row.status) === "approved").length,
    eodRejected: currentReports.filter((row) => String(row.status) === "rejected").length,
    planned: selectedItems.length,
    plannedCompleted: completedItems.length,
    trackedMinutes: Math.round(trackedMinutesTotal),
    evidenceOutput: currentEvidence.filter((row) => String(row.source) !== "worktivity").length,
    evidenceActivity: currentEvidence.filter((row) => String(row.source) === "worktivity").length,
    sessionsNeedingCorrection: currentSessions.filter((row) => String(row.correction_status) === "needs_correction").length,
    activePeople: peopleRows.filter((row) => row.outcomesCompleted > 0 || row.updates > 0 || row.trackedMinutes > 0 || row.eodSubmitted > 0).length,
  };
  const previousTotals: AdminInsightTotals = {
    outcomesCompleted: previousEvents.length,
    outcomesLate: previousTiming.late,
    updates: previousUpdates.length,
    substantiveUpdates: previousUpdates.filter((row) => row.substantive === true).length,
    eodSubmitted: previousReports.filter((row) => ["pending_review", "approved"].includes(String(row.status))).length,
    eodApproved: previousReports.filter((row) => String(row.status) === "approved").length,
    eodRejected: previousReports.filter((row) => String(row.status) === "rejected").length,
    planned: 0,
    plannedCompleted: 0,
    trackedMinutes: Math.round(trackedMinutesPrevious),
    evidenceOutput: previousEvidence.filter((row) => String(row.source) !== "worktivity").length,
    evidenceActivity: previousEvidence.filter((row) => String(row.source) === "worktivity").length,
    sessionsNeedingCorrection: previousCorrections,
    activePeople: 0,
  };

  const updateKindCounts = new Map<string, number>();
  for (const update of currentUpdates) {
    const kind = String(update.update_kind ?? "unclassified");
    updateKindCounts.set(kind, (updateKindCounts.get(kind) ?? 0) + 1);
  }
  const series = dateRange(current.from, current.through).map((date) => ({
    date,
    outcomesCompleted: currentEvents.filter((row) => dateOnly(row.local_date) === date).length,
    updates: currentUpdates.filter((row) => dateOnly(row.shift_date) === date).length,
    eodSubmitted: currentReports.filter((row) => dateOnly(row.report_date) === date && ["pending_review", "approved"].includes(String(row.status))).length,
    trackedMinutes: Math.round(
      currentEvidence
        .filter((row) => dateOnly(row.evidence_date) === date && String(row.source) === "worktivity")
        .reduce((sum, row) => sum + (Number(((row.metrics ?? {}) as Json).totalMinutes ?? 0) || 0), 0),
    ),
  }));

  const outstandingDays = await countOutstandingDays(organizationId, now, { personId: personFilter, allowedSet });

  return {
    range,
    from: current.from,
    through: current.through,
    totals,
    previous: previousTotals,
    people: peopleRows,
    series,
    updateKinds: [...updateKindCounts.entries()].map(([kind, count]) => ({ kind, count })).sort((left, right) => right.count - left.count),
    topApps: [...topApps.entries()].map(([name, minutes]) => ({ name, minutes: Math.round(minutes) })).sort((left, right) => right.minutes - left.minutes).slice(0, 6),
    overdueOpen: overdueResult.count,
    notes: buildAdminInsightNotes({
      rangeLabel: `${current.from} to ${current.through}`,
      totals,
      previous: previousTotals,
      outstandingDays,
      overdueOpen: overdueResult.count ?? 0,
    }),
    freshness: { generatedAt: now.toISOString() },
  };
}

async function countOutstandingDays(organizationId: string, now: Date, scope: { personId: string | null; allowedSet: Set<string> | null }) {
  const through = addDaysIso(todayIso(now), -1);
  const from = addDaysIso(through, -6);
  const scopedIds = scope.personId ? [scope.personId] : scope.allowedSet ? [...scope.allowedSet] : null;
  if (scopedIds && !scopedIds.length) return 0;
  const db = createAdminClient();
  let sessionsQuery = db.from("work_sessions").select("person_id,shift_date")
    .eq("organization_id", organizationId).gte("shift_date", from).lte("shift_date", through);
  let reportsQuery = db.from("work_reports").select("person_id,report_date,status,submitted_at")
    .eq("organization_id", organizationId).gte("report_date", from).lte("report_date", through);
  if (scopedIds) {
    sessionsQuery = sessionsQuery.in("person_id", scopedIds);
    reportsQuery = reportsQuery.in("person_id", scopedIds);
  }
  const [sessions, reports] = await Promise.all([sessionsQuery, reportsQuery]);
  if (sessions.error) throw new Error(`load outstanding sessions: ${sessions.error.message}`);
  if (reports.error) throw new Error(`load outstanding reports: ${reports.error.message}`);
  const reportByKey = new Map<string, Json>();
  for (const report of (reports.data ?? []) as Json[]) {
    reportByKey.set(`${report.person_id}:${report.report_date}`, report);
  }
  // The canonical employee rule keeps a day visible until a submitted report
  // clears it (drafts and rejected reports stay outstanding).
  const byPerson = new Map<string, OutstandingEodCandidate[]>();
  for (const session of (sessions.data ?? []) as Json[]) {
    const personId = String(session.person_id);
    const report = reportByKey.get(`${personId}:${session.shift_date}`) ?? null;
    const list = byPerson.get(personId) ?? [];
    list.push({
      date: String(session.shift_date),
      hasSession: true,
      observedMinutes: 0,
      hasPlan: false,
      completedTasks: 0,
      report: report ? { id: String(report.id), status: String(report.status), submitted: Boolean(report.submitted_at) } : null,
    });
    byPerson.set(personId, list);
  }
  let total = 0;
  for (const candidates of byPerson.values()) total += classifyOutstandingEodDays(candidates).length;
  return total;
}

export type AdminInsights = Awaited<ReturnType<typeof getAdminInsights>>;
