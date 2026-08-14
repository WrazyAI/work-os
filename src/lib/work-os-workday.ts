import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { localDateForTimezone, resolveShiftWindow, type WorkOsScheduleException, type WorkOsScheduleRule } from "@/modules/work-os/companion";
import { decideWorkdayPrompt, dedupePlanCandidates, nextSessionState, type WorkSessionAction, type WorkSessionState } from "@/modules/work-os/workday";

type Json = Record<string, unknown>;
const db = () => createAdminClient();
const value = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : null;

async function audit(access: WorkOsAccess, sessionId: string, eventType: string, fromState: string | null, toState: string, idempotencyKey: string, observedAt: string, metadata: Json = {}) {
  const { error } = await db().from("work_session_events").insert({
    organization_id: access.organizationId, person_id: access.personId, session_id: sessionId,
    event_type: eventType, from_state: fromState, to_state: toState, source: "desktop",
    observed_at: observedAt, actor_user_id: access.ctx.user.id, idempotency_key: idempotencyKey, metadata,
  });
  if (error && !/duplicate/i.test(error.message)) throw new Error(`record work session event: ${error.message}`);
}

export async function shiftFor(access: WorkOsAccess, at: Date) {
  const personId = access.personId as string;
  const { data: schedules, error: scheduleError } = await db().from("work_schedules").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("active", true).order("effective_from", { ascending: false });
  if (scheduleError) throw new Error(`load work schedule: ${scheduleError.message}`);
  const rules = (schedules ?? []) as WorkOsScheduleRule[];
  const timezone = rules[0]?.timezone ?? "UTC";
  const localDate = localDateForTimezone(at, timezone);
  const from = new Date(`${localDate}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${localDate}T12:00:00Z`); to.setUTCDate(to.getUTCDate() + 1);
  const { data: exceptions, error: exceptionError } = await db().from("work_schedule_exceptions").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", personId)
    .gte("exception_date", from.toISOString().slice(0, 10)).lte("exception_date", to.toISOString().slice(0, 10));
  if (exceptionError) throw new Error(`load work schedule exceptions: ${exceptionError.message}`);
  return resolveShiftWindow(rules, (exceptions ?? []) as WorkOsScheduleException[], at);
}

export async function activeSession(access: WorkOsAccess) {
  const { data, error } = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).in("state", ["clocked_in", "active", "paused", "eod_due"]).maybeSingle();
  if (error) throw new Error(`load active work session: ${error.message}`);
  return data;
}

async function loadPlan(access: WorkOsAccess, sessionId?: string | null) {
  if (!sessionId) return null;
  const { data, error } = await db().from("work_daily_plans").select("*, items:work_daily_plan_items(*)")
    .eq("organization_id", access.organizationId).eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`load daily plan: ${error.message}`);
  return data;
}

export async function ensureDailyPlan(access: WorkOsAccess, session: Record<string, any>) {
  const existing = await loadPlan(access, session.id as string);
  if (existing) return existing;
  const { data: tasks, error: taskError } = await db().from("work_tasks").select("id,provider_task_id,title,due_date,completed,blocked,blocked_reason,updated_at")
    .eq("organization_id", access.organizationId).contains("assignee_person_ids", [access.personId as string]).eq("completed", false).order("due_date", { ascending: true, nullsFirst: false }).limit(100);
  if (taskError) throw new Error(`load plan candidates: ${taskError.message}`);
  const candidates = dedupePlanCandidates(tasks ?? []).map((task, rank) => ({
    organization_id: access.organizationId, person_id: access.personId, task_id: task.id,
    source: task.due_date && task.due_date < session.shift_date ? "overdue" : task.due_date === session.shift_date ? "due_today" : "existing",
    disposition: "selected", rank, title_snapshot: task.title, blocker: task.blocked_reason,
  }));
  const { data: plan, error: planError } = await db().from("work_daily_plans").insert({
    organization_id: access.organizationId, person_id: access.personId, session_id: session.id,
    shift_date: session.shift_date, created_by: access.ctx.user.id,
  }).select("*").single();
  if (planError) throw new Error(`create daily plan: ${planError.message}`);
  if (candidates.length) {
    const { error: itemError } = await db().from("work_daily_plan_items").insert(candidates.map((entry) => ({ ...entry, plan_id: plan.id })));
    if (itemError) throw new Error(`create daily plan items: ${itemError.message}`);
  }
  return loadPlan(access, session.id as string);
}

export async function getWorkday(access: WorkOsAccess, at = new Date()) {
  const session = await activeSession(access);
  const shift = await shiftFor(access, at);
  const plan = await loadPlan(access, session?.id as string | undefined);
  const prompt = decideWorkdayPrompt({
    session: session ? {
      state: session.state as WorkSessionState,
      scheduledStartsAt: session.scheduled_starts_at as string | null,
      scheduledEndsAt: session.scheduled_ends_at as string | null,
      clockedInAt: session.clocked_in_at as string | null,
      clockedOutAt: session.clocked_out_at as string | null,
      snoozedUntil: session.snoozed_until as string | null,
    } : null,
    breaks: shift?.breaks ?? [], hasConfirmedPlan: plan?.status === "confirmed",
    lastSubstantiveUpdateAt: session?.last_substantive_update_at as string | null, at: at.toISOString(),
  });
  return { session, plan, prompt };
}

