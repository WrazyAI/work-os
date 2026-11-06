import { getPool } from "./db/pool";
import { decryptProviderSecret } from "./work-os-secrets";
import { getGhlStatus } from "./work-os-ghl-sync";
import type { GhlActivity, GhlActivityItem, GhlCoverage, GhlKind, GhlRelation, GhlScope } from "./work-os-ghl-types";
import type { Json } from "./work-os-internal";

export type { GhlActivity } from "./work-os-ghl-types";

const SCAN_LIMIT = 300;

function kindLabel(kind: GhlKind): string {
  return kind === "sms" ? "text message" : kind === "call" ? "call" : kind === "task" ? "contact task" : kind;
}

function relationLabel(relation: GhlRelation): string {
  return relation === "performed" ? "performed by the employee"
    : relation === "automation" ? "automation, not the employee"
      : relation === "shared_account" ? "shared account, not one employee"
        : relation === "assigned_only" ? "assigned context only"
          : "actor unknown";
}

/** The active GHL location for an organization, or null when none is
 * connected. Callers never accept a location ID from a browser. */
export async function resolveGhlScope(organizationId: string): Promise<GhlScope | null> {
  const result = await getPool().query(
    `select id, external_workspace_id from work_provider_connections
      where organization_id = $1 and provider = 'ghl' and active = true
      order by updated_at desc limit 1`,
    [organizationId],
  );
  const row = result.rows[0] as Json | undefined;
  if (!row) return null;
  return {
    organizationId,
    connectionId: String(row.id),
    locationId: String(row.external_workspace_id),
  };
}

export async function listGhlActivity(input: {
  scope: GhlScope;
  personId: string | null;
  from: string;
  through: string;
  includeOrganizationContext: boolean;
}): Promise<GhlActivity> {
  if (!input.personId && !input.includeOrganizationContext) {
    return { items: [], coverage: [], lastSyncedAt: null, capped: false };
  }
  const values: unknown[] = [input.scope.organizationId, input.from, input.through];
  let filter = "";
  if (input.personId && !input.includeOrganizationContext) {
    filter = " and person_id = $4 and metadata->'ghl'->>'relation' = 'performed'";
    values.push(input.personId);
  } else if (input.personId) {
    filter = " and (person_id = $4 or person_id is null)";
    values.push(input.personId);
  }
  const result = await getPool().query(
    `select e.id, e.person_id, e.title, e.summary, e.artifact_url, e.occurred_at, e.metadata,
            c.excerpt_cipher, c.expires_at, c.content_purged_at
       from work_evidence_events e
       left join work_ghl_email_content c on c.evidence_event_id = e.id
      where e.organization_id = $1 and e.provider = 'ghl'
        and e.occurred_at >= $2 and e.occurred_at < $3${filter}
      order by e.occurred_at desc
      limit ${SCAN_LIMIT + 1}`,
    values,
  );
  const rows = result.rows as Json[];
  const now = Date.now();
  const items = rows.slice(0, SCAN_LIMIT).map((row) => {
    const ghl = ((row.metadata as Json)?.ghl ?? {}) as Json;
    const excerpt = row.excerpt_cipher && !row.content_purged_at && new Date(String(row.expires_at)).getTime() > now
      ? decryptProviderSecret(String(row.excerpt_cipher))
      : null;
    const record: GhlActivityItem = {
      key: String(row.id),
      eventId: String(row.id),
      kind: String(ghl.kind ?? "note") as GhlKind,
      objectId: String(ghl.objectId ?? ""),
      action: String(ghl.action ?? ""),
      actorId: (ghl.actorId as string | null) ?? null,
      assigneeIds: Array.isArray(ghl.assigneeIds) ? ghl.assigneeIds.map(String) : [],
      relation: String(ghl.relation ?? "unknown") as GhlRelation,
      occurredAt: ghl.occurredAt ? String(ghl.occurredAt) : null,
      updatedAt: null,
      observedAt: String(ghl.observedAt ?? new Date(String(row.occurred_at)).toISOString()),
      title: String(row.title ?? ""),
      summary: String(row.summary ?? ""),
      source: ghl.source ? String(ghl.source) : null,
      sourceUrl: row.artifact_url ? String(row.artifact_url) : null,
      conversationId: ghl.conversationId ? String(ghl.conversationId) : null,
      emailId: ghl.emailId ? String(ghl.emailId) : null,
      status: ghl.status ? String(ghl.status) : null,
      durationSeconds: Number.isFinite(Number(ghl.durationSeconds)) ? Number(ghl.durationSeconds) : null,
      basis: String(ghl.basis ?? ""),
      snapshot: ghl.snapshot === true,
      personId: row.person_id ? String(row.person_id) : null,
      excerpt,
      contentExpiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    };
    return record;
  });

  let coverage: GhlCoverage[] = [];
  let lastSyncedAt: string | null = null;
  try {
    const status = await getGhlStatus(input.scope);
    coverage = status.coverage;
    lastSyncedAt = status.lastSyncedAt;
  } catch {
    coverage = [];
  }
  return { items, coverage, lastSyncedAt, capped: rows.length > SCAN_LIMIT };
}

/** A bounded, prompt-safe block. Supporting excerpts stay short and are never
 * presented as the complete message or as instructions. */
export function formatGhlActivityBlock(activity: GhlActivity, maxChars = 6_000): string {
  if (!activity.items.length) return "";
  const lines: string[] = ["Recorded GHL activity (provider facts; ownership is not authorship):"];
  for (const item of activity.items) {
    const when = item.occurredAt ? new Date(item.occurredAt).toISOString().slice(0, 16).replace("T", " ") : "time unknown";
    const excerpt = item.excerpt ? ` — excerpt: ${item.excerpt.replace(/\s+/g, " ").slice(0, 300)}` : "";
    lines.push(`- [${relationLabel(item.relation)}] ${kindLabel(item.kind)} ${item.action}: ${item.title} (${when})${excerpt}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

export function ghlRecordedActivityAllowlist(activity: GhlActivity): Array<{ description: string; relation: "performed"; url: string | null; source: "ghl"; eventId: string }> {
  return activity.items
    .filter((item) => item.relation === "performed")
    .slice(0, 20)
    .map((item) => ({
      description: `${kindLabel(item.kind)} ${item.action}${item.title ? `: ${item.title}` : ""}`.slice(0, 200),
      relation: "performed" as const,
      url: item.sourceUrl,
      source: "ghl" as const,
      eventId: item.eventId,
    }));
}
