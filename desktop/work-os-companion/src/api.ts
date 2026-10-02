import { secureState } from "./vault";
import { diagnostics } from "./diagnostics";
import type { OfflineAction } from "./types";

const MAX_QUEUE_ATTEMPTS = 6;

// Offline sync bypass (debugger scenario): when active, no network call may
// leave the app. Reads are served by scenario fixtures at the view layer;
// writes are simulated by App-level handlers.
let syncBypassActive = false;
// Dev-only bridge: scenario mode can register its fabricated session so the
// API layer resolves it in a plain browser. Never active in production builds.
let debugSession: import("./types").DesktopSession | null = null;
export function setDebugSession(session: import("./types").DesktopSession | null) {
  debugSession = import.meta.env && import.meta.env.DEV ? session : null;
}
export function setSyncBypass(active: boolean) {
  syncBypassActive = active;
}
export class SyncBypassError extends Error {
  constructor() {
    super("Offline sync bypass is active — the backend was not contacted.");
    this.name = "SyncBypassError";
  }
}
const MAX_BACKOFF_MS = 60 * 60_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type QueueFlushResult = {
  sent?: number;
  remaining: number;
  needsAttention: number;
  retiredAttendanceControls?: number;
};

function cleanBase(value: string) { return value.trim().replace(/\/$/, ""); }

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly conflict = false,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function classifyRequestFailure(error: unknown) {
  if (error instanceof ApiRequestError) {
    return {
      retryable: error.retryable,
      conflict: error.conflict,
      status: error.status,
      message: error.message,
    };
  }
  const network = error instanceof TypeError
    || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
  return {
    retryable: network,
    conflict: false,
    status: null,
    message: error instanceof Error ? error.message : "Request failed",
  };
}

function backoffMs(attempts: number) {
  const base = Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, attempts - 1));
  return base + Math.floor(Math.random() * Math.min(5_000, base / 4));
}

