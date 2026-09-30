import { createAdminClient } from "@/lib/supabase/admin";
import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";
import { addDaysIso as addDays } from "@/lib/work-os-dates";
import { dateOnly } from "@/lib/work-os-internal";
import { employeeContext, projectWorkspaceDay } from "@/lib/work-os-daily-workspace";
import { hydrateTaskAssignees, isNiftyTaskAttributableToMember } from "@/lib/work-os";

type Json = Record<string, any>;
export type InsightRange = "day" | "7d" | "30d";

const db = () => createAdminClient();

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function groupByDate(rows: Json[], key: string) {
  const groups = new Map<string, Json[]>();
  for (const row of rows) {
    const date = dateOnly(row[key]);
    if (!date) continue;
    const list = groups.get(date) ?? [];
    list.push(row);
    groups.set(date, list);
  }
  return groups;
}

function rangeDates(from: string, through: string) {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** Neutral activity context from stored Worktivity app/site summaries. This is
 * observed context only — never a productivity or pay judgement. */
export function activityEvidenceRollup(evidence: Json[]) {
  const byApp = new Map<string, number>();
  let trackedMinutes = 0;
  for (const item of evidence) {
    if (String(item.source ?? "") !== "worktivity") continue;
    const metrics = item.metrics && typeof item.metrics === "object" && !Array.isArray(item.metrics) ? item.metrics as Json : null;
    if (!metrics) continue;
    trackedMinutes += Number(metrics.totalMinutes ?? 0) || 0;
    for (const app of Array.isArray(metrics.topApps) ? metrics.topApps as Json[] : []) {
      const name = typeof app.name === "string" && app.name.trim() ? app.name.trim() : null;
      const minutes = Number(app.minutes ?? 0) || 0;
      if (name && minutes > 0) byApp.set(name, (byApp.get(name) ?? 0) + minutes);
    }
  }
  return {
    trackedMinutes: Math.round(trackedMinutes),
    topApps: [...byApp.entries()].map(([name, minutes]) => ({ name, minutes: Math.round(minutes) })).sort((left, right) => right.minutes - left.minutes).slice(0, 5),
  };
}

/** Progress updates split by what the employee actually recorded. Blockers and
 * priority changes stay visible instead of collapsing into one count. */
export function updateKindRollup(checkIns: Json[]) {
  const kinds = { progress: 0, starting: 0, completionClaim: 0, blocked: 0, priorityChange: 0, unplannedWork: 0 };
  for (const item of checkIns) {
    switch (String(item.update_kind ?? "")) {
      case "starting": kinds.starting += 1; break;
      case "continuing":
      case "material_progress": kinds.progress += 1; break;
      case "completion_claim": kinds.completionClaim += 1; break;
      case "blocked": kinds.blocked += 1; break;
      case "priority_change": kinds.priorityChange += 1; break;
      case "unplanned_work": kinds.unplannedWork += 1; break;
    }
  }
  return kinds;
}

/** An outcome is late only when it carried a due date it missed; undated work
 * is never classified either way. */
export function outcomeTiming(tasks: Json[]) {
  let onTime = 0;
  let late = 0;
  for (const task of tasks) {
    if (task.completed !== true) continue;
    const due = dateOnly(task.due_date);
    if (!due) continue;
    const completedAt = Date.parse(String(task.completed_at ?? ""));
    const dueEnd = Date.parse(`${due}T23:59:59.999Z`);
    if (Number.isFinite(completedAt) && completedAt <= dueEnd) onTime += 1;
    else late += 1;
  }
  return { onTime, late };
}

export function planAdherenceRollup(items: Json[]) {
  const live = items.filter((item) => item.disposition !== "removed");
  return {
    selected: live.filter((item) => item.disposition === "selected").length,
    selectedCompleted: live.filter((item) => item.disposition === "selected" && item.completion_state === "completed").length,
    deferred: live.filter((item) => item.disposition === "deferred").length,
    removalProposed: live.filter((item) => item.disposition === "removal_proposed").length,
  };
}

export type InsightConsistency = ReturnType<typeof insightConsistency>;

export function insightConsistency(days: Json[], totals: Json) {
  const daysWithGoal = days.filter((day) => String(day.goal?.text ?? "").trim().length > 0).length;
  const daysWithUpdate = days.filter((day) => Number(day.updates ?? 0) > 0).length;
  const daysWithCompletion = days.filter((day) => Number(day.tasksCompleted ?? 0) > 0).length;
  let bestDay: { date: string; tasksCompleted: number } | null = null;
  for (const day of days) {
    const completed = Number(day.tasksCompleted ?? 0);
    if (!bestDay || completed > bestDay.tasksCompleted) bestDay = { date: String(day.date), tasksCompleted: completed };
  }
  if (bestDay && bestDay.tasksCompleted === 0) bestDay = null;
  let currentStreak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (Number(day.tasksCompleted ?? 0) > 0 || Number(day.updates ?? 0) > 0) currentStreak += 1;
    else break;
  }
  const plannedTotal = Number(totals.planned ?? 0);
  return {
    dayCount: days.length,
    daysWithGoal,
    daysWithUpdate,
    daysWithCompletion,
    bestDay,
    currentStreak,
    commitmentRate: plannedTotal ? Math.round((Number(totals.plannedCompleted ?? 0) / plannedTotal) * 100) : null,
  };
}

