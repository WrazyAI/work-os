import type {
  AdminRead,
  ChatRequest,
  ChatResult,
  DeliveryLease,
  FollowSettings,
  InboxPage,
  OttoScope,
  Page,
  PersonRef,
  ReviewedRecap,
  SpeechLine,
} from "../../../../src/modules/work-os/admin-otto/contracts";
import { apiRequestRaw } from "../api";

const ADMIN_OTTO = "/api/work-os/admin/otto";
export const ADMIN_OTTO_CHAT_TIMEOUT_MS = 60_000;
export const ADMIN_OTTO_SPEECH_TIMEOUT_MS = 90_000;
export const ADMIN_OTTO_TRANSCRIPTION_TIMEOUT_MS = 25_000;

export type AdminOttoContextResponse = {
  scope: OttoScope;
  personId: string | null;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
};

export type AdminOttoThreadTurn = {
  turnId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type AdminOttoThreadView = {
  conversationId: string;
  contextVersion: number;
  turns: AdminOttoThreadTurn[];
  result: AdminRead | null;
  resultStatus: "ready" | "stale" | "unavailable";
};

export type AdminSpeechClip = {
  bytes: ArrayBuffer;
  mimeType: string;
  voice: string;
  reviewKey: string;
  scriptHash: string;
  lines: SpeechLine[];
};

export class AdminOttoApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = "AdminOttoApiError";
    this.status = status;
    this.reason = reason;
  }
}

export class AdminOttoSpeechChangedError extends AdminOttoApiError {
  readonly current: ReviewedRecap;
  constructor(message: string, current: ReviewedRecap) {
    super(message, 409, "review_changed");
    this.name = "AdminOttoSpeechChangedError";
    this.current = current;
  }
}

export class AdminOttoSpeechQuotaError extends AdminOttoApiError {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message, 429, "quota_exceeded");
    this.name = "AdminOttoSpeechQuotaError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid.`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function schema(body: Record<string, unknown>) {
  if (body.schemaVersion !== 1) throw new Error("Admin Otto response schema version is unsupported.");
}

function scopeValue(value: unknown): OttoScope {
  const scope = object(value, "Admin Otto scope");
  const mode = scope.mode === "admin" || scope.mode === "employee" ? scope.mode : null;
  if (!mode) throw new Error("Admin Otto scope mode is invalid.");
  return {
    userId: text(scope.userId, "Admin Otto scope user"),
    organizationId: text(scope.organizationId, "Admin Otto scope organization"),
    mode,
  };
}

function person(value: unknown): ReviewedRecap["person"] {
  const record = object(value, "Admin Otto person");
  return {
    id: text(record.id, "Admin Otto person id"),
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    active: record.active === true,
    timezone: typeof record.timezone === "string" ? record.timezone : "UTC",
  };
}

function recapValue(value: unknown): ReviewedRecap {
  const record = object(value, "Admin Otto recap");
  const original = object(record.original, "Admin Otto recap original");
  const lines = Array.isArray(record.speechLines) ? record.speechLines : [];
  return {
    intervalId: text(record.intervalId, "Admin Otto recap interval"),
    eventId: text(record.eventId, "Admin Otto recap event"),
    person: person(record.person),
    reviewVersion: number(record.reviewVersion, "Admin Otto recap review version"),
    reviewKey: text(record.reviewKey, "Admin Otto recap review key"),
    sourceRevision: number(record.sourceRevision, "Admin Otto recap source revision"),
    scriptHash: text(record.scriptHash, "Admin Otto recap script hash"),
    reviewStatus: record.reviewStatus === "amended" ? "amended" : "confirmed",
    reviewedAt: text(record.reviewedAt, "Admin Otto recap review time"),
    windowStart: text(record.windowStart, "Admin Otto recap window start"),
    windowEnd: text(record.windowEnd, "Admin Otto recap window end"),
    timezone: typeof record.timezone === "string" ? record.timezone : "UTC",
    original: {
      headline: typeof original.headline === "string" ? original.headline : "",
      detail: typeof original.detail === "string" ? original.detail : "",
      activities: Array.isArray(original.activities)
        ? original.activities.filter((entry): entry is string => typeof entry === "string")
        : [],
    },
    employeeFeedback: typeof record.employeeFeedback === "string" ? record.employeeFeedback : null,
    speechLines: lines.flatMap((entry: unknown) => {
      const line = object(entry, "Admin Otto speech line");
      return typeof line.text === "string"
        ? [{ text: line.text, time: typeof line.time === "string" ? line.time : null }]
        : [];
    }),
    coverage: Array.isArray(record.coverage)
      ? record.coverage.filter((entry): entry is string => typeof entry === "string")
      : [],
    ...(typeof record.recordUrl === "string" && record.recordUrl ? { recordUrl: record.recordUrl } : {}),
  };
}

