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

import { flushQueue, sendOrQueue } from "./api";

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
});
