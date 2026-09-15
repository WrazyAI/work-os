import { createAdminClient } from "@/lib/supabase/admin";
import { WorkOsConflictError, type WorkOsAccess, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { listPersonTasks } from "@/lib/work-os";
import { dateOnly } from "@/lib/work-os-internal";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { recordTaskDayEvent } from "@/lib/work-os-daily-workspace";
import { recordWorkMemory } from "@/lib/work-memory";
import { planIntentFingerprint } from "@/lib/work-os-plan-build";
import { localDateForTimezone, resolveStartableShiftWindow, resolveUpcomingShiftWindow, type WorkOsScheduleException, type WorkOsScheduleRule } from "@/modules/work-os/companion";
import { checkInIntervalMs, decideWorkdayPrompt, eodDueAt, EOD_LEAD_TIME_MS, firstFollowUpAt as nextFirstFollowUpAt, nextSessionState, prioritizePlanCandidates, type WorkSessionAction, type WorkSessionState } from "@/modules/work-os/workday";
import { lateReasonRequired, PROLONGED_ABSENCE_MINUTES } from "@/lib/work-os-late-start";
import type { AttendanceProjection } from "@/modules/work-os/attendance";

type Json = Record<string, unknown>;
const db = () => createAdminClient();
const value = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : null;

async function audit(access: WorkOsAccess, sessionId: string, eventType: string, fromState: string | null, toState: string, idempotencyKey: string, observedAt: string, metadata: Json = {}, source: "web" | "desktop" | "agent" | "system" | "worktivity" = "desktop") {
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

async function withGoalMetadata(access: WorkOsAccess, plan: Record<string, any> | null) {
  if (!plan || plan.goal_provenance) return plan;
  const auditResult = await db().from("work_audit_log").select("metadata").eq("organization_id", access.organizationId)
    .eq("target_type", "daily_plan").eq("target_id", String(plan.id)).eq("action", "plan.draft_saved")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (auditResult.error) throw new Error(`load daily goal provenance: ${auditResult.error.message}`);
  const metadata = auditResult.data?.metadata && typeof auditResult.data.metadata === "object" ? auditResult.data.metadata as Json : {};
  const provenance = value(metadata.goalProvenance);
  const suggestionTaskIds = Array.isArray(metadata.suggestionTaskIds) ? metadata.suggestionTaskIds.filter((item): item is string => typeof item === "string") : [];
  return {
    ...plan,
    goal_provenance: provenance ?? (value(plan.freeform_intent) ? "employee" : null),
    suggestion_task_ids: suggestionTaskIds,
  };
}

export async function shiftFor(access: WorkOsAccess, at: Date, mode: "upcoming" | "startable" = "upcoming") {
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
  const window = mode === "startable"
    ? resolveStartableShiftWindow(rules, (exceptions ?? []) as WorkOsScheduleException[], at, 30)
    : resolveUpcomingShiftWindow(rules, (exceptions ?? []) as WorkOsScheduleException[], at);
  return await worktivityAuthoritativeBreaks(access.organizationId) && window ? { ...window, breaks: [] } : window;
}

export async function activeSession(access: WorkOsAccess) {
  const { data, error } = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).in("state", ["clocked_in", "active", "paused", "eod_due"])
    .neq("correction_status", "needs_correction").maybeSingle();
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
  return withGoalMetadata(access, data);
}

async function loadPlanByDate(access: WorkOsAccess, shiftDate: string) {
  const { data, error } = await db().from("work_daily_plans").select("*, items:work_daily_plan_items(*)")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("shift_date", shiftDate).maybeSingle();
  if (error) throw new Error(`load daily plan by date: ${error.message}`);
  return withGoalMetadata(access, data);
}

async function localWorkDate(access: WorkOsAccess, at = new Date()) {
  const context = await unscheduledSessionContext(access, at);
  const shift = await shiftFor(access, at, "upcoming");
  return { shiftDate: context.shiftDate, shift };
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
  if (!session || !prompt.kind || !["follow_up", "hourly_fallback"].includes(prompt.kind) || !prompt.nextPromptAt) return { session, delivered: false };
  const scheduledAt = Date.parse(prompt.nextPromptAt);
  if (!Number.isFinite(scheduledAt) || scheduledAt > at.getTime()) return { session, delivered: false };
  const nextFallbackAt = new Date(scheduledAt + checkInIntervalMs()).toISOString();
  let query = db().from("work_sessions").update({
    last_prompt_kind: prompt.kind,
    last_prompt_at: at.toISOString(),
    next_fallback_at: nextFallbackAt,
    updated_at: at.toISOString(),
  }).eq("organization_id", access.organizationId).eq("id", session.id as string).in("state", ["clocked_in", "active", "paused", "eod_due"]);
  query = session.last_prompt_at
    ? query.eq("last_prompt_at", session.last_prompt_at as string)
    : query.is("last_prompt_at", null);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`persist Work OS prompt schedule: ${error.message}`);
  return { session: data ?? session, delivered: !!data };
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
  return new Map((items.data ?? []).map((item: any) => [String(item.task_id), {
    disposition: item.disposition === "deferred" ? "deferred" as const : "selected" as const,
    rank: Number(item.rank ?? 0),
  }]));
}

