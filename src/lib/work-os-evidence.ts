import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProviderAttribution } from "@/lib/work-os-attribution";

type Json = Record<string, unknown>;

export interface ProviderEvidenceInput {
  provider: string;
  externalWorkspaceIds: string[];
  externalEventId: string;
  externalActorId?: string | null;
  /** Alternate account identifiers for the actor (for example a GitHub login
   * when the primary id is numeric). Matched case-insensitively. */
  externalActorAliases?: string[];
  evidenceClass: "activity_observation" | "output_evidence" | "work_claim";
  title: string;
  summary?: string;
  artifactUrl?: string | null;
  occurredAt: string;
  explicitTaskProviderId?: string | null;
  metadata?: Json;
  raw: Json;
}

function db() {
  return createAdminClient();
}

export async function resolveProviderConnection(provider: string, externalWorkspaceIds: string[]) {
  const ids = [...new Set(externalWorkspaceIds.map(String).filter(Boolean))];
  if (!ids.length) throw new Error(`${provider} webhook does not identify a configured workspace`);
  const { data, error } = await db()
    .from("work_provider_connections")
    .select("*")
    .eq("provider", provider)
    .eq("active", true)
    .in("external_workspace_id", ids)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`resolve ${provider} Work OS connection: ${error.message}`);
  if (!data) throw new Error(`${provider} workspace is not connected to Work OS`);
  return data;
}

/** Resolves the provider account for an actor by numeric id first, then by
 * case-insensitive alias (a GitHub login), and returns the attribution
 * decision the shared policy produces for that account. */
async function resolveActorAttribution(organizationId: string, provider: string, externalActorId: string | null, aliases: string[]) {
  const exactId = externalActorId && externalActorId.trim() ? externalActorId.trim() : null;
  const candidates = [exactId, ...aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== exactId)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const query = db()
      .from("work_source_accounts")
      .select("person_id, verified, metadata")
      .eq("organization_id", organizationId)
      .eq("provider", provider);
    const { data: account, error: accountError } = await (candidate === exactId
      ? query.eq("external_account_id", candidate).maybeSingle()
      : query.ilike("external_account_id", candidate).maybeSingle());
    if (accountError) throw new Error(`resolve ${provider} actor: ${accountError.message}`);
    if (account) {
      return resolveProviderAttribution({
        personId: account.person_id as string | null,
        verified: account.verified as boolean | null,
        metadata: account.metadata as Record<string, unknown> | null,
      });
    }
  }
  return resolveProviderAttribution(null);
}

async function organizationOwnerId(organizationId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("work_organizations")
    .select("legacy_owner_id, created_by")
    .eq("id", organizationId)
    .single();
  if (error) throw new Error(`load evidence organization: ${error.message}`);
  return ((data.legacy_owner_id || data.created_by) as string | null) ?? null;
}

function mirrorRow(input: {
  ownerId: string | null;
  organizationId: string;
  personId: string;
  provider: string;
  eventId: string;
  taskId: string | null;
  title: string;
  summary: string;
  artifactUrl: string | null;
  evidenceClass: string;
  attributionMethod: string;
  attributionConfidence: number;
  occurredAt: string;
}): Json {
  return {
    user_id: input.ownerId,
    organization_id: input.organizationId,
    person_id: input.personId,
    task_id: input.taskId,
    evidence_event_id: input.eventId,
    evidence_date: input.occurredAt.slice(0, 10),
    source: input.provider,
    title: input.title,
    summary: input.summary,
    url: input.artifactUrl,
    metrics: {
      evidenceClass: input.evidenceClass,
      attributionMethod: input.attributionMethod,
      attributionConfidence: input.attributionConfidence,
    },
    raw: { evidenceEventId: input.eventId },
    updated_at: new Date().toISOString(),
  };
}

