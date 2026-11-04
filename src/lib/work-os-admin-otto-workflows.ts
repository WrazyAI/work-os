import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { getAdminPreviewRecord } from "@/lib/work-admin-action-previews";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { normalizeAdminOttoSteps } from "@/lib/work-os-admin-otto-intent";
import type { AdminOttoOperation, AdminOttoPendingAction, AdminOttoPlanStep, AdminOttoWorkflowView, AdminRead, ReadIntent } from "@/modules/work-os/admin-otto/contracts";

type Progress = { action?: AdminOttoPendingAction; refs?: unknown; message: string; failed?: boolean; revision?: number };
type WorkflowRow = { id: string; request_hash: string; plan: AdminOttoPlanStep[]; progress: Record<string, Progress>; abandoned_at: string | null };
export type OttoWorkflowDeps = {
  read: (intent: ReadIntent) => Promise<{ result: AdminRead | null; refs: unknown; reply: string }>;
  replayRead: (refs: unknown) => Promise<{ result: AdminRead | null; reply: string }>;
  operation: (access: WorkOsAccess, operation: AdminOttoOperation, key: string, taskId?: string) => Promise<{ reply: string; pendingAction?: AdminOttoPendingAction }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new WorkOsConflictError("This conversation is no longer available.", "conversation_unavailable");
const label = (step: AdminOttoPlanStep) => step.operation
  ? step.operation.title ?? step.operation.task_query ?? "Task change"
  : step.intent?.action === "eods" ? "EOD reports" : step.intent?.action === "unfinished" ? "Tasks" : step.intent?.action.replaceAll("_", " ") ?? "Work records";

async function row(access: WorkOsAccess, id: string): Promise<WorkflowRow> {
  if (!UUID.test(id)) throw unavailable();
  const { rows } = await getPool().query<WorkflowRow>(
    `select w.id,w.request_hash,w.plan,w.progress,w.abandoned_at from work_admin_otto_workflows w
     join work_org_members m on m.id=w.membership_id and m.organization_id=w.organization_id and m.user_id=w.user_id
     where w.id=$1 and w.organization_id=$2 and w.membership_id=$3 and w.user_id=$4
       and w.abandoned_at is null and m.active=true and m.role='admin' and w.created_at > now()-interval '30 days'`,
    [id, access.organizationId, access.membershipId, access.ctx.user.id],
  );
  if (!rows[0]) throw unavailable();
  return rows[0];
}

export async function assertOttoWorkflowActive(access: WorkOsAccess, id: string) {
  await row(access, id);
}

/** A status read never applies or prepares a change. The durable preview is the
 * authority, not a component's remembered success flag. */
export async function currentOttoAction(access: WorkOsAccess, action: AdminOttoPendingAction): Promise<AdminOttoPendingAction> {
  const record = await getAdminPreviewRecord(access, action.previewId, null);
  if (!record || record.source !== "otto") return { ...action, status: "abandoned" };
  const body = record.result?.body as Record<string, unknown> | null;
  const task = body?.task as Record<string, unknown> | undefined;
  const id = typeof task?.id === "string" ? task.id : record.targetId;
  const key = record.idempotencyKey;
  let reconciled: string | null = null;
  // A released claim with no stored result is *not* proof that nothing ran. A
  // create is keyed by its preview, so look the row up before offering a
  // replacement preview (which would use a different key).
  if (!record.result && !record.confirmedAt && key) {
    const { rows } = await getPool().query<{ id: string }>(`select id from work_tasks
      where organization_id=$1 and agent_token_id is null and agent_idempotency_key=$2 limit 1`,
    [access.organizationId, key]);
    reconciled = rows[0]?.id ?? null;
  }
  return {
    ...action,
    status: record.result || reconciled ? "recorded" : record.confirmedAt ? "in_flight"
      : new Date(record.preview.expiresAt).getTime() <= Date.now() ? "expired" : "pending",
    ...(id || reconciled ? { recordUrl: `/work-os/admin/tasks?task=${encodeURIComponent(reconciled ?? id!)}` } : {}),
  };
}

async function view(access: WorkOsAccess, workflow: WorkflowRow, deps: OttoWorkflowDeps): Promise<AdminOttoWorkflowView> {
  const steps: AdminOttoWorkflowView["steps"] = [];
  for (const [index, step] of workflow.plan.entries()) {
    const saved = workflow.progress[String(index)];
    if (!saved) {
      steps.push({ index, label: label(step), status: "blocked", message: "Waiting for the earlier step to be recorded." });
    } else if (saved.action) {
      const action = await currentOttoAction(access, saved.action);
      steps.push({ index, label: label(step), status: action.status === "recorded" ? "recorded" : "ready", pendingAction: action });
    } else if (saved.refs) {
      try {
        const read = await deps.replayRead(saved.refs);
        steps.push({ index, label: label(step), status: read.result && !saved.failed ? "recorded" : "failed", result: read.result, message: read.reply });
      } catch {
        steps.push({ index, label: label(step), status: "failed", message: "This read could not be reloaded. Ask again for a current answer." });
      }
    } else {
      steps.push({ index, label: label(step), status: "failed", message: saved.message });
    }
  }
  return { id: workflow.id, steps };
}

export async function startOttoWorkflow(access: WorkOsAccess, requestId: string, text: string,
  plan: AdminOttoPlanStep[], deps: OttoWorkflowDeps): Promise<AdminOttoWorkflowView> {
  if (!UUID.test(requestId) || !plan.length || plan.length > 8) throw new WorkOsValidationError("A plan needs 1 to 8 steps and a request identity.");
  plan = normalizeAdminOttoSteps(plan);
  // Text binds replay identity; an overlapping retry never substitutes a new
  // model interpretation for the already stored plan.
  const hash = createHash("sha256").update(text).digest("hex");
  const { rows } = await getPool().query<{ id: string; request_hash: string }>(
    `insert into work_admin_otto_workflows (organization_id,membership_id,user_id,request_id,request_hash,plan)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict (organization_id,membership_id,user_id,request_id) do update
       set request_id=excluded.request_id returning id,request_hash`,
    [access.organizationId, access.membershipId, access.ctx.user.id, requestId, hash, JSON.stringify(plan)],
  );
  if (rows[0].request_hash !== hash) throw new WorkOsConflictError("This request id was used with different text.", "request_id_reused");
  return prepareOttoWorkflow(access, rows[0].id, deps);
}

export async function loadOttoWorkflow(access: WorkOsAccess, id: string, deps: OttoWorkflowDeps) {
  return view(access, await row(access, id), deps);
}

/** Only prepares previews. A recorded predecessor can unlock a preview, never
 * automatically authorize it. Stable per-step keys resolve concurrent prepares. */
export async function prepareOttoWorkflow(access: WorkOsAccess, id: string, deps: OttoWorkflowDeps,
  refreshIndex?: number): Promise<AdminOttoWorkflowView> {
  const workflow = await row(access, id);
  if (refreshIndex !== undefined && (!Number.isInteger(refreshIndex) || refreshIndex < 0 || refreshIndex >= workflow.plan.length)) {
    throw new WorkOsValidationError("Choose a valid step to refresh.");
  }
  for (const [index, step] of workflow.plan.entries()) {
    const old = workflow.progress[String(index)];
    if (old && refreshIndex !== index) continue;
    if (old?.action) {
      const current = await currentOttoAction(access, old.action);
      if (current.status === "recorded" || current.status === "in_flight") continue;
      // Expiry and replacement are one conditional step: a confirm that claimed
      // the preview after the status read makes this update affect no row, and
      // no replacement may be issued while that action is being applied.
      const { rows } = await getPool().query(
        `update work_admin_action_previews set expires_at=least(expires_at,now())
         where id=$1 and organization_id=$2 and user_id=$3 and token_id is null and source='otto' and confirmed_at is null
         returning id`,
        [old.action.previewId, access.organizationId, access.ctx.user.id],
      );
      if (!rows.length) continue;
    }
    let taskId: string | undefined;
    if (step.depends_on !== null) {
      const previous = workflow.progress[String(step.depends_on)];
      if (!previous || previous.failed) continue;
      if (previous.action) {
        const record = await getAdminPreviewRecord(access, previous.action.previewId, null);
        if (!record?.result) continue;
        const body = record.result.body as Record<string, unknown>;
        const task = body?.task as Record<string, unknown> | undefined;
        taskId = typeof task?.id === "string" ? task.id : record.targetId ?? undefined;
        if (step.operation && !taskId) continue;
      } else if (!previous.refs) continue;
    }
    const revision = (old?.revision ?? -1) + 1;
    let progress: Progress;
    try {
      if (step.operation) {
        const prepared = await deps.operation(access, step.operation, `otto-workflow:${id}:${index}:${revision}`, taskId);
        progress = { action: prepared.pendingAction, message: prepared.reply, failed: !prepared.pendingAction, revision };
      } else if (step.intent) {
        const read = await deps.read(step.intent);
        progress = { refs: read.refs, message: read.reply, failed: !read.result || read.result.kind === "resolution", revision };
      } else throw new WorkOsValidationError("A step must contain one supported request.");
    } catch (error) {
      const safe = error instanceof Error && (error.name === "WorkOsValidationError" || error.name === "WorkOsConflictError");
      progress = { failed: true, message: safe ? error.message : "This request could not be prepared. Try again.", revision };
    }
    // A concurrent reset must win over late preparation. A concurrent initial
    // prepare can reuse its stable preview but cannot replace an existing step.
    const { rows } = await getPool().query<{ progress: WorkflowRow["progress"] }>(
      `update work_admin_otto_workflows set progress=jsonb_set(progress,array[$2::text],$3::jsonb)
       where id=$1 and abandoned_at is null and coalesce((progress->$2::text->>'revision')::int,-1)=$4
       returning progress`, [id, String(index), JSON.stringify(progress), old?.revision ?? -1],
    );
    if (!rows.length) return loadOttoWorkflow(access, id, deps);
    workflow.progress = rows[0].progress;
  }
  return view(access, workflow, deps);
}

/** Discarding chat never reverts recorded writes. A confirm already claimed
 * before this boundary was explicitly authorized and may still finish. */
export async function abandonOttoWorkflow(access: WorkOsAccess, id: string): Promise<void> {
  await row(access, id);
  await getPool().query(`update work_admin_otto_workflows set abandoned_at=now() where id=$1
    and organization_id=$2 and membership_id=$3 and user_id=$4`,
  [id, access.organizationId, access.membershipId, access.ctx.user.id]);
  await getPool().query(`update work_admin_action_previews set expires_at=least(expires_at,now())
    where organization_id=$1 and user_id=$2 and source='otto' and token_id is null
      and idempotency_key like $3 and confirmed_at is null`,
  [access.organizationId, access.ctx.user.id, `otto-workflow:${id}:%`]);
}
