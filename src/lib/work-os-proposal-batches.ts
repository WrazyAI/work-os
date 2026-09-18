import { audit, db, nonEmptyString as text, type Json } from "@/lib/work-os-internal";
import { reviewWorkOsProposal, type WorkOsProposalRow } from "@/lib/work-os-proposals";
import type { WorkOsAccess } from "@/lib/work-os-api";

/**
 * Batches group many task proposals that one employee decision approves
 * together. Every item stays a normal proposal, so each one keeps the
 * exactly-once provider path (outbox, apply lease, staleness) from the single
 * review flow. This module adds only what a batch needs on top: ordering, the
 * parent resolution for steps whose task is created in the same batch, and one
 * aggregated result per item.
 */

const PENDING_STATUSES = ["pending", "failed", "needs_review"];

async function loadBatch(access: WorkOsAccess, batchId: string) {
  const { data, error } = await db()
    .from("work_task_proposals")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string)
    .eq("batch_id", batchId)
    .order("batch_index", { ascending: true });
  if (error) throw new Error(`load Work OS proposal batch: ${error.message}`);
  if (!data?.length) throw new Error("That batch is no longer available. Refresh to see the current state.");
  return data as WorkOsProposalRow[];
}

/**
 * A step is filed after the task it belongs to: index order already guarantees
 * parents come first, but a rejected or failed parent must not leave an orphan
 * step behind, so the ordering is explicit here.
 */
function orderBatch(rows: WorkOsProposalRow[]): WorkOsProposalRow[] {
  const parents = rows.filter((row) => !row.parent_client_id);
  const children = rows.filter((row) => row.parent_client_id);
  return [...parents, ...children];
}

/** Owner-scoped readback: the card can rebuild itself from this after a reload. */
export async function getWorkOsProposalBatch(access: WorkOsAccess, batchId: string) {
  const rows = await loadBatch(access, batchId);
  return {
    batch: {
      id: batchId,
      kind: (rows[0].batch_kind as string | null) ?? null,
      created_at: (rows[0].created_at as string | null) ?? null,
    },
    proposals: rows,
  };
}

export interface BatchReviewResult {
  proposal_id: string;
  client_id: string | null;
  parent_client_id: string | null;
  operation: string;
  status: string;
  outcome: string | null;
  message: string;
  /** Set when the provider write is uncertain and the employee must confirm. */
  create_resolution?: "no_task_created";
}

/**
 * Approves (or rejects) every pending item in a batch, in dependency order.
 * Each item is reviewed through the single-proposal path, so a partial failure
 * is reported per item instead of pretending the batch succeeded: an item that
 * fails is left retryable, and a step whose parent failed is reported as
 * skipped rather than filed against the wrong task.
 */
export async function reviewWorkOsProposalBatch(access: WorkOsAccess, batchId: string, body: Json) {
  const decision = text(body.decision);
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const decisionKey = text(body.decision_idempotency_key);
  const decisions = new Map<string, Json>();
  if (Array.isArray(body.decisions)) {
    for (const raw of body.decisions as Json[]) {
      if (!raw || typeof raw !== "object") continue;
      const proposalId = text(raw.proposal_id);
      if (proposalId) decisions.set(proposalId, raw);
    }
  }

  const rows = orderBatch(await loadBatch(access, batchId));
  const createdTaskByClientId = new Map<string, Json>();
  const results: BatchReviewResult[] = [];

  for (const row of rows) {
    const proposalId = String(row.id);
    const item = decisions.get(proposalId) ?? {};
    const itemDecision = text(item.decision) ?? decision;
    const edits = item.edits ?? undefined;
    const result = (status: string, message: string, outcome: string | null, extra?: Partial<BatchReviewResult>): BatchReviewResult => ({
      proposal_id: proposalId,
      client_id: (row.client_id as string | null) ?? null,
      parent_client_id: (row.parent_client_id as string | null) ?? null,
      operation: String(row.operation),
      status,
      outcome,
      message,
      ...extra,
    });

    if (!PENDING_STATUSES.includes(String(row.status))) {
      results.push(result(String(row.status), statusMessage(String(row.status), row), outcomeOf(row), {
        ...(uncertainOf(row) ? { create_resolution: "no_task_created" as const } : {}),
      }));
      continue;
    }

    // Resolve a parent created earlier in this batch before filing the step.
    if (row.parent_client_id) {
      const parent = createdTaskByClientId.get(String(row.parent_client_id));
      if (!parent) {
        results.push(result("skipped", "The task this step belongs to was not created, so the step was left alone.", null));
        continue;
      }
      const beforeState = {
        id: parent.id,
        title: parent.title,
        description: parent.description,
        status: parent.status,
        completed: parent.completed,
        due_date: parent.due_date,
        start_date: parent.start_date,
        task_group_id: parent.task_group_id,
        parent_provider_task_id: parent.parent_provider_task_id,
      };
      const { error: wireError } = await db().from("work_task_proposals").update({
        task_id: parent.id,
        before_state: beforeState,
        updated_at: new Date().toISOString(),
      }).eq("id", proposalId).eq("organization_id", access.organizationId).is("task_id", null);
      if (wireError) throw new Error(`attach batch step to its created task: ${wireError.message}`);
      row.task_id = parent.id as string;
      row.before_state = beforeState;
    }

    try {
      const reviewed = await reviewWorkOsProposal(access, proposalId, {
        decision: itemDecision,
        ...(edits ? { edits } : {}),
        ...(decisionKey ? { decision_idempotency_key: `${decisionKey}:${proposalId}` } : {}),
      });
      const settled = reviewed as unknown as WorkOsProposalRow;
      // Read the created task from the settled row so later steps in this batch
      // can point at it without a second lookup.
      const providerResult = (settled.provider_result ?? {}) as Json;
      if (String(settled.operation) === "create_task" && providerResult && providerResult.id) {
        createdTaskByClientId.set(String(row.client_id ?? proposalId), providerResult);
      }
      results.push(result(
        String(settled.status),
        statusMessage(String(settled.status), settled),
        outcomeOf(settled),
        uncertainOf(settled) ? { create_resolution: "no_task_created" as const } : {},
      ));
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "That change could not be filed.";
      results.push(result("failed", message, "failed"));
    }
  }

  const accepted = results.filter((entry) => entry.status === "applied").length;
  const failed = results.filter((entry) => entry.status === "failed").length;
  const skipped = results.filter((entry) => entry.status === "skipped").length;
  await audit(access, "proposal.batch_reviewed", "task_proposal_batch", batchId, { decision: decision ?? null, accepted, failed, skipped });
  return {
    batch_id: batchId,
    decision,
    results,
    accepted,
    failed,
    skipped,
    outcome: failed ? "failed" : skipped ? "partial" : "applied",
  };
}

function outcomeOf(row: WorkOsProposalRow): string | null {
  return (row as Json).outcome ? String((row as Json).outcome) : null;
}

function uncertainOf(row: WorkOsProposalRow): boolean {
  return (row as Json).create_intent_unresolved === true;
}

function statusMessage(status: string, row: WorkOsProposalRow): string {
  const failure = text(row.failure_reason);
  if (status === "applied") return "Recorded.";
  if (status === "rejected") return "Rejected.";
  if (status === "queued") return "Queued for the next sync.";
  if (status === "processing") return "Still being filed.";
  if (failure) return failure;
  if (status === "failed" || status === "needs_review") return "That change could not be filed.";
  return status;
}
