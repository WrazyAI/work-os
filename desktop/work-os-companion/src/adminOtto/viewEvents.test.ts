import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  constructor(public readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(value: unknown) { this.posted.push(value); }
  close() { this.closed = true; }
  peer(payload: unknown) { this.onmessage?.({ data: payload } as MessageEvent<unknown>); }
}

describe("DEV Otto view event bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).BroadcastChannel = FakeBroadcastChannel;
  });

  it("delivers an allowed view snapshot in the same window and cleans up", async () => {
    const { emit, listen } = await import("../tauriEvents");
    const seen: unknown[] = [];
    const off = await listen<unknown>("work-os://otto-view-state", ({ payload }) => seen.push(payload));
    await emit("work-os://otto-view-state", { scope: { userId: "u", organizationId: "o", mode: "admin" } });
    expect(seen).toHaveLength(1);
    off();
    await emit("work-os://otto-view-state", { ignored: true });
    expect(seen).toHaveLength(1);
  });

  it("receives a peer view event and rejects unknown events", async () => {
    const { listen } = await import("../tauriEvents");
    const seen: unknown[] = [];
    await listen<unknown>("work-os://otto-view-request", ({ payload }) => seen.push(payload));
    const channel = FakeBroadcastChannel.instances[0]!;
    channel.peer({ event: "work-os://otto-view-request", payload: { requestId: "r" } });
    channel.peer({ event: "work-os://not-allowed", payload: { secret: "x" } });
    expect(seen).toEqual([{ requestId: "r" }]);
  });

  it("does not forward a disallowed event to a peer channel", async () => {
    const { emit, listen } = await import("../tauriEvents");
    const seen: unknown[] = [];
    await listen<unknown>("work-os://otto-view-result", ({ payload }) => seen.push(payload));
    const channel = FakeBroadcastChannel.instances[0]!;
    await emit("work-os://not-allowed", { secret: "x" });
    expect(seen).toEqual([]);
    expect(channel.posted).toEqual([]);
  });
});