export async function ensureDailyPlan(access: WorkOsAccess, session: Record<string, any>) {
  const existing = await loadPlan(access, session.id as string);
  if (existing) return existing;
  const shiftDate = dateOnly(session.shift_date);
  if (!shiftDate) throw new Error("Work session is missing its shift date");
  const dated = await loadPlanByDate(access, shiftDate);
  if (dated) {
    if (dated.session_id !== session.id || dated.status === "closed") {
      const { data, error } = await db().from("work_daily_plans").update({
        session_id: session.id,
        status: dated.status === "closed" ? dated.confirmed_at ? "confirmed" : "draft" : dated.status,
        revision: Number(dated.revision ?? 1) + 1,
        updated_at: new Date().toISOString(),
      }).eq("organization_id", access.organizationId).eq("id", dated.id)
        .select("*, items:work_daily_plan_items(*)").single();
      if (error) throw new Error(`attach daily plan to session: ${error.message}`);
      await auditPlan(access, dated.status === "closed" ? "plan.workday_reopened" : "plan.session_attached", String(dated.id), { sessionId: session.id, previousSessionId: dated.session_id, shiftDate });
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
  const ownerId = workOsOrganizationOwnerId(access);
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
  return { session, plan, prompt: promptDecision };
}

/** Claims a due notification after a companion has decided to display it.
 * Read-only day polling must never advance this cadence. */
export async function deliverWorkdayPrompt(access: WorkOsAccess, at = new Date()) {
  const workday = await getWorkday(access, at);
  const delivery = await recordPromptDelivery(access, workday.session, workday.prompt, at);
  return { ...workday, session: delivery.session, delivered: delivery.delivered };
}

export async function clockIn(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const existingByKey = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).eq("clock_in_idempotency_key", idempotencyKey).maybeSingle();
  if (existingByKey.error) throw new Error(`load idempotent clock-in: ${existingByKey.error.message}`);
  if (existingByKey.data) return { session: existingByKey.data, plan: await loadPlan(access, existingByKey.data.id as string) };
  const existingActive = await activeSession(access);
  if (existingActive) {
    if (existingActive.correction_status === "needs_correction") {
      throw new WorkOsConflictError("The previous workday needs a clock-out correction before another session can begin.");
    }
    return { session: existingActive, plan: await ensureDailyPlan(access, existingActive) };
  }
  const observedAt = value(body.observed_at) ?? new Date().toISOString();
  const observed = new Date(observedAt); if (Number.isNaN(observed.getTime())) throw new Error("observed_at must be a valid timestamp");
  const shift = await shiftFor(access, observed, "startable");
  const unscheduled = !shift;
  const exceptionAcknowledged = body.exception_acknowledged === true || body.unscheduled_acknowledged === true;
  const exceptionReason = value(body.exception_reason);
  if (unscheduled && !exceptionAcknowledged) throw new Error("Exception clock-in acknowledgement is required.");
  if (unscheduled && body.exception_acknowledged === true && !exceptionReason) throw new Error("An exception clock-in reason is required.");
  const context = shift ?? await unscheduledSessionContext(access, observed);
  const late = !!shift && observed.getTime() > Date.parse(shift.startsAt) + 15 * 60_000;
  if (late && body.late_acknowledged !== true) throw new Error("Late clock-in acknowledgement is required.");
  const lateReason = value(body.late_reason);
  if (lateReason && lateReason.length > 1000) throw new Error("Late-start reasons must be 1000 characters or fewer.");
  const prolongedAbsence = !!shift && observed.getTime() >= Date.parse(shift.startsAt) + PROLONGED_ABSENCE_MINUTES * 60_000;
  const payload = {
    organization_id: access.organizationId, person_id: access.personId, schedule_id: shift?.scheduleId ?? null,
    shift_date: context.shiftDate, state: "clocked_in", timezone: context.timezone,
    scheduled_starts_at: shift?.startsAt ?? null, scheduled_ends_at: shift?.endsAt ?? null, clocked_in_at: observed.toISOString(),
    source: value(body.source) ?? "desktop", clock_in_idempotency_key: idempotencyKey,
    late_acknowledged_at: late ? observed.toISOString() : null, created_by: access.ctx.user.id,
    late_reason: prolongedAbsence ? lateReason : null,
    late_reason_provided_at: prolongedAbsence && lateReason ? observed.toISOString() : null,
    first_follow_up_at: null,
    exception_acknowledged_at: unscheduled ? observed.toISOString() : null,
    exception_reason: unscheduled ? exceptionReason ?? "Legacy client exception acknowledgement" : null,
    correction_status: "valid",
    updated_at: observed.toISOString(),
  };
  const sameDay = await db().from("work_sessions").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("shift_date", context.shiftDate).eq("state", "scheduled")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (sameDay.error) throw new Error(`load existing workday session: ${sameDay.error.message}`);
  const write = sameDay.data
    ? db().from("work_sessions").update(payload).eq("organization_id", access.organizationId).eq("id", sameDay.data.id)
    : db().from("work_sessions").insert(payload);
  const { data: session, error } = await write.select("*").single();
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
  await audit(access, session.id as string, "clock_in", shift ? "scheduled" : null, "clocked_in", idempotencyKey, observed.toISOString(), {
    late, unscheduled, exceptionAcknowledged: unscheduled, exceptionReason: unscheduled ? payload.exception_reason : null,
  }, source === "web" || source === "agent" || source === "system" || source === "worktivity" ? source : "desktop");
  return { session, plan: await ensureDailyPlan(access, session) };
}

/** Converge a fresh provider attendance interval into the explicit session
 * ledger. Every restart creates a new row, so earlier closed time remains
 * intact and the one-active-session invariant still protects races. */
export async function syncWorktivitySession(access: WorkOsAccess, projection: AttendanceProjection) {
  if (projection.source !== "worktivity" || projection.stale) return activeSession(access);
  const existing = await activeSession(access);
  if (projection.state === "active" || projection.state === "paused") {
    if (existing) {
      if (existing.source !== "worktivity") return existing;
      const action = projection.state === "paused"
        ? existing.state === "paused" ? null : "pause"
        : existing.state === "paused" ? "resume" : existing.state === "clocked_in" ? "mark_active" : null;
      if (!action) return existing;
      return (await transitionSession(access, { action, observed_at: projection.observedAt },
        `worktivity:${action}:${existing.id}:${projection.observedAt}`, "worktivity", true)).session;
    }
    const context = await unscheduledSessionContext(access, new Date(projection.observedAt));
    const latestClosed = await db().from("work_sessions").select("clocked_out_at")
      .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
      .eq("shift_date", context.shiftDate).eq("state", "clocked_out")
      .order("clocked_out_at", { ascending: false }).limit(1).maybeSingle();
    if (latestClosed.error) throw new Error(`load latest closed work interval: ${latestClosed.error.message}`);
    const candidate = new Date(projection.clockedInAt ?? projection.activityObservedAt ?? projection.observedAt);
    const observed = Number.isFinite(candidate.getTime()) ? candidate : new Date(projection.observedAt);
    const priorEnd = latestClosed.data?.clocked_out_at ? Date.parse(String(latestClosed.data.clocked_out_at)) : Number.NaN;
    if (Number.isFinite(priorEnd) && observed.getTime() <= priorEnd) observed.setTime(priorEnd + 1);
    const providerInterval = projection.clockedInAt ?? projection.activityObservedAt ?? projection.observedAt;
    const result = await clockIn(access, {
      observed_at: observed.toISOString(), source: "worktivity", late_acknowledged: true,
      exception_acknowledged: true, exception_reason: "Fresh Worktivity attendance observed",
    }, `worktivity:clock-in:${access.personId}:${providerInterval}`);
    if (result.session.state === "clocked_in") {
      const action = projection.state === "paused" ? "pause" : "mark_active";
      return (await transitionSession(access, { action, observed_at: projection.observedAt },
        `worktivity:${action}:${result.session.id}:${projection.observedAt}`, "worktivity", true)).session;
    }
    return result.session;
  }
  if (projection.state === "off_shift" && existing?.source === "worktivity" && projection.clockedOutAt) {
    const clockedOutAt = new Date(projection.clockedOutAt);
    const clockedInAt = Date.parse(String(existing.clocked_in_at ?? ""));
    if (Number.isFinite(clockedOutAt.getTime()) && Number.isFinite(clockedInAt) && clockedOutAt.getTime() > clockedInAt) {
      return (await transitionSession(access, { action: "clock_out", observed_at: clockedOutAt.toISOString(), extended_acknowledged: true },
        `worktivity:clock-out:${existing.id}:${clockedOutAt.toISOString()}`, "worktivity", true)).session;
    }
  }
  return existing;
}

/** Insert a finished Worktivity-attributed interval for historical repair while
 * a current-day session may be live. A closed row does not violate the
 * one-active-session invariant. Idempotent through its clock-in/out keys. */
export async function insertHistoricalWorktivitySession(access: WorkOsAccess, input: { date: string; clockedInAt: string; clockedOutAt: string; timezone: string }) {
  const shift = await shiftFor(access, new Date(input.clockedInAt), "upcoming").catch(() => null);
  const now = new Date().toISOString();
  const inserted = await db().from("work_sessions").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    schedule_id: shift?.scheduleId ?? null,
    shift_date: input.date,
    state: "clocked_out",
    timezone: shift?.timezone ?? input.timezone,
    scheduled_starts_at: shift?.startsAt ?? null,
    scheduled_ends_at: shift?.endsAt ?? null,
    clocked_in_at: input.clockedInAt,
    clocked_out_at: input.clockedOutAt,
    source: "worktivity",
    clock_in_idempotency_key: `worktivity:repair:clock-in:${access.personId}:${input.date}`,
    clock_out_idempotency_key: `worktivity:repair:clock-out:${access.personId}:${input.date}`,
    exception_acknowledged_at: now,
    exception_reason: "Backfilled from stored Worktivity activity",
    correction_status: "valid",
    created_by: access.ctx.user.id,
    updated_at: now,
  }).select("id").single();
  if (inserted.error) {
    if (/duplicate|unique/i.test(inserted.error.message)) return;
    throw new Error(`insert historical Worktivity session: ${inserted.error.message}`);
  }
  const sessionId = (inserted.data as { id?: string } | null)?.id;
  if (!sessionId) return;
  const event = await db().from("work_session_events").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    session_id: sessionId,
    event_type: "clock_out",
    from_state: "clocked_in",
    to_state: "clocked_out",
    source: "worktivity",
    observed_at: input.clockedOutAt,
    actor_user_id: access.ctx.user.id,
    idempotency_key: `worktivity:repair:event:${access.personId}:${input.date}`,
    metadata: { backfill: true, clockedInAt: input.clockedInAt, clockedOutAt: input.clockedOutAt },
  });
  if (event.error && !/duplicate/i.test(event.error.message)) throw new Error(`record historical session event: ${event.error.message}`);
}

