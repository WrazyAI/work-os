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

import { apiRequest, flushQueue, sendOrQueue } from "./api";

describe("offline action replay", () => {
  beforeEach(() => {
    mockState.queue = [];
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  });

  it("queues with an observed timestamp and replays idempotently after connectivity returns", async () => {
    const offlineFetch = vi.fn(async () => { throw new TypeError("offline"); });
    vi.stubGlobal("fetch", offlineFetch);
    const queued = await sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" });
    expect(queued).toEqual({ queued: true });
    expect(mockState.queue).toHaveLength(1);
    expect(mockState.queue[0].body.observed_at).toBeTruthy();
    expect(mockState.queue[0].id).toBeTruthy();
    expect(offlineFetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const onlineFetch = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", onlineFetch);
    expect(await flushQueue()).toEqual({ sent: 1, remaining: 0 });
    expect(mockState.queue).toEqual([]);
    expect(onlineFetch).toHaveBeenCalledTimes(2);
    expect(String(onlineFetch.mock.calls[1][0])).toContain("/api/work-os/me/workday");
    expect((onlineFetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
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
});
