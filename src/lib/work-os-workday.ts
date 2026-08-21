import { createAdminClient } from "@/lib/supabase/admin";
import { WorkOsConflictError, type WorkOsAccess } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId, listPersonTasks } from "@/lib/work-os";
import { localDateForTimezone, resolveShiftWindow, type WorkOsScheduleException, type WorkOsScheduleRule } from "@/modules/work-os/companion";
import { decideWorkdayPrompt, eodDueAt, EOD_LEAD_TIME_MS, HOURLY_FALLBACK_DELAY_MS, nextSessionState, prioritizePlanCandidates, type WorkSessionAction, type WorkSessionState } from "@/modules/work-os/workday";

type Json = Record<string, unknown>;
const db = () => createAdminClient();
const value = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : null;

async function audit(access: WorkOsAccess, sessionId: string, eventType: string, fromState: string | null, toState: string, idempotencyKey: string, observedAt: string, metadata: Json = {}, source: "web" | "desktop" | "agent" | "system" = "desktop") {
  const { error } = await db().from("work_session_events").insert({
    organization_id: access.organizationId, person_id: access.personId, session_id: sessionId,
    event_type: eventType, from_state: fromState, to_state: toState, source,
    observed_at: observedAt, actor_user_id: access.ctx.user.id, idempotency_key: idempotencyKey, metadata,
  });
  if (error && !/duplicate/i.test(error.message)) throw new Error(`record work session event: ${error.message}`);
}

async function auditPlan(access: WorkOsAccess, action: string, planId: string, metadata: Json = {}) {
  const { error } = await db().from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action,
    target_type: "daily_plan",
    target_id: planId,
    metadata,
  });
  if (error) throw new Error(`record daily plan audit: ${error.message}`);
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

async function unscheduledSessionContext(access: WorkOsAccess, at: Date) {
  const { data, error } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).maybeSingle();
  if (error) throw new Error(`load employee timezone: ${error.message}`);
  const timezone = typeof data?.timezone === "string" && data.timezone.trim() ? data.timezone : "UTC";
  return { timezone, shiftDate: localDateForTimezone(at, timezone) };
}

async function loadPlan(access: WorkOsAccess, sessionId?: string | null) {
  if (!sessionId) return null;
  const { data, error } = await db().from("work_daily_plans").select("*, items:work_daily_plan_items(*)")
    .eq("organization_id", access.organizationId).eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`load daily plan: ${error.message}`);
  return data;
}

async function loadPlanByDate(access: WorkOsAccess, shiftDate: string) {
  const { data, error } = await db().from("work_daily_plans").select("*, items:work_daily_plan_items(*)")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("shift_date", shiftDate).maybeSingle();
  if (error) throw new Error(`load daily plan by date: ${error.message}`);
  return data;
}

async function localWorkDate(access: WorkOsAccess, at = new Date()) {
  const shift = await shiftFor(access, at);
  if (shift) return { shiftDate: shift.shiftDate, shift };
  const context = await unscheduledSessionContext(access, at);
  return { shiftDate: context.shiftDate, shift: null };
}

async function transitionToEodIfDue(access: WorkOsAccess, session: Record<string, any>, at: Date) {
  if (!["clocked_in", "active", "paused"].includes(String(session.state)) || !session.scheduled_ends_at) return session;
  const dueAt = eodDueAt(session.scheduled_ends_at as string);
  if (!dueAt || at.getTime() < Date.parse(dueAt)) return session;
  const { data, error } = await db().from("work_sessions").update({
    state: "eod_due",
    updated_at: at.toISOString(),
  }).eq("organization_id", access.organizationId).eq("id", session.id as string)
    .in("state", ["clocked_in", "active", "paused"]).select("*").maybeSingle();
  if (error) throw new Error(`persist EOD session state: ${error.message}`);
  if (data) {
    await audit(access, session.id as string, "eod_due", session.state as string, "eod_due", `eod_due:${session.id}:${session.scheduled_ends_at}`, at.toISOString(), { dueAt }, "system");
    return data;
  }
  const current = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId).eq("id", session.id as string).maybeSingle();
  if (current.error) throw new Error(`reload EOD session state: ${current.error.message}`);
  return current.data ?? session;
}

