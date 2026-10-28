import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryLease, InboxPage, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import {
  startAuthorizedAdminRecapDelivery,
  ADMIN_RECAP_POLL_MS,
  ADMIN_RECAP_BACKOFF_MS,
  deliveryOwnerFor,
  startAdminRecapDelivery,
  type AdminRecapArrival,
  type AdminRecapDeliveryApi,
} from "./delivery";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };
const now = () => Date.parse("2026-10-24T12:00:00.000Z");

function inbox(unread = 0, catchupPending = false): InboxPage {
  return {
    items: [],
    nextCursor: null,
    total: unread,
    asOf: new Date(now()).toISOString(),
    coverage: [],
    unread,
    catchupPending,
  };
}

function lease(ids: string[], pendingCount: number, token = `lease-${ids[0] ?? "empty"}`): DeliveryLease {
  return {
    token,
    expiresAt: new Date(now() + 30_000).toISOString(),
    eventIds: ids,
    pendingCount,
  };
}

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

function harness(overrides: {
  claims?: Array<DeliveryLease | null>;
  mode?: "admin" | "employee";
  online?: boolean;
  hidden?: boolean;
  canPresent?: boolean;
  checkPresentation?: () => boolean | Promise<boolean>;
  onArrival?: (arrival: AdminRecapArrival) => boolean | void | Promise<boolean | void>;
  updateState?: AdminRecapDeliveryApi["updateState"];
  fetchInbox?: AdminRecapDeliveryApi["fetchInbox"];
  isCurrent?: () => boolean;
  beforeClaim?: () => Promise<void>;
  clock?: () => number;
} = {}) {
  const calls = {
    inbox: [] as Array<{ cursor?: string; limit?: number }>,
    claims: [] as Array<{ deviceId: string; windowId: string }>,
    states: [] as Array<{ eventIds: string[]; action: string; leaseToken?: string }>,
  };
  const leases = [...(overrides.claims ?? [null])];
  const arrivals: AdminRecapArrival[] = [];
  const errors: unknown[] = [];
  let mode = overrides.mode ?? "admin";
  const api: AdminRecapDeliveryApi = {
    fetchInbox: async (input) => {
      calls.inbox.push(input);
      return overrides.fetchInbox ? overrides.fetchInbox(input) : inbox(3, false);
    },
    claim: async (input) => {
      calls.claims.push(input);
      await overrides.beforeClaim?.();
      return leases.length ? (leases.shift() ?? null) : null;
    },
    updateState: async (input) => {
      calls.states.push(input);
      if (overrides.updateState) await overrides.updateState(input);
    },
  };
  const controller = startAdminRecapDelivery({
    scope,
    epoch: 1,
    deviceId: "device-1",
    windowId: "main",
    api,
    now: overrides.clock ?? now,
    isOnline: () => overrides.online ?? true,
    isHidden: () => overrides.hidden ?? true,
    canPresent: overrides.checkPresentation ?? (async () => overrides.canPresent ?? true),
    getMode: () => mode,
    isCurrent: (epoch) => epoch === 1 && (overrides.isCurrent?.() ?? true),
    onArrival: async (arrival) => {
      arrivals.push(arrival);
      return overrides.onArrival ? overrides.onArrival(arrival) : true;
    },
    onError: (error) => errors.push(error),
  });
  return {
    controller,
    calls,
    arrivals,
    errors,
    setMode: (next: "admin" | "employee") => { mode = next; },
    setClaims: (next: Array<DeliveryLease | null>) => { leases.splice(0, leases.length, ...next); },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pre-presentation claim failures", () => {
  it("does not present a coalesced drain after its first lease expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now()));
    let claims = 0;
    const h = harness({ claims: [lease(["event-1"], 1), null],
      beforeClaim: async () => { if (++claims === 2) vi.setSystemTime(Date.now() + 60_000); },
      clock: () => Date.now(),
    });
    await h.controller.pollNow();
    expect(h.arrivals).toEqual([]);
    expect(h.calls.states.every((state) => state.action === "release")).toBe(true);
    await h.controller.stop();
  });
  it("presents a fresh lease even when the local clock runs ahead of the server", async () => {
    // The server stamps its lease from its own clock. A workstation two minutes
    // fast must not treat that timestamp as already expired and silently drop
    // every arrival; the local deadline is measured from receipt instead.
    const h = harness({
      claims: [{ ...lease(["event-1"], 1), expiresAt: new Date(now() - 120_000).toISOString() }],
    });
    await h.controller.pollNow();
    expect(h.arrivals).toHaveLength(1);
    expect(h.calls.states).toEqual([{ eventIds: ["event-1"], action: "presented", leaseToken: "lease-event-1" }]);
    expect(h.errors).toEqual([]);
    await h.controller.stop();
  });
  it("releases a lease with an unparseable expiry instead of presenting it", async () => {
    const h = harness({ claims: [{ ...lease(["event-1"], 1), expiresAt: "not-a-time" }] });
    await h.controller.pollNow();
    expect(h.arrivals).toEqual([]);
    expect(h.calls.states).toEqual([{ eventIds: ["event-1"], action: "release", leaseToken: "lease-event-1" }]);
    await h.controller.stop();
  });
  it.each(["employee", "manager"] as const)("does not start or poll admin delivery for %s", async (role) => {
    vi.useFakeTimers();
    const fetchInbox = vi.fn(async () => inbox(0, false));
    const delivery = startAuthorizedAdminRecapDelivery({
      signedIn: true, syncBypass: false, session: { ...scope, role },
      scope, epoch: 1, deviceId: "device", windowId: "main",
      api: { fetchInbox, claim: async () => null, updateState: async () => undefined },
      onArrival: () => true,
    });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(delivery).toBeNull();
    expect(fetchInbox).not.toHaveBeenCalled();
  });
  it.each(["claim", "visibility"])("releases an obtained lease after a later %s failure", async (failure) => {
    let claims = 0;
    let checks = 0;
    const h = harness({
      claims: [lease(["event-1"], 1)],
      beforeClaim: async () => { if (++claims === 2 && failure === "claim") throw new Error("claim failed"); },
      checkPresentation: () => { if (++checks === 2 && failure === "visibility") throw new Error("visibility failed"); return true; },
    });
    await h.controller.pollNow();
    expect(h.arrivals).toEqual([]);
    expect(h.calls.states).toEqual([{ eventIds: ["event-1"], action: "release", leaseToken: expect.any(String) }]);
    await h.controller.stop();
  });
});

