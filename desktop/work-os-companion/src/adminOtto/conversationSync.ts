import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { isOttoScope, sameOttoScope } from "./mode";

export const OTTO_CONVERSATION_EVENT = "work-os://otto-conversation";
export const OTTO_CONVERSATION_REQUEST_EVENT = "work-os://otto-conversation-request";
export const OTTO_CONVERSATION_RESULT_EVENT = "work-os://otto-conversation-result";

export type AdminConversationWindow = "main" | "avatar";
export type AdminConversationFailure =
  | "stale_scope"
  | "stale_generation"
  | "busy"
  | "pending_other_window"
  | "conversation_changed"
  | "invalid_ticket"
  | "new_chat_pending"
  | "discard_failed"
  | "timeout"
  | "disposed";

export type AdminConversationFence = {
  scope: OttoScope;
  epoch: number;
  generation: number;
};

export type AdminConversationState = {
  scope: OttoScope;
  epoch: number;
  generation: number;
  revision: number;
  conversationId: string | null;
  busy: boolean;
  resetting: boolean;
};

export type AdminConversationTicket = {
  scope: OttoScope;
  epoch: number;
  generation: number;
  operationId: string;
  requestId: string;
  windowId: AdminConversationWindow;
  conversationId: string | null;
};

type RequestBase = {
  operationId: string;
  windowId: AdminConversationWindow;
  scope: OttoScope;
  epoch: number;
  generation: number;
};

export type AdminConversationRequest =
  | (RequestBase & {
      type: "begin-send";
      requestId: string;
      conversationId: string | null;
    })
  | (RequestBase & {
      type: "finish-send";
      requestId: string;
      ticket: AdminConversationTicket;
      conversationId: string;
    })
  | (RequestBase & {
      type: "cancel-send";
      requestId: string;
      ticket: AdminConversationTicket;
    })
  | (RequestBase & {
      type: "discard";
      conversationId: string | null;
      requestId: string | null;
    });

export type AdminConversationResult = {
  operationId: string;
  windowId: AdminConversationWindow;
  scope: OttoScope;
  epoch: number;
  generation: number;
  accepted: boolean;
  reason: AdminConversationFailure | null;
  state?: AdminConversationState;
  ticket?: AdminConversationTicket;
};

export type AdminConversationOwnerDeps = {
  getLiveFence: () => AdminConversationFence | null;
  discard: (input: { conversationId: string | null; requestId: string | null }) => Promise<void>;
  publish: (state: AdminConversationState) => void;
};

export type AdminConversationOwner = {
  snapshot: () => AdminConversationState;
  setContext: (input: { scope: OttoScope; epoch: number; conversationId?: string | null }) => void;
  handle: (request: AdminConversationRequest) => Promise<AdminConversationResult>;
  dispose: () => void;
};

export type AdminConversationTransport = (request: AdminConversationRequest) => Promise<AdminConversationResult>;

export type AdminConversationClient = {
  beginSend: (input: { requestId: string; conversationId: string | null }) => Promise<AdminConversationTicket>;
  finishSend: (ticket: AdminConversationTicket, conversationId: string) => Promise<void>;
  cancelSend: (ticket: AdminConversationTicket) => void;
  discard: (input: { conversationId: string | null; requestId: string | null }) => Promise<void>;
};

const FAILURE_COPY: Record<AdminConversationFailure, string> = {
  stale_scope: "This conversation belongs to an earlier workspace. Reopen it to continue.",
  stale_generation: "That earlier send was already retired. Start a new chat to continue.",
  busy: "The other window is already sending a message. Wait for it to finish.",
  pending_other_window: "Another send is still unresolved. Recover or start a new chat first.",
  conversation_changed: "The conversation changed in another window. Reload it before sending.",
  invalid_ticket: "That earlier send is no longer current.",
  new_chat_pending: "A new chat is being prepared. Try again in a moment.",
  discard_failed: "The old chat could not be discarded. Nothing was cleared; try New chat again.",
  timeout: "The other window did not answer in time. Try again.",
  disposed: "This conversation is no longer available.",
};

