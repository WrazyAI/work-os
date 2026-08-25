import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkOsOrganizationOwnerId } from "@/lib/work-os";
import type { WorkOsAccess } from "@/lib/work-os-api";

type Json = Record<string, any>;
export type InsightRange = "day" | "7d" | "30d";

const db = () => createAdminClient();
const DAY_MS = 86_400_000;

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateOf(value: unknown) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
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

function elapsedSeconds(session: Json, now: Date, authoritative: boolean) {
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start)) return 0;
  const rawEnd = session.clocked_out_at ? Date.parse(String(session.clocked_out_at)) : now.getTime();
  const end = Number.isFinite(rawEnd) ? rawEnd : now.getTime();
  return Math.max(0, Math.round((end - start) / 1000) - effectiveBreakObservation(session, now, authoritative).seconds);
}

export function deterministicInsightBrief(days: Json[], references: Json[]) {
  const latest = days.at(-1) ?? {};
  const completed = days.reduce((sum, day) => sum + day.tasksCompleted, 0);
  const plannedCompleted = days.reduce((sum, day) => sum + day.plannedCompleted, 0);
  const carry = days.reduce((sum, day) => sum + day.carryOver, 0);
  const evidence = days.reduce((sum, day) => sum + day.outputEvidence, 0);
  const wins = [
    completed ? `${completed} task outcome${completed === 1 ? "" : "s"} completed in this range.` : "No completed Nifty outcomes were recorded in this range.",
    plannedCompleted ? `${plannedCompleted} planned item${plannedCompleted === 1 ? "" : "s"} reached completion.` : "No planned items have reached completion yet.",
  ];
  const attention = [
    carry ? `${carry} carry-over item${carry === 1 ? "" : "s"} remained visible across the selected days.` : "No carry-over pressure is visible.",
    evidence ? `${evidence} output-evidence event${evidence === 1 ? "" : "s"} support the work record.` : "No output evidence has been linked yet; activity context alone does not prove an outcome.",
  ];
  const nextFocus = latest.planned > latest.plannedCompleted
    ? ["Close or explicitly defer the remaining planned items before the next workday."]
    : ["Set the next workday intent and choose the smallest set of meaningful outcomes."];
  return {
    generated: false,
    summary: completed
      ? `The record shows ${completed} completed task outcome${completed === 1 ? "" : "s"}; plan, evidence, and activity signals remain separate.`
      : "The record is still forming. Plan commitments, employee updates, output evidence, and activity context are shown separately.",
    wins,
    attention,
    nextFocus,
    referenceIds: references.slice(0, 24).map((item) => String(item.id)),
  };
}

async function aiBrief(days: Json[], references: Json[]) {
  const fallback = deterministicInsightBrief(days, references);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !references.length) return fallback;
  try {
    const allowed = new Set(references.map((item) => String(item.id)));
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.WORK_OS_INSIGHTS_MODEL?.trim() || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Create a concise personal work brief from only the supplied facts. Never call activity productivity. Separate employee claims, task outcomes, output evidence, and activity context. Return JSON with summary, wins, attention, nextFocus, and referenceIds. Every claim must cite one or more supplied reference IDs." },
          { role: "user", content: JSON.stringify({ days, references }) },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as Json;
    const raw = payload.choices?.[0]?.message?.content;
    const parsed = typeof raw === "string" ? JSON.parse(raw) as Json : null;
    const ids = Array.isArray(parsed?.referenceIds) ? parsed.referenceIds.map(String).filter((id: string) => allowed.has(id)) : [];
    if (!parsed || typeof parsed.summary !== "string" || !ids.length) return fallback;
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
    return { generated: true, summary: parsed.summary.slice(0, 900), wins: strings(parsed.wins), attention: strings(parsed.attention), nextFocus: strings(parsed.nextFocus), referenceIds: ids.slice(0, 24) };
  } catch {
    return fallback;
  }
}