function adminRead(value: unknown): AdminRead | null {
  if (value === null || value === undefined) return null;
  const record = object(value, "Admin Otto result");
  const kind = record.kind;
  if (kind !== "tasks" && kind !== "records" && kind !== "recaps" && kind !== "recap" && kind !== "resolution") {
    throw new Error("Admin Otto result kind is invalid.");
  }
  return record as unknown as AdminRead;
}

function pageShell(value: Record<string, unknown>) {
  return {
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
    total: number(value.total, "Admin Otto page total"),
    asOf: text(value.asOf, "Admin Otto page as-of time"),
    coverage: Array.isArray(value.coverage)
      ? value.coverage.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function peoplePage(value: unknown): Page<PersonRef> {
  const body = object(value, "Admin Otto people");
  schema(body);
  if (!Array.isArray(body.items)) throw new Error("Admin Otto people items are invalid.");
  return {
    ...pageShell(body),
    items: body.items.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      return typeof row.id === "string" && row.id ? [person(row)] : [];
    }),
  };
}

function inboxPage(value: unknown): InboxPage {
  const body = object(value, "Admin Otto inbox");
  schema(body);
  if (!Array.isArray(body.items)) throw new Error("Admin Otto inbox items are invalid.");
  return {
    ...pageShell(body),
    items: body.items.flatMap((entry) => {
      const item = object(entry, "Admin Otto inbox item");
      if (typeof item.deliveryId !== "string" || !item.deliveryId) return [];
      return [{
        deliveryId: item.deliveryId,
        recap: recapValue(item.recap),
        seenAt: typeof item.seenAt === "string" ? item.seenAt : null,
        listenedAt: typeof item.listenedAt === "string" ? item.listenedAt : null,
      }];
    }),
    unread: number(body.unread, "Admin Otto inbox unread"),
    catchupPending: body.catchupPending === true,
  };
}

async function errorFrom(response: Response): Promise<AdminOttoApiError> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const message = typeof body?.error === "string" && body.error
    ? body.error
    : `Admin Otto request failed (${response.status}).`;
  const reason = typeof body?.reason === "string" ? body.reason : null;
  return new AdminOttoApiError(message, response.status, reason);
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (body: Record<string, unknown>) => T,
  timeoutMs = 20_000,
): Promise<T> {
  const response = await apiRequestRaw(path, init, { timeoutMs });
  if (!response.ok) throw await errorFrom(response);
  const body = await response.json().catch(() => null);
  const record = object(body, "Admin Otto response");
  schema(record);
  return parse(record);
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(value),
  };
}

/** Authoritative context bootstrap. The body is empty: scope is server-owned
 * and comes from the bearer/cookie membership. */
export async function fetchAdminOttoContext(): Promise<AdminOttoContextResponse> {
  return requestJson(`${ADMIN_OTTO}/context`, jsonBody({}), (body) => ({
    scope: scopeValue(body.scope),
    personId: typeof body.personId === "string" ? body.personId : null,
    voiceAvailable: body.voiceAvailable === true,
    transcriptionAvailable: body.transcriptionAvailable === true,
  }));
}