async function recordPromptDelivery(access: WorkOsAccess, session: Record<string, any> | null, prompt: ReturnType<typeof decideWorkdayPrompt>, at: Date) {
  if (!session || !prompt.kind || !["follow_up", "hourly_fallback"].includes(prompt.kind) || !prompt.nextPromptAt) return session;
  const scheduledAt = Date.parse(prompt.nextPromptAt);
  if (!Number.isFinite(scheduledAt) || scheduledAt > at.getTime()) return session;
  const nextFallbackAt = new Date(scheduledAt + HOURLY_FALLBACK_DELAY_MS).toISOString();
  const { data, error } = await db().from("work_sessions").update({
    last_prompt_kind: prompt.kind,
    last_prompt_at: at.toISOString(),
    next_fallback_at: nextFallbackAt,
    updated_at: at.toISOString(),
  }).eq("organization_id", access.organizationId).eq("id", session.id as string).in("state", ["clocked_in", "active", "paused", "eod_due"]).select("*").maybeSingle();
  if (error) throw new Error(`persist Work OS prompt schedule: ${error.message}`);
  return data ?? session;
}

async function loadCarryOverItems(access: WorkOsAccess, shiftDate: string) {
  const previousPlan = await db().from("work_daily_plans").select("id,shift_date")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .lt("shift_date", shiftDate).order("shift_date", { ascending: false }).limit(1).maybeSingle();
  if (previousPlan.error) throw new Error(`load prior daily plan: ${previousPlan.error.message}`);
  if (!previousPlan.data) return new Map<string, { disposition: "selected" | "deferred"; rank: number }>();
  const items = await db().from("work_daily_plan_items").select("task_id,disposition,rank")
    .eq("organization_id", access.organizationId).eq("plan_id", previousPlan.data.id)
    .in("disposition", ["selected", "deferred"]).not("task_id", "is", null).order("rank", { ascending: true });
  if (items.error) throw new Error(`load prior plan items: ${items.error.message}`);
  return new Map((items.data ?? []).map((item) => [String(item.task_id), {
    disposition: item.disposition === "deferred" ? "deferred" as const : "selected" as const,
    rank: Number(item.rank ?? 0),
  }]));
}

export async function ensureDailyPlan(access: WorkOsAccess, session: Record<string, any>) {
  const existing = await loadPlan(access, session.id as string);
  if (existing) return existing;
  const shiftDate = String(session.shift_date);
  const dated = await loadPlanByDate(access, shiftDate);
  if (dated) {
    if (!dated.session_id) {
      const { data, error } = await db().from("work_daily_plans").update({
        session_id: session.id,
        revision: Number(dated.revision ?? 1) + 1,
        updated_at: new Date().toISOString(),
      }).eq("organization_id", access.organizationId).eq("id", dated.id).is("session_id", null)
        .select("*, items:work_daily_plan_items(*)").single();
      if (error) throw new Error(`attach daily plan to session: ${error.message}`);
      await auditPlan(access, "plan.session_attached", String(dated.id), { sessionId: session.id, shiftDate });
      return data;
    }
    return dated;
  }
  return ensureDailyPlanForDate(access, shiftDate, session);
}