export async function transitionSession(access: WorkOsAccess, body: Json, idempotencyKey: string, source: "web" | "desktop" | "agent" | "system" | "worktivity" = "desktop", allowProviderBreakTransitions = false) {
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
  const rawAction = value(body.action);
  if (rawAction === "late_reason") {
    const reason = value(body.reason);
    if (!reason) throw new Error("A late-start reason is required.");
    if (reason.length > 1000) throw new Error("Late-start reasons must be 1000 characters or fewer.");
    if (!lateReasonRequired({ ...session, late_reason: null })) {
      throw new Error("A late-start reason must be recorded only for sessions that started 30 or more minutes late.");
    }
    const recordedAt = new Date().toISOString();
    const { data: recorded, error: recordError } = await db().from("work_sessions").update({
      late_reason: reason,
      late_reason_provided_at: recordedAt,
      updated_at: recordedAt,
    }).eq("id", session.id).eq("organization_id", access.organizationId).select("*").single();
    if (recordError) throw new Error(`record late-start reason: ${recordError.message}`);
    await audit(access, session.id as string, "late_reason", session.state as string, session.state as string, idempotencyKey, recordedAt, { reasonLength: reason.length }, source);
    return { session: recorded, plan: await loadPlan(access, session.id as string) };
  }
  const action = rawAction as WorkSessionAction | null;
  if (!action || !["pause", "resume", "mark_active", "mark_eod_due", "clock_out"].includes(action)) throw new Error("A valid session action is required.");
  if (["pause", "resume"].includes(action) && !allowProviderBreakTransitions && await worktivityAuthoritativeBreaks(access.organizationId)) {
    throw new Error("Manual pause and resume are disabled: Worktivity OnBreak is the organization break source.");
  }
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
  await audit(access, session.id as string, action, session.state as string, next, idempotencyKey, observed.toISOString(), { overtime }, source);
  if (next === "clocked_out") await db().from("work_daily_plans").update({ status: "closed", updated_at: observed.toISOString() }).eq("session_id", session.id);
  return { session: data, plan: await loadPlan(access, session.id as string) };
}