function reschedule(action: OfflineAction, error: unknown, now = Date.now()): OfflineAction {
  const failure = classifyRequestFailure(error);
  const attempts = action.attempts + 1;
  const terminal = !failure.retryable || attempts >= MAX_QUEUE_ATTEMPTS;
  return {
    ...action,
    attempts,
    lastError: failure.message,
    statusCode: failure.status ?? undefined,
    status: terminal ? "needs_attention" : "pending",
    failureKind: terminal
      ? failure.conflict ? "conflict" : failure.retryable ? "retry_exhausted" : "permanent"
      : undefined,
    nextAttemptAt: terminal ? undefined : new Date(now + backoffMs(attempts)).toISOString(),
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return diagnostics.withSpan("api.request", async () => {
    if (syncBypassActive) throw new SyncBypassError();
    const session = (await secureState.session()) ?? (import.meta.env && import.meta.env.DEV ? debugSession : null);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new ApiRequestError("Connect this device to WrazyOS.", 401, false);
    }
    const signal = init.signal ?? AbortSignal.timeout(20_000);
    let response: Response;
    try {
      response = await fetch(`${cleanBase(session.apiBase)}${path}`, {
        ...init,
        signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-Work-OS-Organization-Id": session.organizationId,
          ...(init.body && !(typeof FormData !== "undefined" && init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      if (init.signal?.aborted && error instanceof Error && error.name === "AbortError") throw error;
      const failure = classifyRequestFailure(error);
      throw new ApiRequestError(failure.message, null, true);
    }
    const result = response.status === 204 ? undefined : await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (result as { error?: string } | undefined)?.error || `Work OS request failed (${response.status})`;
      const reason = typeof (result as { reason?: unknown } | undefined)?.reason === "string"
        ? (result as { reason: string }).reason
        : undefined;
      throw new ApiRequestError(message, response.status, RETRYABLE_STATUS.has(response.status), response.status === 409, reason);
    }
    return result as T;
  }, { path, method: init.method ?? "GET", statusHint: "request" }, "sync");
}

/** Authenticated binary fetch for protected media such as screenshot previews. */
export async function apiRequestBlob(path: string, label = "Media"): Promise<Blob> {
  return diagnostics.withSpan("api.requestBlob", async () => {
    if (syncBypassActive) throw new SyncBypassError();
    const session = (await secureState.session()) ?? (import.meta.env && import.meta.env.DEV ? debugSession : null);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new ApiRequestError("Connect this device to WrazyOS.", 401, false);
    }
    let response: Response;
    try {
      response = await fetch(`${cleanBase(session.apiBase)}${path}`, {
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-Work-OS-Organization-Id": session.organizationId,
        },
      });
    } catch (error) {
      const failure = classifyRequestFailure(error);
      throw new ApiRequestError(failure.message, null, true);
    }
    if (!response.ok) {
      throw new ApiRequestError(`${label} failed (${response.status})`, response.status, RETRYABLE_STATUS.has(response.status));
    }
    return response.blob();
  }, { path, method: "GET", statusHint: "blob" }, "sync");
}

type TaskCompletionResponse = {
  task: { completed?: boolean; provider?: string };
  providerStatus?: string;
  reconciled?: boolean;
};

/** True when a queue-aware mutation was saved on this device for retry instead
 * of reaching the server. Callers must never report it as delivered. */
export function isQueuedResult(value: unknown): value is { queued: true } {
  return !!value && typeof value === "object" && (value as { queued?: unknown }).queued === true;
}

/**
 * Applies an idempotent task completion state and reconciles an ambiguous
 * response against Nifty-backed task detail before surfacing a failure.
 *
 * A transport can disappear after Nifty has committed the mutation. Retrying
 * the write would be misleading and can duplicate downstream events, while
 * reporting the request as failed contradicts the provider. The detail route
 * refreshes the single task from Nifty, so a matching readback is definitive.
 */
export async function updateTaskCompletion(taskId: string, completed: boolean): Promise<TaskCompletionResponse> {
  const path = `/api/work-os/me/tasks/${encodeURIComponent(taskId)}`;
  try {
    return await apiRequest<TaskCompletionResponse>(path, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    });
  } catch (mutationError) {
    try {
      const readback = await apiRequest<TaskCompletionResponse>(path);
      if (readback.task?.completed === completed) {
        diagnostics.warn("task.completion_reconciled", "Recovered task completion after an ambiguous mutation response", {
          taskId,
          completed,
        });
        return { ...readback, providerStatus: readback.task?.provider === "local" ? "work_os_confirmed" : "nifty_confirmed", reconciled: true };
      }
    } catch {
      // Preserve the mutation failure; it is the actionable error for the user.
    }
    throw mutationError;
  }
}

/** Full-state saves: a newer PUT on the same path replaces the whole plan or
 * onboarding payload, so older queued copies are superseded by definition. */
function isFullStateSave(path: string, method: string) {
  return (path === "/api/work-os/me/plan" || path === "/api/work-os/me/onboarding") && method === "PUT";
}

export async function sendOrQueue(path: string, method: "POST" | "PUT" | "PATCH", body: Record<string, unknown>) {
  if (syncBypassActive) throw new SyncBypassError();
  const createdAt = new Date().toISOString();
  const replaySafeBody = { ...body, observed_at: body.observed_at ?? createdAt };
  const action: OfflineAction = {
    id: crypto.randomUUID(),
    path,
    method,
    body: replaySafeBody,
    createdAt,
    attempts: 0,
    status: "pending",
  };
  try {
    const result = await apiRequest(path, {
      method,
      headers: { "Idempotency-Key": action.id },
      body: JSON.stringify(replaySafeBody),
    });
    if (isFullStateSave(path, method)) {
      // The server now holds this newer payload, so earlier copies that gave
      // up retrying are stale; leaving them queued keeps reporting "needs
      // attention" for work this save already replaced.
      const queue = await secureState.queue();
      const live = queue.filter((queued) => !(queued.path === path && queued.method === method && queued.status === "needs_attention"));
      if (live.length !== queue.length) await secureState.saveQueue(live);
    }
    return result;
  } catch (error) {
    const failure = classifyRequestFailure(error);
    if (!failure.retryable) throw error;
    diagnostics.warn("offline_queue.enqueued", "Request queued for retry", { path, method }, { source: "sync" });
    const queue = await secureState.queue();
    const pending = isFullStateSave(path, method)
      ? queue.filter((queued) => queued.path !== path || queued.method !== method || queued.status === "needs_attention")
      : queue;
    await secureState.saveQueue([...pending, action]);
    return { queued: true };
  }
}