export class AdminConversationError extends Error {
  readonly reason: AdminConversationFailure;
  constructor(reason: AdminConversationFailure, message = FAILURE_COPY[reason]) {
    super(message);
    this.name = "AdminConversationError";
    this.reason = reason;
  }
}

const ID_LIMIT = 160;
const FAILURES = new Set<AdminConversationFailure>([
  "stale_scope", "stale_generation", "busy", "pending_other_window",
  "conversation_changed", "invalid_ticket", "new_chat_pending",
  "discard_failed", "timeout", "disposed",
]);

function copyScope(scope: OttoScope): OttoScope {
  return { userId: scope.userId, organizationId: scope.organizationId, mode: scope.mode };
}

function safePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function requiredId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_LIMIT;
}

function nullableId(value: unknown): value is string | null {
  return value === null || requiredId(value);
}

function scopeFrom(value: unknown): OttoScope | null {
  return isOttoScope(value) ? copyScope(value) : null;
}

function cloneState(state: AdminConversationState): AdminConversationState {
  return { ...state, scope: copyScope(state.scope) };
}

function cloneTicket(ticket: AdminConversationTicket): AdminConversationTicket {
  return { ...ticket, scope: copyScope(ticket.scope) };
}

function sameTicket(left: AdminConversationTicket, right: AdminConversationTicket): boolean {
  return left.operationId === right.operationId
    && left.requestId === right.requestId
    && left.windowId === right.windowId
    && left.epoch === right.epoch
    && left.generation === right.generation
    && left.conversationId === right.conversationId
    && sameOttoScope(left.scope, right.scope);
}

function parseTicket(value: unknown): AdminConversationTicket | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !safePositive(raw.epoch) || !safePositive(raw.generation)) return null;
  if (!requiredId(raw.operationId) || !requiredId(raw.requestId)) return null;
  if (raw.windowId !== "main" && raw.windowId !== "avatar") return null;
  if (!nullableId(raw.conversationId)) return null;
  return {
    scope,
    epoch: raw.epoch,
    generation: raw.generation,
    operationId: raw.operationId,
    requestId: raw.requestId,
    windowId: raw.windowId,
    conversationId: raw.conversationId,
  };
}

export function parseAdminConversationState(value: unknown): AdminConversationState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !safePositive(raw.epoch) || !safePositive(raw.generation) || !safePositive(raw.revision)) return null;
  if (!nullableId(raw.conversationId)) return null;
  if (typeof raw.busy !== "boolean" || typeof raw.resetting !== "boolean") return null;
  return {
    scope,
    epoch: raw.epoch,
    generation: raw.generation,
    revision: raw.revision,
    conversationId: raw.conversationId,
    busy: raw.busy,
    resetting: raw.resetting,
  };
}

export function parseAdminConversationRequest(value: unknown): AdminConversationRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !safePositive(raw.epoch) || !safePositive(raw.generation)) return null;
  if (!requiredId(raw.operationId)) return null;
  if (raw.windowId !== "main" && raw.windowId !== "avatar") return null;
  const base = {
    operationId: raw.operationId,
    windowId: raw.windowId,
    scope,
    epoch: raw.epoch,
    generation: raw.generation,
  } as const;
  if (raw.type === "begin-send") {
    if (!requiredId(raw.requestId) || !nullableId(raw.conversationId)) return null;
    return { ...base, type: "begin-send", requestId: raw.requestId, conversationId: raw.conversationId };
  }
  if (raw.type === "finish-send") {
    const ticket = parseTicket(raw.ticket);
    if (!requiredId(raw.requestId) || !ticket || !requiredId(raw.conversationId)) return null;
    return { ...base, type: "finish-send", requestId: raw.requestId, ticket, conversationId: raw.conversationId };
  }
  if (raw.type === "cancel-send") {
    const ticket = parseTicket(raw.ticket);
    if (!requiredId(raw.requestId) || !ticket) return null;
    return { ...base, type: "cancel-send", requestId: raw.requestId, ticket };
  }
  if (raw.type === "discard") {
    if (!nullableId(raw.conversationId) || !nullableId(raw.requestId)) return null;
    return { ...base, type: "discard", conversationId: raw.conversationId, requestId: raw.requestId };
  }
  return null;
}

