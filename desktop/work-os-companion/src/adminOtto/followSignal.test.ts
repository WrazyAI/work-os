import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowSettings, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { emit } from "../tauriEvents";
import {
  ADMIN_OTTO_FOLLOW_CHANGED_EVENT,
  adminOttoFollowChangedAppliesTo,
  adminOttoFollowChangedEvent,
  listenAdminOttoFollowChanged,
  parseAdminOttoFollowChangedEvent,
} from "./followSignal";

const native = vi.hoisted(() => ({ handlers: new Map<string, Set<(event: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    const group = native.handlers.get(name) ?? new Set();
    group.add(handler);
    native.handlers.set(name, group);
    return () => { group.delete(handler); };
  },
  emit: async (name: string, payload: unknown) => {
    for (const handler of native.handlers.get(name) ?? []) handler({ payload });
  },
}));

const scope: OttoScope = { userId: "admin-1", organizationId: "org-1", mode: "admin" };
const otherScope: OttoScope = { userId: "admin-2", organizationId: "org-1", mode: "admin" };
const settings: FollowSettings = { mode: "selected", personIds: ["person-1"], revision: 4, activated: true };

afterEach(() => { native.handlers.clear(); });

describe("admin Otto follow signal", () => {
  it("delivers only the production event shape through the event adapter", async () => {
    const received: ReturnType<typeof adminOttoFollowChangedEvent>[] = [];
    const off = await listenAdminOttoFollowChanged((event) => received.push(event));
    await emit(ADMIN_OTTO_FOLLOW_CHANGED_EVENT, adminOttoFollowChangedEvent(scope, settings));
    await emit(ADMIN_OTTO_FOLLOW_CHANGED_EVENT, { scope, mode: "selected", personIds: "bad", revision: 4 });
    await emit("work-os://unrelated", adminOttoFollowChangedEvent(scope, settings));
    off();
    await emit(ADMIN_OTTO_FOLLOW_CHANGED_EVENT, adminOttoFollowChangedEvent(scope, settings));

    expect(received).toEqual([{
      scope,
      mode: "selected",
      personIds: ["person-1"],
      revision: 4,
    }]);
  });

  it("keeps the consumer scoped to the live account", () => {
    const event = parseAdminOttoFollowChangedEvent(adminOttoFollowChangedEvent(scope, settings));
    expect(event).not.toBeNull();
    expect(adminOttoFollowChangedAppliesTo(event!, scope)).toBe(true);
    expect(adminOttoFollowChangedAppliesTo(event!, otherScope)).toBe(false);
    expect(adminOttoFollowChangedAppliesTo(event!, { ...scope, organizationId: "org-2" })).toBe(false);
    expect(adminOttoFollowChangedAppliesTo(event!, { ...scope, mode: "employee" })).toBe(false);
    expect(adminOttoFollowChangedAppliesTo(parseAdminOttoFollowChangedEvent({ scope }), scope)).toBe(false);
  });

  it("drops names and settings flags from the cross-window payload", () => {
    const event = adminOttoFollowChangedEvent(scope, {
      ...settings,
      personIds: ["person-1", "", "person-2"],
    });
    expect(event).toEqual({
      scope,
      mode: "selected",
      personIds: ["person-1", "person-2"],
      revision: 4,
    });
    expect(JSON.stringify(event)).not.toContain("displayName");
    expect(JSON.stringify(event)).not.toContain("activated");
  });
});
