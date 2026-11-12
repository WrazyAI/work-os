/** Shared, provider-neutral contracts for read-only GoHighLevel evidence.
 *
 * Nothing in these types may carry an email body, credential, or raw provider
 * payload: those stay in memory or in the encrypted content table. */

export type GhlKind = "call" | "email" | "sms" | "appointment" | "note" | "task" | "opportunity";

/** How the record relates to an employee. `performed` is the only relation
 * that is the employee's own work; everything else is context. */
export type GhlRelation = "performed" | "automation" | "shared_account" | "assigned_only" | "unknown";

export interface GhlScope {
  organizationId: string;
  connectionId: string;
  locationId: string;
}

export interface GhlIdentity {
  externalId: string;
  personId: string | null;
  verified: boolean;
  shared: boolean;
  revision: string;
}

export interface GhlRecord {
  /** Logical provider identity. It survives re-sync and delivery-state changes,
   * so one sent email is one record. */
  key: string;
  kind: GhlKind;
  objectId: string;
  action: string;
  actorId: string | null;
  assigneeIds: string[];
  relation: GhlRelation;
  /** Provider instant of the action, or null when the provider gave none.
   * Never substitute observation time. */
  occurredAt: string | null;
  updatedAt: string | null;
  observedAt: string;
  title: string;
  summary: string;
  source: string | null;
  sourceUrl: string | null;
  conversationId: string | null;
  emailId: string | null;
  status: string | null;
  durationSeconds: number | null;
  /** Short reason for the relation decision, safe to show internally. */
  basis: string;
  /** True for a current-state observation rather than a proven occurrence. */
  snapshot: boolean;
}

export interface GhlActivityItem extends GhlRecord {
  eventId: string;
  personId: string | null;
  excerpt: string | null;
  contentExpiresAt: string | null;
  contentId: string | null;
}

export interface GhlActivity {
  items: GhlActivityItem[];
  coverage: GhlCoverage[];
  lastSyncedAt: string | null;
  capped: boolean;
}

export interface GhlCoverage {
  kind: GhlKind;
  state: "pending" | "complete" | "partial" | "unavailable";
  from: string;
  through: string;
  reason: string | null;
  scanned: number;
  capped: boolean;
}
