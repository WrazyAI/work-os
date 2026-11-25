import type { OttoScope } from "@wrazy/work-os-shared/admin-otto/contracts";
import type { AdminOverview, AdminOverviewActivity } from "../admin/types";
import { isOttoScope } from "./mode";

/** The cross-window arrival that wakes the floating companion's admin side.
 * It carries one already-grounded item: the main window owns the overview read
 * and the delivery feed, so the avatar never polls the team record twice. */
export const OTTO_ADMIN_ATTENTION_EVENT = "work-os://otto-admin-attention";

/** The floating companion's explicit action. The avatar may be the only visible
 * surface, so the main window opens the exact administration destination the
 * card promised instead of leaving the person to find it. */
export const OTTO_ADMIN_ATTENTION_OPEN_EVENT = "work-os://otto-admin-attention-open";

/** Device-local memory for EOD submissions that were already announced. A
 * watermark plus ids keeps a reload from re-announcing the same report while
 * still catching an arrival recorded while the app was closed. */
export const ADMIN_ATTENTION_SEEN_KEY = "work-os.admin-attention.seen.v1";

/** Dismissed admin attention, scoped to the local workday and the event. */
export const ADMIN_ATTENTION_DISMISSED_KEY = "work-os.admin-attention.dismissed.v1";

/** Only the two arrivals that earn an interrupt: a report submitted for review
 * and a reviewed recap delivered to the administration inbox. Overdue tasks,
 * evidence disputes, and configuration blockers stay in the bell. */
export type AdminAttentionKind = "eod_submitted" | "recap_reviewed";

export type AdminAttentionItem = {
  /** Stable per event group, so a dismissal and a re-announcement agree. */
  id: string;
  kind: AdminAttentionKind;
  /** The underlying record count the item names. */
  count: number;
  title: string;
  body: string;
  /** The administration destination that resolves it. */
  section: "review" | "recaps";
  /** Present only when the item names exactly one person. */
  personId: string | null;
  at: string;
};

export type AdminAttentionSeen = {
  scope: string;
  day: string;
  /** Newest announced activity instant, used to catch an offline arrival. */
  watermark: string | null;
  ids: string[];
};

export type AdminAttentionEvent = {
  scope: OttoScope;
  epoch: number;
  item: AdminAttentionItem | null;
};

export type AdminAttentionDismissals = {
  day: string;
  ids: string[];
};

const MAX_SEEN_IDS = 200;
const MAX_DISMISSED_IDS = 50;
const CATCH_UP_MS = 24 * 60 * 60 * 1000;
const MAX_COPY = 240;
const ID_LIMIT = 128;

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function clean(value: unknown, limit = MAX_COPY): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function scopeKey(scope: { userId: string; organizationId: string }): string {
  return `${scope.userId}:${scope.organizationId}`;
}

function personList(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** The first eod_submitted activity after the stored watermark, grouped into
 * one counted item. A first read seeds the watermark and announces nothing:
 * opening the app is not a new submission. */
export function eodAttentionFromOverview(
  overview: AdminOverview,
  previous: AdminAttentionSeen | null,
): { item: AdminAttentionItem | null; seen: AdminAttentionSeen } {
  const generatedAt = validIso(overview.generatedAt) ? Date.parse(overview.generatedAt) : Date.now();
  const activities = (overview.recentActivity ?? [])
    .filter((activity): activity is AdminOverviewActivity & { at: string } =>
      activity.kind === "eod_submitted" && validIso(activity.at))
    .sort((left, right) => left.at.localeCompare(right.at));
  const newest = activities[activities.length - 1]?.at ?? null;
  const seeded = previous !== null && previous.watermark !== null
    ? previous
    : { scope: "", day: overview.date, watermark: newest, ids: activities.map((activity) => activity.id) };
  const known = new Set(seeded.ids);
  const watermark = seeded.watermark;
  const fresh = activities.filter((activity) => {
    const at = Date.parse(activity.at);
    if (known.has(activity.id)) return false;
    if (!watermark) return false;
    if (at <= Date.parse(watermark)) return false;
    // A long-closed app must not announce a stale day's report as if it just
    // arrived; the bell still keeps the standing decision record.
    return generatedAt - at <= CATCH_UP_MS;
  });
  const seen: AdminAttentionSeen = {
    scope: seeded.scope,
    day: overview.date,
    watermark: newest && (!watermark || newest > watermark) ? newest : watermark,
    ids: [...new Set([...seeded.ids, ...activities.map((activity) => activity.id)])].slice(-MAX_SEEN_IDS),
  };
  if (!fresh.length) return { item: null, seen };
  const names = [...new Set(fresh
    .map((activity) => clean(activity.personName, 80))
    .filter(Boolean))];
  const count = fresh.length;
  const named = names.length ? personList(names) : null;
  const title = count === 1 ? "EOD report submitted" : `${count} EOD reports submitted`;
  const body = count === 1
    ? `${named ?? "An employee"}'s report is waiting for your review.`
    : `${named ?? "Your team"} submitted reports waiting for your review.`;
  return {
    item: {
      id: `eod:${fresh[fresh.length - 1]!.at}`,
      kind: "eod_submitted",
      count,
      title,
      body,
      section: "review",
      personId: count === 1 ? fresh[0]!.personId : null,
      at: fresh[fresh.length - 1]!.at,
    },
    seen,
  };
}

/** A reviewed-recap delivery group. The event ids name the exact delivery, so
 * the same group never announces twice and a newer group is a new arrival. */
export function recapAttentionItem(input: {
  count: number;
  eventIds: readonly string[];
  at?: string | null;
}): AdminAttentionItem {
  const count = Math.max(1, Math.trunc(input.count));
  const eventIds = [...new Set(input.eventIds.filter((id) => typeof id === "string" && id.length > 0))];
  const at = validIso(input.at) ? input.at : new Date().toISOString();
  return {
    id: `recap:${(eventIds.length ? eventIds : [at]).slice(0, 100).join(",")}`,
    kind: "recap_reviewed",
    count,
    title: count === 1 ? "Reviewed recap ready" : "Reviewed recaps are ready",
    body: count === 1
      ? "1 recap is waiting in the administration inbox."
      : `${count} recaps are waiting in the administration inbox.`,
    section: "recaps",
    personId: null,
    at,
  };
}

/** The one rule every auto-switch uses: only a genuinely new arrival for the
 * other workspace moves the view, and only when that workspace is available.
 * A launch's already-waiting state and a manual return are never reversed for
 * an event that was already seen. */
export function shouldAutoSwitchWorkspace(input: {
  current: "employee" | "admin";
  target: "employee" | "admin";
  available: boolean;
  firstObservation?: boolean;
}): boolean {
  if (input.firstObservation) return false;
  if (!input.available) return false;
  return input.current !== input.target;
}

/** The sentence the compact bubble and the expanded card show for this item. */
export function adminAttentionActionLabel(item: AdminAttentionItem): string {
  return item.kind === "recap_reviewed" ? "View recaps" : "Review reports";
}

export function adminAttentionSeenKey(scope: { userId: string; organizationId: string }): string {
  return scopeKey(scope);
}

export function parseAdminAttentionSeen(value: unknown): AdminAttentionSeen | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.scope !== "string" || typeof raw.day !== "string") return null;
  if (raw.watermark !== null && !validIso(raw.watermark)) return null;
  if (!Array.isArray(raw.ids) || raw.ids.some((id) => typeof id !== "string" || !id || id.length > ID_LIMIT)) return null;
  return {
    scope: raw.scope.slice(0, 192),
    day: raw.day.slice(0, 32),
    watermark: raw.watermark,
    ids: [...new Set(raw.ids as string[])].slice(-MAX_SEEN_IDS),
  };
}