export function parseAdminConversationResult(value: unknown): AdminConversationResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const scope = scopeFrom(raw.scope);
  if (!scope || !safePositive(raw.epoch) || !safePositive(raw.generation)) return null;
  if (!requiredId(raw.operationId)) return null;
  if (raw.windowId !== "main" && raw.windowId !== "avatar") return null;
  if (typeof raw.accepted !== "boolean") return null;
  if (raw.reason !== null && (typeof raw.reason !== "string" || !FAILURES.has(raw.reason as AdminConversationFailure))) return null;
  const state = raw.state === undefined ? undefined : parseAdminConversationState(raw.state);
  if (raw.state !== undefined && !state) return null;
  const ticket = raw.ticket === undefined ? undefined : parseTicket(raw.ticket);
  if (raw.ticket !== undefined && !ticket) return null;
  return {
    operationId: raw.operationId,
    windowId: raw.windowId,
    scope,
    epoch: raw.epoch,
    generation: raw.generation,
    accepted: raw.accepted,
    reason: raw.reason as AdminConversationFailure | null,
    ...(state ? { state } : {}),
    ...(ticket ? { ticket } : {}),
  };
}

type Entry = { ticket: AdminConversationTicket; status: "active" | "cancelled" };

export function createAdminConversationOwner(deps: AdminConversationOwnerDeps): AdminConversationOwner {
  let state: AdminConversationState | null = null;
  const entries = new Map<string, Entry>();
  const processed = new Map<string, AdminConversationResult>();
  const fenced = new Set<string>();
  let resetPromise: Promise<void> | null = null;
  let disposed = false;

  const snapshot = (): AdminConversationState => {
    if (!state) throw new Error("The admin conversation owner has no context.");
    return cloneState(state);
  };

  const publish = () => {
    if (!state) return;
    if (disposed) return;
    deps.publish(snapshot());
  };

  const resultFor = (
    request: AdminConversationRequest,
    accepted: boolean,
    reason: AdminConversationFailure | null,
    extra: { ticket?: AdminConversationTicket } = {},
  ): AdminConversationResult => ({
    operationId: request.operationId,
    windowId: request.windowId,
    scope: copyScope(request.scope),
    epoch: request.epoch,
    generation: request.generation,
    accepted,
    reason,
    ...(state ? { state: snapshot() } : {}),
    ...(extra.ticket ? { ticket: cloneTicket(extra.ticket) } : {}),
  });

  const remember = (result: AdminConversationResult) => {
    processed.set(result.operationId, result);
    return result;
  };

  const findEntry = (ticket: AdminConversationTicket): Entry | null => {
    const entry = entries.get(ticket.operationId);
    if (!entry || !sameTicket(entry.ticket, ticket)) return null;
    return entry;
  };

  const setBusy = () => {
    if (!state) return;
    state.busy = [...entries.values()].some((entry) => entry.status === "active");
  };

  const handleBegin = async (request: Extract<AdminConversationRequest, { type: "begin-send" }>) => {
    if (!state) return resultFor(request, false, "stale_scope");
    if (state.resetting) return resultFor(request, false, "new_chat_pending");
    const existing = [...entries.values()].find((entry) => entry.ticket.requestId === request.requestId);
    if (existing) {
      if (existing.ticket.windowId !== request.windowId) return resultFor(request, false, "busy");
      if (existing.ticket.operationId === request.operationId
        && existing.ticket.epoch === state.epoch
        && existing.ticket.generation === state.generation) {
        return resultFor(request, true, null, { ticket: existing.ticket });
      }
      // A view round trip keeps the durable request id but must reacquire a
      // ticket on the current fence; the old completion stays rejected.
      const retryTicket: AdminConversationTicket = {
        scope: copyScope(state.scope),
        epoch: state.epoch,
        generation: state.generation,
        operationId: request.operationId,
        requestId: request.requestId,
        windowId: request.windowId,
        conversationId: state.conversationId,
      };
      entries.delete(existing.ticket.operationId);
      entries.set(retryTicket.operationId, { ticket: retryTicket, status: "active" });
      state.busy = true;
      state.revision += 1;
      publish();
      return resultFor(request, true, null, { ticket: retryTicket });
    }
    if (state.busy || entries.size > 0) {
      return resultFor(request, false, state.busy ? "busy" : "pending_other_window");
    }
    if (request.conversationId !== state.conversationId) {
      return resultFor(request, false, "conversation_changed");
    }
    const ticket: AdminConversationTicket = {
      scope: copyScope(state.scope),
      epoch: state.epoch,
      generation: state.generation,
      operationId: request.operationId,
      requestId: request.requestId,
      windowId: request.windowId,
      conversationId: state.conversationId,
    };
    entries.set(ticket.operationId, { ticket, status: "active" });
    state.busy = true;
    state.revision += 1;
    publish();
    return resultFor(request, true, null, { ticket });
  };

  const handleFinish = async (request: Extract<AdminConversationRequest, { type: "finish-send" }>) => {
    if (!state) return resultFor(request, false, "stale_scope");
    if (state.resetting) return resultFor(request, false, "new_chat_pending");
    if (!sameOttoScope(request.ticket.scope, state.scope) || request.ticket.epoch !== state.epoch) {
      return resultFor(request, false, "stale_scope");
    }
    if (request.ticket.generation !== state.generation) return resultFor(request, false, "stale_generation");
    const entry = findEntry(request.ticket);
    if (!entry) return resultFor(request, false, "invalid_ticket");
    if (state.conversationId !== null && state.conversationId !== request.conversationId) {
      return resultFor(request, false, "conversation_changed");
    }
    entries.delete(entry.ticket.operationId);
    state.conversationId = request.conversationId;
    state.busy = [...entries.values()].some((item) => item.status === "active");
    state.revision += 1;
    publish();
    return resultFor(request, true, null, { ticket: entry.ticket });
  };

  const handleCancel = async (request: Extract<AdminConversationRequest, { type: "cancel-send" }>) => {
    if (!state) return resultFor(request, false, "stale_scope");
    if (state.resetting) return resultFor(request, false, "new_chat_pending");
    if (!sameOttoScope(request.ticket.scope, state.scope) || request.ticket.epoch !== state.epoch) {
      return resultFor(request, false, "stale_scope");
    }
    if (request.ticket.generation !== state.generation) return resultFor(request, false, "stale_generation");
    const entry = findEntry(request.ticket);
    if (!entry) return resultFor(request, false, "invalid_ticket");
    if (entry.status === "active") {
      entry.status = "cancelled";
      state.busy = false;
      state.revision += 1;
      publish();
    }
    return resultFor(request, true, null, { ticket: entry.ticket });
  };

  const handleDiscard = async (request: Extract<AdminConversationRequest, { type: "discard" }>) => {
    if (!state) return resultFor(request, false, "stale_scope");
    if (state.resetting && resetPromise) {
      try {
        await resetPromise;
        return resultFor(request, true, null);
      } catch {
        return resultFor(request, false, "discard_failed");
      }
    }
    if (!state) return resultFor(request, false, "stale_scope");
    state.resetting = true;
    state.busy = false;
    state.revision += 1;
    publish();

    const identities = new Set<string>();
    if (state.conversationId) identities.add(`conversation:${state.conversationId}`);
    for (const entry of entries.values()) identities.add(`request:${entry.ticket.requestId}`);
    if (request.conversationId) identities.add(`conversation:${request.conversationId}`);
    if (request.requestId) identities.add(`request:${request.requestId}`);

    const discardIdentity = async (key: string) => {
      if (fenced.has(key)) return;
      const [kind, id] = key.split(":", 2);
      if (!id) return;
      await deps.discard(kind === "conversation" ? { conversationId: id, requestId: null } : { conversationId: null, requestId: id });
      fenced.add(key);
    };

    const run = (async () => {
      for (const key of identities) await discardIdentity(key);
      if (!state) throw new Error("The admin conversation owner has no context.");
      entries.clear();
      fenced.clear();
      state.generation += 1;
      state.revision += 1;
      state.conversationId = null;
      state.busy = false;
      state.resetting = false;
      publish();
    })();
    resetPromise = run;
    try {
      await run;
      return resultFor(request, true, null);
    } catch {
      if (state) {
        state.resetting = false;
        state.busy = [...entries.values()].some((entry) => entry.status === "active");
        state.revision += 1;
        publish();
      }
      return resultFor(request, false, "discard_failed");
    } finally {
      resetPromise = null;
    }
  };

  return {
    snapshot,
    setContext(input) {
      if (disposed) return;
      if (!state) {
        state = {
          scope: copyScope(input.scope),
          epoch: input.epoch,
          generation: 1,
          revision: 1,
          conversationId: input.conversationId ?? null,
          busy: false,
          resetting: false,
        };
        publish();
        return;
      }
      const actorChanged = state.scope.userId !== input.scope.userId
        || state.scope.organizationId !== input.scope.organizationId;
      if (actorChanged) {
        entries.clear();
        processed.clear();
        fenced.clear();
        resetPromise = null;
        state = {
          scope: copyScope(input.scope),
          epoch: input.epoch,
          generation: 1,
          revision: 1,
          conversationId: input.conversationId ?? null,
          busy: false,
          resetting: false,
        };
        publish();
        return;
      }
      const nextConversationId = input.conversationId === undefined ? state.conversationId : input.conversationId;
      const changed = state.epoch !== input.epoch
        || state.scope.mode !== input.scope.mode
        || state.conversationId !== nextConversationId;
      if (!changed) return;
      processed.clear();
      state.scope = copyScope(input.scope);
      state.epoch = input.epoch;
      // A view boundary suspends the old turn; its unresolved request ids stay
      // in the registry so New chat can still fence them.
      state.busy = false;
      if (!state.resetting && entries.size === 0) state.conversationId = nextConversationId;
      state.revision += 1;
      publish();
    },
    async handle(request) {
      if (disposed) return resultFor(request, false, "disposed");
      const prior = processed.get(request.operationId);
      if (prior) return prior;
      if (!state) return remember(resultFor(request, false, "stale_scope"));
      const live = deps.getLiveFence();
      if (!live
        || !sameOttoScope(live.scope, state.scope)
        || live.epoch !== state.epoch
        || live.generation !== state.generation
        || !sameOttoScope(request.scope, state.scope)
        || request.epoch !== state.epoch
        || request.generation !== state.generation) {
        return remember(resultFor(request, false, "stale_scope"));
      }
      let result: AdminConversationResult;
      if (request.type === "begin-send") result = await handleBegin(request);
      else if (request.type === "finish-send") result = await handleFinish(request);
      else if (request.type === "cancel-send") result = await handleCancel(request);
      else result = await handleDiscard(request);
      return remember(result);
    },
    dispose() {
      disposed = true;
      entries.clear();
      processed.clear();
      fenced.clear();
      state = null;
    },
  };
}