export function effectiveBreakObservation(session: Json, now: Date, authoritative: boolean) {  if (!authoritative) return { seconds: Number(session.paused_seconds ?? 0), freshness: "manual" as const };
  const observedAt = Date.parse(String(session.provider_break_observed_at ?? ""));
  if (!Number.isFinite(observedAt)) return { seconds: 0, freshness: "unknown" as const };
  const active = !session.clocked_out_at;
  return {
    seconds: Number(session.provider_break_seconds ?? 0),
    freshness: active && now.getTime() - observedAt > 10 * 60_000 ? "stale" as const : "observed" as const,
  };
}

export function reliableElapsedSeconds(session: Json, now: Date, throughDate: string, authoritative: boolean) {
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start)) return 0;
  const unresolvedPast = !session.clocked_out_at
    && (session.correction_status === "needs_correction" || String(session.shift_date) < throughDate);
  if (unresolvedPast) return 0;
  const rawEnd = session.clocked_out_at ? Date.parse(String(session.clocked_out_at)) : now.getTime();
  if (!Number.isFinite(rawEnd)) return 0;
  return Math.max(0, Math.round((rawEnd - start) / 1000) - effectiveBreakObservation(session, now, authoritative).seconds);
}

function sumDays(days: Json[], key: string) {
  return days.reduce((sum, day) => sum + Number(day[key] ?? 0), 0);
}

/** Every duration the employee reads is spoken in hours and minutes — never
 * decimal hours such as "2.8h". */