export async function ensureDailyPlanForDate(access: WorkOsAccess, shiftDate: string, session: Record<string, any> | null = null) {
  const existing = await loadPlanByDate(access, shiftDate);
  if (existing) return existing;
  const carryOver = await loadCarryOverItems(access, shiftDate);
  const ownerId = await getWorkOsOrganizationOwnerId(access.organizationId);
  const currentTasks = await listPersonTasks(ownerId, access.personId as string, {
    completed: "false", todayOnly: true, todayDate: shiftDate, limit: 100,
  });
  const missingCarryIds = [...carryOver.keys()].filter((id) => !(currentTasks ?? []).some((task) => String(task.id) === id));
  let carryTasks: Json[] = [];
  if (missingCarryIds.length) {
    const result = await db().from("work_tasks").select("*").eq("user_id", ownerId).in("id", missingCarryIds).eq("completed", false);
    if (result.error) throw new Error(`load carry-over tasks: ${result.error.message}`);
    carryTasks = result.data ?? [];
  }
  const tasks = [...(currentTasks ?? []), ...carryTasks];
  const candidates = prioritizePlanCandidates(tasks, shiftDate, carryOver).map((task) => ({
      organization_id: access.organizationId, person_id: access.personId, task_id: task.id,
      source: task.source, disposition: task.disposition, rank: task.rank, title_snapshot: task.title,
      blocker: task.blocked_reason, item_kind: "nifty_task", completion_state: task.completed ? "completed" : "open",
    }));
  const { data: plan, error: planError } = await db().from("work_daily_plans").insert({
    organization_id: access.organizationId, person_id: access.personId, session_id: session?.id ?? null,
    shift_date: shiftDate, created_by: access.ctx.user.id,
  }).select("*").single();
  if (planError) {
    if (/duplicate|unique/i.test(planError.message)) return loadPlanByDate(access, shiftDate);
    throw new Error(`create daily plan: ${planError.message}`);
  }
  if (candidates.length) {
    const { error: itemError } = await db().from("work_daily_plan_items").insert(candidates.map((entry) => ({ ...entry, plan_id: plan.id })));
    if (itemError) throw new Error(`create daily plan items: ${itemError.message}`);
  }
  await auditPlan(access, "plan.draft_created", String(plan.id), { shiftDate, candidateCount: candidates.length });
  return loadPlanByDate(access, shiftDate);
}

export async function getWorkday(access: WorkOsAccess, at = new Date()) {
  const loadedSession = await activeSession(access);
  const session = loadedSession ? await transitionToEodIfDue(access, loadedSession, at) : null;
  const context = await localWorkDate(access, at);
  const shift = context.shift;
  const plan = session
    ? await ensureDailyPlan(access, session)
    : await ensureDailyPlanForDate(access, context.shiftDate);
  const promptDecision = decideWorkdayPrompt({
    session: session ? {
      state: session.state as WorkSessionState,
      scheduledStartsAt: session.scheduled_starts_at as string | null,
      scheduledEndsAt: session.scheduled_ends_at as string | null,
      clockedInAt: session.clocked_in_at as string | null,
      clockedOutAt: session.clocked_out_at as string | null,
      snoozedUntil: session.snoozed_until as string | null,
      firstFollowUpAt: session.first_follow_up_at as string | null,
      nextFallbackAt: session.next_fallback_at as string | null,
      lastPromptKind: session.last_prompt_kind as "follow_up" | "hourly_fallback" | "eod" | null,
      lastPromptAt: session.last_prompt_at as string | null,
    } : null,
    breaks: shift?.breaks ?? [], hasConfirmedPlan: plan?.status === "confirmed", planConfirmedAt: plan?.confirmed_at as string | null,
    firstFollowUpAt: session?.first_follow_up_at as string | null,
    nextFallbackAt: session?.next_fallback_at as string | null,
    lastPromptKind: session?.last_prompt_kind as "follow_up" | "hourly_fallback" | "eod" | null,
    lastPromptAt: session?.last_prompt_at as string | null,
    lastSubstantiveUpdateAt: session?.last_substantive_update_at as string | null, at: at.toISOString(),
  });
  const persistedSession = await recordPromptDelivery(access, session, promptDecision, at);
  return { session: persistedSession, plan, prompt: promptDecision };
}