export async function resolveMissedClockOut(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const sessionId = value(body.session_id);
  const timestamp = value(body.clocked_out_at);
  const provenance = value(body.provenance);
  if (!sessionId || !timestamp) throw new Error("session_id and clocked_out_at are required");
  if (!provenance || !["employee_entered", "provider_observed"].includes(provenance)) {
    throw new Error("provenance must be employee_entered or provider_observed");
  }
  const corrected = new Date(timestamp);
  if (Number.isNaN(corrected.getTime()) || corrected.getTime() > Date.now()) throw new Error("clocked_out_at must be a valid past timestamp");
  const existingEvent = await db().from("work_session_events").select("session_id")
    .eq("organization_id", access.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingEvent.error) throw new Error(`load idempotent correction: ${existingEvent.error.message}`);
  const current = await db().from("work_sessions").select("*").eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string).eq("id", existingEvent.data?.session_id ?? sessionId).single();
  if (current.error) throw new Error(`load session correction target: ${current.error.message}`);
  if (existingEvent.data || current.data.correction_status === "corrected") {
    return { session: current.data, plan: await loadPlan(access, current.data.id as string) };
  }
  if (current.data.clocked_out_at) throw new WorkOsConflictError("This session already has a clock-out timestamp.");
  if (current.data.correction_status !== "needs_correction") throw new WorkOsConflictError("This session does not require a missed clock-out correction.");
  const clockedInAt = Date.parse(String(current.data.clocked_in_at ?? ""));
  if (!Number.isFinite(clockedInAt) || corrected.getTime() <= clockedInAt) throw new Error("clocked_out_at must be after clocked_in_at");
  const now = new Date().toISOString();
  const { data, error } = await db().from("work_sessions").update({
    state: "clocked_out",
    clocked_out_at: corrected.toISOString(),
    clock_out_idempotency_key: idempotencyKey,
    correction_status: "corrected",
    correction_reason: value(body.reason) ?? current.data.correction_reason,
    correction_timestamp: corrected.toISOString(),
    correction_provenance: provenance,
    corrected_at: now,
    corrected_by: access.ctx.user.id,
    paused_at: null,
    updated_at: now,
  }).eq("organization_id", access.organizationId).eq("id", sessionId)
    .eq("correction_status", "needs_correction").is("clocked_out_at", null).select("*").single();
  if (error) throw new Error(`resolve missed clock-out: ${error.message}`);
  await audit(access, sessionId, "resolve_missed_clock_out", current.data.state as string, "clocked_out", idempotencyKey, corrected.toISOString(), {
    provenance, reason: value(body.reason), correctedAt: now,
  }, provenance === "provider_observed" ? "system" : "desktop");
  await db().from("work_daily_plans").update({ status: "closed", updated_at: now }).eq("organization_id", access.organizationId).eq("session_id", sessionId);
  return { session: data, plan: await loadPlan(access, sessionId) };
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
  objective?: string | null;
  success_criteria?: unknown;
  estimate_minutes?: number | null;
  source_refs?: unknown;
  clarification_state?: string | null;
};

