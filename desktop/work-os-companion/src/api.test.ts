import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSession, OfflineAction } from "./types";

const mockState = vi.hoisted(() => ({
  session: {
    token: "desktop-token",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    organizationId: "org-a",
    apiBase: "https://work.example.test",
  } satisfies DesktopSession,
  queue: [] as OfflineAction[],
}));

vi.mock("./vault", () => ({
  secureState: {
    session: vi.fn(async () => mockState.session),
    queue: vi.fn(async () => mockState.queue),
    saveQueue: vi.fn(async (queue: OfflineAction[]) => { mockState.queue = queue; }),
  },
}));

vi.mock("./diagnostics", () => ({
  diagnostics: { withSpan: vi.fn(async (_category: string, action: () => Promise<unknown>) => action()), warn: vi.fn() },
}));

import { apiRequest, flushQueue, isQueuedResult, readyInterpretations, sendOrQueue, updateTaskCompletion, uploadTaskCompletionEvidence } from "./api";

describe("offline action replay", () => {
  beforeEach(() => {
    mockState.queue = [];
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  });

  it("does not replay an old queued clock action after attendance moves to Worktivity", async () => {
    const offlineFetch = vi.fn(async () => { throw new TypeError("offline"); });
    vi.stubGlobal("fetch", offlineFetch);
    const queued = await sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" });
    expect(queued).toEqual({ queued: true });
    expect(mockState.queue).toHaveLength(1);
    expect(mockState.queue[0].body.observed_at).toBeTruthy();
    expect(mockState.queue[0].id).toBeTruthy();
    expect(offlineFetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    mockState.queue.push({ id: "late-reason", path: "/api/work-os/me/workday", method: "PATCH", body: { action: "late_reason", reason: "Traffic" }, createdAt: new Date().toISOString(), attempts: 0, status: "pending" });
    const onlineFetch = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", onlineFetch);
    expect(await flushQueue()).toEqual({ sent: 1, remaining: 0, needsAttention: 0, retiredAttendanceControls: 1 });
    expect(mockState.queue).toEqual([]);
    expect(onlineFetch).toHaveBeenCalledTimes(2);
    expect(String(onlineFetch.mock.calls[0][0])).toContain("/api/work-os/desktop/session");
    expect(String(onlineFetch.mock.calls[1][0])).toContain("/api/work-os/me/workday");
    expect((onlineFetch.mock.calls[1][1] as RequestInit).method).toBe("PATCH");
    expect((onlineFetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
  });

  it("collapses offline plan autosaves to the latest draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));

    await sendOrQueue("/api/work-os/me/plan", "PUT", { revision: 1, successful_day_intent: "First draft" });
    await sendOrQueue("/api/work-os/me/plan", "PUT", { revision: 1, successful_day_intent: "Latest draft" });

    expect(mockState.queue).toHaveLength(1);
    expect(mockState.queue[0].body).toMatchObject({ revision: 1, successful_day_intent: "Latest draft" });
  });

  it("clears a plan save that gave up retrying once a newer plan save succeeds", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    mockState.queue = [
      {
        id: "stale-plan-save", path: "/api/work-os/me/plan", method: "PUT", body: {},
        createdAt: new Date().toISOString(), attempts: 6, status: "needs_attention",
      },
      {
        id: "other-work", path: "/api/work-os/me/interpret", method: "POST", body: {},
        createdAt: new Date().toISOString(), attempts: 1, status: "needs_attention",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ plan: {} }), { status: 200, headers: { "content-type": "application/json" } })));

    await sendOrQueue("/api/work-os/me/plan", "PUT", { revision: 2, freeform_intent: "Fresh save" });

    expect(mockState.queue.map((action) => action.id)).toEqual(["other-work"]);
  });

  it("retains a replayed interpretation as ready for explicit review", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const queued = await sendOrQueue("/api/work-os/me/interpret", "POST", { input: "Finished the release notes" });
    expect(queued).toEqual({ queued: true });

    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ interpretation: { operations: [{ op: "record_progress" }] } }), { status: 200, headers: { "content-type": "application/json" } })));

    expect(await flushQueue()).toEqual({ sent: 1, remaining: 1, needsAttention: 0 });
    expect(mockState.queue[0]).toMatchObject({ path: "/api/work-os/me/interpret", status: "ready_for_review" });
    expect(readyInterpretations(mockState.queue)).toHaveLength(1);

    const noReplay = vi.fn();
    vi.stubGlobal("fetch", noReplay);
    expect(await flushQueue()).toEqual({ sent: 0, remaining: 1, needsAttention: 0 });
    expect(noReplay).not.toHaveBeenCalled();
  });

  it("sends authenticated proposal decisions even when no work session is active", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const onlineFetch = vi.fn(async () => new Response(JSON.stringify({ proposal: { status: "accepted" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", onlineFetch);

    await sendOrQueue("/api/work-os/proposals/proposal-1", "PATCH", { decision: "accept" });

    const [url, init] = onlineFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://work.example.test/api/work-os/proposals/proposal-1");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer desktop-token",
      "X-Work-OS-Organization-Id": "org-a",
      "Content-Type": "application/json",
      "Idempotency-Key": expect.any(String),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({ decision: "accept", observed_at: expect.any(String) });
    expect(mockState.queue).toEqual([]);
  });

  it("surfaces server validation errors instead of hiding them in the offline queue", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Clock in before confirming a plan." }), { status: 409, headers: { "content-type": "application/json" } })));

    await expect(apiRequest("/api/work-os/me/plan", { method: "PATCH", body: "{}" })).rejects.toThrow("Clock in before confirming a plan.");
    expect(mockState.queue).toEqual([]);
  });

  it("preserves caller cancellation instead of wrapping it as a network failure", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const controller = new AbortController();
    const abortError = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort();
      throw abortError;
    }));

    await expect(apiRequest("/api/work-os/me/tasks?view=history", { signal: controller.signal })).rejects.toBe(abortError);
  });

  it("reconciles a lost completion response from Nifty-backed task detail", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const onlineFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset after write"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: { completed: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", onlineFetch);

    await expect(updateTaskCompletion("task/one", true)).resolves.toMatchObject({
      task: { completed: true },
      providerStatus: "nifty_confirmed",
      reconciled: true,
    });
    expect(onlineFetch).toHaveBeenCalledTimes(2);
    expect(String(onlineFetch.mock.calls[1][0])).toContain("/api/work-os/me/tasks/task%2Fone");
    expect(onlineFetch.mock.calls[1][1]?.method).toBeUndefined();
  });

  it("preserves the mutation failure when provider readback does not match", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const onlineFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset before write"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: { completed: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", onlineFetch);

    await expect(updateTaskCompletion("task-two", true)).rejects.toThrow("connection reset before write");
    expect(onlineFetch).toHaveBeenCalledTimes(2);
  });

  it("moves a permanently rejected replay to Needs Attention", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    mockState.queue = [{
      id: "action-permanent", path: "/api/work-os/me/onboarding", method: "PUT", body: {},
      createdAt: new Date().toISOString(), attempts: 1, status: "pending",
    }];
    const onlineFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Revision conflict" }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", onlineFetch);

    expect(await flushQueue()).toEqual({ sent: 0, remaining: 1, needsAttention: 1 });
    expect(mockState.queue[0]).toMatchObject({ status: "needs_attention", failureKind: "conflict", statusCode: 409, attempts: 2 });
  });

  it("stops retrying after the configured ceiling", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    mockState.queue = [{
      id: "action-exhausted", path: "/api/work-os/me/plan", method: "PUT", body: {},
      createdAt: new Date().toISOString(), attempts: 5, status: "pending",
    }];
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));

    expect(await flushQueue()).toEqual({ sent: 0, remaining: 1, needsAttention: 1 });
    expect(mockState.queue[0]).toMatchObject({ status: "needs_attention", failureKind: "retry_exhausted", attempts: 6 });
  });
});