export async function clockIn(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const existingByKey = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).eq("clock_in_idempotency_key", idempotencyKey).maybeSingle();
  if (existingByKey.error) throw new Error(`load idempotent clock-in: ${existingByKey.error.message}`);
  if (existingByKey.data) return { session: existingByKey.data, plan: await loadPlan(access, existingByKey.data.id as string) };
  if (await activeSession(access)) throw new Error("Only one active work session is allowed.");
  const observedAt = value(body.observed_at) ?? new Date().toISOString();
  const observed = new Date(observedAt); if (Number.isNaN(observed.getTime())) throw new Error("observed_at must be a valid timestamp");
  const shift = await shiftFor(access, observed);
  const unscheduled = !shift;
  if (unscheduled && body.unscheduled_acknowledged !== true) throw new Error("Unscheduled clock-in acknowledgement is required.");
  const context = shift ?? await unscheduledSessionContext(access, observed);
  const late = !!shift && observed.getTime() > Date.parse(shift.startsAt) + 15 * 60_000;
  if (late && body.late_acknowledged !== true) throw new Error("Late clock-in acknowledgement is required.");
  const { data: session, error } = await db().from("work_sessions").insert({
    organization_id: access.organizationId, person_id: access.personId, schedule_id: shift?.scheduleId ?? null,
    shift_date: context.shiftDate, state: "clocked_in", timezone: context.timezone,
    scheduled_starts_at: shift?.startsAt ?? null, scheduled_ends_at: shift?.endsAt ?? null, clocked_in_at: observed.toISOString(),
    source: value(body.source) ?? "desktop", clock_in_idempotency_key: idempotencyKey,
    late_acknowledged_at: late ? observed.toISOString() : null, created_by: access.ctx.user.id,
  }).select("*").single();
  if (error) {
    if (/duplicate|unique|work_sessions_active_person_uidx/i.test(error.message)) {
      const reconciled = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
        .eq("person_id", access.personId as string).eq("clock_in_idempotency_key", idempotencyKey).maybeSingle();
      if (reconciled.error) throw new Error(`reconcile idempotent clock-in: ${reconciled.error.message}`);
      if (reconciled.data) return { session: reconciled.data, plan: await loadPlan(access, reconciled.data.id as string) };
      throw new WorkOsConflictError("Only one active work session is allowed.");
    }
    throw new Error(`clock in: ${error.message}`);
  }
  const source = value(body.source);
  await audit(access, session.id as string, "clock_in", shift ? "scheduled" : null, "clocked_in", idempotencyKey, observed.toISOString(), { late, unscheduled }, source === "web" || source === "agent" || source === "system" ? source : "desktop");
  return { session, plan: await ensureDailyPlan(access, session) };
}

export async function transitionSession(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const existingEvent = await db().from("work_session_events").select("session_id")
    .eq("organization_id", access.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingEvent.error) throw new Error(`load idempotent session transition: ${existingEvent.error.message}`);
  if (existingEvent.data) {
    const current = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId).eq("id", existingEvent.data.session_id).single();
    if (current.error) throw new Error(`load transitioned work session: ${current.error.message}`);
    return { session: current.data, plan: await loadPlan(access, current.data.id as string) };
  }
  const clockedOutByKey = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).eq("clock_out_idempotency_key", idempotencyKey).maybeSingle();
  if (clockedOutByKey.error) throw new Error(`load idempotent clock-out: ${clockedOutByKey.error.message}`);
  if (clockedOutByKey.data) return { session: clockedOutByKey.data, plan: await loadPlan(access, clockedOutByKey.data.id as string) };
  const session = await activeSession(access); if (!session) throw new Error("No active work session.");
  const action = value(body.action) as WorkSessionAction | null;
  if (!action || !["pause", "resume", "mark_active", "mark_eod_due", "clock_out"].includes(action)) throw new Error("A valid session action is required.");
  if (action === "clock_out" && session.clock_out_idempotency_key === idempotencyKey) return { session, plan: await loadPlan(access, session.id as string) };
  const observedAt = value(body.observed_at) ?? new Date().toISOString();
  const observed = new Date(observedAt); if (Number.isNaN(observed.getTime())) throw new Error("observed_at must be a valid timestamp");
  const next = nextSessionState(session.state as WorkSessionState, action);
  const scheduledEnd = session.scheduled_ends_at ? Date.parse(session.scheduled_ends_at as string) : null;
  if (action === "mark_eod_due" && (scheduledEnd === null || observed.getTime() < scheduledEnd - EOD_LEAD_TIME_MS)) {
    throw new Error("EOD state is server-owned and only becomes available in the final ten minutes of the scheduled shift.");
  }
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