export function createLocalAdminConversationTransport(owner: AdminConversationOwner): AdminConversationTransport {
  return (request) => owner.handle(request);
}

export function createAdminConversationClient(deps: {
  windowId: AdminConversationWindow;
  getFence: () => AdminConversationFence | null;
  transport: AdminConversationTransport;
  createOperationId?: () => string;
  timeoutMs?: number;
}): AdminConversationClient {
  const timeoutMs = deps.timeoutMs ?? 8_000;
  const operationId = deps.createOperationId ?? (() => crypto.randomUUID());
  type RequestBody =
    | { type: "begin-send"; operationId: string; requestId: string; conversationId: string | null }
    | { type: "finish-send"; operationId: string; requestId: string; ticket: AdminConversationTicket; conversationId: string }
    | { type: "cancel-send"; operationId: string; requestId: string; ticket: AdminConversationTicket }
    | { type: "discard"; operationId: string; conversationId: string | null; requestId: string | null };
  const request = async (body: RequestBody): Promise<AdminConversationResult> => {
    const fence = deps.getFence();
    if (!fence) throw new AdminConversationError("stale_scope");
    const complete: AdminConversationRequest = {
      ...body,
      windowId: deps.windowId,
      scope: copyScope(fence.scope),
      epoch: fence.epoch,
      generation: fence.generation,
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AdminConversationError("timeout")), timeoutMs);
    });
    try {
      return await Promise.race([deps.transport(complete), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    async beginSend(input) {
      const fence = deps.getFence();
      if (!fence) throw new AdminConversationError("stale_scope");
      const result = await request({
        type: "begin-send",
        operationId: operationId(),
        requestId: input.requestId,
        conversationId: input.conversationId,
      });
      if (!result.accepted || !result.ticket) throw new AdminConversationError(result.reason ?? "invalid_ticket");
      return cloneTicket(result.ticket);
    },
    async finishSend(ticket, conversationId) {
      const result = await request({
        type: "finish-send",
        operationId: operationId(),
        requestId: ticket.requestId,
        ticket,
        conversationId,
      });
      if (!result.accepted) throw new AdminConversationError(result.reason ?? "invalid_ticket");
    },
    cancelSend(ticket) {
      void request({
        type: "cancel-send",
        operationId: operationId(),
        requestId: ticket.requestId,
        ticket,
      }).catch(() => undefined);
    },
    async discard(input) {
      const result = await request({
        type: "discard",
        operationId: operationId(),
        conversationId: input.conversationId,
        requestId: input.requestId,
      });
      if (!result.accepted) throw new AdminConversationError(result.reason ?? "discard_failed");
    },
  };
}

export type AdminConversationEventBus = {
  emit: (event: string, payload: unknown) => Promise<void> | void;
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void> | (() => void);
};

/** Event transport for the floating window. The result listener is installed
 * before the first request, so a fast acknowledgement cannot be missed. */
export async function createAdminConversationEventTransport(deps: {
  bus: AdminConversationEventBus;
  timeoutMs?: number;
}): Promise<{ transport: AdminConversationTransport; dispose: () => void }> {
  const pending = new Map<string, { resolve: (result: AdminConversationResult) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const off = await Promise.resolve(deps.bus.listen(OTTO_CONVERSATION_RESULT_EVENT, (message) => {
    // Tauri listeners receive an event envelope; test and local buses may pass
    // the raw payload. Accept both without changing the wire contract.
    const payload = message && typeof message === "object" && "payload" in message
      ? (message as { payload: unknown }).payload
      : message;
    const result = parseAdminConversationResult(payload);
    if (!result) return;
    const waiter = pending.get(result.operationId);
    if (!waiter) return;
    pending.delete(result.operationId);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }));
  return {
    transport(request) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.operationId);
          reject(new AdminConversationError("timeout"));
        }, deps.timeoutMs ?? 8_000);
        pending.set(request.operationId, { resolve, reject, timer });
        Promise.resolve(deps.bus.emit(OTTO_CONVERSATION_REQUEST_EVENT, request)).catch((error) => {
          const waiter = pending.get(request.operationId);
          if (!waiter) return;
          pending.delete(request.operationId);
          clearTimeout(waiter.timer);
          reject(error);
        });
      });
    },
    dispose() {
      off();
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new AdminConversationError("disposed"));
      }
      pending.clear();
    },
  };
}
