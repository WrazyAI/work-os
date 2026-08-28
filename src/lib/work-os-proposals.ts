import {
  addTaskProgress,
  createEvidence,
  createTask,
  getTaskByLocalOrProviderId,
  syncNifty,
  updateTask,
} from "@/lib/work-os";
import { activeSession } from "@/lib/work-os-workday";
import {
  audit,
  db,
  nonEmptyString as text,
  organizationOwnerId,
  type Json,
  type ProposalOperation,
} from "@/lib/work-os-internal";
import { completeWorkOsTask } from "@/lib/work-os-employee-tasks";
import type { WorkOsAccess } from "@/lib/work-os-api";

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

async function applyProposal(access: WorkOsAccess, proposal: Json) {
  const operation = proposal.operation as ProposalOperation;
  const change = proposal.proposed_change as Json;
  if (operation === "remove_from_plan") {
    const planItemId = text(change.plan_item_id) ?? text((proposal.before_state as Json | undefined)?.plan_item_id);
    if (!planItemId) throw new Error("plan_item_id is required for a removal proposal");
    const { data, error } = await db().from("work_daily_plan_items").update({
      disposition: "removed",
      updated_at: new Date().toISOString(),
    }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId)
      .eq("disposition", "removal_proposed").select("*").maybeSingle();
    if (error) throw new Error(`remove task from daily plan: ${error.message}`);
    if (data) return data;
    const { data: current, error: currentError } = await db().from("work_daily_plan_items").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId).maybeSingle();
    if (currentError) throw new Error(`reconcile removed plan item: ${currentError.message}`);
    if (current?.disposition === "removed") return current;
    throw new Error("Removal proposal is no longer pending review.");
  }
  const ownerId = await organizationOwnerId(access.organizationId);
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

async function restorePlanRemoval(access: WorkOsAccess, proposal: Json) {
  const before = (proposal.before_state ?? {}) as Json;
  const change = (proposal.proposed_change ?? {}) as Json;
  const planItemId = text(change.plan_item_id) ?? text(before.plan_item_id);
  const previousDisposition = text(before.disposition);
  if (!planItemId || !["selected", "deferred"].includes(previousDisposition ?? "")) return;
  const { error } = await db().from("work_daily_plan_items").update({
    disposition: previousDisposition,
    updated_at: new Date().toISOString(),
  }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId)
    .eq("disposition", "removal_proposed");
  if (error) throw new Error(`restore rejected plan removal: ${error.message}`);
}

export async function proposeWorkOsPlanRemoval(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const planItemId = text(body.plan_item_id);
  const reason = text(body.reason) ?? "No longer part of today's selected work.";
  if (!planItemId) throw new Error("plan_item_id is required");
  const { data: existing, error: existingError } = await db().from("work_task_proposals").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingError) throw new Error(`load idempotent removal proposal: ${existingError.message}`);
  if (existing) return { proposal: existing };
  const { data: item, error: itemError } = await db().from("work_daily_plan_items").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId).single();
  if (itemError) throw new Error(`load daily plan item for removal: ${itemError.message}`);
  if (!item.task_id) throw new Error("Only task-backed plan items can be removed through review.");
  if (!["selected", "deferred"].includes(item.disposition as string)) throw new Error("This plan item is already pending removal or removed.");
  const { data: plan, error: planError } = await db().from("work_daily_plans").select("id,session_id,shift_date,status")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", item.plan_id).single();
  if (planError) throw new Error(`load daily plan for removal: ${planError.message}`);
  if (!["draft", "confirmed"].includes(String(plan.status))) throw new Error("Only an open daily plan can receive a removal proposal.");
  const session = await activeSession(access);
  if (!session || session.id !== plan.session_id) throw new Error("Only the current clocked-in plan can receive a removal proposal.");
  const beforeState = {
    plan_id: plan.id,
    plan_item_id: item.id,
    task_id: item.task_id,
    title_snapshot: item.title_snapshot,
    disposition: item.disposition,
    rank: item.rank,
  };
  const { data: proposal, error: proposalError } = await db().from("work_task_proposals").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    task_id: item.task_id,
    operation: "remove_from_plan",
    input_text: reason,
    before_state: beforeState,
    proposed_change: { plan_item_id: item.id, disposition: "removed", reason },
    model: "employee",
    prompt_version: "work-os-plan-removal-v1",
    idempotency_key: idempotencyKey,
    created_by: access.ctx.user.id,
  }).select("*").single();
  if (proposalError) {
    if (/duplicate|unique/i.test(proposalError.message)) {
      const reconciled = await db().from("work_task_proposals").select("*")
        .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
        .eq("idempotency_key", idempotencyKey).single();
      if (reconciled.error) throw new Error(`reconcile removal proposal: ${reconciled.error.message}`);
      return { proposal: reconciled.data };
    }
    throw new Error(`create plan removal proposal: ${proposalError.message}`);
  }
  const { data: updatedItem, error: updateError } = await db().from("work_daily_plan_items").update({
    disposition: "removal_proposed",
    updated_at: new Date().toISOString(),
  }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", item.id)
    .eq("disposition", item.disposition).select("*").maybeSingle();
  if (updateError) {
    await db().from("work_task_proposals").update({ status: "failed", failure_reason: `Could not reserve plan item for removal: ${updateError.message}`, updated_at: new Date().toISOString() }).eq("id", proposal.id).eq("status", "pending");
    throw new Error(`mark plan removal pending: ${updateError.message}`);
  }
  if (!updatedItem) {
    await db().from("work_task_proposals").update({ status: "failed", failure_reason: "The plan item changed before this removal proposal could be reserved.", updated_at: new Date().toISOString() }).eq("id", proposal.id).eq("status", "pending");
    throw new Error("The plan item changed before this removal proposal could be reserved.");
  }
  await audit(access, "proposal.removal_proposed", "task_proposal", proposal.id as string, { planItemId: item.id, taskId: item.task_id, reason });
  return { proposal, planItem: updatedItem };
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
    if (proposal.operation === "remove_from_plan") await restorePlanRemoval(access, proposal as Json);
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
  if (proposal.task_id && proposal.operation !== "remove_from_plan") {
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
