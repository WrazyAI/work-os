import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addTaskProgress,
  completeTask,
  createEvidence,
  createEodReport,
  createTask,
  getTaskByLocalOrProviderId,
  listEvidence,
  listTasks,
  reviewReport,
  syncNifty,
  updateTask,
} from "@/lib/work-os";
import { canAccessWorkOsPerson, type WorkOsAccess } from "@/lib/work-os-api";
import {
  validateWorkOsBreakWindows,
  validateWorkOsDate,
  validateWorkOsDateRange,
  validateWorkOsTime,
  validateWorkOsTimezone,
} from "@/lib/work-os-schedule-validation";
import {
  decideWorkOsPrompt,
  isTaskOutcomeEvidence,
  localDateForTimezone,
  resolveShiftWindow,
  type WorkOsCheckInState,
  type WorkOsScheduleException,
  type WorkOsScheduleRule,
} from "@/modules/work-os/companion";
import { getWorkday } from "@/lib/work-os-workday";
import { reconcileWorktivityAttendance } from "@/lib/work-os-attendance";

type Json = Record<string, unknown>;
type ProposalOperation =
  | "create_task"
  | "update_task"
  | "log_progress"
  | "add_blocker"
  | "resolve_blocker"
  | "link_evidence"
  | "complete_task";

const OPERATIONS = new Set<ProposalOperation>([
  "create_task",
  "update_task",
  "log_progress",
  "add_blocker",
  "resolve_blocker",
  "link_evidence",
  "complete_task",
]);
const CHECK_IN_MODEL = process.env.WORK_OS_AI_MODEL || "gpt-5.4-mini";
const CHECK_IN_PROMPT_VERSION = "work-os-check-in-v1";

function db() {
  return createAdminClient();
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOnly(value: unknown) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

async function organizationOwnerId(organizationId: string) {
  const { data, error } = await db()
    .from("work_organizations")
    .select("legacy_owner_id, created_by")
    .eq("id", organizationId)
    .single();
  if (error) throw new Error(`load Work OS organization: ${error.message}`);
  const ownerId = data.legacy_owner_id || data.created_by;
  if (!ownerId) throw new Error("Work OS organization has no Nifty provider owner");
  return ownerId as string;
}

async function audit(access: WorkOsAccess, action: string, targetType: string, targetId?: string | null, metadata: Json = {}) {
  const { error } = await db().from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata,
  });
  if (error) throw new Error(`write Work OS audit log: ${error.message}`);
}

export async function listWorkOsSchedules(access: WorkOsAccess, personId?: string | string[] | null) {
  let query = db()
    .from("work_schedules")
    .select("*, person:work_people(id, display_name)")
    .eq("organization_id", access.organizationId)
    .order("effective_from", { ascending: false });
  if (Array.isArray(personId)) query = query.in("person_id", personId);
  else if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS schedules: ${error.message}`);
  return data ?? [];
}

export async function listWorkOsScheduleExceptions(access: WorkOsAccess, personId?: string | string[] | null) {
  let query = db()
    .from("work_schedule_exceptions")
    .select("*, person:work_people(id, display_name)")
    .eq("organization_id", access.organizationId)
    .gte("exception_date", new Date().toISOString().slice(0, 10))
    .order("exception_date", { ascending: true })
    .limit(200);
  if (Array.isArray(personId)) query = query.in("person_id", personId);
  else if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS schedule exceptions: ${error.message}`);
  return data ?? [];
}