export async function clockIn(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const existingByKey = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).eq("clock_in_idempotency_key", idempotencyKey).maybeSingle();
  if (existingByKey.error) throw new Error(`load idempotent clock-in: ${existingByKey.error.message}`);
  if (existingByKey.data) return { session: existingByKey.data, plan: await loadPlan(access, existingByKey.data.id as string) };
  if (await activeSession(access)) throw new Error("Only one active work session is allowed.");
  const observedAt = value(body.observed_at) ?? new Date().toISOString();
  const observed = new Date(observedAt); if (Number.isNaN(observed.getTime())) throw new Error("observed_at must be a valid timestamp");
  const shift = await shiftFor(access, observed); if (!shift) throw new Error("No scheduled shift is available to clock into.");
  const late = observed.getTime() > Date.parse(shift.startsAt) + 15 * 60_000;
  if (late && body.late_acknowledged !== true) throw new Error("Late clock-in acknowledgement is required.");
  const { data: session, error } = await db().from("work_sessions").insert({
    organization_id: access.organizationId, person_id: access.personId, schedule_id: shift.scheduleId,
    shift_date: shift.shiftDate, state: "clocked_in", timezone: shift.timezone,
    scheduled_starts_at: shift.startsAt, scheduled_ends_at: shift.endsAt, clocked_in_at: observed.toISOString(),
    source: value(body.source) ?? "desktop", clock_in_idempotency_key: idempotencyKey,
    late_acknowledged_at: late ? observed.toISOString() : null, created_by: access.ctx.user.id,
  }).select("*").single();
  if (error) throw new Error(`clock in: ${error.message}`);
  await audit(access, session.id as string, "clock_in", "scheduled", "clocked_in", idempotencyKey, observed.toISOString(), { late });
  return { session, plan: await ensureDailyPlan(access, session) };
}

export async function transitionSession(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const session = await activeSession(access); if (!session) throw new Error("No active work session.");
  const action = value(body.action) as WorkSessionAction | null;
  if (!action || !["pause", "resume", "mark_active", "mark_eod_due", "clock_out"].includes(action)) throw new Error("A valid session action is required.");
  if (action === "clock_out" && session.clock_out_idempotency_key === idempotencyKey) return { session, plan: await loadPlan(access, session.id as string) };
  const observedAt = value(body.observed_at) ?? new Date().toISOString();
  const observed = new Date(observedAt); if (Number.isNaN(observed.getTime())) throw new Error("observed_at must be a valid timestamp");
  const next = nextSessionState(session.state as WorkSessionState, action);
  const scheduledEnd = session.scheduled_ends_at ? Date.parse(session.scheduled_ends_at as string) : null;
  const overtime = action === "clock_out" && scheduledEnd !== null && observed.getTime() > scheduledEnd + 15 * 60_000;
  if (overtime && body.extended_acknowledged !== true) throw new Error("Extended-shift acknowledgement is required.");
  let pausedSeconds = Number(session.paused_seconds || 0);
  if (session.state === "paused" && session.paused_at && action !== "pause") pausedSeconds += Math.max(0, Math.round((observed.getTime() - Date.parse(session.paused_at as string)) / 1000));
  const patch: Json = { state: next, updated_at: observed.toISOString(), paused_seconds: pausedSeconds };
  if (action === "pause") patch.paused_at = observed.toISOString();
  if (action === "resume") patch.paused_at = null;
  if (action === "clock_out") Object.assign(patch, { clocked_out_at: observed.toISOString(), clock_out_idempotency_key: idempotencyKey, paused_at: null, extended_acknowledged_at: overtime ? observed.toISOString() : null });
  if (action === "mark_active") patch.last_substantive_update_at = observed.toISOString();
  if (body.snoozed_until) patch.snoozed_until = body.snoozed_until;
  const { data, error } = await db().from("work_sessions").update(patch).eq("id", session.id).eq("organization_id", access.organizationId).select("*").single();
  if (error) throw new Error(`update work session: ${error.message}`);
  await audit(access, session.id as string, action, session.state as string, next, idempotencyKey, observed.toISOString(), { overtime });
  if (next === "clocked_out") await db().from("work_daily_plans").update({ status: "closed", updated_at: observed.toISOString() }).eq("session_id", session.id);
  return { session: data, plan: await loadPlan(access, session.id as string) };
}

export async function saveDailyPlan(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const session = await activeSession(access); if (!session) throw new Error("Clock in before confirming a plan.");
  const plan = await loadPlan(access, session.id as string); if (!plan) throw new Error("Daily plan not found.");
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
  const deferredIds = Array.isArray(body.deferred_ids) ? body.deferred_ids.map(String) : [];
  for (let rank = 0; rank < itemIds.length; rank += 1) {
    await db().from("work_daily_plan_items").update({ rank, disposition: "selected", updated_at: new Date().toISOString() }).eq("plan_id", plan.id).eq("id", itemIds[rank]);
  }
  if (deferredIds.length) await db().from("work_daily_plan_items").update({ disposition: "deferred", updated_at: new Date().toISOString() }).eq("plan_id", plan.id).in("id", deferredIds);
  const confirmed = body.confirm === true;
  const { data, error } = await db().from("work_daily_plans").update({
    freeform_intent: value(body.freeform_intent), status: confirmed ? "confirmed" : plan.status,
    confirmation_idempotency_key: confirmed ? idempotencyKey : plan.confirmation_idempotency_key,
    confirmed_at: confirmed ? new Date().toISOString() : plan.confirmed_at, updated_at: new Date().toISOString(),
  }).eq("id", plan.id).eq("organization_id", access.organizationId).select("*, items:work_daily_plan_items(*)").single();
  if (error) throw new Error(`save daily plan: ${error.message}`);
  return data;
}
