import type { GhlCoverage, GhlIdentity, GhlKind, GhlRecord, GhlRelation, GhlScope } from "./work-os-ghl-types";

interface NormalizeContext {
  scope: GhlScope;
  identities: GhlIdentity[];
  observedAt: string;
}

type Json = Record<string, any>;

const AUTOMATION_SOURCES = new Set(["workflow", "bulk_actions", "campaign"]);

function text(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Only an ISO instant or epoch millisecond value becomes an instant. Invalid
 * input stays null so observation time is never presented as occurrence time. */
function instant(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const raw = text(value, 60);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function positiveDuration(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function identityFor(context: NormalizeContext, actorId: string | null): GhlIdentity | null {
  if (!actorId) return null;
  return context.identities.find((identity) => identity.externalId === actorId) ?? null;
}

/** Classifies who performed the action. Only a verified, unambiguous,
 * individually-owned identity authorizes `performed`. */
function humanRelation(context: NormalizeContext, actorId: string | null, source: string | null): { relation: GhlRelation; basis: string } {
  if (source && AUTOMATION_SOURCES.has(source)) return { relation: "automation", basis: `Automation source ${source}.` };
  const identity = identityFor(context, actorId);
  if (!identity) return { relation: "unknown", basis: "No mapped provider identity for the acting user." };
  if (identity.shared) return { relation: "shared_account", basis: "Acting identity is a shared account." };
  if (!identity.verified || !identity.personId) return { relation: "unknown", basis: "Acting identity is not a verified employee mapping." };
  return { relation: "performed", basis: "Verified employee identity and a manual source." };
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => text(value, 120)).filter(Boolean))];
}

function base(kind: GhlKind, objectId: string, action: string, context: NormalizeContext, input: {
  actorId?: string | null;
  assigneeIds?: string[];
  relation: GhlRelation;
  basis: string;
  occurredAt: string | null;
  updatedAt?: string | null;
  title: string;
  summary: string;
  source?: string | null;
  conversationId?: string | null;
  emailId?: string | null;
  status?: string | null;
  durationSeconds?: number | null;
  snapshot: boolean;
  keySuffix?: string;
}): GhlRecord {
  return {
    key: `${kind}:${objectId}:${action}${input.keySuffix ? `:${input.keySuffix}` : ""}`,
    kind,
    objectId,
    action,
    actorId: input.actorId ?? null,
    assigneeIds: unique(input.assigneeIds ?? []),
    relation: input.relation,
    occurredAt: input.occurredAt,
    updatedAt: input.updatedAt ?? null,
    observedAt: context.observedAt,
    title: input.title,
    summary: input.summary,
    source: input.source ?? null,
    sourceUrl: null,
    conversationId: input.conversationId ?? null,
    emailId: input.emailId ?? null,
    status: input.status ?? null,
    durationSeconds: input.durationSeconds ?? null,
    basis: input.basis,
    snapshot: input.snapshot,
  };
}

function messageSource(payload: Json): string | null {
  const detail = payload.emailDetail && typeof payload.emailDetail === "object" ? payload.emailDetail : null;
  return text(detail?.source ?? payload.source, 60) || null;
}

function normalizeMessage(kind: "email" | "sms" | "call", payload: Json, context: NormalizeContext): GhlRecord[] {
  const objectId = text(payload.id, 120);
  if (!objectId) return [];
  const actorId = text(payload.userId, 120) || null;
  const direction = text(payload.direction, 20) || null;
  const status = text(payload.status, 40) || null;
  const occurredAt = instant(payload.dateAdded ?? payload.createdAt ?? payload.dateCreated);
  const source = messageSource(payload);
  const detail = payload.emailDetail && typeof payload.emailDetail === "object" ? payload.emailDetail : null;
  const subject = text(detail?.subject, 160) || null;

  let relation: GhlRelation;
  let basis: string;
  if (kind === "call" && direction === "inbound") {
    relation = "unknown";
    basis = "An inbound call does not establish which employee answered or handled it.";
  } else {
    const decision = humanRelation(context, actorId, source);
    relation = decision.relation;
    basis = decision.basis;
  }

  const title = kind === "email"
    ? `Email ${direction === "inbound" ? "received" : "sent"}${subject ? `: ${subject}` : ""}`
    : kind === "sms"
      ? `Text message ${direction === "inbound" ? "received" : "sent"}`
      : `Call ${direction ?? "recorded"}`;
  const summary = kind === "call"
    ? `Call ${direction ?? "record"} with status ${status ?? "unknown"}${positiveDuration(payload.call?.duration) ? ` and duration ${positiveDuration(payload.call?.duration)}s` : ""}.`
    : `${title} recorded by GHL.`;

  return [base(kind, objectId, direction === "inbound" ? "received" : "sent", context, {
    actorId,
    relation,
    basis,
    occurredAt,
    title,
    summary,
    source,
    conversationId: text(payload.conversationId, 120) || null,
    emailId: kind === "email" ? objectId : null,
    status,
    durationSeconds: kind === "call" ? positiveDuration(payload.call?.duration) : null,
    snapshot: false,
  })];
}

