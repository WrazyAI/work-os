import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProviderAttribution } from "@/lib/work-os-attribution";

type Json = Record<string, unknown>;

export interface ProviderEvidenceInput {
  provider: string;
  externalWorkspaceIds: string[];
  externalEventId: string;
  externalActorId?: string | null;
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
  let attribution = resolveProviderAttribution(null);
  if (input.externalActorId) {
    const { data: account, error: accountError } = await db()
      .from("work_source_accounts")
      .select("person_id, verified, metadata")
      .eq("organization_id", organizationId)
      .eq("provider", input.provider)
      .eq("external_account_id", input.externalActorId)
      .maybeSingle();
    if (accountError) throw new Error(`resolve ${input.provider} actor: ${accountError.message}`);
    attribution = resolveProviderAttribution(account ? {
      personId: account.person_id as string | null,
      verified: account.verified as boolean | null,
      metadata: account.metadata as Record<string, unknown> | null,
    } : null);
  }
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
    const { data: organization, error: organizationError } = await db()
      .from("work_organizations")
      .select("legacy_owner_id, created_by")
      .eq("id", organizationId)
      .single();
    if (organizationError) throw new Error(`load evidence organization: ${organizationError.message}`);
    const ownerId = organization.legacy_owner_id || organization.created_by;
    const { error: mirrorError } = await db().from("work_evidence").upsert({
      user_id: ownerId,
      organization_id: organizationId,
      person_id: personId,
      task_id: taskId,
      evidence_event_id: event.id,
      evidence_date: input.occurredAt.slice(0, 10),
      source: input.provider,
      title: input.title,
      summary: input.summary ?? "",
      url: input.artifactUrl ?? null,
      metrics: {
        evidenceClass: input.evidenceClass,
        attributionMethod: attribution.method,
        attributionConfidence: attribution.confidence,
      },
      raw: { evidenceEventId: event.id },
      updated_at: new Date().toISOString(),
    }, { onConflict: "evidence_event_id" });
    if (mirrorError) throw new Error(`mirror ${input.provider} evidence: ${mirrorError.message}`);
  }

  return { event, attributed: !!personId, connectionId: connection.id };
}