export async function getPersonalInsights(access: WorkOsAccess, range: InsightRange, throughValue?: string | null, now = new Date()) {
  const { through, count, from } = insightDateWindow(range, throughValue, now);
  const personId = access.personId as string;
  const ownerId = await getWorkOsOrganizationOwnerId(access.organizationId);
  const [sessionsResult, plansResult, checkInsResult, evidenceResult, tasksResult, orgResult] = await Promise.all([
    db().from("work_sessions").select("id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,provider_break_seconds,provider_break_observed_at,provider_break_provenance,attendance_observed_at")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_daily_plans").select("id,shift_date,status,items:work_daily_plan_items(id,task_id,item_kind,completion_state,completed_at,source,title_snapshot,task:work_tasks(id,title,completed,completed_at))")
      .eq("organization_id", access.organizationId).eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_check_ins").select("id,shift_date,substantive,input_text").eq("organization_id", access.organizationId)
      .eq("person_id", personId).gte("shift_date", from).lte("shift_date", through),
    db().from("work_evidence").select("id,evidence_date,source,title").eq("user_id", ownerId).eq("person_id", personId)
      .gte("evidence_date", from).lte("evidence_date", through),
    db().from("work_tasks").select("id,title,completed,completed_at,due_date,provider_created_at")
      .eq("user_id", ownerId).contains("assignee_person_ids", [personId])
      .or(`due_date.lte.${through},provider_created_at.lt.${addDays(through, 1)}T00:00:00Z`),
    db().from("work_organizations").select("nifty_synced_at,feature_flags").eq("id", access.organizationId).single(),
  ]);
  for (const [label, result] of [["sessions", sessionsResult], ["plans", plansResult], ["check-ins", checkInsResult], ["evidence", evidenceResult], ["tasks", tasksResult], ["organization", orgResult]] as const) {
    if (result.error) throw new Error(`load Work OS insight ${label}: ${result.error.message}`);
  }
  const sessions = sessionsResult.data ?? [];
  const plans = plansResult.data ?? [];
  const checkIns = checkInsResult.data ?? [];
  const evidence = evidenceResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const authoritativeBreaks = (orgResult.data?.feature_flags as Json | null)?.worktivity_authoritative_breaks === true;
  const allReferences: Json[] = [];
  const days = Array.from({ length: count }, (_, index) => addDays(from, index)).map((date) => {
    const daySessions = sessions.filter((item) => item.shift_date === date);
    const plan = plans.find((item) => item.shift_date === date) as Json | undefined;
    const items = Array.isArray(plan?.items) ? plan.items as Json[] : [];
    const dayCheckIns = checkIns.filter((item) => item.shift_date === date && item.substantive === true);
    const dayEvidence = evidence.filter((item) => item.evidence_date === date);
    const completedTasks = tasks.filter((item) => dateOf(item.completed_at) === date);
    const openTasks = tasks.filter((item) => {
      const created = dateOf(item.provider_created_at) ?? dateOf(item.due_date);
      const completedAt = dateOf(item.completed_at);
      return !!created && created <= date && (!completedAt || completedAt > date) && (!item.due_date || item.due_date <= date || created === date);
    });
    const completedItem = (item: Json) => item.item_kind === "outcome"
      ? item.completion_state === "completed"
      : item.task?.completed === true && (!item.task.completed_at || dateOf(item.task.completed_at)! <= date);
    const references = [
      ...(plan ? [{ type: "plan", id: plan.id, label: `Plan for ${date}` }] : []),
      ...completedTasks.map((item) => ({ type: "task", id: item.id, label: item.title })),
      ...dayCheckIns.map((item) => ({ type: "check_in", id: item.id, label: String(item.input_text ?? "Employee update").slice(0, 100) })),
      ...dayEvidence.map((item) => ({ type: "evidence", id: item.id, label: item.title })),
    ];
    allReferences.push(...references);
    return {
      date,
      observedSeconds: daySessions.reduce((sum, item) => sum + elapsedSeconds(item, now, authoritativeBreaks), 0),
      pausedSeconds: daySessions.reduce((sum, item) => sum + effectiveBreakObservation(item, now, authoritativeBreaks).seconds, 0),
      breakFreshness: authoritativeBreaks
        ? (daySessions.some((item) => effectiveBreakObservation(item, now, true).freshness === "unknown") ? "unknown" : daySessions.some((item) => effectiveBreakObservation(item, now, true).freshness === "stale") ? "stale" : "observed")
        : "manual",
      planStatus: plan?.status ?? "none",
      planned: items.filter((item) => item.disposition !== "removed").length,
      plannedCompleted: items.filter((item) => item.disposition !== "removed" && completedItem(item)).length,
      carryOver: items.filter((item) => item.source === "carry_over" && item.disposition !== "removed").length,
      overdue: items.filter((item) => item.source === "overdue" && item.disposition !== "removed").length,
      updates: dayCheckIns.length,
      outputEvidence: dayEvidence.filter((item) => item.source !== "worktivity").length,
      activityContext: dayEvidence.filter((item) => item.source === "worktivity").length,
      tasksCompleted: completedTasks.length,
      tasksOpen: openTasks.length,
      references,
    };
  });
  const numericKeys = ["observedSeconds", "pausedSeconds", "planned", "plannedCompleted", "carryOver", "overdue", "updates", "outputEvidence", "activityContext", "tasksCompleted", "tasksOpen"] as const;
  const totals = Object.fromEntries(numericKeys.map((key) => [key, days.reduce((sum, day) => sum + Number(day[key]), 0)]));
  const observed = sessions.map((item) => item.attendance_observed_at).filter(Boolean).sort().at(-1) ?? null;
  return {
    range, from, through, days, totals,
    brief: await aiBrief(days, allReferences),
    freshness: { niftySyncedAt: orgResult.data?.nifty_synced_at ?? null, worktivityObservedAt: observed, authoritativeBreaks },
  };
}

export function insightDateWindow(range: InsightRange, throughValue?: string | null, now = new Date()) {
  const through = validDate(throughValue) ?? now.toISOString().slice(0, 10);
  const count = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  return { through, count, from: addDays(through, -(count - 1)) };
}
