import { afterEach, expect, it, vi } from "vitest";
import { createDayMonitorClient, monitorDaySnapshot } from "./dayMonitor";

afterEach(() => vi.useRealTimers());

it("uses host arbitration and passes scoped snapshots between independent clients", async () => {
  vi.useFakeTimers();
  let owner = "main";
  let stored: string | null = null;
  const listeners = new Map<string, (scope: string) => void>();
  const changed = { main: vi.fn(), avatar: vi.fn() };
  const clients = ["main", "avatar"].map((window) => createDayMonitorClient({
    scope: "account-a", window: window as "main" | "avatar",
    onOwner: changed[window as "main" | "avatar"], onSnapshot: changed[window as "main" | "avatar"],
    transport: {
      claim: async () => owner === window,
      read: async () => stored,
      publish: async (value) => { if (owner !== window) return false; stored = value; listeners.get(window === "main" ? "avatar" : "main")?.("account-a"); return true; },
      release: async () => undefined,
      listen: async (listener) => { listeners.set(window, listener); return () => { listeners.delete(window); }; },
    },
  }));
  await Promise.all(clients.map((client) => client.start()));
  expect(await clients[0].isOwner()).toBe(true);
  expect(await clients[1].isOwner()).toBe(false);
  const day = { at: "now", shiftDate: "2026-11-04", tasks: [], evidence: ["not shared"], taskHistory: ["not shared"], workspaceSummary: { carryOverGroups: ["not shared"] } } as any;
  await clients[0].publish(day);
  await vi.advanceTimersByTimeAsync(0);
  expect(changed.avatar).toHaveBeenLastCalledWith(expect.objectContaining({ shiftDate: "2026-11-04" }));
  expect(JSON.parse(stored!)).not.toHaveProperty("evidence");
  owner = "avatar";
  expect(await clients[0].isOwner()).toBe(false);
  expect(await clients[1].isOwner()).toBe(true);
  expect(await clients[0].publish(day)).toBe(false);
  await Promise.all(clients.map((client) => client.stop()));
  expect(listeners.size).toBe(0);
});

it("never applies late snapshots after a scope retires", async () => {
  let resolve!: (value: string) => void;
  const onSnapshot = vi.fn();
  const client = createDayMonitorClient({ scope: "old", window: "main", onOwner: () => undefined, onSnapshot,
    transport: { claim: async () => false, read: () => new Promise<string>((done) => { resolve = done; }), publish: async () => false, release: async () => undefined, listen: async () => () => undefined } });
  const starting = client.start();
  await Promise.resolve(); await Promise.resolve();
  await client.stop();
  resolve(JSON.stringify({ shiftDate: "old private day" }));
  await starting;
  expect(onSnapshot).not.toHaveBeenCalled();
});

it("shares only bounded status/task choices, never hidden collections or task descriptions", () => {
  const snapshot = monitorDaySnapshot({ tasks: [{ id: "one", title: "task", description: "private long text", subtasks: [{ id: "child", title: "child", description: "long" }] }], evidence: [1], taskHistory: [2], proposals: [3], workspaceSummary: {} } as any);
  expect(snapshot).not.toHaveProperty("workspaceSummary");
  expect(snapshot.tasks[0]).not.toHaveProperty("description");
  expect(snapshot.tasks[0].subtasks[0]).not.toHaveProperty("description");
});