function boundedCriteria(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 5) throw new Error("A commitment can have at most five success criteria.");
  return value.map((item) => {
    const criterion = valueText(item);
    if (!criterion || criterion.length > 300) throw new Error("Success criteria must be 300 characters or fewer.");
    return criterion;
  });
}

function valueText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function commitmentFields(item: DraftItem, taskId: string | null) {
  const objective = item.objective === undefined ? undefined : valueText(item.objective);
  if (objective !== undefined && objective !== null && objective.length > 1_000) throw new Error("Commitment objectives must be 1000 characters or fewer.");
  const criteria = item.success_criteria === undefined ? undefined : boundedCriteria(item.success_criteria);
  const estimate = item.estimate_minutes;
  if (estimate !== undefined && estimate !== null && (!Number.isInteger(estimate) || estimate < 1 || estimate > 720)) {
    throw new Error("Commitment estimates must be between 1 and 720 minutes.");
  }
  const clarificationState = item.clarification_state;
  if (clarificationState !== undefined && clarificationState !== null && !["none", "needs_clarification", "resolved"].includes(clarificationState)) {
    throw new Error("Invalid commitment clarification state.");
  }
  let sourceRefs: Json[] | undefined;
  if (item.source_refs !== undefined) {
    if (!Array.isArray(item.source_refs) || item.source_refs.length > 10) throw new Error("A commitment can have at most ten source references.");
    sourceRefs = item.source_refs.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("Commitment source references are invalid.");
      const ref = entry as Json;
      const provider = valueText(ref.provider);
      const type = valueText(ref.type);
      const id = valueText(ref.id);
      const label = valueText(ref.label);
      const validTaskRef = taskId && ["work_os", "nifty"].includes(provider ?? "") && type === "task" && id === taskId;
      const validIntentRef = !taskId && provider === "employee" && type === "intent" && id === "raw_intent";
      if (!validTaskRef && !validIntentRef) throw new Error("Commitment source references must be server-known task or employee intent references.");
      return { provider, type, id, ...(label ? { label: label.slice(0, 240) } : {}) };
    });
  }
  return {
    ...(objective !== undefined ? { objective } : {}),
    ...(criteria !== undefined ? { success_criteria: criteria } : {}),
    ...(estimate !== undefined ? { estimate_minutes: estimate } : {}),
    ...(sourceRefs !== undefined ? { source_refs: sourceRefs } : {}),
    ...(clarificationState !== undefined ? { clarification_state: clarificationState } : {}),
  };
}