function planDate(input: unknown) {
  const result = value(input);
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("shift_date must be YYYY-MM-DD");
  return result;
}

export async function getDailyPlan(access: WorkOsAccess, requestedDate?: string | null, at = new Date()) {
  const { shiftDate: currentDate } = await localWorkDate(access, at);
  const shiftDate = planDate(requestedDate) ?? currentDate;
  const plan = shiftDate === currentDate
    ? await ensureDailyPlanForDate(access, shiftDate, await activeSession(access))
    : await loadPlanByDate(access, shiftDate);
  return { plan, currentDate, editable: shiftDate === currentDate && plan?.status !== "closed" };
}

type DraftItem = {
  id?: string;
  task_id?: string | null;
  title_snapshot?: string;
  disposition?: string;
  rank?: number;
  item_kind?: string;
  completion_state?: string;
};

export async function saveDailyPlanDraft(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const { shiftDate: currentDate } = await localWorkDate(access);
  const shiftDate = planDate(body.shift_date) ?? currentDate;
  if (shiftDate !== currentDate) throw new Error("Only today's plan can be edited.");
  const session = await activeSession(access);
  const plan = session ? await ensureDailyPlan(access, session) : await ensureDailyPlanForDate(access, shiftDate);
  if (!plan || plan.status === "closed") throw new Error("This plan is read-only.");
  const expectedRevision = Number(body.revision ?? plan.revision ?? 1);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("A valid plan revision is required.");
  const submitted = Array.isArray(body.items) ? body.items as DraftItem[] : null;
  if (submitted && submitted.length > 100) throw new Error("A daily plan can contain at most 100 items.");
  const freeformIntent = value(body.freeform_intent);
  if (freeformIntent && freeformIntent.length > 4000) throw new Error("Plan intent must be 4000 characters or fewer.");
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await db().from("work_daily_plans").update({
    freeform_intent: freeformIntent,
    revision: expectedRevision + 1,
    updated_at: now,
  }).eq("organization_id", access.organizationId).eq("id", plan.id).eq("revision", expectedRevision)
    .neq("status", "closed").select("id").maybeSingle();
  if (claimError) throw new Error(`save daily plan draft: ${claimError.message}`);
  if (!claimed) throw new WorkOsConflictError("This plan changed on another device. Refresh before saving again.");

  if (submitted) {
    const existingItems = Array.isArray(plan.items) ? plan.items as Json[] : [];
    const existingById = new Map(existingItems.map((item) => [String(item.id), item]));
    const retainedOutcomes = new Set<string>();
    for (let index = 0; index < submitted.length; index += 1) {
      const item = submitted[index];
      const disposition = item.disposition === "deferred" ? "deferred" : "selected";
      const completionState = item.completion_state === "completed" ? "completed" : "open";
      const existing = item.id ? existingById.get(String(item.id)) : null;
      if (existing) {
        const outcome = existing.item_kind === "outcome" || !existing.task_id;
        const title = outcome ? value(item.title_snapshot) : value(existing.title_snapshot);
        if (!title || title.length > 240) throw new Error("Plan outcomes require a title of 240 characters or fewer.");
        const { error } = await db().from("work_daily_plan_items").update({
          rank: index,
          disposition,
          title_snapshot: title,
          completion_state: outcome ? completionState : existing.completion_state,
          completed_at: outcome && completionState === "completed" ? existing.completed_at ?? now : null,
          updated_at: now,
        }).eq("organization_id", access.organizationId).eq("plan_id", plan.id).eq("id", existing.id);
        if (error) throw new Error(`update daily plan item: ${error.message}`);
        if (outcome) retainedOutcomes.add(String(existing.id));
        continue;
      }
      if (item.item_kind !== "outcome" && item.task_id) throw new Error("New Nifty plan items must come from the server-provided task list.");
      const title = value(item.title_snapshot);
      if (!title || title.length > 240) throw new Error("Plan outcomes require a title of 240 characters or fewer.");
      const { data: created, error } = await db().from("work_daily_plan_items").insert({
        organization_id: access.organizationId,
        plan_id: plan.id,
        person_id: access.personId,
        task_id: null,
        source: "unplanned",
        disposition,
        rank: index,
        title_snapshot: title,
        item_kind: "outcome",
        completion_state: completionState,
        completed_at: completionState === "completed" ? now : null,
      }).select("id").single();
      if (error) throw new Error(`create daily plan outcome: ${error.message}`);
      retainedOutcomes.add(String(created.id));
    }
    const removable = existingItems.filter((item) => (item.item_kind === "outcome" || !item.task_id) && !retainedOutcomes.has(String(item.id)));
    if (removable.length) {
      const { error } = await db().from("work_daily_plan_items").delete().eq("organization_id", access.organizationId)
        .eq("plan_id", plan.id).in("id", removable.map((item) => String(item.id)));
      if (error) throw new Error(`remove daily plan outcomes: ${error.message}`);
    }
  }
  await auditPlan(access, "plan.draft_saved", String(plan.id), { shiftDate, revision: expectedRevision + 1, idempotencyKey });
  return loadPlanByDate(access, shiftDate);
}