export function readyInterpretations(queue: OfflineAction[]): OfflineAction[] {
  return queue.filter((action) => action.path === "/api/work-os/me/interpret" && action.status === "ready_for_review");
}

/** The manual classifier is an explicit choice, so it cancels a stale queued proposal. */
export async function discardReadyInterpretation(id: string) {
  const queue = await secureState.queue();
  await secureState.saveQueue(queue.filter((action) => action.id !== id || action.status !== "ready_for_review"));
}

export async function flushQueue(now = Date.now()): Promise<QueueFlushResult> {
  return diagnostics.withSpan("offline_queue.flush", async () => {
    let queue = await secureState.queue();
    if (syncBypassActive) {
      return { remaining: queue.length, needsAttention: queue.filter((action) => action.status === "needs_attention").length };
    }
    const obsoleteAttendance = queue.filter((action) => {
      if (action.path.replace(/\/$/, "") !== "/api/work-os/me/workday") return false;
      if (action.method === "POST") return true;
      return action.method === "PATCH" && !["late_reason", "resolve_missed_clock_out"].includes(String(action.body.action ?? ""));
    });
    if (obsoleteAttendance.length) {
      const obsoleteIds = new Set(obsoleteAttendance.map((action) => action.id));
      queue = queue.filter((action) => !obsoleteIds.has(action.id));
      await secureState.saveQueue(queue);
      diagnostics.warn("offline_queue.worktivity_migration", "Saved attendance actions were not replayed because Worktivity now controls clock status.", {
        count: obsoleteAttendance.length,
        methods: [...new Set(obsoleteAttendance.map((action) => action.method))],
      }, { source: "sync" });
    }
    const retiredAttendanceControls = obsoleteAttendance.length;
    const withRetired = <T extends Record<string, unknown>>(result: T) => retiredAttendanceControls
      ? { ...result, retiredAttendanceControls }
      : result;
    const due = queue.filter((action) =>
      action.status === "pending"
      && (!action.nextAttemptAt || Date.parse(action.nextAttemptAt) <= now)
    );
    if (!due.length) {
      return withRetired({
        sent: 0,
        remaining: queue.length,
        needsAttention: queue.filter((action) => action.status === "needs_attention").length,
      });
    }

    try {
      // One lightweight authenticated probe per flush. This route does not
      // refresh Worktivity or Nifty and prevents one bad mutation from causing
      // repeated full-day refreshes.
      await apiRequest<{ ok: true }>("/api/work-os/desktop/session");
    } catch (error) {
      const dueIds = new Set(due.map((action) => action.id));
      const remaining = queue.map((action) => dueIds.has(action.id) ? reschedule(action, error, now) : action);
      await secureState.saveQueue(remaining);
      return withRetired({
        sent: 0,
        remaining: remaining.length,
        needsAttention: remaining.filter((action) => action.status === "needs_attention").length,
      });
    }

    const dueIds = new Set(due.map((action) => action.id));
    const remaining = queue.filter((action) => !dueIds.has(action.id));
    let sent = 0;
    for (const action of due) {
      try {
        const result = await apiRequest(action.path, {
          method: action.method,
          headers: { "Idempotency-Key": action.id },
          body: JSON.stringify(action.body),
        });
        sent += 1;
        if (action.path === "/api/work-os/me/interpret") {
          remaining.push({ ...action, status: "ready_for_review", result, nextAttemptAt: undefined, lastError: undefined });
        }
      } catch (error) {
        const next = reschedule(action, error, now);
        diagnostics.warn(
          next.status === "needs_attention" ? "offline_queue.needs_attention" : "offline_queue.retrying",
          next.lastError || "Sync failed",
          { path: action.path, attempts: next.attempts, failureKind: next.failureKind },
          { source: "sync" },
        );
        remaining.push(next);
      }
    }
    await secureState.saveQueue(remaining);
    return withRetired({
      sent,
      remaining: remaining.length,
      needsAttention: remaining.filter((action) => action.status === "needs_attention").length,
    });
  }, {}, "sync");
}