describe("admin recap delivery", () => {
  it("hidden_main_polls_every_60000", async () => {
    vi.useFakeTimers();
    const h = harness({ hidden: true });
    expect(ADMIN_RECAP_POLL_MS).toBe(60_000);
    await h.controller.pollNow();
    expect(h.calls.inbox).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ADMIN_RECAP_POLL_MS - 1);
    expect(h.calls.inbox).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.inbox).toHaveLength(2);
    await h.controller.stop();
  });

  it("sleep_reconnect_drains_pages_once", async () => {
    vi.useFakeTimers();
    const first = ids("a", 100);
    const second = ids("b", 100);
    const third = ids("c", 50);
    const h = harness({
      claims: [lease(first, 250, "lease-a"), lease(second, 150, "lease-b"), lease(third, 50, "lease-c")],
    });
    await h.controller.pollNow("reconnect");
    // One counted arrival for the whole drain, and one presented ack per lease.
    expect(h.arrivals).toHaveLength(1);
    expect(h.arrivals[0].count).toBe(250);
    expect(h.arrivals[0].eventIds).toHaveLength(250);
    expect(h.arrivals[0].scope).toEqual(scope);
    expect(h.calls.claims.length).toBeGreaterThanOrEqual(3);
    expect(h.calls.states.filter((state) => state.action === "presented")).toHaveLength(3);
    expect(h.calls.states.map((state) => state.eventIds.length)).toEqual([100, 100, 50]);
    // The next automatic poll is the normal cadence, not an immediate re-drain.
    await vi.advanceTimersByTimeAsync(ADMIN_RECAP_POLL_MS - 1);
    expect(h.calls.inbox).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.inbox).toHaveLength(2);
    await h.controller.stop();
  });

  it("ackonlyacceptedpresentation", async () => {
    const h = harness({ claims: [lease(ids("a", 2), 2)], onArrival: () => false });
    await h.controller.pollNow();
    expect(h.calls.claims.length).toBeGreaterThanOrEqual(1);
    expect(h.calls.states.filter((state) => state.action === "presented")).toEqual([]);
    expect(h.calls.states.filter((state) => state.action === "release")).toHaveLength(1);
    expect(h.controller.snapshot().unread).toBe(3);
  });

  it("failuresleaveinbox", async () => {
    vi.useFakeTimers();
    const h = harness({
      claims: [lease(ids("a", 2), 2), lease(ids("a", 2), 2)],
      updateState: async () => { throw new Error("ack unavailable"); },
    });
    await h.controller.pollNow();
    expect(h.calls.states.filter((state) => state.action === "presented")).toHaveLength(1);
    expect(h.controller.snapshot().lastError).toContain("ack unavailable");
    // The failed acknowledgement is retried on the next poll, not swallowed.
    await vi.advanceTimersByTimeAsync(ADMIN_RECAP_POLL_MS);
    expect(h.calls.claims.length).toBeGreaterThanOrEqual(2);
    await h.controller.stop();
  });

  it("releases later claims when one presented acknowledgement fails", async () => {
    let presented = 0;
    const h = harness({
      claims: [lease(ids("a", 2), 6, "lease-a"), lease(ids("b", 2), 4, "lease-b"), lease(ids("c", 2), 2, "lease-c")],
      updateState: async (input) => {
        if (input.action === "presented") {
          presented += 1;
          if (presented === 2) throw new Error("ack unavailable");
        }
      },
    });
    await h.controller.pollNow();
    const releases = h.calls.states.filter((state) => state.action === "release");
    // The failed claim and the not-yet-presented third claim are both released.
    expect(releases.map((state) => state.leaseToken).sort()).toEqual(["lease-b", "lease-c"]);
    expect(h.calls.states.filter((state) => state.action === "presented")).toHaveLength(2);
    expect(h.controller.snapshot().lastError).toContain("ack unavailable");
  });

  it("releaseleasesclose", async () => {
    let arrived!: () => void;
    const arrival = new Promise<void>((resolve) => { arrived = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({
      claims: [lease(ids("a", 2), 2)],
      onArrival: async () => {
        arrived();
        await gate;
        return false;
      },
    });
    const poll = h.controller.pollNow();
    await arrival;
    await h.controller.stop();
    release();
    await poll;
    expect(h.calls.states.filter((state) => state.action === "release")).toHaveLength(1);
    expect(h.calls.states.filter((state) => state.action === "presented")).toEqual([]);
  });

  it("personal_mode_retains_team_unread_without_claiming_or_acking", async () => {
    const h = harness({ mode: "employee", claims: [lease(ids("a", 2), 2)] });
    await h.controller.pollNow();
    expect(h.calls.inbox).toHaveLength(1);
    expect(h.calls.claims).toHaveLength(0);
    expect(h.calls.states).toEqual([]);
    expect(h.controller.snapshot().unread).toBe(3);

    h.setMode("admin");
    await h.controller.setMode("admin");
    expect(h.calls.claims.length).toBeGreaterThanOrEqual(1);
    expect(h.calls.states.filter((state) => state.action === "presented")).toHaveLength(1);
  });

  it("drops a delayed lease after the account/scope changed without presenting", async () => {
    let current = true;
    const h = harness({
      claims: [lease(ids("a", 2), 2)],
      isCurrent: () => current,
      beforeClaim: async () => { current = false; },
    });
    await h.controller.pollNow();
    expect(h.arrivals).toEqual([]);
    expect(h.calls.states.filter((state) => state.action === "presented")).toEqual([]);
    // The lease was obtained before the scope changed, so it is released for
    // the next authorized attempt rather than left for expiry.
    expect(h.calls.states.filter((state) => state.action === "release")).toHaveLength(1);
  });

  it("does not consume a team acknowledgement after switching to personal mode", async () => {
    let switched = false;
    const h = harness({
      claims: [lease(ids("a", 2), 2)],
      onArrival: async () => {
        switched = true;
        await h.controller.setMode("employee");
        return true;
      },
    });
    await h.controller.pollNow();
    expect(switched).toBe(true);
    expect(h.calls.states.filter((state) => state.action === "presented")).toEqual([]);
    expect(h.calls.states.filter((state) => state.action === "release")).toHaveLength(1);
  });

  it("uses lease ids rather than pendingCount equality", async () => {
    const h = harness({ claims: [lease(ids("a", 100), 2_000)] });
    await h.controller.pollNow();
    expect(h.arrivals[0].count).toBe(100);
    expect(h.calls.states.filter((state) => state.action === "presented")[0].eventIds).toHaveLength(100);
    // pendingCount 2000 is a bounded total, not a reason to present the same ids twice.
    expect(h.calls.states.filter((state) => state.action === "presented")).toHaveLength(1);
  });

  it("backs off 60/120/240/300 and resets on success", async () => {
    vi.useFakeTimers();
    let failures = 0;
    const h = harness({
      fetchInbox: async () => {
        failures += 1;
        if (failures <= 4) throw new Error("offline");
        return inbox();
      },
    });
    await h.controller.pollNow();
    expect(ADMIN_RECAP_BACKOFF_MS).toEqual([60_000, 120_000, 240_000, 300_000]);
    for (const delay of ADMIN_RECAP_BACKOFF_MS) {
      const before = h.calls.inbox.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.calls.inbox).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.calls.inbox).toHaveLength(before + 1);
    }
    // The fifth attempt succeeds, so the next automatic poll returns to 60s.
    await vi.advanceTimersByTimeAsync(ADMIN_RECAP_POLL_MS);
    expect(h.calls.inbox.length).toBe(6);
    await h.controller.stop();
  });

  it("avatarprimary_mainfallback_sameprocess_no_doubles", () => {
    expect(deliveryOwnerFor({ window: "avatar", adminMode: true })).toBe("avatar");
    expect(deliveryOwnerFor({ window: "main", adminMode: true, avatarVisible: true })).toBe("none");
    expect(deliveryOwnerFor({ window: "main", adminMode: true, avatarVisible: false })).toBe("main");
    // Unknown visibility falls back to main instead of two owners.
    expect(deliveryOwnerFor({ window: "main", adminMode: true, avatarVisible: null })).toBe("main");
    expect(deliveryOwnerFor({ window: "main", adminMode: false, avatarVisible: false })).toBe("none");
    expect(deliveryOwnerFor({ window: "avatar", adminMode: false })).toBe("none");
  });
});
