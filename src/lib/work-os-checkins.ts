import { createHash } from "node:crypto";
import { listPersonTasks } from "@/lib/work-os";
import { localDateForTimezone, resolveShiftWindow } from "@/modules/work-os/companion";
import {
  OPERATIONS,
  audit,
  db,
  loadShiftData,
  nonEmptyString as text,
  organizationOwnerId,
  type Json,
  type ProposalOperation,
} from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { recordWorkMemory, buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, CHECK_IN_MODEL, recordAiUsage } from "@/lib/work-os-ai-model";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const CHECK_IN_TIMEOUT_MS = AI_TIMEOUTS.checkIn;
const CHECK_IN_PROMPT_VERSION = "work-os-check-in-v1";

interface ParsedProposal {
  operation: ProposalOperation;
  task_id?: string | null;
  change: Json;
}

export type CheckInCommitmentContext = { title: string; objective: string | null; successCriteria: string[]; status: "selected" | "deferred" | "completed" };

/** Commitment context gives the model employee-reviewed intent, never completion evidence. */
export function checkInCommitmentContext(rows: Json[]): CheckInCommitmentContext[] {
  return rows.slice(0, 12).flatMap((row) => {
    const title = text(row.title_snapshot);
    if (!title) return [];
    const criteria = Array.isArray(row.success_criteria)
      ? row.success_criteria.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 5)
      : [];
    const status = row.completion_state === "completed" ? "completed" : row.disposition === "deferred" ? "deferred" : "selected";
    return [{ title, objective: text(row.objective), successCriteria: criteria, status }];
  });
}

async function parseCheckIn(input: string, tasks: Json[], commitments: CheckInCommitmentContext[], context?: { todayBlock?: string; memoryBlock?: string }): Promise<{ model: string; proposals: ParsedProposal[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required to turn a check-in into task proposals");
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
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(aiRequestBody(CHECK_IN_MODEL, {
      messages: [
        {
          role: "system",
          content: [
            "You produce proposals for human review. The Work OS task record is authoritative.",
            "Use an existing task when the text refers to one. Do not claim work, status, output, blockers, or completion unless the employee explicitly states it.",
            "Daily commitments are employee-reviewed planning context, not evidence. Never infer a commitment is completed or progressed from its presence.",
            "The live day state is authoritative for what is currently planned, completed, and blocked today.",
            "Memory context may include dated history plus same-day tentative context awaiting review. Use it only for continuity and intent; never treat it as evidence of current state, progress, or completion.",
            "Use complete_task only for explicit completion language. Activity alone never proves completion.",
            "For create_task include name, expected_outcome, definition_of_done, and any stated due date, priority, effort, dependency, or blocker. Do not fabricate missing values.",
          ].join("\n"),
        },
        // The task list leads and the employee's own words come last, so the
        // provider's prefix cache can reuse the list across check-ins. The
        // model reads the same content either way.
        { role: "user", content: JSON.stringify({ currentTasks: taskContext, dailyCommitments: commitments, ...(context?.todayBlock ? { todayContext: context.todayBlock } : {}), ...(context?.memoryBlock ? { memoryContext: context.memoryBlock } : {}), employeeInput: input }) },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "proposeWorkChanges" } },
      temperature: 0.2,
      max_tokens: AI_TOKEN_BUDGETS.checkIn,
    })),
    signal: AbortSignal.timeout(CHECK_IN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Work OS proposal AI failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const json = await response.json() as Json;
  recordAiUsage("check_in", CHECK_IN_MODEL, json);
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
    if (operation === "remove_from_plan" && !text(change.plan_item_id)) continue;
    const localTaskId = matchedTask ? String(matchedTask.id) : null;
    const signature = JSON.stringify([operation, localTaskId, change]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    proposals.push({ operation, task_id: localTaskId, change });
  }
  return { model: CHECK_IN_MODEL, proposals };
}

/** Maps the prompt engine's finer slot names onto the stored check-in kinds.
 * Progress prompts (`follow_up`, `hourly_fallback`) are the in-shift
 * "catch_up" check-in; the quiet `optional` prompt keeps its own kind. */
export function normalizeCheckInKind(kind: string | null | undefined): "plan" | "catch_up" | "optional" | "eod" | null {
  if (kind === "follow_up" || kind === "hourly_fallback") return "catch_up";
  return kind === "plan" || kind === "catch_up" || kind === "optional" || kind === "eod" ? kind : null;
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
  const requestedKind = text(body.kind);
  const normalizedKind = normalizeCheckInKind(requestedKind);
  if (requestedKind && !normalizedKind) throw new Error("invalid check-in kind");
  const kind = normalizedKind ?? (shift && now.getTime() >= new Date(shift.endsAt).getTime() - 15 * 60_000 ? "eod" : "plan");
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
  const tasks = await listPersonTasks(ownerId, personId, { todayOnly: true, includeAssignedBy: false }) as Json[];
  if (confirmedExisting && !tasks.length) throw new Error("there are no existing tasks to confirm as the current plan");
  const planItems = await db().from("work_daily_plans").select("items:work_daily_plan_items(title_snapshot,objective,success_criteria,disposition,completion_state)")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("shift_date", shiftDate).maybeSingle();
  if (planItems.error) throw new Error(`load check-in planning context: ${planItems.error.message}`);
  const commitments = checkInCommitmentContext(Array.isArray(planItems.data?.items) ? planItems.data.items as Json[] : []);
  const context = memoryEnabled(access.featureFlags)
    ? {
        todayBlock: await buildTodaySnapshot({ organizationId: access.organizationId, personId, localDate: shiftDate }),
        memoryBlock: await buildMemoryPromptBlock({ organizationId: access.organizationId, personId, localDate: shiftDate }, input || "recent progress and blockers", { limit: 8, analysisLocalDate: shiftDate }),
      }
    : undefined;
  const parsed = input ? await parseCheckIn(input, tasks, commitments, context) : { model: CHECK_IN_MODEL, proposals: [] as ParsedProposal[] };
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
    inference_metadata: { commitmentContextCount: commitments.length },
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
  await recordWorkMemory(
    { organizationId: access.organizationId, personId },
    {
      kind: "check_in",
      sourceTable: "work_check_ins",
      sourceId: String(checkIn.id),
      content: input || (confirmedExisting ? "Confirmed existing tasks as the current plan." : "Check-in recorded without text."),
      summary: input ? input.slice(0, 160) : null,
      metadata: { checkInKind: kind, updateKind, proposalCount: proposals.length },
      localDate: shiftDate,
      occurredAt: checkIn.created_at ?? now.toISOString(),
    },
  );
  if (activeSession?.id && (input || confirmedExisting)) {
    await db().from("work_sessions").update({ state: "active", last_substantive_update_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", activeSession.id);
  }
  return { checkIn, proposals };
}