function interpretationMetadata(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("interpretation_metadata must be an object.");
  const raw = value as Json;
  const sourceContext = Array.isArray(raw.sourceContext)
    ? raw.sourceContext.filter((item): item is string => typeof item === "string" && ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates", "github"].includes(item)).slice(0, 6)
    : [];
  const clarificationCount = Number(raw.clarificationCount);
  if (!Number.isInteger(clarificationCount) || clarificationCount < 0 || clarificationCount > 2) throw new Error("interpretation_metadata clarificationCount must be between 0 and 2.");
  const result: Json = { clarificationCount, sourceContext };
  for (const key of ["model", "promptVersion", "interpretedAt"] as const) {
    const entry = valueText(raw[key]);
    if (entry) result[key] = entry.slice(0, 240);
  }
  const clarifications = Array.isArray(raw.clarifications) ? raw.clarifications.slice(0, 2).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const clarification = entry as Json;
    const id = valueText(clarification.id);
    const question = valueText(clarification.question);
    const reason = valueText(clarification.reason);
    const commitmentId = valueText(clarification.commitmentId);
    if (!id || id.length > 120 || !question || question.length > 300 || !reason || reason.length > 120) return [];
    return [{ id, question, reason, ...(commitmentId && commitmentId.length <= 120 ? { commitmentId } : {}) }];
  }) : [];
  result.clarifications = clarifications;
  return result;
}

function clarificationAnswers(value: unknown, metadata: Json) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("clarification_answers must be an object.");
  const allowedIds = new Set(Array.isArray(metadata.clarifications)
    ? metadata.clarifications.flatMap((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && valueText((entry as Json).id) ? [valueText((entry as Json).id)!] : [])
    : []);
  const entries = Object.entries(value as Json);
  if (entries.length > 2) throw new Error("A plan can include at most two clarification answers.");
  const answers: Json = {};
  for (const [id, rawAnswer] of entries) {
    const answer = valueText(rawAnswer);
    if (!allowedIds.has(id) || !answer || answer.length > 1_000) throw new Error("Clarification answers must address the current planning questions.");
    answers[id] = answer;
  }
  return answers;
}

