import { afterEach, describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import {
  AVATAR_OWNER_HEARTBEAT_MS,
  AVATAR_OWNER_LEASE_MS,
  avatarOwnsDelivery,
  mainOwnsDelivery,
  ownerClaimActive,
  ownerHeartbeatDue,
  ownerEventPayload,
  parseOwnerEvent,
  type OwnerClaim,
} from "./ownership";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };
const claim = (at: number, overrides: Partial<OwnerClaim> = {}): OwnerClaim => ({
  window: "avatar",
  scope,
  epoch: 2,
  receivedAt: at,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("admin Otto delivery ownership", () => {
  it("avatarcrashfallback: a stale claim expires and main resumes", () => {
    expect(AVATAR_OWNER_HEARTBEAT_MS).toBe(20_000);
    expect(AVATAR_OWNER_LEASE_MS).toBe(45_000);
    const t0 = 1_000_000;
    const active = claim(t0);
    expect(ownerClaimActive(active, scope, 2, t0 + AVATAR_OWNER_LEASE_MS - 1)).toBe(true);
    expect(mainOwnsDelivery({ mode: "admin", avatarVisible: true, claim: active, scope, epoch: 2, now: t0 + 1 })).toBe(false);
    // No heartbeat after a crash/hang: main recovers at the lease boundary.
    expect(ownerClaimActive(active, scope, 2, t0 + AVATAR_OWNER_LEASE_MS)).toBe(false);
    expect(mainOwnsDelivery({ mode: "admin", avatarVisible: true, claim: active, scope, epoch: 2, now: t0 + AVATAR_OWNER_LEASE_MS }))
      .toBe(true);
  });

  it("a heartbeat extends the avatar lease", () => {
    const t0 = 2_000_000;
    expect(ownerHeartbeatDue(t0, t0 + AVATAR_OWNER_HEARTBEAT_MS - 1)).toBe(false);
    expect(ownerHeartbeatDue(t0, t0 + AVATAR_OWNER_HEARTBEAT_MS)).toBe(true);
    const refreshed = claim(t0 + AVATAR_OWNER_HEARTBEAT_MS);
    expect(ownerClaimActive(refreshed, scope, 2, t0 + AVATAR_OWNER_HEARTBEAT_MS + AVATAR_OWNER_LEASE_MS - 1)).toBe(true);
  });

  it("hidden or missing avatar hands delivery to main immediately", () => {
    const active = claim(10);
    expect(mainOwnsDelivery({ mode: "admin", avatarVisible: false, claim: active, scope, epoch: 2, now: 11 })).toBe(true);
    expect(avatarOwnsDelivery({ scope: { ...scope, mode: "employee" }, visible: false })).toBe(false);
  });

  it("ignores an owner claim for another account, organization, mode or epoch", () => {
    const now = 5_000;
    for (const foreign of [
      claim(0, { scope: { ...scope, userId: "user-2" } }),
      claim(0, { scope: { ...scope, organizationId: "org-2" } }),
      claim(0, { scope: { ...scope, mode: "employee" } }),
      claim(0, { epoch: 1 }),
      claim(0, { window: "main" }),
    ]) {
      expect(ownerClaimActive(foreign, scope, 2, now)).toBe(false);
    }
    expect(mainOwnsDelivery({ mode: "admin", avatarVisible: true, claim: claim(0, { epoch: 1 }), scope, epoch: 2, now }))
      .toBe(true);
  });

  it("uses fake time at the lease boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const t0 = Date.now();
    const active = claim(t0);
    vi.setSystemTime(t0 + AVATAR_OWNER_LEASE_MS - 1);
    expect(ownerClaimActive(active, scope, 2)).toBe(true);
    vi.setSystemTime(t0 + AVATAR_OWNER_LEASE_MS);
    expect(ownerClaimActive(active, scope, 2)).toBe(false);
    expect(mainOwnsDelivery({ mode: "admin", avatarVisible: true, claim: active, scope, epoch: 2 })).toBe(true);
  });

  it("keeps the owner event contract fully scoped and typed", () => {
    const event = ownerEventPayload({
      window: "avatar", windowId: "avatar:1", scope, epoch: 2, active: true,
      // extra untrusted fields are never copied
      ...({ token: "secret", recap: "team text" } as Record<string, unknown>),
    });
    expect(event).toEqual({ window: "avatar", windowId: "avatar:1", scope, epoch: 2, active: true });
    expect(parseOwnerEvent(event)).toEqual(event);
    expect(parseOwnerEvent({ ...event, scope: { ...scope, userId: "" } })).toBeNull();
    expect(parseOwnerEvent({ ...event, epoch: 0 })).toBeNull();
    expect(parseOwnerEvent({ ...event, active: "yes" })).toBeNull();
  });

  it("employee-mode admin retains feed-only ownership when the avatar is unavailable", () => {
    const employeeScope = { ...scope, mode: "employee" as const };
    expect(avatarOwnsDelivery({ scope: employeeScope, visible: true })).toBe(true);
    expect(mainOwnsDelivery({ mode: "employee", avatarVisible: false, claim: null, scope: employeeScope, epoch: 3, now: 0 }))
      .toBe(true);
  });
});