export async function updateDailyPlanOutcome(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const outcomeId = value(body.outcome_id);
  if (!outcomeId) throw new Error("outcome_id is required");
  const completionState = body.completion_state === "completed" ? "completed" : body.completion_state === "open" ? "open" : null;
  if (!completionState) throw new Error("completion_state must be open or completed");
  const { shiftDate } = await localWorkDate(access);
  const plan = await loadPlanByDate(access, shiftDate);
  if (!plan || plan.status === "closed") throw new Error("This plan is read-only.");
  const now = new Date().toISOString();
  const { data, error } = await db().from("work_daily_plan_items").update({
    completion_state: completionState,
    completed_at: completionState === "completed" ? now : null,
    updated_at: now,
  }).eq("organization_id", access.organizationId).eq("plan_id", plan.id).eq("id", outcomeId)
    .eq("item_kind", "outcome").select("id").maybeSingle();
  if (error) throw new Error(`update plan outcome: ${error.message}`);
  if (!data) throw new Error("Plan outcome not found.");
  await auditPlan(access, "plan.outcome_updated", String(plan.id), { outcomeId, completionState, idempotencyKey });
  return loadPlanByDate(access, shiftDate);
}

export async function convertDailyPlanOutcome(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const outcomeId = value(body.convert_outcome_id);
  const taskId = value(body.task_id);
  if (!outcomeId || !taskId) throw new Error("convert_outcome_id and task_id are required");
  const { shiftDate } = await localWorkDate(access);
  const plan = await loadPlanByDate(access, shiftDate);
  if (!plan || plan.status === "closed") throw new Error("This plan is read-only.");
  const ownerId = await getWorkOsOrganizationOwnerId(access.organizationId);
  const taskResult = await db().from("work_tasks").select("id,title,completed,completed_at").eq("user_id", ownerId)
    .eq("id", taskId).contains("assignee_person_ids", [access.personId as string]).maybeSingle();
  if (taskResult.error) throw new Error(`validate converted Nifty task: ${taskResult.error.message}`);
  if (!taskResult.data) throw new Error("The confirmed Nifty task is not assigned to this employee.");
  const now = new Date().toISOString();
  const { data, error } = await db().from("work_daily_plan_items").update({
    task_id: taskResult.data.id,
    item_kind: "nifty_task",
    title_snapshot: taskResult.data.title,
    completion_state: taskResult.data.completed ? "completed" : "open",
    completed_at: taskResult.data.completed_at,
    updated_at: now,
  }).eq("organization_id", access.organizationId).eq("plan_id", plan.id).eq("id", outcomeId)
    .eq("item_kind", "outcome").select("id").maybeSingle();
  if (error) throw new Error(`link converted plan outcome: ${error.message}`);
  if (!data) throw new Error("Plan outcome not found.");
  await auditPlan(access, "plan.outcome_converted", String(plan.id), { outcomeId, taskId, idempotencyKey });
  return loadPlanByDate(access, shiftDate);
}