export async function saveDailyPlanDraft(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const { shiftDate: currentDate } = await localWorkDate(access);
  const shiftDate = planDate(body.shift_date) ?? currentDate;
  if (shiftDate !== currentDate) throw new Error("Only today's plan can be edited.");
  const session = await activeSession(access);
  const plan = session ? await ensureDailyPlan(access, session) : await ensureDailyPlanForDate(access, shiftDate);
  if (!plan || plan.status === "closed") throw new Error("This plan is read-only.");
  const confirm = body.confirm === true;
  if (confirm && !session) throw new Error("Clock in before confirming a plan.");
  const expectedRevision = Number(body.revision ?? plan.revision ?? 1);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("A valid plan revision is required.");
  const submitted = Array.isArray(body.items) ? body.items as DraftItem[] : null;
  if (submitted && submitted.length > 100) throw new Error("A daily plan can contain at most 100 items.");
  const hasIntent = Object.prototype.hasOwnProperty.call(body, "freeform_intent");
  const freeformIntent = hasIntent ? value(body.freeform_intent) : value(plan.freeform_intent);
  if (freeformIntent && freeformIntent.length > 4000) throw new Error("Plan intent must be 4000 characters or fewer.");
  const buildId = confirm ? value(body.build_id) : null;
  if (confirm && !buildId) throw new Error("An AI build id is required for plan confirmation.");
  if (buildId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(buildId)) throw new Error("build_id must be a valid AI build id.");
  const intentFingerprint = confirm ? planIntentFingerprint(freeformIntent) : null;
  const requestedProvenance = body.goal_provenance === undefined ? value(plan.goal_provenance) : value(body.goal_provenance);
  if (requestedProvenance && !["employee", "accepted_suggestion", "ai_draft"].includes(requestedProvenance)) throw new Error("goal_provenance must identify an employee goal, an accepted suggestion, or an AI draft");
  const suggestionTaskIds = Array.isArray(body.suggestion_task_ids)
    ? [...new Set(body.suggestion_task_ids.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))]
    : Array.isArray(plan.suggestion_task_ids) ? plan.suggestion_task_ids.filter((item: unknown): item is string => typeof item === "string") : [];
  if (suggestionTaskIds.length > 20) throw new Error("A goal suggestion can reference at most 20 tasks.");
  const focusSummary = body.focus_summary === undefined ? undefined : value(body.focus_summary);
  if (focusSummary && focusSummary.length > 500) throw new Error("Plan focus_summary must be 500 characters or fewer.");
  const metadata = interpretationMetadata(body.interpretation_metadata)
    ?? (plan.interpretation_metadata && typeof plan.interpretation_metadata === "object" && !Array.isArray(plan.interpretation_metadata) ? plan.interpretation_metadata as Json : {});
  const answers = clarificationAnswers(body.clarification_answers, metadata)
    ?? (plan.clarification_answers && typeof plan.clarification_answers === "object" && !Array.isArray(plan.clarification_answers) ? plan.clarification_answers as Json : {});
  const now = new Date().toISOString();
  const preparedItems: Json[] = [];
  let removableOutcomeIds: string[] = [];
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
        const fields = commitmentFields(item, existing.task_id ? String(existing.task_id) : null);
        preparedItems.push({
          id: String(existing.id), rank: index, disposition, title_snapshot: title,
          completion_state: outcome ? completionState : String(existing.completion_state ?? "open"),
          objective: "objective" in fields ? fields.objective : existing.objective ?? null,
          success_criteria: "success_criteria" in fields ? fields.success_criteria : existing.success_criteria ?? [],
          estimate_minutes: "estimate_minutes" in fields ? fields.estimate_minutes : existing.estimate_minutes ?? null,
          source_refs: "source_refs" in fields ? fields.source_refs : existing.source_refs ?? [],
          clarification_state: "clarification_state" in fields ? fields.clarification_state : existing.clarification_state ?? null,
        });
        if (outcome) retainedOutcomes.add(String(existing.id));
        continue;
      }
      if (item.item_kind !== "outcome" && item.task_id) throw new Error("New Nifty plan items must come from the server-provided task list.");
      const title = value(item.title_snapshot);
      if (!title || title.length > 240) throw new Error("Plan outcomes require a title of 240 characters or fewer.");
      preparedItems.push({
        rank: index, disposition, title_snapshot: title, item_kind: "outcome", completion_state: completionState,
        objective: null, success_criteria: [], estimate_minutes: null, source_refs: [], clarification_state: null,
        ...commitmentFields(item, null),
      });
    }
    removableOutcomeIds = existingItems.filter((item) => (item.item_kind === "outcome" || !item.task_id) && !retainedOutcomes.has(String(item.id))).map((item) => String(item.id));
  }
  const confirmedAt = plan.confirmed_at ? new Date(plan.confirmed_at as string) : new Date(now);
  const firstFollowUpAt = confirm && session && !session.first_follow_up_at ? nextFirstFollowUpAt({
    planConfirmedAt: confirmedAt.toISOString(),
    session: {
      state: session.state as WorkSessionState,
      scheduledStartsAt: session.scheduled_starts_at as string | null,
      scheduledEndsAt: session.scheduled_ends_at as string | null,
      clockedInAt: session.clocked_in_at as string | null,
    },
    at: now,
  }) : null;
  const { data: mutation, error: mutationError } = await db().rpc("work_save_daily_plan_draft", {
    p_organization_id: access.organizationId,
    p_person_id: access.personId,
    p_plan_id: plan.id,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_freeform_intent: freeformIntent,
    p_goal_provenance: freeformIntent ? requestedProvenance ?? "employee" : null,
    p_suggestion_task_ids: freeformIntent && requestedProvenance === "accepted_suggestion" ? suggestionTaskIds : [],
    p_focus_summary: focusSummary === undefined ? plan.focus_summary ?? null : focusSummary,
    p_interpretation_metadata: metadata,
    p_clarification_answers: answers,
    p_items: submitted ? preparedItems : null,
    p_remove_outcome_ids: removableOutcomeIds,
    p_confirm: confirm,
    p_session_id: session?.id ?? null,
    p_first_follow_up_at: firstFollowUpAt,
    p_build_id: buildId,
    p_intent_fingerprint: intentFingerprint,
  });
  if (mutationError) {
    if (/changed on another device/i.test(mutationError.message)) throw new WorkOsConflictError("This plan changed on another device. Refresh before saving again.");
    if (/AI build confirmation/i.test(mutationError.message)) throw new WorkOsConflictError("The AI build is invalid, expired, already used, or does not match this plan intent. Build the plan again.");
    throw new Error(`save daily plan draft atomically: ${mutationError.message}`);
  }
  const result = Array.isArray(mutation) ? mutation[0] : mutation;
  if (!result) throw new Error("save daily plan draft atomically: no mutation result");
  if (result.replayed !== true) {
    await auditPlan(access, confirm ? "plan.confirmed" : "plan.draft_saved", String(plan.id), {
      shiftDate, revision: expectedRevision + 1, idempotencyKey,
      confirmed: confirm,
      goalProvenance: freeformIntent ? requestedProvenance ?? "employee" : null,
      suggestionTaskIds: freeformIntent && requestedProvenance === "accepted_suggestion" ? suggestionTaskIds : [],
    });
    const committedItems = submitted ? preparedItems : Array.isArray(plan.items) ? plan.items as Json[] : [];
    const itemTitles = committedItems
      .map((item) => value(item.title_snapshot))
      .filter((title): title is string => Boolean(title))
      .slice(0, 12);
    const intentText = freeformIntent;
    const parts = [
      intentText ? `Focus: ${intentText}` : null,
      itemTitles.length ? `Plan items: ${itemTitles.join("; ")}` : null,
    ].filter(Boolean);
    if (parts.length) {
      await recordWorkMemory(
        { organizationId: access.organizationId, personId: access.personId as string },
        {
          kind: "plan",
          sourceTable: "work_daily_plans",
          sourceId: `${String(plan.id)}:${expectedRevision + 1}`,
          content: parts.join("\n"),
          summary: intentText ? intentText.slice(0, 160) : `Plan saved with ${itemTitles.length} item(s)`,
          metadata: {
            confirmed: confirm,
            revision: expectedRevision + 1,
            goalProvenance: freeformIntent ? requestedProvenance ?? "employee" : null,
          },
          localDate: shiftDate,
        },
      );
    }
  }
  return loadPlanByDate(access, shiftDate);
}