export async function fetchAdminOttoInbox(input: { cursor?: string; limit?: number } = {}): Promise<InboxPage> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  const query = params.toString();
  return requestJson(`${ADMIN_OTTO}/inbox${query ? `?${query}` : ""}`, { method: "GET" }, inboxPage);
}

export async function claimAdminOttoDelivery(input: {
  deviceId: string;
  windowId: string;
}): Promise<DeliveryLease | null> {
  return requestJson(`${ADMIN_OTTO}/inbox/claim`, jsonBody({
    deviceId: input.deviceId,
    windowId: input.windowId,
  }), (body) => {
    if (body.lease === null) return null;
    const lease = object(body.lease, "Admin Otto delivery lease");
    if (!Array.isArray(lease.eventIds) || lease.eventIds.some((id) => typeof id !== "string")) {
      throw new Error("Admin Otto delivery lease ids are invalid.");
    }
    return {
      token: text(lease.token, "Admin Otto delivery lease token"),
      expiresAt: text(lease.expiresAt, "Admin Otto delivery lease expiry"),
      eventIds: lease.eventIds as string[],
      pendingCount: number(lease.pendingCount, "Admin Otto delivery pending count"),
    };
  });
}

export async function updateAdminOttoDelivery(input: {
  eventIds: string[];
  action: "presented" | "seen" | "listened" | "dismissed" | "release";
  leaseToken?: string;
}): Promise<void> {
  await requestJson(`${ADMIN_OTTO}/inbox/state`, {
    method: "PUT",
    body: JSON.stringify({
      eventIds: input.eventIds,
      action: input.action,
      ...(input.leaseToken === undefined ? {} : { leaseToken: input.leaseToken }),
    }),
  }, () => undefined);
}

/** Bounded active directory page for the follow checklist. Name resolution in
 * chat still searches the complete authorized roster; this page is only for
 * selection UIs and never narrows a named query. */
export async function fetchAdminOttoPeople(input: { cursor?: string; limit?: number; ids?: string[] } = {}): Promise<Page<PersonRef>> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.ids?.length) params.set("ids", input.ids.join(","));
  const query = params.toString();
  return requestJson(`${ADMIN_OTTO}/people${query ? `?${query}` : ""}`, { method: "GET" }, peoplePage);
}

function preferences(body: Record<string, unknown>): FollowSettings {
  return {
    mode: body.mode === "selected" ? "selected" : "all",
    personIds: Array.isArray(body.personIds)
      ? body.personIds.filter((id): id is string => typeof id === "string")
      : [],
    revision: number(body.revision, "Admin Otto preferences revision"),
    activated: body.activated === true,
  };
}

export async function fetchAdminOttoPreferences(): Promise<FollowSettings> {
  return requestJson(`${ADMIN_OTTO}/preferences`, { method: "GET" }, preferences);
}

export async function saveAdminOttoPreferences(input: {
  mode: "all" | "selected";
  personIds: string[];
  expectedRevision: number;
}): Promise<FollowSettings> {
  return requestJson(`${ADMIN_OTTO}/preferences`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, preferences);
}

export async function sendAdminOttoChat(input: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
  return requestJson(`${ADMIN_OTTO}/chat`, { ...jsonBody({
    schemaVersion: 1,
    ...input,
  }), signal }, (body): ChatResult => ({
    conversationId: text(body.conversationId, "Admin Otto conversation id"),
    turnId: text(body.turnId, "Admin Otto turn id"),
    reply: typeof body.reply === "string" ? body.reply : "",
    result: adminRead(body.result),
    contextVersion: number(body.contextVersion, "Admin Otto context version"),
    ...(body.errorCode === "unsupported" || body.errorCode === "ambiguous" || body.errorCode === "missing"
      ? { errorCode: body.errorCode }
      : {}),
  }), ADMIN_OTTO_CHAT_TIMEOUT_MS);
}