export async function saveDailyPlan(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const session = await activeSession(access); if (!session) throw new Error("Clock in before confirming a plan.");
  const plan = await ensureDailyPlan(access, session); if (!plan) throw new Error("Daily plan not found.");
  if (body.confirm === true && plan.status === "confirmed" && plan.confirmation_idempotency_key === idempotencyKey) return plan;
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
  const deferredIds = Array.isArray(body.deferred_ids) ? body.deferred_ids.map(String) : [];
  const editableIds = new Set((Array.isArray(plan.items) ? plan.items : [])
    .filter((item: Json) => ["selected", "deferred"].includes(String(item.disposition)))
    .map((item: Json) => String(item.id)));
  if (itemIds.some((id) => !editableIds.has(id)) || deferredIds.some((id) => !editableIds.has(id))) throw new Error("Plan selection contains an item that is no longer editable.");
  if (itemIds.some((id) => deferredIds.includes(id))) throw new Error("A plan item cannot be both selected and deferred.");
  const now = new Date();
  for (let rank = 0; rank < itemIds.length; rank += 1) {
    const { data: updated, error: itemError } = await db().from("work_daily_plan_items").update({ rank, disposition: "selected", updated_at: now.toISOString() }).eq("organization_id", access.organizationId).eq("plan_id", plan.id).eq("id", itemIds[rank]).in("disposition", ["selected", "deferred"]).select("id").maybeSingle();
    if (itemError) throw new Error(`select daily plan item: ${itemError.message}`);
    if (!updated) throw new Error("A selected plan item changed before the plan was saved.");
  }
  if (deferredIds.length) {
    const { data: updated, error: itemError } = await db().from("work_daily_plan_items").update({ disposition: "deferred", updated_at: now.toISOString() }).eq("organization_id", access.organizationId).eq("plan_id", plan.id).in("id", deferredIds).in("disposition", ["selected", "deferred"]).select("id");
    if (itemError) throw new Error(`defer daily plan item: ${itemError.message}`);
    if ((updated ?? []).length !== deferredIds.length) throw new Error("A deferred plan item changed before the plan was saved.");
  }
  const confirmed = body.confirm === true;
  const confirmedAt = plan.confirmed_at ? new Date(plan.confirmed_at as string) : now;
  const followUpAt = session.first_follow_up_at ?? new Date(confirmedAt.getTime() + 30 * 60_000).toISOString();
  const { data, error } = await db().from("work_daily_plans").update({
    freeform_intent: value(body.freeform_intent), status: confirmed ? "confirmed" : plan.status,
    confirmation_idempotency_key: confirmed ? idempotencyKey : plan.confirmation_idempotency_key,
    confirmed_at: confirmed ? confirmedAt.toISOString() : plan.confirmed_at,
    revision: Number(plan.revision ?? 1) + 1,
    updated_at: now.toISOString(),
  }).eq("id", plan.id).eq("organization_id", access.organizationId).select("*, items:work_daily_plan_items(*)").single();
  if (error) throw new Error(`save daily plan: ${error.message}`);
  if (confirmed && !session.first_follow_up_at) {
    const { error: sessionError } = await db().from("work_sessions").update({
      first_follow_up_at: followUpAt, next_fallback_at: null, last_prompt_kind: null, last_prompt_at: null, updated_at: now.toISOString(),
    }).eq("organization_id", access.organizationId).eq("id", session.id);
    if (sessionError) throw new Error(`save Work OS prompt schedule: ${sessionError.message}`);
  }
  await auditPlan(access, confirmed ? "plan.confirmed" : "plan.updated", plan.id as string, {
    sessionId: session.id,
    selectedCount: itemIds.length,
    deferredCount: deferredIds.length,
    idempotencyKey,
  });
  return data;
}
