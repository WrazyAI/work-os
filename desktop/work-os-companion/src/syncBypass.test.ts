import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineAction } from "./types";

const mockState = vi.hoisted(() => ({
  session: {
    token: "desktop-token",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    organizationId: "org-a",
    apiBase: "https://work.example.test",
  } satisfies import("./types").DesktopSession,
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

import { apiRequest, flushQueue, sendOrQueue, setSyncBypass, SyncBypassError } from "./api";
import { applyDayScenario, DEBUG_PRESETS, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import type { DebugScenario } from "./types";

describe("offline sync bypass", () => {
  beforeEach(() => {
    mockState.queue = [];
    setSyncBypass(false);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setSyncBypass(false);
    vi.unstubAllGlobals();
  });

  it("blocks reads with a typed bypass error and never touches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setSyncBypass(true);
    await expect(apiRequest("/api/work-os/me/day")).rejects.toBeInstanceOf(SyncBypassError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks writes without queueing them for replay", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setSyncBypass(true);
    await expect(sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" })).rejects.toBeInstanceOf(SyncBypassError);
    expect(mockState.queue).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns queue counts from flush without flushing anything", async () => {
    mockState.queue = [{
      id: "q1", method: "POST", path: "/api/work-os/me/workday", body: {}, createdAt: new Date().toISOString(),
      attempts: 0, status: "needs_attention",
    }];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setSyncBypass(true);
    const result = await flushQueue();
    expect(result).toEqual({ remaining: 1, needsAttention: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockState.queue).toHaveLength(1);
  });

  it("restores normal network behavior when the bypass is disabled", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    setSyncBypass(true);
    setSyncBypass(false);
    await expect(apiRequest<{ ok: boolean }>("/api/work-os/me/day")).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("offline playground scenario", () => {
  it("is exposed as a preset that enables bypass with a clocked-in day", () => {
    const preset = DEBUG_PRESETS.find((entry) => entry.id === "offline_playground");
    expect(preset).toBeDefined();
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, ...preset!.scenario } satisfies DebugScenario;
    expect(scenario.enabled).toBe(true);
    expect(scenario.syncBypass).toBe(true);
    expect(scenario.dayState).toBe("clocked_in");
  });

  it("still synthesizes the workspace day from fixtures", () => {
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, dayState: "clocked_in" } satisfies DebugScenario;
    const day = applyDayScenario(null, scenario);
    expect(day).not.toBeNull();
    expect(day!.tasks.length).toBeGreaterThan(0);
    expect(day!.session).not.toBeNull();
  });
});
