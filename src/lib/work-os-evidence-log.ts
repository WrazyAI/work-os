import { todayIso as today } from "@/lib/work-os-dates";
import {
  dateOnly,
  db,
  ensureNoError,
  nonEmptyString,
  selectFirst,
  type Json,
} from "@/lib/work-os-internal";
import { getTaskByLocalOrProviderId } from "@/lib/work-os-tasks";

export async function listEvidence(userId: string, opts: { personId?: string | null; taskId?: string | null; date?: string | null } = {}) {
  let query = db()
    .from("work_evidence")
    .select("*, person:work_people(id, display_name), task:work_tasks(id, title), event:work_evidence_events(correction_status,evidence_class)")
    .eq("user_id", userId)
    .order("evidence_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.personId) query = query.eq("person_id", opts.personId);
  if (opts.taskId) query = query.eq("task_id", opts.taskId);
  if (opts.date) query = query.eq("evidence_date", opts.date);
  return ensureNoError(query, "load evidence");
}

async function resolveEvidenceScope(userId: string, body: Json, requestedOrganizationId?: string | null) {
  const suppliedOrganizationId = nonEmptyString(requestedOrganizationId) ?? nonEmptyString(body.organization_id);
  const taskId = nonEmptyString(body.task_id);
  const personId = nonEmptyString(body.person_id);
  let task: Json | null = null;
  let person: Json | null = null;

  if (taskId) {
    if (suppliedOrganizationId) {
      task = await ensureNoError(
        db().from("work_tasks").select("*").eq("organization_id", suppliedOrganizationId).eq("id", taskId).maybeSingle(),
        "load evidence task",
      ) as Json | null;
      if (!task) {
        task = await ensureNoError(
          db().from("work_tasks").select("*").eq("organization_id", suppliedOrganizationId).eq("provider_task_id", taskId).maybeSingle(),
          "load evidence task",
        ) as Json | null;
      }
      if (!task) throw new Error("task must belong to the evidence organization");
    } else {
      task = await getTaskByLocalOrProviderId(userId, taskId);
    }
  }

  let organizationId = suppliedOrganizationId ?? (task?.organization_id as string | null | undefined) ?? null;
  if (personId) {
    let personQuery = db().from("work_people").select("id,organization_id").eq("id", personId);
    if (organizationId) personQuery = personQuery.eq("organization_id", organizationId);
    else personQuery = personQuery.eq("user_id", userId);
    person = await ensureNoError(personQuery.maybeSingle(), "load evidence person") as Json | null;
    if (!person) throw new Error("person must belong to the evidence organization");
    if (organizationId && person.organization_id !== organizationId) throw new Error("person must belong to the evidence organization");
    organizationId = person.organization_id as string;
  }
  if (task && organizationId && task.organization_id !== organizationId) throw new Error("task must belong to the evidence organization");

  if (!organizationId) {
    const organization = await ensureNoError(
      db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle(),
      "load evidence organization",
    ) as Json | null;
    if (!organization) throw new Error("Work OS organization is required before creating evidence");
    organizationId = organization.id as string;
  }

  const organization = await ensureNoError(
    db().from("work_organizations").select("id,legacy_owner_id,created_by").eq("id", organizationId).single(),
    "load evidence organization",
  ) as Json;
  return {
    organizationId,
    ownerId: (organization.legacy_owner_id || organization.created_by || userId) as string,
    task,
    person,
  };
}

export async function createEvidence(userId: string, body: Json, requestedOrganizationId?: string | null) {
  const scope = await resolveEvidenceScope(userId, body, requestedOrganizationId);
  const idempotencyKey = nonEmptyString(body.idempotency_key) ?? nonEmptyString(body.client_request_id);
  if (idempotencyKey) {
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", scope.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "load idempotent evidence",
    );
    if (existing) return existing;
  }
  const payload = {
    user_id: scope.ownerId,
    organization_id: scope.organizationId,
    person_id: scope.person?.id ?? null,
    task_id: scope.task?.id ?? null,
    evidence_date: dateOnly(nonEmptyString(body.evidence_date)) ?? today(),
    source: nonEmptyString(body.source) ?? "manual",
    title: nonEmptyString(body.title) ?? "Manual evidence",
    summary: nonEmptyString(body.summary) ?? "",
    url: nonEmptyString(body.url),
    metrics: typeof body.metrics === "object" && body.metrics ? body.metrics : {},
    idempotency_key: idempotencyKey,
    raw: typeof body.raw === "object" && body.raw ? body.raw : {},
  };
  try {
    return await selectFirst(db().from("work_evidence").insert(payload).select("*"), "create evidence");
  } catch (error) {
    if (!idempotencyKey) throw error;
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", scope.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "reconcile idempotent evidence",
    );
    if (existing) return existing;
    throw error;
  }
}
