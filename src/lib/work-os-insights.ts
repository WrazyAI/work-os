import { createAdminClient } from "@/lib/supabase/admin";
import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";
import { addDaysIso as addDays } from "@/lib/work-os-dates";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";

type Json = Record<string, any>;
export type InsightRange = "day" | "7d" | "30d";

const db = () => createAdminClient();

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export function effectiveBreakObservation(session: Json, now: Date, authoritative: boolean) {
  if (!authoritative) return { seconds: Number(session.paused_seconds ?? 0), freshness: "manual" as const };
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

export function deterministicInsightBrief(days: Json[], references: Json[]) {
  const latest = days.at(-1) ?? {};
  const completed = days.reduce((sum, day) => sum + Number(day.tasksCompleted ?? 0), 0);
  const progressed = days.reduce((sum, day) => sum + Number(day.progressed ?? 0), 0);
  const carried = days.reduce((sum, day) => sum + Number(day.carried ?? day.carryOver ?? 0), 0);
  const deferred = days.reduce((sum, day) => sum + Number(day.deferred ?? 0), 0);
  const wins = [
    completed ? `${completed} task outcome${completed === 1 ? "" : "s"} completed in this range.` : "No completed Nifty outcomes were recorded in this range.",
    progressed ? `${progressed} substantive progress update${progressed === 1 ? "" : "s"} recorded.` : "No substantive progress updates were recorded.",
  ];
  const attention = [
    carried ? `${carried} carried or overdue item${carried === 1 ? "" : "s"} remained visible.` : "No carry-over pressure is visible.",
    deferred ? `${deferred} item${deferred === 1 ? " was" : "s were"} explicitly deferred and excluded from commitments.` : "No work was explicitly deferred.",
  ];
  return {
    generated: false,
    summary: latest.sessionQuality?.status === "needs_correction"
      ? "The selected range contains a session that needs correction; unresolved time is excluded."
      : completed
        ? `The shared daily record shows ${completed} completed task outcome${completed === 1 ? "" : "s"} without converting activity into a score.`
        : "The daily record separates goals, task outcomes, employee updates, evidence, and activity context.",
    wins,
    attention,
    nextFocus: carried ? ["Review overdue work and explicitly surface or defer it."] : ["Set or update the next workday goal from the Tasks workspace."],
    referenceIds: references.slice(0, 24).map((item) => String(item.id)),
  };
}

export async function getPersonalInsights(access: WorkOsAccess, range: InsightRange, throughValue?: string | null, now = new Date()) {
  const { through, count, from } = insightDateWindow(range, throughValue, now);
  const personId = access.personId as string;
  const ownerId = workOsOrganizationOwnerId(access);
  const dates = Array.from({ length: count }, (_, index) => addDays(from, index));
  const [sessionsResult, plansResult, checkInsResult, evidenceResult, orgResult, workspaces] = await Promise.all([
    db().from("work_sessions").select("id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,provider_break_seconds,provider_break_observed_at,provider_break_provenance,attendance_observed_at,correction_status,correction_reason")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_daily_plans").select("id,shift_date,status,freeform_intent,goal_provenance,suggestion_task_ids,items:work_daily_plan_items(id,task_id,item_kind,completion_state,completed_at,source,disposition,title_snapshot,task:work_tasks(id,title,completed,completed_at,status))")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_check_ins").select("id,shift_date,substantive,input_text,update_kind").eq("organization_id", access.organizationId)
      .eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_evidence").select("id,evidence_date,source,title").eq("user_id", ownerId).eq("person_id", personId)
      .gte("evidence_date", from).lte("evidence_date", through),
    db().from("work_organizations").select("nifty_synced_at,nifty_sync_error,feature_flags").eq("id", access.organizationId).single(),
    Promise.all(dates.map((date) => resolveDailyWorkspace(access, date, { limit: 100, now }))),
  ]);
  for (const [label, result] of [["sessions", sessionsResult], ["plans", plansResult], ["check-ins", checkInsResult], ["evidence", evidenceResult], ["organization", orgResult]] as const) {
    if (result.error) throw new Error(`load Work OS insight ${label}: ${result.error.message}`);
  }
  const sessions = sessionsResult.data ?? [];
  const plans = plansResult.data ?? [];
  const checkIns = checkInsResult.data ?? [];
  const evidence = evidenceResult.data ?? [];
  const authoritativeBreaks = (orgResult.data?.feature_flags as Json | null)?.worktivity_authoritative_breaks === true;
  const allReferences: Json[] = [];

  const days = dates.map((date, index) => {
    const workspace = workspaces[index];
    const daySessions = sessions.filter((item) => item.shift_date === date);
    const plan = plans.find((item) => item.shift_date === date) as Json | undefined;
    const items = Array.isArray(plan?.items) ? (plan.items as Json[]) : [];
    const dayCheckIns = checkIns.filter((item) => item.shift_date === date && item.substantive === true);
    const dayEvidence = evidence.filter((item) => item.evidence_date === date);
    const references = [
      ...(plan ? [{ type: "plan", id: plan.id, date, label: `Goal for ${date}`, target: `/work-os?view=tasks&date=${date}` }] : []),
      ...workspace.tasks.map((item) => ({ type: "task", id: item.id, date, label: item.title, target: `/work-os?view=tasks&date=${date}&task=${item.provider_task_id}` })),
      ...dayCheckIns.map((item) => ({ type: "check_in", id: item.id, date, label: String(item.input_text ?? "Employee update").slice(0, 100), target: `/work-os?view=insights&date=${date}&update=${item.id}` })),
      ...dayEvidence.map((item) => ({ type: "evidence", id: item.id, date, label: item.title, target: `/work-os?view=evidence&date=${date}&evidence=${item.id}` })),
    ];
    allReferences.push(...references);
    const breakStates = daySessions.map((item) => effectiveBreakObservation(item, now, authoritativeBreaks).freshness);
    return {
      date,
      goal: { text: workspace.goal.text, provenance: workspace.goal.provenance },
      observedSeconds: daySessions.reduce((sum, item) => sum + reliableElapsedSeconds(item, now, through, authoritativeBreaks), 0),
      pausedSeconds: daySessions.reduce((sum, item) => sum + effectiveBreakObservation(item, now, authoritativeBreaks).seconds, 0),
      breakFreshness: authoritativeBreaks
        ? breakStates.includes("unknown") ? "unknown" : breakStates.includes("stale") ? "stale" : "observed"
        : "manual",
      sessionQuality: workspace.sessionQuality,
      planStatus: plan?.status ?? "none",
      planned: workspace.commitmentTotal,
      plannedCompleted: workspace.commitmentCompleted,
      completed: workspace.tasks.filter((task) => task.dayAttribution.reason === "completed").length,
      progressed: dayCheckIns.filter((item) => ["continuing", "material_progress"].includes(String(item.update_kind))).length,
      deferred: items.filter((item) => item.disposition === "deferred" && !["archived", "deleted"].includes(String(item.task?.status))).length,
      carried: workspace.carryOverGroups.reduce((sum, group) => sum + group.tasks.length, 0),
      unplanned: workspace.tasks.filter((task) => task.dayAttribution.reason === "creation_observed" && !task.due_date).length,
      carryOver: workspace.carryOverGroups.reduce((sum, group) => sum + group.tasks.length, 0),
      overdue: workspace.overdueCount,
      updates: dayCheckIns.length,
      outputEvidence: dayEvidence.filter((item) => item.source !== "worktivity").length,
      activityContext: dayEvidence.filter((item) => item.source === "worktivity").length,
      tasksCompleted: workspace.completed,
      tasksOpen: Math.max(0, workspace.total - workspace.completed),
      references,
    };
  });
  const numericKeys = ["observedSeconds", "pausedSeconds", "planned", "plannedCompleted", "completed", "progressed", "deferred", "carried", "unplanned", "carryOver", "overdue", "updates", "outputEvidence", "activityContext", "tasksCompleted", "tasksOpen"] as const;
  const totals = Object.fromEntries(numericKeys.map((key) => [key, days.reduce((sum, day) => sum + Number(day[key]), 0)]));
  const observed = sessions.map((item) => item.attendance_observed_at).filter(Boolean).sort().at(-1) ?? null;
  const niftySyncedAt = orgResult.data?.nifty_synced_at ?? null;
  const stale = !!orgResult.data?.nifty_sync_error || !niftySyncedAt || now.getTime() - Date.parse(niftySyncedAt) > 10 * 60_000;
  return {
    range,
    from,
    through,
    days,
    totals,
    brief: deterministicInsightBrief(days, allReferences),
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

export function insightDateWindow(range: InsightRange, throughValue?: string | null, now = new Date()) {
  const through = validDate(throughValue) ?? now.toISOString().slice(0, 10);
  const count = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  return { through, count, from: addDays(through, -(count - 1)) };
}