export async function ingestProviderEvidence(input: ProviderEvidenceInput) {
  const connection = await resolveProviderConnection(input.provider, input.externalWorkspaceIds);
  const organizationId = connection.organization_id as string;
  const requiredFeature = input.provider === "github" ? "github_evidence" : input.provider === "ghl" ? "ghl_evidence" : null;
  if (requiredFeature) {
    const { data: organization, error: featureError } = await db().from("work_organizations").select("feature_flags").eq("id", organizationId).single();
    if (featureError) throw new Error(`load ${input.provider} feature flags: ${featureError.message}`);
    if ((organization.feature_flags as Record<string, boolean> | null)?.[requiredFeature] !== true) {
      throw new Error(`${input.provider} evidence is not enabled for this organization`);
    }
  }
  const attribution = await resolveActorAttribution(
    organizationId,
    input.provider,
    input.externalActorId ?? null,
    input.externalActorAliases ?? [],
  );
  let personId = attribution.personId;
  if (personId) {
    const { data: person, error: personError } = await db()
      .from("work_people")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", personId)
      .maybeSingle();
    if (personError) throw new Error(`validate ${input.provider} actor organization: ${personError.message}`);
    if (!person) personId = null;
  }

  let taskId: string | null = null;
  if (input.explicitTaskProviderId) {
    const { data: task, error: taskError } = await db()
      .from("work_tasks")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", "nifty")
      .eq("provider_task_id", input.explicitTaskProviderId)
      .maybeSingle();
    if (taskError) throw new Error(`resolve evidence task: ${taskError.message}`);
    taskId = task?.id as string | null;
  }

  const { data: event, error: eventError } = await db()
    .from("work_evidence_events")
    .upsert({
      organization_id: organizationId,
      provider: input.provider,
      external_event_id: input.externalEventId,
      person_id: personId,
      task_id: taskId,
      evidence_class: input.evidenceClass,
      title: input.title,
      summary: input.summary ?? "",
      artifact_url: input.artifactUrl ?? null,
      attribution_method: attribution.method,
      attribution_confidence: attribution.confidence,
      occurred_at: input.occurredAt,
      metadata: input.metadata ?? {},
      raw: input.raw,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,provider,external_event_id" })
    .select("*")
    .single();
  if (eventError) throw new Error(`ingest ${input.provider} evidence: ${eventError.message}`);

  if (personId) {
    const ownerId = await organizationOwnerId(organizationId);
    const { error: mirrorError } = await db().from("work_evidence").upsert(mirrorRow({
      ownerId,
      organizationId,
      personId,
      provider: input.provider,
      eventId: String(event.id),
      taskId,
      title: input.title,
      summary: input.summary ?? "",
      artifactUrl: input.artifactUrl ?? null,
      evidenceClass: input.evidenceClass,
      attributionMethod: attribution.method,
      attributionConfidence: attribution.confidence,
      occurredAt: input.occurredAt,
    }), { onConflict: "evidence_event_id" });
    if (mirrorError) throw new Error(`mirror ${input.provider} evidence: ${mirrorError.message}`);
  }

  return { event, attributed: !!personId, connectionId: connection.id };
}

/** Attributes previously ingested but unattributed events for one provider
 * actor to a person, then mirrors them into evidence. Called when an admin
 * maps and verifies an account so setup-order never loses early evidence. */
export async function attributeProviderActor(input: {
  organizationId: string;
  provider: string;
  actorId?: string | null;
  actorLogin?: string | null;
  personId: string;
}): Promise<{ attributed: number }> {
  const queries: Array<Promise<{ data: unknown[] | null; error: { message: string } | null }>> = [];
  const base = () => db()
    .from("work_evidence_events")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("provider", input.provider)
    .is("person_id", null)
    .limit(500);
  const actorId = input.actorId?.trim();
  const actorLogin = input.actorLogin?.trim();
  if (actorId) queries.push(base().eq("metadata->>actor_id", actorId) as never);
  if (actorLogin) queries.push(base().eq("metadata->>actor_login", actorLogin) as never);
  if (!queries.length) return { attributed: 0 };
  const results = await Promise.all(queries);
  const byId = new Map<string, Json>();
  for (const result of results) {
    if (result.error) throw new Error(`load unattributed ${input.provider} evidence: ${result.error.message}`);
    for (const row of (result.data ?? []) as Json[]) byId.set(String(row.id), row);
  }
  const events = [...byId.values()];
  if (!events.length) return { attributed: 0 };

  const { error: updateError } = await db()
    .from("work_evidence_events")
    .update({
      person_id: input.personId,
      attribution_method: "verified_provider_account",
      attribution_confidence: 1,
      updated_at: new Date().toISOString(),
    })
    .in("id", events.map((row) => String(row.id)));
  if (updateError) throw new Error(`attribute ${input.provider} evidence: ${updateError.message}`);

  const ownerId = await organizationOwnerId(input.organizationId);
  const rows = events.map((row) => mirrorRow({
    ownerId,
    organizationId: input.organizationId,
    personId: input.personId,
    provider: input.provider,
    eventId: String(row.id),
    taskId: row.task_id ? String(row.task_id) : null,
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    artifactUrl: row.artifact_url ? String(row.artifact_url) : null,
    evidenceClass: String(row.evidence_class ?? "output_evidence"),
    attributionMethod: "verified_provider_account",
    attributionConfidence: 1,
    occurredAt: new Date(String(row.occurred_at ?? new Date().toISOString())).toISOString(),
  }));
  const { error: mirrorError } = await db().from("work_evidence").upsert(rows, { onConflict: "evidence_event_id" });
  if (mirrorError) throw new Error(`mirror attributed ${input.provider} evidence: ${mirrorError.message}`);
  return { attributed: rows.length };
}