export async function updateDailyTaskSurface(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const taskId = value(body.surface_task_id) ?? value(body.defer_task_id);
  if (!taskId) throw new Error("surface_task_id or defer_task_id is required");
  const disposition = body.defer_task_id ? "deferred" : "selected";
  const { shiftDate } = await localWorkDate(access);
  const plan = await ensureDailyPlanForDate(access, shiftDate, await activeSession(access));
  if (!plan || plan.status === "closed") throw new Error("Today's task workspace is read-only.");
  const ownerId = workOsOrganizationOwnerId(access);
  const attributableTasks = await listPersonTasks(ownerId, access.personId as string, { completed: "false", includeLedgerHistory: true, limit: 1000 });
  const task = attributableTasks.find((item) => String(item.id) === taskId || String(item.provider_task_id) === taskId);
  if (!task) throw new Error("The Nifty task is not attributable to this employee.");
  const existing = await db().from("work_daily_plan_items").select("id,disposition")
    .eq("organization_id", access.organizationId).eq("plan_id", plan.id).eq("task_id", task.id).maybeSingle();
  if (existing.error) throw new Error(`load surfaced task: ${existing.error.message}`);
  const now = new Date().toISOString();
  if (existing.data) {
    const updated = await db().from("work_daily_plan_items").update({ disposition, updated_at: now })
      .eq("organization_id", access.organizationId).eq("id", existing.data.id).select("id").single();
    if (updated.error) throw new Error(`update surfaced task: ${updated.error.message}`);
  } else {
    const rank = Array.isArray(plan.items) ? plan.items.length : 0;
    const inserted = await db().from("work_daily_plan_items").insert({
      organization_id: access.organizationId, plan_id: plan.id, person_id: access.personId, task_id: task.id,
      source: "carry_over", disposition, rank, title_snapshot: task.title,
      blocker: task.blocked_reason, item_kind: "nifty_task",
      completion_state: task.completed ? "completed" : "open", completed_at: task.completed_at,
    });
    if (inserted.error) throw new Error(`surface task in today's workspace: ${inserted.error.message}`);
  }
  await auditPlan(access, disposition === "selected" ? "workspace.task_surfaced" : "workspace.task_deferred", String(plan.id), { taskId, shiftDate, idempotencyKey });
  await recordTaskDayEvent(access, task, disposition === "selected" ? "surfaced" : "deferred", {
    idempotencyKey: `workspace:${disposition}:${idempotencyKey}`,
    localDate: shiftDate,
    provenance: "employee_explicit",
    metadata: { planId: plan.id },
  });
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
  const ownerId = workOsOrganizationOwnerId(access);
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
