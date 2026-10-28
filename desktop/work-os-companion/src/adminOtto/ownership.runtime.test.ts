import { afterEach, describe, expect, it, vi } from "vitest";
import { listen, emit } from "../tauriEvents";
import { OTTO_DELIVERY_OWNER_EVENT } from "./mode";
import { AVATAR_OWNER_HEARTBEAT_MS, AVATAR_OWNER_LEASE_MS, ownerEventPayload, startDeliveryOwnership } from "./ownership";

const native = vi.hoisted(() => ({ handlers: new Map<string, Set<(event: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    const group = native.handlers.get(name) ?? new Set();
    group.add(handler); native.handlers.set(name, group);
    return () => { group.delete(handler); };
  },
  emit: async (name: string, payload: unknown) => {
    for (const handler of native.handlers.get(name) ?? []) handler({ payload });
  },
}));
const context = { scope: { userId: "user-1", organizationId: "org-1", mode: "admin" as const }, epoch: 3 };
afterEach(() => { vi.useRealTimers(); native.handlers.clear(); });

describe("production cross-window ownership over the Tauri event adapter", () => {
  it("elects avatar, renews without restarting delivery, and recovers main after a crash", async () => {
    vi.useFakeTimers();
    const main: boolean[] = [], avatar: boolean[] = [];
    const stopMain = startDeliveryOwnership({ window: "main", context, avatarVisible: true, onChange: (owner) => main.push(owner) });
    const stopAvatar = startDeliveryOwnership({ window: "avatar", context, avatarVisible: true, onChange: (owner) => avatar.push(owner) });
    await vi.advanceTimersByTimeAsync(0);
    expect(avatar.at(-1)).toBe(true);
    expect(main.at(-1)).toBe(false);
    await vi.advanceTimersByTimeAsync(AVATAR_OWNER_HEARTBEAT_MS * 3);
    expect(main.filter(Boolean)).toHaveLength(0);
    expect(avatar.filter(Boolean)).toHaveLength(1);
    // Simulate process death: drop its outgoing events, rather than relying on cleanup.
    native.handlers.get(OTTO_DELIVERY_OWNER_EVENT)?.clear();
    stopAvatar();
    await vi.advanceTimersByTimeAsync(AVATAR_OWNER_LEASE_MS);
    expect(main.at(-1)).toBe(true);
    stopMain();
  });

  it("does not let a stale actor/epoch false event displace a fresh owner", async () => {
    vi.useFakeTimers();
    const ownership: boolean[] = [];
    const stop = startDeliveryOwnership({ window: "main", context, avatarVisible: true, onChange: (owner) => ownership.push(owner) });
    await vi.advanceTimersByTimeAsync(0);
    await emit(OTTO_DELIVERY_OWNER_EVENT, ownerEventPayload({ window: "avatar", windowId: "avatar", ...context, active: true }));
    await emit(OTTO_DELIVERY_OWNER_EVENT, ownerEventPayload({ window: "avatar", windowId: "avatar", ...context, epoch: 2, active: false }));
    await emit(OTTO_DELIVERY_OWNER_EVENT, ownerEventPayload({ window: "avatar", windowId: "avatar", ...context, scope: { ...context.scope, userId: "other" }, active: false }));
    expect(ownership.at(-1)).toBe(false);
    await vi.advanceTimersByTimeAsync(AVATAR_OWNER_LEASE_MS);
    expect(ownership.at(-1)).toBe(true);
    stop();
  });

  it("cleans up a native subscription that resolves after shutdown", async () => {
    let resolve!: (off: () => void) => void;
    const off = vi.fn();
    const stop = startDeliveryOwnership({ window: "main", context, avatarVisible: false, onChange: () => undefined,
      listen: () => new Promise((done) => { resolve = done; }), emit,
    });
    stop(); resolve(off); await Promise.resolve();
    expect(off).toHaveBeenCalledOnce();
    // The real adapter remains importable; production does not bridge admin data to browser fixtures.
    expect(listen).toBeTypeOf("function");
  });
});