describe("queued result contract", () => {
  it("only treats an explicit queued flag as saved-not-delivered", () => {
    expect(isQueuedResult({ queued: true })).toBe(true);
    expect(isQueuedResult({ queued: false })).toBe(false);
    expect(isQueuedResult({ ok: true })).toBe(false);
    expect(isQueuedResult(undefined)).toBe(false);
    expect(isQueuedResult(null)).toBe(false);
    expect(isQueuedResult("queued")).toBe(false);
  });
});

describe("completion evidence upload", () => {
  const evidence = {
    id: "evidence-1",
    title: "Ship the drawer — completion evidence",
    note: "Signed verification record.",
    fileName: "notes.txt",
    contentType: "text/plain",
    sizeBytes: 5,
    createdAt: "2026-08-21T16:42:00.000Z",
    url: "/api/work-os/evidence/evidence-1/file",
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    vi.restoreAllMocks();
  });

  it("sends multipart form data without a JSON content type and reports confirmed completion", async () => {
    const onlineFetch = vi.fn(async () => new Response(JSON.stringify({ evidence, task: { completed: true }, providerStatus: "work_os_confirmed" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", onlineFetch);
    const result = await uploadTaskCompletionEvidence("task/one", new File(["hello"], "notes.txt", { type: "text/plain" }), "Shows the check", true, "idem-1");
    expect(result).toMatchObject({ outcome: "completed", evidence });
    const [url, init] = onlineFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://work.example.test/api/work-os/me/tasks/task%2Fone/completion-evidence");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).not.toMatchObject({ "Content-Type": "application/json" });
    expect((init.body as FormData).get("idempotency_key")).toBe("idem-1");
    expect((init.body as FormData).get("complete")).toBe("true");
  });

  it("keeps a saved-evidence receipt when completion fails after the upload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Evidence saved. This task records an expected outcome.",
      evidence,
      task: null,
      completion: "failed",
    }), { status: 502, headers: { "content-type": "application/json" } })));
    const result = await uploadTaskCompletionEvidence("task-1", new File(["hello"], "notes.txt", { type: "text/plain" }), "", true, "idem-2");
    expect(result).toEqual({
      outcome: "completion_failed",
      evidence,
      error: "Evidence saved. This task records an expected outcome.",
    });
  });
});
