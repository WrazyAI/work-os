import { secureState } from "./vault";
import { diagnostics } from "./diagnostics";
import type { OfflineAction } from "./types";

function cleanBase(value: string) { return value.trim().replace(/\/$/, ""); }

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return diagnostics.withSpan("api.request", async () => {
    const session = await secureState.session();
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("Connect this device to WrazyOS.");
    const signal = init.signal ?? AbortSignal.timeout(20_000);
    const response = await fetch(`${cleanBase(session.apiBase)}${path}`, {
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
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((result as { error?: string }).error || `Work OS request failed (${response.status})`);
    return result as T;
  }, { path, method: init.method ?? "GET", statusHint: "request" }, "sync");
}

export async function sendOrQueue(path: string, method: "POST" | "PUT" | "PATCH", body: Record<string, unknown>) {
  const createdAt = new Date().toISOString();
  const replaySafeBody = { ...body, observed_at: body.observed_at ?? createdAt };
  const action: OfflineAction = { id: crypto.randomUUID(), path, method, body: replaySafeBody, createdAt, attempts: 0 };
  try {
    return await apiRequest(path, { method, headers: { "Idempotency-Key": action.id }, body: JSON.stringify(replaySafeBody) });
  } catch (error) {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    diagnostics.warn("offline_queue.enqueued", "Request queued for retry", { path, method }, { source: "sync" });
    const queue = await secureState.queue();
    const pending = path === "/api/work-os/me/plan" && method === "PUT"
      ? queue.filter((queued) => queued.path !== path || queued.method !== method)
      : queue;
    await secureState.saveQueue([...pending, action]);
    return { queued: true };
  }
}

export async function flushQueue() {
  return diagnostics.withSpan("offline_queue.flush", async () => {
    const queue = await secureState.queue();
    const remaining: OfflineAction[] = [];
    for (const action of queue) {
      try {
        await apiRequest("/api/work-os/me/day");
        await apiRequest(action.path, { method: action.method, headers: { "Idempotency-Key": action.id }, body: JSON.stringify(action.body) });
      } catch (error) {
        diagnostics.warn("offline_queue.retrying", error instanceof Error ? error.message : "Sync failed", { path: action.path, attempts: action.attempts + 1 }, { source: "sync" });
        remaining.push({ ...action, attempts: action.attempts + 1, lastError: error instanceof Error ? error.message : "Sync failed" });
      }
    }
    await secureState.saveQueue(remaining);
    return { sent: queue.length - remaining.length, remaining: remaining.length };
  }, {}, "sync");
}