function normalizeNote(payload: Json, context: NormalizeContext): GhlRecord[] {
  const objectId = text(payload.id, 120);
  if (!objectId) return [];
  const actorId = text(payload.userId, 120) || null;
  const decision = humanRelation(context, actorId, payload.source ? text(payload.source, 40) : null);
  return [base("note", objectId, "created", context, {
    actorId,
    relation: decision.relation,
    basis: decision.basis,
    occurredAt: instant(payload.dateAdded),
    updatedAt: instant(payload.dateUpdated),
    title: "Contact note added",
    summary: "Contact note recorded by GHL.",
    source: text(payload.source, 40) || null,
    status: null,
    snapshot: false,
  })];
}

function appointmentRelation(payload: Json, context: NormalizeContext, createdById: string | null): { relation: GhlRelation; basis: string } {
  const createdBySource = text(payload.createdBy?.source, 40) || null;
  if (createdBySource && AUTOMATION_SOURCES.has(createdBySource)) {
    return { relation: "automation", basis: `Appointment created by automation source ${createdBySource}.` };
  }
  if (createdById) {
    const decision = humanRelation(context, createdById, null);
    if (decision.relation === "performed") return decision;
  }
  const assignees = unique([payload.assignedUserId, ...(Array.isArray(payload.users) ? payload.users : [])]);
  if (assignees.length) return { relation: "assigned_only", basis: "Appointment ownership does not establish who booked or changed it." };
  return { relation: "unknown", basis: "No booking actor or assignee is recorded." };
}

function normalizeAppointment(payload: Json, context: NormalizeContext): GhlRecord[] {
  const objectId = text(payload.id, 120);
  if (!objectId) return [];
  const createdById = text(payload.createdBy?.userId, 120) || null;
  const assignees = unique([payload.assignedUserId, ...(Array.isArray(payload.users) ? payload.users : [])]);
  const decision = appointmentRelation(payload, context, createdById);
  const status = text(payload.status, 40) || null;
  const updatedAt = instant(payload.dateUpdated);
  return [base("appointment", objectId, "snapshot", context, {
    actorId: createdById,
    assigneeIds: assignees,
    relation: decision.relation,
    basis: decision.basis,
    occurredAt: instant(payload.dateAdded),
    updatedAt,
    title: `Appointment ${status ?? "recorded"}`,
    summary: `Appointment scheduled for ${instant(payload.startTime) ?? "an unknown time"}; booking time and ownership are separate facts.`,
    source: text(payload.createdBy?.source, 40) || null,
    status,
    snapshot: true,
    keySuffix: `${updatedAt ?? ""}:${status ?? ""}`,
  })];
}

function snapshotKind(kind: "opportunity" | "task", payload: Json, context: NormalizeContext): GhlRecord[] {
  const objectId = text(payload.id, 120);
  if (!objectId) return [];
  const assignees = unique([payload.assignedTo, payload.assignedUserId, ...(Array.isArray(payload.assignedUsers) ? payload.assignedUsers : [])]);
  const status = text(payload.status, 40) || null;
  const updatedAt = instant(payload.dateUpdated);
  const stage = text(payload.stageId, 120) || null;
  return [base(kind, objectId, "snapshot", context, {
    assigneeIds: assignees,
    relation: assignees.length ? "assigned_only" : "unknown",
    basis: "The record exposes ownership and current state, not which employee changed it.",
    occurredAt: instant(payload.dateAdded),
    updatedAt,
    title: kind === "opportunity" ? `Opportunity ${status ?? "recorded"}` : `Contact task ${status ?? "recorded"}`,
    summary: kind === "opportunity" ? "Opportunity state recorded by GHL; ownership is not proof of an employee action." : "Contact task state recorded by GHL.",
    status,
    snapshot: true,
    keySuffix: `${updatedAt ?? ""}:${stage ?? ""}:${status ?? ""}`,
  })];
}

/** Turns one provider payload into zero or more normalized records. It never
 * reads or retains message bodies and never invents an acting employee. */
export function normalizeGhlRecord(kind: GhlKind, payload: unknown, context: NormalizeContext): GhlRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Json;
  switch (kind) {
    case "email":
    case "sms":
    case "call":
      return normalizeMessage(kind, row, context);
    case "note":
      return normalizeNote(row, context);
    case "appointment":
      return normalizeAppointment(row, context);
    case "opportunity":
    case "task":
      return snapshotKind(kind, row, context);
    default:
      return [];
  }
}

/** Calendar discovery enumerates scheduled times, not change history. It can
 * therefore never describe booking-history coverage as complete. */
export function normalizeGhlAppointmentCoverage(input: {
  scope: GhlScope;
  scheduledFrom: string;
  scheduledThrough: string;
  scanned: number;
  capped: boolean;
}): GhlCoverage {
  return {
    kind: "appointment",
    state: "partial",
    from: input.scheduledFrom,
    through: input.scheduledThrough,
    reason: "Calendar discovery enumerates scheduled appointment times; it cannot prove complete booking or change history.",
    scanned: input.scanned,
    capped: input.capped,
  };
}
