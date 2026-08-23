import { secureState } from "./vault";
import { diagnostics } from "./diagnostics";
import type { OfflineAction } from "./types";

const MAX_QUEUE_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 60 * 60_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function cleanBase(value: string) { return value.trim().replace(/\/$/, ""); }

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly conflict = false,
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
    const session = await secureState.session();
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
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      const failure = classifyRequestFailure(error);
      throw new ApiRequestError(failure.message, null, true);
    }
    const result = response.status === 204 ? undefined : await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (result as { error?: string } | undefined)?.error || `Work OS request failed (${response.status})`;
      throw new ApiRequestError(message, response.status, RETRYABLE_STATUS.has(response.status), response.status === 409);
    }
    return result as T;
  }, { path, method: init.method ?? "GET", statusHint: "request" }, "sync");
}

export async function sendOrQueue(path: string, method: "POST" | "PUT" | "PATCH", body: Record<string, unknown>) {
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
    return await apiRequest(path, {
      method,
      headers: { "Idempotency-Key": action.id },
      body: JSON.stringify(replaySafeBody),
    });
  } catch (error) {
    const failure = classifyRequestFailure(error);
    if (!failure.retryable) throw error;
    diagnostics.warn("offline_queue.enqueued", "Request queued for retry", { path, method }, { source: "sync" });
    const queue = await secureState.queue();
    const pending = (path === "/api/work-os/me/plan" || path === "/api/work-os/me/onboarding") && method === "PUT"
      ? queue.filter((queued) => queued.path !== path || queued.method !== method || queued.status === "needs_attention")
      : queue;
    await secureState.saveQueue([...pending, action]);
    return { queued: true };
  }
}

export async function flushQueue(now = Date.now()) {
  return diagnostics.withSpan("offline_queue.flush", async () => {
    const queue = await secureState.queue();
    const due = queue.filter((action) =>
      action.status !== "needs_attention"
      && (!action.nextAttemptAt || Date.parse(action.nextAttemptAt) <= now)
    );
    if (!due.length) {
      return {
        sent: 0,
        remaining: queue.length,
        needsAttention: queue.filter((action) => action.status === "needs_attention").length,
      };
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
      return {
        sent: 0,
        remaining: remaining.length,
        needsAttention: remaining.filter((action) => action.status === "needs_attention").length,
      };
    }

    const dueIds = new Set(due.map((action) => action.id));
    const remaining = queue.filter((action) => !dueIds.has(action.id));
    let sent = 0;
    for (const action of due) {
      try {
        await apiRequest(action.path, {
          method: action.method,
          headers: { "Idempotency-Key": action.id },
          body: JSON.stringify(action.body),
        });
        sent += 1;
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
    return {
      sent,
      remaining: remaining.length,
      needsAttention: remaining.filter((action) => action.status === "needs_attention").length,
    };
  }, {}, "sync");
}
