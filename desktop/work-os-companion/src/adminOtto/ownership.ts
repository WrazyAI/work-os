import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { isOttoScope, OTTO_DELIVERY_OWNER_EVENT, type OttoContextEvent } from "./mode";
import { emit, listen } from "../tauriEvents";

/** The avatar re-announces ownership on this cadence. */
export const AVATAR_OWNER_HEARTBEAT_MS = 20_000;
/** Main takes over when no owner heartbeat arrives inside this bound. */
export const AVATAR_OWNER_LEASE_MS = 45_000;

export type OwnerClaim = {
  window: "main" | "avatar";
  scope: OttoScope;
  epoch: number;
  receivedAt: number;
};

export type OwnerEventPayload = {
  window: "main" | "avatar";
  windowId: string;
  scope: OttoScope;
  epoch: number;
  active: boolean;
};

export function ownerEventPayload(input: OwnerEventPayload): OwnerEventPayload {
  return {
    window: input.window,
    windowId: input.windowId,
    scope: {
      userId: input.scope.userId,
      organizationId: input.scope.organizationId,
      mode: input.scope.mode,
    },
    epoch: input.epoch,
    active: input.active,
  };
}

export function parseOwnerEvent(value: unknown): OwnerEventPayload | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if ((event.window !== "main" && event.window !== "avatar") || typeof event.windowId !== "string"
    || !isOttoScope(event.scope) || !Number.isInteger(event.epoch) || Number(event.epoch) < 1
    || typeof event.active !== "boolean") return null;
  return ownerEventPayload(event as OwnerEventPayload);
}

function sameScope(left: OttoScope, right: OttoScope) {
  return left.userId === right.userId
    && left.organizationId === right.organizationId
    && left.mode === right.mode;
}

/** A fresh claim from the expected window for exactly this
 * actor/organization/mode/epoch. */
export function claimActive(
  claim: OwnerClaim | null,
  window: "main" | "avatar",
  scope: OttoScope,
  epoch: number,
  now: number = Date.now(),
): boolean {
  return !!claim
    && claim.window === window
    && sameScope(claim.scope, scope)
    && claim.epoch === epoch
    && now - claim.receivedAt < AVATAR_OWNER_LEASE_MS;
}

export function ownerClaimActive(
  claim: OwnerClaim | null,
  scope: OttoScope,
  epoch: number,
  now: number = Date.now(),
): boolean {
  return claimActive(claim, "avatar", scope, epoch, now);
}

export function ownerHeartbeatDue(sentAt: number, now: number = Date.now()): boolean {
  return now - sentAt >= AVATAR_OWNER_HEARTBEAT_MS;
}

/**
 * Main owns the fallback when no live avatar claim exists, or immediately when
 * the avatar window is known to be hidden. The 30-second server lease remains
 * the cross-device arbiter; this only stops two process-local windows.
 */
export function mainOwnsDelivery(input: {
  mode: "admin" | "employee";
  avatarVisible: boolean | null;
  claim: OwnerClaim | null;
  scope: OttoScope;
  epoch: number;
  now?: number;
}): boolean {
  if (input.avatarVisible === false) return true;
  return !ownerClaimActive(input.claim, input.scope, input.epoch, input.now ?? Date.now());
}

/** A visible avatar is the normal owner; main defers to its heartbeat. */
export function avatarOwnsDelivery(input: {
  scope: OttoScope;
  visible: boolean;
}): boolean {
  return input.visible;
}

export type DeliveryOwnershipDeps = {
  window: "main" | "avatar";
  context: OttoContextEvent;
  avatarVisible: boolean;
  onChange: (owns: boolean) => void;
  listen?: typeof listen;
  emit?: typeof emit;
};

export function deliveryOwnershipKey(context: OttoContextEvent): string {
  return JSON.stringify([context.scope.userId, context.scope.organizationId, context.scope.mode, context.epoch]);
}

/** Owns the native subscription and heartbeat independently of the delivery
 * loop. Renewals never tear down a running poll. Avatar has deterministic
 * priority; main waits at most one lease for a visible but unresponsive avatar. */
export function startDeliveryOwnership(deps: DeliveryOwnershipDeps): () => void {
  let stopped = false;
  let owns = false;
  let off: (() => void) | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = deps.emit ?? emit;
  const announce = (active: boolean) => {
    void send(OTTO_DELIVERY_OWNER_EVENT, ownerEventPayload({
      window: deps.window, windowId: deps.window, ...deps.context, active,
    })).catch(() => undefined);
  };
  const change = (next: boolean) => {
    if (stopped || next === owns) return;
    owns = next;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    deps.onChange(next);
    announce(next);
    if (next) heartbeat = setInterval(() => announce(true), AVATAR_OWNER_HEARTBEAT_MS);
  };
  const awaitAvatar = () => {
    if (expiry) clearTimeout(expiry);
    expiry = setTimeout(() => change(true), AVATAR_OWNER_LEASE_MS);
  };
  deps.onChange(false);
  void (deps.listen ?? listen)<unknown>(OTTO_DELIVERY_OWNER_EVENT, ({ payload }) => {
    if (stopped || deps.window !== "main") return;
    const event = parseOwnerEvent(payload);
    if (!event || event.window !== "avatar" || !sameScope(event.scope, deps.context.scope)
      || event.epoch !== deps.context.epoch || !deps.avatarVisible) return;
    if (event.active) { change(false); awaitAvatar(); }
    else { if (expiry) clearTimeout(expiry); change(true); }
  }).then((unsubscribe) => {
    if (stopped) { unsubscribe(); return; }
    off = unsubscribe;
    if (deps.window === "avatar") change(deps.avatarVisible);
    else if (deps.avatarVisible) awaitAvatar();
    else change(true);
  }).catch(() => {
    // No coordination channel: main remains the safe fallback; server leases
    // still arbitrate across devices. Avatar never presents without its bus.
    if (deps.window === "main") change(true);
  });
  return () => {
    stopped = true;
    off?.();
    if (expiry) clearTimeout(expiry);
    if (heartbeat) clearInterval(heartbeat);
    if (owns) announce(false);
  };
}