export function parseAdminAttentionDismissals(value: unknown): AdminAttentionDismissals | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.day !== "string") return null;
  if (!Array.isArray(raw.ids) || raw.ids.some((id) => typeof id !== "string" || !id || id.length > ID_LIMIT)) return null;
  return { day: raw.day.slice(0, 32), ids: [...new Set(raw.ids as string[])].slice(-MAX_DISMISSED_IDS) };
}

/** Whether this event is still silenced for the current local day. */
export function isAdminAttentionDismissed(
  dismissals: AdminAttentionDismissals | null,
  item: AdminAttentionItem | null,
  day: string,
): boolean {
  return !!item && !!dismissals && dismissals.day === day && dismissals.ids.includes(item.id);
}

export function dismissAdminAttention(
  dismissals: AdminAttentionDismissals | null,
  item: AdminAttentionItem,
  day: string,
): AdminAttentionDismissals {
  const current = dismissals && dismissals.day === day ? dismissals : { day, ids: [] };
  return { day, ids: [...new Set([...current.ids, item.id])].slice(-MAX_DISMISSED_IDS) };
}

/** The event is only a transport shape; every field is rebuilt here so a
 * malformed or stale window payload can never render arbitrary copy. */
export function adminAttentionEvent(scope: OttoScope, epoch: number, item: AdminAttentionItem | null): AdminAttentionEvent {
  return {
    scope: { userId: scope.userId, organizationId: scope.organizationId, mode: "admin" },
    epoch: Number.isSafeInteger(epoch) && epoch > 0 ? epoch : 1,
    item: item ? sanitizeAdminAttentionItem(item) : null,
  };
}

export function parseAdminAttentionEvent(value: unknown): AdminAttentionEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isOttoScope(raw.scope) || raw.scope.mode !== "admin") return null;
  if (typeof raw.epoch !== "number" || !Number.isSafeInteger(raw.epoch) || raw.epoch < 1) return null;
  const item = raw.item === null ? null : parseAdminAttentionItem(raw.item);
  if (raw.item !== null && !item) return null;
  return {
    scope: { userId: raw.scope.userId, organizationId: raw.scope.organizationId, mode: "admin" },
    epoch: raw.epoch,
    item,
  };
}

function sanitizeAdminAttentionItem(item: AdminAttentionItem): AdminAttentionItem {
  return {
    id: clean(item.id, ID_LIMIT),
    kind: item.kind === "recap_reviewed" ? "recap_reviewed" : "eod_submitted",
    count: Math.max(1, Math.trunc(item.count)),
    title: clean(item.title) || "Something needs your review",
    body: clean(item.body) || "Open Administration to review it.",
    section: item.section === "recaps" ? "recaps" : "review",
    personId: typeof item.personId === "string" && item.personId ? item.personId.slice(0, ID_LIMIT) : null,
    at: validIso(item.at) ? item.at : new Date().toISOString(),
  };
}

function parseAdminAttentionItem(value: unknown): AdminAttentionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > ID_LIMIT) return null;
  if (raw.kind !== "eod_submitted" && raw.kind !== "recap_reviewed") return null;
  if (typeof raw.count !== "number" || !Number.isSafeInteger(raw.count) || raw.count < 1) return null;
  if (typeof raw.title !== "string" || typeof raw.body !== "string") return null;
  if (raw.section !== "review" && raw.section !== "recaps") return null;
  if (raw.personId !== null && (typeof raw.personId !== "string" || raw.personId.length > ID_LIMIT)) return null;
  if (!validIso(raw.at)) return null;
  return sanitizeAdminAttentionItem(raw as unknown as AdminAttentionItem);
}
