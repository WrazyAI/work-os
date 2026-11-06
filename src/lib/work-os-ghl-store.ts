import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { decryptProviderSecret } from "@/lib/work-os-secrets";
import {
  canAccessWorkOsPerson,
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import type { GhlIdentity, GhlRecord, GhlRelation, GhlScope } from "./work-os-ghl-types";

type Json = Record<string, any>;

const SECRET_KEY_PATTERN = /token|secret|api[_-]?key|password|credential|cipher/i;

export function ghlMappingRevision(identities: GhlIdentity[]): string {
  const canonical = [...identities]
    .sort((left, right) => left.externalId.localeCompare(right.externalId))
    .map((identity) => ({
      id: identity.externalId,
      person: identity.personId,
      verified: identity.verified,
      shared: identity.shared,
      revision: identity.revision,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function loadGhlIdentities(scope: GhlScope): Promise<GhlIdentity[]> {
  const rows = await getPool().query(
    `select external_account_id, person_id, verified, metadata
       from work_source_accounts
      where organization_id = $1 and provider = 'ghl'
      order by external_account_id`,
    [scope.organizationId],
  );
  return (rows.rows as Json[]).map((row) => ({
    externalId: String(row.external_account_id),
    personId: row.person_id ? String(row.person_id) : null,
    verified: row.verified === true,
    shared: (row.metadata as Json | null)?.shared === true,
    revision: String((row.metadata as Json | null)?.revision ?? ""),
  }));
}

export async function loadGhlCredential(scope: GhlScope): Promise<string> {
  const connection = await getPool().query(
    `select id, active from work_provider_connections
      where id = $1 and organization_id = $2 and provider = 'ghl' and external_workspace_id = $3`,
    [scope.connectionId, scope.organizationId, scope.locationId],
  );
  const row = connection.rows[0] as Json | undefined;
  if (!row) throw new Error("GHL connection is not connected for this organization");
  if (row.active !== true) throw new Error("GHL connection is not active");
  const credentials = await getPool().query(
    "select access_token_cipher from work_provider_credentials where organization_id = $1 and provider = 'ghl'",
    [scope.organizationId],
  );
  const cipher = (credentials.rows[0] as Json | undefined)?.access_token_cipher;
  if (!cipher) throw new Error("GHL credential is not configured");
  return decryptProviderSecret(String(cipher));
}

/** Strips any secret-shaped key from provider connection config before it is
 * persisted or returned to a client. */
export function redactProviderConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProviderConfig);
  if (!value || typeof value !== "object") return value;
  const output: Json = {};
  for (const [key, nested] of Object.entries(value as Json)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = redactProviderConfig(nested);
  }
  return output;
}

function relationFor(record: GhlRecord, identities: GhlIdentity[]): { relation: GhlRelation; personId: string | null; basis: string } {
  if (record.relation === "automation") return { relation: "automation", personId: null, basis: record.basis };
  if (record.relation === "assigned_only") return { relation: "assigned_only", personId: null, basis: record.basis };
  if (record.relation === "shared_account") return { relation: "shared_account", personId: null, basis: record.basis };
  if (record.relation !== "performed") return { relation: "unknown", personId: null, basis: record.basis };
  const identity = identities.find((item) => item.externalId === record.actorId);
  if (!identity) return { relation: "unknown", personId: null, basis: "No mapped provider identity for the acting user." };
  if (identity.shared) return { relation: "shared_account", personId: null, basis: "Acting identity is a shared account." };
  if (!identity.verified || !identity.personId) return { relation: "unknown", personId: null, basis: "Acting identity is not a verified employee mapping." };
  return { relation: "performed", personId: identity.personId, basis: "Verified employee identity and a manual source." };
}

type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

async function organizationOwner(scope: GhlScope, db: QueryClient): Promise<string | null> {
  const result = await db.query(
    "select legacy_owner_id, created_by from work_organizations where id = $1",
    [scope.organizationId],
  );
  const row = result.rows[0] as Json | undefined;
  return (row?.legacy_owner_id || row?.created_by || null) as string | null;
}

function eventMetadata(scope: GhlScope, record: GhlRecord, relation: GhlRelation, basis: string): Json {
  return {
    actor: { id: record.actorId, login: null },
    ghl: {
      kind: record.kind,
      action: record.action,
      objectId: record.objectId,
      actorId: record.actorId,
      relation,
      basis,
      source: record.source,
      sourceUrl: record.sourceUrl,
      conversationId: record.conversationId,
      emailId: record.emailId,
      status: record.status,
      durationSeconds: record.durationSeconds,
      assigneeIds: record.assigneeIds,
      occurredAt: record.occurredAt,
      observedAt: record.observedAt,
      snapshot: record.snapshot,
      connectionId: scope.connectionId,
      locationId: scope.locationId,
    },
  };
}

function mirrorMetrics(record: GhlRecord, relation: GhlRelation): Json {
  return {
    evidenceClass: record.snapshot ? "activity_observation" : "output_evidence",
    attributionMethod: relation === "performed" ? "verified_provider_account" : "unattributed",
    attributionConfidence: relation === "performed" ? 1 : 0,
    relation,
  };
}

async function upsertEvent(db: QueryClient, input: {
  scope: GhlScope;
  record: GhlRecord;
  relation: GhlRelation;
  personId: string | null;
  basis: string;
}): Promise<{ id: string; summary: string; correctionStatus: string }> {
  const { scope, record, relation, personId, basis } = input;
  const occurredAt = record.occurredAt ?? record.observedAt;
  const evidenceClass = record.snapshot ? "activity_observation" : "output_evidence";
  const result = await db.query(
    `insert into work_evidence_events
      (organization_id, provider, external_event_id, event_type, evidence_class, person_id,
       attribution_method, attribution_confidence, occurred_at, title, summary, metadata, raw)
     values ($1,'ghl',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb)
     on conflict (organization_id, provider, external_event_id) do update set
       event_type = excluded.event_type,
       evidence_class = excluded.evidence_class,
       person_id = excluded.person_id,
       attribution_method = excluded.attribution_method,
       attribution_confidence = excluded.attribution_confidence,
       occurred_at = excluded.occurred_at,
       title = excluded.title,
       summary = case when work_evidence_events.correction_status = 'original' then excluded.summary else work_evidence_events.summary end,
       metadata = excluded.metadata,
       raw = '{}'::jsonb,
       updated_at = now()
     returning id, summary, correction_status`,
    [
      scope.organizationId,
      record.key,
      `${record.kind}.${record.action}`,
      evidenceClass,
      personId,
      personId ? "verified_provider_account" : "unattributed",
      personId ? 1 : 0,
      occurredAt,
      record.title.slice(0, 240),
      record.summary.slice(0, 2_000),
      JSON.stringify(eventMetadata(scope, record, relation, basis)),
    ],
  );
  const saved = result.rows[0] as Json;
  return { id: String(saved.id), summary: String(saved.summary ?? ""), correctionStatus: String(saved.correction_status ?? "original") };
}

async function mirrorPersonEvent(db: QueryClient, input: {
  scope: GhlScope;
  eventId: string;
  record: GhlRecord;
  personId: string;
  relation: GhlRelation;
  summary: string;
}): Promise<void> {
  const { scope, eventId, record, personId, relation, summary } = input;
  const ownerId = await organizationOwner(scope, db);
  const occurredAt = record.occurredAt ?? record.observedAt;
  await db.query(
    `insert into work_evidence
      (user_id, organization_id, person_id, evidence_event_id, evidence_date, source, title, summary, url, metrics, raw, updated_at)
     values ($1,$2,$3,$4,$5,'ghl',$6,$7,$8,$9,$10,now())
     on conflict (evidence_event_id) do update set
       person_id = excluded.person_id,
       evidence_date = excluded.evidence_date,
       title = excluded.title,
       summary = excluded.summary,
       url = excluded.url,
       metrics = excluded.metrics,
       updated_at = now()`,
    [
      ownerId,
      scope.organizationId,
      personId,
      eventId,
      new Date(occurredAt).toISOString().slice(0, 10),
      record.title.slice(0, 240),
      summary.slice(0, 2_000),
      record.sourceUrl,
      JSON.stringify(mirrorMetrics(record, relation)),
      JSON.stringify({ evidenceEventId: eventId }),
    ],
  );
}

async function removeMirror(db: QueryClient, scope: GhlScope, eventId: string): Promise<void> {
  await db.query(
    "delete from work_evidence where organization_id = $1 and evidence_event_id = $2 and source = 'ghl'",
    [scope.organizationId, eventId],
  );
}

export async function persistGhlRecords(
  scope: GhlScope,
  records: GhlRecord[],
  expectedMappingRevision: string,
): Promise<{ written: number; rejectedStaleMapping: boolean }> {
  const identities = await loadGhlIdentities(scope);
  if (ghlMappingRevision(identities) !== expectedMappingRevision) {
    return { written: 0, rejectedStaleMapping: true };
  }
  const client = await getPool().connect();
  let written = 0;
  try {
    await client.query("begin");
    for (const record of records) {
      const decision = relationFor(record, identities);
      if (decision.personId) {
        const person = await client.query(
          "select id from work_people where id = $1 and organization_id = $2",
          [decision.personId, scope.organizationId],
        );
        if (!person.rows.length) {
          decision.relation = "unknown";
          decision.personId = null;
          decision.basis = "Mapped person is not an active member of this organization.";
        }
      }
      const event = await upsertEvent(client, { scope, record, relation: decision.relation, personId: decision.personId, basis: decision.basis });
      if (decision.personId) {
        await mirrorPersonEvent(client, {
          scope,
          eventId: event.id,
          record,
          personId: decision.personId,
          relation: decision.relation,
          summary: event.correctionStatus === "original" ? record.summary : event.summary,
        });
      } else {
        await removeMirror(client, scope, event.id);
      }
      written += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return { written, rejectedStaleMapping: false };
}

/** Re-evaluates stored events for one actor after a mapping change. Performed
 * work can be retracted; previously unknown work can become attributed. Shared,
 * automation and assigned-only records are never silently upgraded. */
export async function reconcileGhlAttribution(scope: GhlScope, actorId: string): Promise<{ attributed: number; retracted: number }> {
  const identities = await loadGhlIdentities(scope);
  const identity = identities.find((item) => item.externalId === actorId);
  const events = await getPool().query(
    `select id, person_id, metadata, title, summary, artifact_url, occurred_at
       from work_evidence_events
      where organization_id = $1 and provider = 'ghl' and metadata->'actor'->>'id' = $2`,
    [scope.organizationId, actorId],
  );
  let attributed = 0;
  let retracted = 0;
  for (const row of events.rows as Json[]) {
    const ghl = (row.metadata as Json).ghl ?? {};
    const previous = String(ghl.relation ?? "unknown") as GhlRelation;
    let relation: GhlRelation;
    let personId: string | null = null;
    if (previous === "automation" || previous === "assigned_only" || previous === "shared_account") {
      relation = previous;
    } else if (identity && identity.verified && identity.personId && !identity.shared) {
      relation = "performed";
      personId = identity.personId;
    } else if (identity?.shared) {
      relation = "shared_account";
    } else {
      relation = "unknown";
    }
    const changedPerson = (row.person_id ?? null) !== personId;
    const changedRelation = previous !== relation;
    if (!changedPerson && !changedRelation) continue;
    await getPool().query(
      `update work_evidence_events
          set person_id = $1, attribution_method = $2, attribution_confidence = $3,
              metadata = jsonb_set(metadata, '{ghl,relation}', to_jsonb($4::text), true),
              updated_at = now()
        where id = $5`,
      [personId, personId ? "verified_provider_account" : "unattributed", personId ? 1 : 0, relation, row.id],
    );
    if (personId) {
      await mirrorPersonEvent(getPool(), {
        scope,
        eventId: String(row.id),
        record: {
          key: String(row.id),
          kind: String(ghl.kind ?? "note") as GhlRecord["kind"],
          objectId: String(ghl.objectId ?? ""),
          action: String(ghl.action ?? ""),
          actorId,
          assigneeIds: Array.isArray(ghl.assigneeIds) ? ghl.assigneeIds : [],
          relation,
          occurredAt: ghl.occurredAt ?? null,
          updatedAt: null,
          observedAt: String(ghl.observedAt ?? new Date(row.occurred_at).toISOString()),
          title: String(row.title ?? ""),
          summary: String(row.summary ?? ""),
          source: ghl.source ?? null,
          sourceUrl: row.artifact_url ?? null,
          conversationId: ghl.conversationId ?? null,
          emailId: ghl.emailId ?? null,
          status: ghl.status ?? null,
          durationSeconds: ghl.durationSeconds ?? null,
          basis: String(ghl.basis ?? ""),
          snapshot: ghl.snapshot === true,
        },
        personId,
        relation,
        summary: String(row.summary ?? ""),
      });
      attributed += 1;
    } else {
      await removeMirror(getPool(), scope, String(row.id));
      retracted += 1;
    }
  }
  return { attributed, retracted };
}

export async function requireGhlEvidenceAccess(access: WorkOsAccess, eventId: string): Promise<{
  scope: GhlScope;
  record: GhlRecord;
  personId: string | null;
  event: Json;
}> {
  const result = await getPool().query(
    `select * from work_evidence_events
      where organization_id = $1 and provider = 'ghl' and id = $2`,
    [access.organizationId, eventId],
  );
  const event = result.rows[0] as Json | undefined;
  if (!event) throw new WorkOsNotFoundError("Evidence not found");
  const personId = event.person_id ? String(event.person_id) : null;
  if (access.role !== "admin") {
    if (!personId) throw new WorkOsForbiddenError("Shared GHL evidence is visible to workspace administrators only");
    if (!(await canAccessWorkOsPerson(access, personId))) {
      throw new WorkOsForbiddenError("You do not have access to this employee's evidence");
    }
  }
  const ghl = (event.metadata as Json)?.ghl ?? {};
  const connection = await getPool().query(
    `select id, external_workspace_id from work_provider_connections
      where organization_id = $1 and provider = 'ghl' and active = true
      order by updated_at desc limit 1`,
    [access.organizationId],
  );
  const connectionRow = connection.rows[0] as Json | undefined;
  if (!connectionRow) throw new WorkOsNotFoundError("GHL connection not found");
  const scope: GhlScope = {
    organizationId: access.organizationId,
    connectionId: String(connectionRow.id),
    locationId: String(ghl.locationId ?? connectionRow.external_workspace_id),
  };
  const record: GhlRecord = {
    key: String(event.external_event_id),
    kind: String(ghl.kind ?? "note") as GhlRecord["kind"],
    objectId: String(ghl.objectId ?? ""),
    action: String(ghl.action ?? ""),
    actorId: ghl.actorId ?? (event.metadata as Json)?.actor?.id ?? null,
    assigneeIds: Array.isArray(ghl.assigneeIds) ? ghl.assigneeIds.map(String) : [],
    relation: String(ghl.relation ?? "unknown") as GhlRelation,
    occurredAt: ghl.occurredAt ?? null,
    updatedAt: null,
    observedAt: String(ghl.observedAt ?? new Date(event.occurred_at).toISOString()),
    title: String(event.title ?? ""),
    summary: String(event.summary ?? ""),
    source: ghl.source ?? null,
    sourceUrl: event.artifact_url ? String(event.artifact_url) : null,
    conversationId: ghl.conversationId ?? null,
    emailId: ghl.emailId ?? null,
    status: ghl.status ?? null,
    durationSeconds: ghl.durationSeconds ?? null,
    basis: String(ghl.basis ?? ""),
    snapshot: ghl.snapshot === true,
  };
  return { scope, record, personId, event };
}

/** Applies a correction. Unknown/shared GHL evidence is administratively
 * correctable without manufacturing a person mapping; attributed evidence keeps
 * the existing person/team access rules. */
export async function correctGhlEvidence(
  access: WorkOsAccess,
  eventId: string,
  input: { status: string; summary?: string; reason?: string },
): Promise<Json> {
  const { event, personId } = await requireGhlEvidenceAccess(access, eventId).catch((error) => {
    if (error instanceof WorkOsForbiddenError && access.role !== "admin") throw error;
    throw error;
  });
  const allowed = access.role === "employee" ? ["disputed"] : ["disputed", "corrected", "retracted"];
  if (!allowed.includes(input.status)) throw new WorkOsValidationError(`correction_status must be ${allowed.join(" or ")}`);
  if (!personId && access.role !== "admin") throw new WorkOsForbiddenError("Only an administrator can correct shared GHL evidence");
  if (input.status === "corrected" && !(input.summary ?? "").trim()) {
    throw new WorkOsValidationError("summary is required for corrected evidence");
  }
  const summary = (input.summary ?? "").trim() || String(event.summary ?? "");
  const updated = await getPool().query(
    `update work_evidence_events
        set correction_status = $1, summary = $2, corrected_by = $3, corrected_at = now(), updated_at = now()
      where id = $4 and organization_id = $5 and provider = 'ghl'
      returning *`,
    [input.status, summary, access.ctx.user.id, eventId, access.organizationId],
  );
  const row = updated.rows[0] as Json;
  if (personId) {
    await getPool().query(
      `update work_evidence set summary = $1, updated_at = now() where organization_id = $2 and evidence_event_id = $3`,
      [summary, access.organizationId, eventId],
    );
  }
  await getPool().query(
    `insert into work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
     values ($1,$2,$3,'evidence_event',$4,$5)`,
    [
      access.organizationId,
      access.ctx.user.id,
      `evidence.${input.status}`,
      eventId,
      JSON.stringify({ reason: input.reason?.trim() || null, personAttributed: Boolean(personId) }),
    ],
  );
  return row;
}