export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(Math.abs(Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Deterministic, record-bound insight language. Every sentence restates stored
 * values only; nothing becomes a productivity score. The AI synthesis may
 * select these facts by index but never writes new prose or numbers.
 */
export function deterministicInsightBrief(days: Json[], references: Json[], extras: {
  comparison?: { days: Json[]; totals?: Json } | null;
  consistency?: InsightConsistency | null;
} = {}) {
  const latest = days.at(-1) ?? {};
  const completed = days.reduce((sum, day) => sum + Number(day.tasksCompleted ?? 0), 0);
  const progressed = days.reduce((sum, day) => sum + Number(day.progressed ?? 0), 0);
  // Carry-over is a point-in-time backlog snapshot. Summing it across days
  // double-counts the same still-open task, so attention uses the range's
  // closing snapshot instead.
  const carried = Number(latest.carried ?? latest.carryOver ?? 0);
  const deferred = days.reduce((sum, day) => sum + Number(day.deferred ?? 0), 0);
  const tracked = days.reduce((sum, day) => sum + Number(day.trackedMinutes ?? 0), 0);
  const onTime = sumDays(days, "outcomesOnTime");
  const late = sumDays(days, "outcomesLate");
  const blockers = days.reduce((sum, day) => sum + Number(day.updatesByKind?.blocked ?? 0), 0);
  const corrections = sumDays(days, "sessionCorrections");
  const consistency = extras.consistency ?? null;
  const comparison = extras.comparison ?? null;
  const wins = [
    completed ? `${completed} task outcome${completed === 1 ? "" : "s"} completed in this range.` : "No completed Nifty outcomes were recorded in this range.",
    progressed ? `${progressed} substantive progress update${progressed === 1 ? "" : "s"} recorded.` : "No substantive progress updates were recorded.",
    tracked ? `${tracked} tracked minute${tracked === 1 ? "" : "s"} of app/site activity context recorded (observed context, not a productivity score).` : "No Worktivity app/site activity context was recorded in this range.",
  ];
  const attention = [
    carried ? `${carried} carried or overdue item${carried === 1 ? "" : "s"} remained visible.` : "No carry-over pressure is visible.",
    deferred ? `${deferred} item${deferred === 1 ? " was" : "s were"} explicitly deferred and excluded from commitments.` : "No work was explicitly deferred.",
  ];
  const nextFocus = [carried ? "Review overdue work and explicitly surface or defer it." : "Set or update the next workday goal from the Tasks workspace."];

  if (onTime + late > 0) {
    wins.push(late ? `${onTime} of ${onTime + late} outcome${onTime + late === 1 ? "" : "s"} with a due date landed on time.` : `${onTime} outcome${onTime === 1 ? "" : "s"} with a due date all landed on time.`);
  }
  if (consistency && consistency.dayCount > 1) {
    if (consistency.daysWithGoal > 0) wins.push(consistency.daysWithGoal === consistency.dayCount
      ? `A written goal was set on every one of the ${consistency.dayCount} days.`
      : `A written goal was set on ${consistency.daysWithGoal} of ${consistency.dayCount} days.`);
    if (consistency.daysWithUpdate > 0) wins.push(consistency.daysWithUpdate === consistency.dayCount
      ? `A substantive update was recorded on every one of the ${consistency.dayCount} days.`
      : `A substantive update was recorded on ${consistency.daysWithUpdate} of ${consistency.dayCount} days.`);
    if (consistency.currentStreak > 1) wins.push(`${consistency.currentStreak} days in a row ended with a recorded update or completed work.`);
  }
  if (comparison) {
    const previousCompleted = sumDays(comparison.days, "tasksCompleted");
    const previousObserved = sumDays(comparison.days, "observedSeconds");
    const currentObserved = sumDays(days, "observedSeconds");
    if (completed !== previousCompleted) {
      const direction = completed > previousCompleted ? "up from" : "down from";
      wins.push(`Task outcomes were ${direction} ${previousCompleted} in the equal earlier period.`);
    }
    if (previousObserved > 0 && currentObserved > 0 && currentObserved !== previousObserved) {
      wins.push(`Observed work time moved ${currentObserved > previousObserved ? "up" : "down"} ${formatDuration(Math.abs(currentObserved - previousObserved))} against the equal earlier period.`);
    }
  }
  if (late > 0) attention.push(`${late} outcome${late === 1 ? "" : "s"} landed after ${late === 1 ? "its" : "their"} due date${late === 1 ? "" : "s"}.`);
  if (blockers > 0) attention.push(`${blockers} blocker${blockers === 1 ? " was" : "s were"} raised through the update record.`);
  if (corrections > 0) attention.push(`${corrections} session${corrections === 1 ? " still needs" : "s still need"} correction; unresolved time is excluded.`);
  if (late > 0) nextFocus.push("Rebalance due dates on the outcomes that landed late.");
  if (blockers > 0) nextFocus.push("Review the blockers raised this period and set the next action for each.");
  if (consistency && consistency.daysWithGoal === 0 && consistency.dayCount > 1) nextFocus.push("Set a written goal on workdays so intent stays comparable over time.");

  return {
    generated: false,
    summary: latest.sessionQuality?.status === "needs_correction"
      ? "The selected range contains a session that needs correction; unresolved time is excluded."
      : completed
        ? `The shared daily record shows ${completed} completed task outcome${completed === 1 ? "" : "s"} without converting activity into a score.`
        : "The daily record separates goals, task outcomes, employee updates, evidence, and activity context.",
    wins,
    attention,
    nextFocus,
    referenceIds: references.slice(0, 24).map((item) => String(item.id)),
  };
}

export function previousInsightWindow(range: InsightRange, throughValue?: string | null, now = new Date()) {
  const current = insightDateWindow(range, throughValue, now);
  const previousThrough = addDays(current.from, -1);
  return { ...insightDateWindow(range, previousThrough, now), through: previousThrough };
}

export function insightDateWindow(range: InsightRange, throughValue?: string | null, now = new Date()) {
  const through = validDate(throughValue) ?? now.toISOString().slice(0, 10);
  const count = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  return { through, count, from: addDays(through, -(count - 1)) };
}

export async function getPersonalInsights(access: WorkOsAccess, range: InsightRange, throughValue?: string | null, now = new Date()) {
  const { through, from } = insightDateWindow(range, throughValue, now);
  const previous = previousInsightWindow(range, throughValue, now);
  const windowFrom = previous.from < from ? previous.from : from;
  const personId = access.personId as string;
  const ownerId = workOsOrganizationOwnerId(access);
  const context = await employeeContext(access, now);
  const [tasksResult, eventsResult, plansResult, sessionsResult, checkInsResult, evidenceResult, orgResult, providerConnectionsResult, sourceAccountsResult] = await Promise.all([
    db().from("work_tasks")
      .select("*,project:work_projects(id,name,provider_project_id)")
      .eq("user_id", ownerId)
      .eq("organization_id", access.organizationId)
      .not("status", "in", "(archived,deleted)")
      .order("provider_created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(2500),
    db().from("work_task_day_events").select("*")
      .eq("organization_id", access.organizationId).gte("local_date", windowFrom).lte("local_date", through)
      .order("observed_at", { ascending: true }).order("id", { ascending: true }),
    db().from("work_daily_plans").select("id,shift_date,status,freeform_intent,focus_summary,goal_provenance,suggestion_task_ids,revision,items:work_daily_plan_items(id,task_id,item_kind,completion_state,completed_at,source,disposition,title_snapshot,task:work_tasks(id,title,completed,completed_at,status))")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", windowFrom).lte("shift_date", through),
    db().from("work_sessions").select("id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,provider_break_seconds,provider_break_observed_at,provider_break_provenance,attendance_observed_at,correction_status,correction_reason")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", windowFrom).lte("shift_date", through),
    db().from("work_check_ins").select("id,shift_date,substantive,input_text,update_kind").eq("organization_id", access.organizationId)
      .eq("person_id", personId).gte("shift_date", windowFrom).lte("shift_date", through),
    db().from("work_evidence").select("id,evidence_date,source,title,metrics").eq("user_id", ownerId).eq("person_id", personId)
      .gte("evidence_date", windowFrom).lte("evidence_date", through),
    db().from("work_organizations").select("nifty_synced_at,nifty_sync_error,feature_flags").eq("id", access.organizationId).single(),
    db().from("work_provider_connections").select("provider,active").eq("organization_id", access.organizationId),
    db().from("work_source_accounts").select("provider,person_id,verified").eq("organization_id", access.organizationId).eq("person_id", personId),
  ]);
  for (const [label, result] of [["tasks", tasksResult], ["events", eventsResult], ["plans", plansResult], ["sessions", sessionsResult], ["check-ins", checkInsResult], ["evidence", evidenceResult], ["organization", orgResult], ["provider connections", providerConnectionsResult], ["source accounts", sourceAccountsResult]] as const) {
    if (result.error) throw new Error(`load Work OS insight ${label}: ${result.error.message}`);
  }
  const allTasks = await hydrateTaskAssignees(ownerId, (tasksResult.data ?? []) as Json[]) as Json[];
  const attributable = allTasks.filter((task) =>
    (Array.isArray(task.assignee_person_ids) && task.assignee_person_ids.includes(access.personId))
    || isNiftyTaskAttributableToMember(task, context.niftyMemberId)
  );
  const attributableIds = new Set(attributable.map((task) => String(task.id)));
  const events = ((eventsResult.data ?? []) as Json[]).filter((event) =>
    event.person_id === access.personId || attributableIds.has(String(event.task_id))
  );
  const plans = groupByDate((plansResult.data ?? []) as Json[], "shift_date");
  const sessions = groupByDate((sessionsResult.data ?? []) as Json[], "shift_date");
  const checkIns = groupByDate((checkInsResult.data ?? []) as Json[], "shift_date");
  const evidence = groupByDate((evidenceResult.data ?? []) as Json[], "evidence_date");
  const eventsByDate = groupByDate(events, "local_date");
  const authoritativeBreaks = (orgResult.data?.feature_flags as Json | null)?.worktivity_authoritative_breaks === true;
  const allReferences: Json[] = [];

  const projectDay = (date: string) => {
    const plan = (plans.get(date) ?? [])[0] ?? null;
    const daySessions = sessions.get(date) ?? [];
    const dayCheckIns = (checkIns.get(date) ?? []).filter((item) => item.substantive === true);
    const dayEvidence = evidence.get(date) ?? [];
    const projected = projectWorkspaceDay({
      date,
      currentDate: context.currentDate,
      allTasks,
      attributable,
      events: eventsByDate.get(date) ?? [],
      plan,
      session: daySessions[0] ?? null,
    });
    const activity = activityEvidenceRollup(dayEvidence);
    const timing = outcomeTiming(projected.tasks);
    const adherence = planAdherenceRollup(Array.isArray(plan?.items) ? plan.items as Json[] : []);
    const observedSeconds = daySessions.reduce((sum, item) => sum + reliableElapsedSeconds(item, now, through, authoritativeBreaks), 0);
    const pausedSeconds = daySessions.reduce((sum, item) => sum + effectiveBreakObservation(item, now, authoritativeBreaks).seconds, 0);
    const breakStates = daySessions.map((item) => effectiveBreakObservation(item, now, authoritativeBreaks).freshness);
    const references = [
      ...(plan ? [{ type: "plan", id: plan.id, date, label: `Goal for ${date}`, target: `/work-os?view=tasks&date=${date}` }] : []),
      ...projected.tasks.slice(0, 30).map((item) => ({ type: "task", id: item.id, date, label: item.title, target: `/work-os?view=tasks&date=${date}&task=${item.provider_task_id}` })),
      ...dayCheckIns.slice(0, 20).map((item) => ({ type: "check_in", id: item.id, date, label: String(item.input_text ?? "Employee update").slice(0, 100), target: `/work-os?view=insights&date=${date}&update=${item.id}` })),
      ...dayEvidence.slice(0, 20).map((item) => ({ type: "evidence", id: item.id, date, label: item.title, target: `/work-os?view=evidence&date=${date}&evidence=${item.id}` })),
    ];
    const updatesByKind = updateKindRollup(dayCheckIns);
    const summary = {
      date,
      goal: projected.goal,
      observedSeconds,
      pausedSeconds,
      pauseRatio: observedSeconds + pausedSeconds > 0 ? Math.round((pausedSeconds / (observedSeconds + pausedSeconds)) * 100) / 100 : 0,
      breakFreshness: authoritativeBreaks
        ? breakStates.includes("unknown") ? "unknown" : breakStates.includes("stale") ? "stale" : "observed"
        : "manual",
      sessionQuality: projected.sessionQuality,
      sessionCorrections: projected.sessionQuality.status === "needs_correction" ? 1 : 0,
      planStatus: plan?.status ?? "none",
      planned: projected.commitmentTotal,
      plannedCompleted: projected.commitmentCompleted,
      completed: projected.tasks.filter((task) => task.dayAttribution.reason === "completed").length,
      progressed: updatesByKind.progress,
      updatesByKind,
      deferred: (Array.isArray(plan?.items) ? plan.items as Json[] : []).filter((item) => item.disposition === "deferred" && !["archived", "deleted"].includes(String(item.task?.status))).length,
      carried: projected.carryOverGroups.reduce((sum, group) => sum + group.tasks.length, 0),
      unplanned: projected.tasks.filter((task) => task.dayAttribution.reason === "creation_observed" && !task.due_date).length,
      carryOver: projected.carryOverGroups.reduce((sum, group) => sum + group.tasks.length, 0),
      overdue: projected.overdueCount,
      updates: dayCheckIns.length,
      outputEvidence: dayEvidence.filter((item) => item.source !== "worktivity").length,
      activityContext: dayEvidence.filter((item) => item.source === "worktivity").length,
      trackedMinutes: activity.trackedMinutes,
      topApps: activity.topApps,
      tasksCompleted: projected.completed,
      tasksOpen: Math.max(0, projected.total - projected.completed),
      outcomesOnTime: timing.onTime,
      outcomesLate: timing.late,
      planAdherence: adherence,
      goalSet: String(projected.goal.text ?? "").trim().length > 0,
      references,
    };
    return { summary, references };
  };

  const currentDays = rangeDates(from, through).map((date) => {
    const { summary, references } = projectDay(date);
    allReferences.push(...references);
    return summary;
  });
  const previousDays = rangeDates(previous.from, previous.through).map((date) => projectDay(date).summary);
  const numericKeys = ["observedSeconds", "pausedSeconds", "planned", "plannedCompleted", "completed", "progressed", "deferred", "carried", "unplanned", "carryOver", "overdue", "updates", "outputEvidence", "activityContext", "trackedMinutes", "tasksCompleted", "tasksOpen", "outcomesOnTime", "outcomesLate", "sessionCorrections"] as const;
  const totals = Object.fromEntries(numericKeys.map((key) => [key, currentDays.reduce((sum, day) => sum + Number(day[key] ?? 0), 0)]));
  const previousTotals = Object.fromEntries(numericKeys.map((key) => [key, previousDays.reduce((sum, day) => sum + Number(day[key] ?? 0), 0)]));
  const comparison = { range, from: previous.from, through: previous.through, days: previousDays, totals: previousTotals };
  const consistency = insightConsistency(currentDays, totals);
  const observed = (sessionsResult.data ?? []).map((item: any) => item.attendance_observed_at).filter(Boolean).sort().at(-1) ?? null;
  const niftySyncedAt = orgResult.data?.nifty_synced_at ?? null;
  const stale = !!orgResult.data?.nifty_sync_error || !niftySyncedAt || now.getTime() - Date.parse(niftySyncedAt) > 10 * 60_000;
  const activeProviders = new Set((providerConnectionsResult.data ?? []).filter((row: any) => row.active === true).map((row: any) => String(row.provider)));
  const verifiedProviders = new Set((sourceAccountsResult.data ?? []).filter((row: any) => row.verified === true).map((row: any) => String(row.provider)));
  const currentEvidenceRows = ((evidenceResult.data ?? []) as Json[]).filter((item) => String(item.evidence_date ?? "") >= from);
  const featureFlags = (orgResult.data?.feature_flags ?? {}) as Json;
  const evidenceSources = ["github", "ghl"].map((provider) => ({
    provider,
    connected: activeProviders.has(provider),
    enabled: featureFlags[provider === "github" ? "github_evidence" : "ghl_evidence"] === true,
    verifiedForPerson: verifiedProviders.has(provider),
    evidenceCount: currentEvidenceRows.filter((item) => String(item.source ?? "") === provider).length,
  }));
  return {
    range,
    from,
    through,
    days: currentDays,
    totals,
    updateKinds: updateKindRollup((checkInsResult.data ?? []).filter((item: any) => String(dateOnly(item.shift_date) ?? "") >= from)),
    consistency,
    comparison,
    evidenceSources,
    brief: deterministicInsightBrief(currentDays, allReferences, { comparison, consistency }),
    freshness: {
      niftySyncedAt,
      worktivityObservedAt: observed,
      authoritativeBreaks,
      stale,
      staleAt: stale ? niftySyncedAt : null,
      error: orgResult.data?.nifty_sync_error ?? null,
    },
  };
}