export async function fetchAdminOttoThread(conversationId: string, signal?: AbortSignal): Promise<AdminOttoThreadView> {
  return requestJson(`${ADMIN_OTTO}/chat?conversationId=${encodeURIComponent(conversationId)}`, { method: "GET", signal }, (body) => {
    if (!Array.isArray(body.turns)) throw new Error("Admin Otto thread turns are invalid.");
    return {
      conversationId: text(body.conversationId, "Admin Otto thread conversation id"),
      contextVersion: number(body.contextVersion, "Admin Otto thread context version"),
      turns: body.turns.flatMap((entry) => {
        const turn = object(entry, "Admin Otto thread turn");
        if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") return [];
        return [{
          turnId: text(turn.turnId, "Admin Otto thread turn id"),
          role: turn.role,
          text: turn.text,
          createdAt: typeof turn.createdAt === "string" ? turn.createdAt : "",
        }];
      }),
      result: adminRead(body.result),
      resultStatus: body.resultStatus === "ready" || body.resultStatus === "stale" ? body.resultStatus : "unavailable",
    };
  });
}

export async function fetchAdminOttoRecap(intervalId: string): Promise<ReviewedRecap> {
  return requestJson(`${ADMIN_OTTO}/recaps/${encodeURIComponent(intervalId)}`, { method: "GET" }, (body) => recapValue(body.recap));
}

function speechLines(header: string | null): SpeechLine[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const line = entry as Record<string, unknown>;
      return typeof line.text === "string"
        ? [{ text: line.text, time: typeof line.time === "string" ? line.time : null }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Upload one recorded clip for transcription. The clip is forwarded and
 * dropped; only its text returns. Admin voice does not require a person map. */
export async function transcribeAdminOttoAudio(
  audio: Blob,
  language?: string,
  signal?: AbortSignal,
): Promise<{ text: string; model?: string }> {
  const form = new FormData();
  form.append("audio", audio, "clip.webm");
  if (language) form.append("language", language);
  const response = await apiRequestRaw(`${ADMIN_OTTO}/transcribe`, {
    method: "POST",
    body: form,
    ...(signal ? { signal } : {}),
  }, { timeoutMs: ADMIN_OTTO_TRANSCRIPTION_TIMEOUT_MS });
  if (!response.ok) throw await errorFrom(response);
  const body = object(await response.json().catch(() => null), "Admin Otto transcription");
  schema(body);
  return {
    text: typeof body.text === "string" ? body.text : "",
    ...(typeof body.model === "string" ? { model: body.model } : {}),
  };
}

/** POST a reviewed version key, never text, and keep the canonical spoken
 * lines the server returns for the visible prompter. */
export async function speakAdminOttoRecap(input: {
  intervalId: string;
  reviewKey: string;
  voice?: string;
}, signal?: AbortSignal): Promise<AdminSpeechClip> {
  const response = await apiRequestRaw(`${ADMIN_OTTO}/recaps/${encodeURIComponent(input.intervalId)}/speech`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      reviewKey: input.reviewKey,
      ...(input.voice ? { voice: input.voice } : {}),
    }),
    ...(signal ? { signal } : {}),
  }, { timeoutMs: ADMIN_OTTO_SPEECH_TIMEOUT_MS });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const message = typeof body?.error === "string" && body.error ? body.error : "Reading that recap is unavailable.";
    if (response.status === 409 && body?.reason === "review_changed" && body.recap) {
      throw new AdminOttoSpeechChangedError(message, recapValue(body.recap));
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? body?.retryAfterSeconds ?? 1);
      throw new AdminOttoSpeechQuotaError(message, Number.isFinite(retryAfter) ? retryAfter : 1);
    }
    throw new AdminOttoApiError(message, response.status, typeof body?.reason === "string" ? body.reason : null);
  }
  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? "audio/wav",
    voice: response.headers.get("x-work-os-recap-voice") ?? input.voice ?? "",
    reviewKey: response.headers.get("x-work-os-recap-review-key") ?? input.reviewKey,
    scriptHash: response.headers.get("x-work-os-recap-script-hash") ?? "",
    lines: speechLines(response.headers.get("x-work-os-recap-lines")),
  };
}