export async function saveWorkOsSchedule(access: WorkOsAccess, body: Json) {
  const personId = text(body.person_id);
  if (!personId) throw new Error("person_id is required");
  const days = Array.isArray(body.days_of_week)
    ? [...new Set(body.days_of_week.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5];
  if (!days.length) throw new Error("days_of_week must include at least one day");
  const shiftStart = validateWorkOsTime(body.shift_start, "shift_start");
  const shiftEnd = validateWorkOsTime(body.shift_end, "shift_end");
  if (shiftStart === shiftEnd) throw new Error("shift_start and shift_end must be different");
  const effectiveFrom = body.effective_from ? validateWorkOsDate(body.effective_from, "effective_from") : new Date().toISOString().slice(0, 10);
  const effectiveTo = body.effective_to ? validateWorkOsDate(body.effective_to, "effective_to") : null;
  validateWorkOsDateRange(effectiveFrom, effectiveTo);
  const payload = {
    organization_id: access.organizationId,
    person_id: personId,
    timezone: validateWorkOsTimezone(body.timezone),
    days_of_week: days,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    break_windows: validateWorkOsBreakWindows(body.break_windows, shiftStart, shiftEnd),
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    active: body.active !== false,
    created_by: access.ctx.user.id,
    updated_at: new Date().toISOString(),
  };
  const scheduleId = text(body.id);
  const query = scheduleId
    ? db().from("work_schedules").update(payload).eq("organization_id", access.organizationId).eq("id", scheduleId)
    : db().from("work_schedules").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw new Error(`save Work OS schedule: ${error.message}`);
  await audit(access, scheduleId ? "schedule.updated" : "schedule.created", "schedule", data.id as string, { personId });
  return data;
}

export async function saveWorkOsScheduleException(access: WorkOsAccess, body: Json) {
  const personId = text(body.person_id);
  const exceptionDate = body.exception_date ? validateWorkOsDate(body.exception_date, "exception_date") : null;
  const kind = text(body.kind);
  if (!personId || !exceptionDate) throw new Error("person_id and exception_date are required");
  if (!kind || !["leave", "changed_shift", "working_day"].includes(kind)) throw new Error("invalid schedule exception kind");
  const shiftStart = body.shift_start ? validateWorkOsTime(body.shift_start, "shift_start") : null;
  const shiftEnd = body.shift_end ? validateWorkOsTime(body.shift_end, "shift_end") : null;
  if (!!shiftStart !== !!shiftEnd) throw new Error("shift_start and shift_end must be provided together");
  if (shiftStart === shiftEnd && shiftStart) throw new Error("shift_start and shift_end must be different");
  const payload = {
    organization_id: access.organizationId,
    person_id: personId,
    exception_date: exceptionDate,
    kind,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    break_windows: validateWorkOsBreakWindows(body.break_windows, shiftStart ?? undefined, shiftEnd ?? undefined),
    note: text(body.note),
    created_by: access.ctx.user.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("work_schedule_exceptions")
    .upsert(payload, { onConflict: "organization_id,person_id,exception_date" })
    .select("*")
    .single();
  if (error) throw new Error(`save Work OS schedule exception: ${error.message}`);
  await audit(access, "schedule.exception_saved", "schedule_exception", data.id as string, { personId, exceptionDate, kind });
  return data;
}

async function loadShiftData(access: WorkOsAccess, personId: string, at: Date) {
  const { data: schedules, error: scheduleError } = await db()
    .from("work_schedules")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("active", true)
    .order("effective_from", { ascending: false });
  if (scheduleError) throw new Error(`load shift schedules: ${scheduleError.message}`);
  const rules = (schedules ?? []) as WorkOsScheduleRule[];
  const timezone = rules[0]?.timezone ?? "UTC";
  const localDate = localDateForTimezone(at, timezone);
  const from = new Date(`${localDate}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${localDate}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const { data: exceptions, error: exceptionError } = await db()
    .from("work_schedule_exceptions")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .gte("exception_date", from.toISOString().slice(0, 10))
    .lte("exception_date", to.toISOString().slice(0, 10));
  if (exceptionError) throw new Error(`load shift exceptions: ${exceptionError.message}`);
  return { rules, exceptions: (exceptions ?? []) as WorkOsScheduleException[], timezone };
}

export async function getWorkOsDay(access: WorkOsAccess, personId: string, at = new Date()) {
  const attendance = await reconcileWorktivityAttendance(access, at);
  const { rules, exceptions, timezone } = await loadShiftData(access, personId, at);
  const shift = resolveShiftWindow(rules, exceptions, at);
  const shiftDate = shift?.shiftDate ?? localDateForTimezone(at, timezone);
  const { data: checkIns, error: checkInError } = await db()
    .from("work_check_ins")
    .select("substantive, confirmed_existing_tasks, occurred_at, snoozed_until")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("shift_date", shiftDate)
    .order("occurred_at", { ascending: true });
  if (checkInError) throw new Error(`load shift check-ins: ${checkInError.message}`);
  const prompt = decideWorkOsPrompt(shift, (checkIns ?? []) as WorkOsCheckInState[], at);
  const ownerId = await organizationOwnerId(access.organizationId);
  const [latestTaskResult, latestProjectResult, organizationSyncResult] = await Promise.all([
    db().from("work_tasks").select("synced_at").eq("organization_id", access.organizationId).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_projects").select("synced_at").eq("organization_id", access.organizationId).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_organizations").select("nifty_synced_at,nifty_sync_error").eq("id", access.organizationId).single(),
  ]);
  if (latestTaskResult.error) throw new Error(`load Nifty task freshness: ${latestTaskResult.error.message}`);
  if (latestProjectResult.error) throw new Error(`load Nifty project freshness: ${latestProjectResult.error.message}`);
  if (organizationSyncResult.error) throw new Error(`load Nifty organization freshness: ${organizationSyncResult.error.message}`);
  const latestTask = latestTaskResult.data;
  const latestProject = latestProjectResult.data;
  const lastSyncedAt = [latestTask?.synced_at, latestProject?.synced_at, organizationSyncResult.data.nifty_synced_at].filter(Boolean).sort().at(-1) as string | undefined;
  let niftySync: Json = { fresh: !!lastSyncedAt && Date.now() - new Date(lastSyncedAt).getTime() < 5 * 60_000, syncedAt: lastSyncedAt ?? null };
  if (!niftySync.fresh) {
    try {
      const result = await syncNifty(ownerId);
      niftySync = { fresh: true, syncedAt: result.syncedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nifty sync failed";
      await db().from("work_organizations").update({ nifty_sync_error: message, updated_at: new Date().toISOString() }).eq("id", access.organizationId);
      niftySync = { fresh: false, syncedAt: lastSyncedAt ?? null, error: message };
    }
  }
  const [tasks, evidence] = await Promise.all([
    listTasks(ownerId, { personId, todayOnly: true, todayDate: shiftDate }),
    listEvidence(ownerId, { personId, date: shiftDate }),
  ]);
  const { data: proposals, error: proposalError } = await db()
    .from("work_task_proposals")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .in("status", ["pending", "needs_review", "failed", "stale"])
    .order("created_at", { ascending: false });
  if (proposalError) throw new Error(`load task proposals: ${proposalError.message}`);
  const { data: report, error: reportError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("report_date", shiftDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reportError) throw new Error(`load current EOD report: ${reportError.message}`);
  const workday = await getWorkday(access, at);
  return { at: at.toISOString(), shiftDate, shift, prompt: workday.session ? workday.prompt : prompt, session: workday.session, plan: workday.plan, attendance: attendance.attendance, niftySync, tasks, evidence, proposals: proposals ?? [], report };
}

interface ParsedProposal {
  operation: ProposalOperation;
  task_id?: string | null;
  change: Json;
}

async function parseCheckIn(input: string, tasks: Json[]): Promise<{ model: string; proposals: ParsedProposal[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to turn a check-in into task proposals");
  const taskContext = tasks.map((task) => ({
    id: task.id,
    providerTaskId: task.provider_task_id,
    title: task.title,
    description: task.description,
    dueDate: task.due_date,
    status: task.status,
    expectedOutcome: task.expected_outcome,
    definitionOfDone: task.definition_of_done,
  }));
  const tool = {
    type: "function",
    function: {
      name: "proposeWorkChanges",
      description: "Convert an employee check-in into reviewable Work OS task operations without inventing work or completion.",
      parameters: {
        type: "object",
        properties: {
          proposals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                operation: { type: "string", enum: [...OPERATIONS] },
                task_id: { type: ["string", "null"], description: "Existing local Work OS task ID, or null only for create_task." },
                change: { type: "object", additionalProperties: true },
              },
              required: ["operation", "task_id", "change"],
              additionalProperties: false,
            },
          },
        },
        required: ["proposals"],
        additionalProperties: false,
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHECK_IN_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "You produce proposals for human review. Nifty is authoritative for tasks.",
            "Use an existing task when the text refers to one. Do not claim work, status, output, blockers, or completion unless the employee explicitly states it.",
            "Use complete_task only for explicit completion language. Activity alone never proves completion.",
            "For create_task include name, expected_outcome, definition_of_done, and any stated due date, priority, effort, dependency, or blocker. Do not fabricate missing values.",
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify({ employeeInput: input, currentTasks: taskContext }) },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "proposeWorkChanges" } },
    }),
  });
  if (!response.ok) throw new Error(`Work OS proposal AI failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const json = await response.json() as Json;
  const choices = json.choices as Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> | undefined;
  const rawArgs = choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}";
  let args: Json;
  try {
    args = JSON.parse(rawArgs) as Json;
  } catch {
    throw new Error("Work OS proposal AI returned invalid structured output");
  }
  const tasksById = new Map(tasks.flatMap((task) => [
    [String(task.id), task],
    [String(task.provider_task_id), task],
  ]));
  const explicitCompletion = /\b(done|completed|finished|shipped|resolved|fixed|delivered)\b/i.test(input);
  const proposals: ParsedProposal[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(args.proposals) ? args.proposals as Json[] : []) {
    let operation = text(candidate.operation) as ProposalOperation | null;
    if (!operation || !OPERATIONS.has(operation)) continue;
    const taskId = text(candidate.task_id);
    const matchedTask = taskId ? tasksById.get(taskId) : null;
    if (operation !== "create_task" && !matchedTask) continue;
    if (operation === "complete_task" && !explicitCompletion) operation = "log_progress";
    const change = candidate.change && typeof candidate.change === "object" ? candidate.change as Json : {};
    if (operation === "create_task" && !text(change.name)) continue;
    const localTaskId = matchedTask ? String(matchedTask.id) : null;
    const signature = JSON.stringify([operation, localTaskId, change]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    proposals.push({ operation, task_id: localTaskId, change });
  }
  return { model: CHECK_IN_MODEL, proposals };
}

export async function createWorkOsCheckIn(access: WorkOsAccess, body: Json) {
  const personId = access.personId as string;
  const input = text(body.input_text) ?? "";
  const confirmedExisting = body.confirmed_existing_tasks === true;
  const now = new Date();
  const requestedSnooze = text(body.snoozed_until);
  let snoozedUntil: string | null = null;
  if (requestedSnooze) {
    const parsed = new Date(requestedSnooze);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) throw new Error("snoozed_until must be a future timestamp");
    if (parsed.getTime() > now.getTime() + 60 * 60_000) throw new Error("check-ins can be snoozed for at most 60 minutes");
    snoozedUntil = parsed.toISOString();
  }
  if (!input && !confirmedExisting && !snoozedUntil) throw new Error("input_text, confirmed_existing_tasks, or snoozed_until is required");
  const { rules, exceptions, timezone } = await loadShiftData(access, personId, now);
  const shift = resolveShiftWindow(rules, exceptions, now);
  const shiftDate = shift?.shiftDate ?? localDateForTimezone(now, timezone);
  const kind = text(body.kind) ?? (shift && now.getTime() >= new Date(shift.endsAt).getTime() - 15 * 60_000 ? "eod" : "plan");
  if (!["plan", "catch_up", "optional", "eod"].includes(kind)) throw new Error("invalid check-in kind");
  const source = ["web", "desktop", "agent"].includes(text(body.source) ?? "") ? text(body.source) : "web";
  const ownerId = await organizationOwnerId(access.organizationId);
  const clientRequestId = text(body.client_request_id);
  const updateKind = text(body.update_kind);
  const allowedUpdateKinds = ["starting", "continuing", "material_progress", "completion_claim", "blocked", "priority_change", "unplanned_work"];
  if (updateKind && !allowedUpdateKinds.includes(updateKind)) throw new Error("invalid progress update kind");
  const { data: activeSession, error: activeSessionError } = await db().from("work_sessions").select("id")
    .eq("organization_id", access.organizationId).eq("person_id", personId)
    .in("state", ["clocked_in", "active", "paused", "eod_due"]).maybeSingle();
  if (activeSessionError) throw new Error(`load active work session: ${activeSessionError.message}`);
  if (clientRequestId) {
    const { data: existing, error: existingError } = await db().from("work_check_ins").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("client_request_id", clientRequestId).maybeSingle();
    if (existingError) throw new Error(`load idempotent Work OS check-in: ${existingError.message}`);
    if (existing) {
      const { data: existingProposals } = await db().from("work_task_proposals").select("*").eq("check_in_id", existing.id);
      return { checkIn: existing, proposals: existingProposals ?? [] };
    }
  }
  const tasks = await listTasks(ownerId, { personId, todayOnly: true }) as Json[];
  if (confirmedExisting && !tasks.length) throw new Error("there are no existing Nifty tasks to confirm as the current plan");
  const parsed = input ? await parseCheckIn(input, tasks) : { model: CHECK_IN_MODEL, proposals: [] as ParsedProposal[] };
  const { data: checkIn, error: checkInError } = await db().from("work_check_ins").insert({
    organization_id: access.organizationId,
    person_id: personId,
    shift_date: shiftDate,
    kind,
    source,
    input_text: input,
    substantive: confirmedExisting,
    confirmed_existing_tasks: confirmedExisting,
    snoozed_until: snoozedUntil,
    client_request_id: clientRequestId,
    session_id: activeSession?.id ?? null,
    update_kind: updateKind,
    structured_claims: body.structured_claims && typeof body.structured_claims === "object" ? body.structured_claims : {},
    inference_metadata: {},
    created_by: access.ctx.user.id,
  }).select("*").single();
  if (checkInError) throw new Error(`create Work OS check-in: ${checkInError.message}`);

  const rows = parsed.proposals.map((proposal, index) => ({
    organization_id: access.organizationId,
    person_id: personId,
    check_in_id: checkIn.id,
    task_id: proposal.task_id && tasks.some((task) => task.id === proposal.task_id) ? proposal.task_id : null,
    operation: proposal.operation,
    input_text: input,
    before_state: proposal.task_id ? tasks.find((task) => task.id === proposal.task_id || task.provider_task_id === proposal.task_id) ?? {} : {},
    proposed_change: proposal.change,
    model: parsed.model,
    prompt_version: CHECK_IN_PROMPT_VERSION,
    idempotency_key: createHash("sha256").update(`${checkIn.id}:${index}:${JSON.stringify(proposal)}`).digest("hex"),
    created_by: access.ctx.user.id,
  }));
  let proposals: Json[] = [];
  if (rows.length) {
    const { data, error } = await db().from("work_task_proposals").insert(rows).select("*");
    if (error) throw new Error(`create Work OS proposals: ${error.message}`);
    proposals = data ?? [];
  }
  await audit(access, "check_in.created", "check_in", checkIn.id as string, { kind, proposalCount: proposals.length });
  if (activeSession?.id && (input || confirmedExisting)) {
    await db().from("work_sessions").update({ state: "active", last_substantive_update_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", activeSession.id);
  }
  return { checkIn, proposals };
}

export async function listWorkOsProposals(access: WorkOsAccess, personId: string, status?: string | null) {
  let query = db()
    .from("work_task_proposals")
    .select("*, task:work_tasks(id, title, provider_task_id)")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS proposals: ${error.message}`);
  return data ?? [];
}

async function completionEvidence(taskId: string, organizationId: string, ownerId: string) {
  const [legacyEvidence, eventResult] = await Promise.all([
    listEvidence(ownerId, { taskId }) as Promise<Json[]>,
    db().from("work_evidence_events").select("id, evidence_class, title, artifact_url")
      .eq("organization_id", organizationId).eq("task_id", taskId)
      .eq("evidence_class", "output_evidence").limit(1),
  ]);
  if (eventResult.error) throw new Error(`check completion evidence: ${eventResult.error.message}`);
  const legacyOutput = legacyEvidence.some(isTaskOutcomeEvidence);
  return legacyOutput || !!eventResult.data?.length;
}

export async function completeWorkOsTask(access: WorkOsAccess, taskId: string, completed = true) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (completed && !(await completionEvidence(task.id as string, access.organizationId, ownerId))) {
    throw new Error("sufficient outcome or artifact evidence is required before completing this task");
  }
  return completeTask(ownerId, taskId, completed);
}

async function applyProposal(access: WorkOsAccess, proposal: Json) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const operation = proposal.operation as ProposalOperation;
  const change = proposal.proposed_change as Json;
  const taskId = text(proposal.task_id) ?? text((proposal.before_state as Json | undefined)?.id);
  if (operation === "create_task") {
    if (!text(change.task_group_id)) throw new Error("task_group_id is required before this Nifty task can be created");
    const marker = `Work OS proposal: ${proposal.id}`;
    await syncNifty(ownerId);
    const { data: existing, error: existingError } = await db().from("work_tasks").select("*")
      .eq("organization_id", access.organizationId).ilike("description", `%${marker}%`).maybeSingle();
    if (existingError) throw new Error(`reconcile Nifty task proposal: ${existingError.message}`);
    if (existing) return existing;
    return createTask(ownerId, {
      ...change,
      description: [text(change.description), marker].filter(Boolean).join("\n\n"),
    });
  }
  if (!taskId) throw new Error("proposal task is required");
  if (operation === "update_task") {
    const patch: Json = { ...change };
    if (text(change.title) && !text(change.name)) patch.name = change.title;
    return updateTask(ownerId, taskId, patch);
  }
  if (operation === "log_progress") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data: existing, error: existingError } = await db().from("work_evidence").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .contains("raw", { note: { proposal_id: proposal.id } }).maybeSingle();
    if (existingError) throw new Error(`reconcile proposal progress: ${existingError.message}`);
    if (existing) return existing;
    return addTaskProgress(ownerId, taskId, {
      person_id: proposal.person_id,
      title: text(change.title) ?? undefined,
      summary: text(change.summary) ?? text(change.progress) ?? proposal.input_text,
      url: text(change.url),
      source: "manual",
      proposal_id: proposal.id,
    });
  }
  if (operation === "link_evidence") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data: existing, error: existingError } = await db().from("work_evidence").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .contains("raw", { proposal_id: proposal.id }).maybeSingle();
    if (existingError) throw new Error(`reconcile linked evidence: ${existingError.message}`);
    if (existing) return existing;
    return createEvidence(ownerId, {
      person_id: proposal.person_id,
      task_id: task.id,
      source: "manual",
      title: text(change.title) ?? "Employee-linked evidence",
      summary: text(change.summary) ?? proposal.input_text,
      url: text(change.url),
      raw: { proposal_id: proposal.id },
    }, access.organizationId);
  }
  if (operation === "add_blocker") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const description = text(change.description) ?? text(change.blocked_reason) ?? text(proposal.input_text);
    if (!description) throw new Error("blocker description is required");
    const { data: existing, error: existingError } = await db().from("work_task_blockers").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .eq("person_id", proposal.person_id as string).eq("description", description).eq("status", "active").maybeSingle();
    if (existingError) throw new Error(`reconcile task blocker: ${existingError.message}`);
    if (existing) return existing;
    const { data, error } = await db().from("work_task_blockers").insert({
      organization_id: access.organizationId,
      task_id: task.id,
      person_id: proposal.person_id,
      description,
      created_by: access.ctx.user.id,
    }).select("*").single();
    if (error) throw new Error(`create task blocker: ${error.message}`);
    await updateTask(ownerId, taskId, { blocked: true, blocked_reason: description });
    return data;
  }
  if (operation === "resolve_blocker") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data, error } = await db().from("work_task_blockers").update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string).eq("status", "active").select("*");
    if (error) throw new Error(`resolve task blocker: ${error.message}`);
    await updateTask(ownerId, taskId, { blocked: false, blocked_reason: null });
    return data;
  }
  if (operation === "complete_task") {
    return completeWorkOsTask(access, taskId, true);
  }
  throw new Error("unsupported proposal operation");
}

export async function reviewWorkOsProposal(access: WorkOsAccess, proposalId: string, body: Json) {
  const decision = text(body.decision);
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const { data: proposal, error: loadError } = await db()
    .from("work_task_proposals")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", proposalId)
    .single();
  if (loadError) throw new Error(`load Work OS proposal: ${loadError.message}`);
  if (proposal.person_id !== access.personId) throw new Error("Only the proposal owner can accept or reject it");
  const decisionKey = text(body.decision_idempotency_key);
  if (proposal.status === "applying") {
    const applyingSince = new Date(proposal.updated_at as string).getTime();
    if (Date.now() - applyingSince <= 5 * 60_000) return proposal;
    const { data: recovered, error: recoveryError } = await db().from("work_task_proposals").update({
      status: "failed",
      failure_reason: "Previous provider application did not finalize; reconciling before retry.",
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying").select("*").maybeSingle();
    if (recoveryError) throw new Error(`recover stalled Work OS proposal: ${recoveryError.message}`);
    if (recovered) Object.assign(proposal, recovered);
  }
  if (decisionKey && proposal.decision_idempotency_key === decisionKey && !["pending", "failed", "needs_review", "stale"].includes(proposal.status)) return proposal;
  if (decision === "reject" && ["pending", "failed", "needs_review", "stale"].includes(proposal.status)) {
    const { data, error } = await db().from("work_task_proposals").update({
      status: "rejected",
      decided_by: access.ctx.user.id,
      decided_at: new Date().toISOString(),
      decision_idempotency_key: decisionKey,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).select("*").single();
    if (error) throw new Error(`reject Work OS proposal: ${error.message}`);
    await audit(access, "proposal.rejected", "task_proposal", proposalId);
    return data;
  }
  if (!["pending", "failed", "needs_review"].includes(proposal.status)) return proposal;
  const proposedChange = body.proposed_change && typeof body.proposed_change === "object"
    ? body.proposed_change as Json
    : proposal.proposed_change as Json;
  if (proposal.task_id) {
    try {
      const ownerId = await organizationOwnerId(access.organizationId);
      await syncNifty(ownerId);
      const current = await getTaskByLocalOrProviderId(ownerId, proposal.task_id as string);
      const before = (proposal.before_state ?? {}) as Json;
      const keys = ["title", "description", "status", "completed", "due_date", "start_date"];
      if (keys.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(current[key] ?? null))) {
        const { data: stale, error: staleError } = await db().from("work_task_proposals").update({
          status: "stale", failure_reason: "Nifty task changed after this proposal was drafted. Create a new proposal from the current task state.",
          decision_idempotency_key: decisionKey, decided_by: access.ctx.user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", proposalId).select("*").single();
        if (staleError) throw new Error(`mark stale Work OS proposal: ${staleError.message}`);
        await audit(access, "proposal.stale", "task_proposal", proposalId);
        return stale;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Nifty task refresh failed";
      await db().from("work_task_proposals").update({
        status: "failed",
        failure_reason: `Could not refresh Nifty before applying this proposal: ${reason}`,
        updated_at: new Date().toISOString(),
      }).eq("id", proposalId).in("status", ["pending", "failed", "needs_review"]);
      await audit(access, "proposal.refresh_failed", "task_proposal", proposalId, { reason });
      throw error;
    }
  }
  const { data: applying, error: applyingError } = await db().from("work_task_proposals").update({
    status: "applying",
    proposed_change: proposedChange,
    decided_by: access.ctx.user.id,
    decided_at: new Date().toISOString(),
    decision_idempotency_key: decisionKey,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  }).eq("id", proposalId).in("status", ["pending", "failed", "needs_review"]).select("*").maybeSingle();
  if (applyingError) throw new Error(`claim Work OS proposal: ${applyingError.message}`);
  if (!applying) {
    const { data } = await db().from("work_task_proposals").select("*").eq("id", proposalId).single();
    return data;
  }
  try {
    const providerResult = await applyProposal(access, applying as Json);
    const { data, error } = await db().from("work_task_proposals").update({
      status: "applied",
      provider_result: providerResult ?? {},
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).select("*").single();
    if (error) throw new Error(`finalize Work OS proposal: ${error.message}`);
    if (proposal.check_in_id) {
      await db().from("work_check_ins").update({ substantive: true }).eq("id", proposal.check_in_id as string);
    }
    await audit(access, "proposal.applied", "task_proposal", proposalId, { operation: proposal.operation });
    return data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Proposal application failed";
    const needsReview = /required before|evidence is required|task_group_id is required/i.test(reason);
    await db().from("work_task_proposals").update({
      status: needsReview ? "needs_review" : "failed",
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId);
    await audit(access, "proposal.failed", "task_proposal", proposalId, { operation: proposal.operation, reason, needsReview });
    throw error;
  }
}

async function saveReportVersion(access: WorkOsAccess, report: Json, kind: "draft" | "employee_submission" | "manager_edit", markdown: string, idempotencyKey?: string | null) {
  const payload = {
    organization_id: access.organizationId,
    report_id: report.id,
    version_kind: kind,
    markdown,
    metrics: report.metrics ?? {},
    missing_evidence: report.missing_evidence ?? [],
    idempotency_key: idempotencyKey ?? null,
    created_by: access.ctx.user.id,
  };
  const query = idempotencyKey
    ? db().from("work_report_versions").upsert(payload, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true })
    : db().from("work_report_versions").insert(payload);
  const { error } = await query;
  if (error) throw new Error(`save ${kind} EOD version: ${error.message}`);
}

export async function draftWorkOsEod(access: WorkOsAccess, personId: string, body: Json) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const draftKey = text(body.draft_idempotency_key);
  if (draftKey) {
    const { data: existing, error: existingError } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("draft_idempotency_key", draftKey).maybeSingle();
    if (existingError) throw new Error(`load idempotent EOD draft: ${existingError.message}`);
    if (existing) {
      await saveReportVersion(access, existing as Json, "draft", text(existing.markdown) ?? "", draftKey);
      return existing;
    }
  }
  let report: Json;
  try {
    report = await createEodReport(ownerId, { ...body, person_id: personId }) as Json;
  } catch (error) {
    if (!draftKey) throw error;
    const { data: reconciled } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("draft_idempotency_key", draftKey).maybeSingle();
    if (!reconciled) throw error;
    report = reconciled as Json;
  }
  await saveReportVersion(access, report, "draft", text(report.markdown) ?? "", draftKey);
  await audit(access, "report.drafted", "report", report.id as string, { personId, reportDate: report.report_date });
  return report;
}

export async function submitWorkOsEod(access: WorkOsAccess, reportId: string, body: Json) {
  const { data: report, error: loadError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", reportId)
    .single();
  if (loadError) throw new Error(`load EOD report: ${loadError.message}`);
  if (!report.person_id || !(await canAccessWorkOsPerson(access, String(report.person_id)))) throw new Error("forbidden");
  const submissionKey = text(body.submission_idempotency_key);
  if (submissionKey && report.submission_idempotency_key === submissionKey) {
    await saveReportVersion(access, report as Json, "employee_submission", text(report.submitted_markdown) ?? text(report.markdown) ?? "", submissionKey);
    return report;
  }
  if (!["draft", "rejected"].includes(report.status)) throw new Error("only draft or rejected reports can be submitted");
  const markdown = text(body.markdown) ?? text(report.markdown);
  if (!markdown) throw new Error("markdown is required");
  const submittedAt = new Date().toISOString();
  const { data: submitted, error: submitError } = await db().from("work_reports").update({
    status: "pending_review",
    markdown,
    submitted_markdown: markdown,
    submitted_by: access.ctx.user.id,
    submitted_at: submittedAt,
    submission_idempotency_key: submissionKey,
    reviewed_by: null,
    reviewed_at: null,
    updated_at: submittedAt,
  }).eq("organization_id", access.organizationId).eq("id", reportId).in("status", ["draft", "rejected"]).select("*").maybeSingle();
  if (submitError) throw new Error(`submit EOD report: ${submitError.message}`);
  if (!submitted) {
    const { data: reconciled, error: reconcileError } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("id", reportId).maybeSingle();
    if (reconcileError || !reconciled || !submissionKey || reconciled.submission_idempotency_key !== submissionKey) {
      throw new Error("EOD report changed while it was being submitted");
    }
    await saveReportVersion(access, reconciled as Json, "employee_submission", text(reconciled.submitted_markdown) ?? markdown, submissionKey);
    return reconciled;
  }
  await saveReportVersion(access, submitted as Json, "employee_submission", markdown, submissionKey);
  await audit(access, "report.submitted", "report", reportId, { personId: report.person_id, submittedAt });
  return submitted;
}

export async function reviewWorkOsEod(access: WorkOsAccess, reportId: string, body: Json) {
  const { data: report, error: loadError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", reportId)
    .single();
  if (loadError) throw new Error(`load EOD report for review: ${loadError.message}`);
  if (report.status !== "pending_review") throw new Error("only pending reports can be reviewed");
  const ownerId = await organizationOwnerId(access.organizationId);
  const reviewed = await reviewReport(ownerId, reportId, access.ctx.user.id, body) as Json;
  if (typeof body.markdown === "string" && body.markdown !== report.markdown) {
    const { error: versionError } = await db().from("work_report_versions").insert({
      organization_id: access.organizationId,
      report_id: reportId,
      version_kind: "manager_edit",
      markdown: body.markdown,
      metrics: report.metrics ?? {},
      missing_evidence: report.missing_evidence ?? [],
      created_by: access.ctx.user.id,
    });
    if (versionError) throw new Error(`save manager EOD edit: ${versionError.message}`);
  }
  await audit(access, `report.${String(body.status)}`, "report", reportId, {
    personId: report.person_id,
    employeeSubmissionPreserved: !!report.submitted_markdown,
  });
  return reviewed;
}
