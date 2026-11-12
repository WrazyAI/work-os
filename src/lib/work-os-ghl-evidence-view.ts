import type { WorkOsAccess } from "@/lib/work-os-api";

type Json = Record<string, any>;

const APPROVED_HOSTS = new Set(["app.gohighlevel.com", "gohighlevel.com", "www.gohighlevel.com"]);

/** Only an organization administrator sees location-only shared/automation
 * records. Managers and employees keep their existing person/team scope. */
export function canViewGhlOrganizationContext(access: Pick<WorkOsAccess, "role">): boolean {
  return access.role === "admin";
}

/** A source link is rendered only when it is a validated HTTPS GHL host. A
 * provider record with no validated link stays link-free rather than inventing
 * an exact-message URL. */
export function isApprovedGhlSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (APPROVED_HOSTS.has(url.hostname) || url.hostname.endsWith(".gohighlevel.com"));
  } catch {
    return false;
  }
}

const RELATION_LABELS: Record<string, string> = {
  performed: "Performed by mapped employee",
  automation: "Automation — not the employee",
  shared_account: "Shared account — not one employee",
  assigned_only: "Assigned contact only — actor unknown",
  unknown: "Actor unknown",
};

/** Projects one raw GHL event into the existing Evidence row shape. It never
 * includes credentials, raw provider payloads, or message bodies. */
export function ghlEvidenceRow(row: Json, actorPerson?: { id: string; displayName: string } | null): Json {
  const metadata = (row.metadata ?? {}) as Json;
  const ghl = (metadata.ghl ?? {}) as Json;
  const relation = String(ghl.relation ?? "unknown");
  const safeGhl = {
    kind: ghl.kind,
    action: ghl.action,
    relation,
    actorId: ghl.actorId ?? (metadata.actor as Json | undefined)?.id ?? null,
    assigneeIds: Array.isArray(ghl.assigneeIds) ? ghl.assigneeIds : [],
    source: ghl.source ?? null,
    conversationId: ghl.conversationId ?? null,
    emailId: ghl.emailId ?? null,
    status: ghl.status ?? null,
    durationSeconds: ghl.durationSeconds ?? null,
    occurredAt: ghl.occurredAt ?? null,
    observedAt: ghl.observedAt ?? null,
    snapshot: ghl.snapshot === true,
  };
  return {
    id: String(row.id),
    person_id: row.person_id ?? null,
    task_id: null,
    evidence_date: new Date(String(row.occurred_at)).toISOString().slice(0, 10),
    source: "ghl",
    title: String(row.title ?? "GHL evidence"),
    summary: String(row.summary ?? ""),
    url: null,
    metrics: { relation, evidenceClass: row.evidence_class },
    created_at: row.occurred_at,
    person: null,
    task: null,
    event: {
      correction_status: row.correction_status,
      evidence_class: row.evidence_class,
      metadata: { actor: { id: safeGhl.actorId, login: null }, ghl: safeGhl },
      screenshot: null,
    },
    ghl: {
      eventId: String(row.id),
      relation,
      // The record's own classification decides what the action was; a mapped
      // account names the person. Naming them is not a hedge: a verified
      // mapping is the workspace's answer to "whose account is this".
      actorLabel: actorPerson
        ? (relation === "automation"
          ? `Automation — ${actorPerson.displayName}`
          : relation === "shared_account"
            ? `Shared account — ${actorPerson.displayName}`
            : actorPerson.displayName)
        : RELATION_LABELS[relation] ?? RELATION_LABELS.unknown,
      assigneeLabels: [],
      contentAvailability: ghl.emailId ? "on_demand" : "metadata_only",
      coverage: ghl.snapshot ? "contextual_snapshot" : "recorded_action",
    },
  };
}
