import type {
  DeliveryLease,
  InboxPage,
  OttoScope,
} from "../../../../src/modules/work-os/admin-otto/contracts";
import type { AdminRecapPresentationFence } from "./notifications";

/** One feed poll while the process runs. The main window is deliberately not
 * paused when hidden: the floating companion may be the only visible surface. */
export const ADMIN_RECAP_POLL_MS = 60_000;
/** Failed/offline attempts: 60, 120, 240, then 300 seconds, reset on success. */
export const ADMIN_RECAP_BACKOFF_MS = [60_000, 120_000, 240_000, 300_000] as const;
/** A defensive drain bound; each page is the server's 100-id lease. */
export const ADMIN_RECAP_MAX_DRAIN_PAGES = 50;

export type AdminRecapDeliveryApi = {
  fetchInbox(input: { cursor?: string; limit?: number }): Promise<InboxPage>;
  claim(input: { deviceId: string; windowId: string }): Promise<DeliveryLease | null>;
  updateState(input: {
    eventIds: string[];
    action: "presented" | "release";
    leaseToken?: string;
  }): Promise<void>;
};

export type AdminRecapArrival = {
  scope: OttoScope;
  epoch: number;
  /** Distinct delivery event ids, never the feed's pending total. */
  eventIds: string[];
  count: number;
  unread: number;
  catchupPending: boolean;
  source: "poll" | "focus" | "reconnect" | "mode" | "manual";
};

export type AdminRecapDeliverySnapshot = {
  scope: OttoScope;
  epoch: number;
  mode: "admin" | "employee";
  polling: boolean;
  unread: number;
  catchupPending: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  presented: number;
};

export type AdminRecapDeliveryDeps = {
  scope: OttoScope;
  epoch: number;
  deviceId: string;
  windowId: string;
  api: AdminRecapDeliveryApi;
  /** Mode-controller fence. A stale epoch is dropped before any claim/ack. */
  isCurrent?: (epoch: number, scope: OttoScope) => boolean;
  getMode?: () => "admin" | "employee";
  isOnline?: () => boolean;
  /** Observed only; a hidden main window still polls. */
  isHidden?: () => boolean;
  /** Avatar-only visibility guard so a hidden owner never presents or acks. */
  canPresent?: () => boolean | Promise<boolean>;
  onArrival: (arrival: AdminRecapArrival, fence: AdminRecapPresentationFence) => boolean | void | Promise<boolean | void>;
  onState?: (state: AdminRecapDeliverySnapshot) => void;
  onError?: (error: unknown) => void;
  now?: () => number;
  pollMs?: number;
  maxDrainPages?: number;
};

export type AdminRecapDeliveryHandle = {
  (): void;
  pollNow: (source?: AdminRecapArrival["source"]) => Promise<void>;
  snapshot: () => AdminRecapDeliverySnapshot;
  setMode: (mode: "admin" | "employee") => Promise<void>;
  stop: () => Promise<void>;
};

type Claimed = { lease: DeliveryLease; eventIds: string[]; deadline: number };

/** Local claim deadline, deliberately under the server's 30-second lease. It is
 * measured from receipt with this device's clock, so a workstation clock ahead
 * of the server cannot make a fresh lease look expired; the server's own lease
 * check remains authoritative for a presented acknowledgement. */
export const ADMIN_RECAP_LOCAL_LEASE_MS = 25_000;

export type AuthorizedAdminDeliveryDeps = AdminRecapDeliveryDeps & {
  signedIn: boolean;
  syncBypass: boolean;
  session: { userId: string; organizationId: string; role: string } | null;
};

/** Both shells use this boundary, including administrators in personal mode.
 * A stale snapshot alone must never start an admin-only feed. */
export function startAuthorizedAdminRecapDelivery(deps: AuthorizedAdminDeliveryDeps): AdminRecapDeliveryHandle | null {
  if (!deps.signedIn || deps.syncBypass || deps.session?.role !== "admin"
    || deps.session.userId !== deps.scope.userId || deps.session.organizationId !== deps.scope.organizationId) return null;
  return startAdminRecapDelivery(deps);
}

function iso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Recap delivery failed.";
}

/**
 * Main/avatar owner choice inside one process.
 *
 * The avatar is the normal notification owner. The main window takes over only
 * when the avatar window is known to be unavailable; an unknown visibility
 * state also falls back to main, and the server's 30-second leases remain the
 * cross-device arbiter. Exactly one process-local window receives each value.
 */
export function deliveryOwnerFor(input: {
  window: "main" | "avatar";
  adminMode: boolean;
  avatarVisible?: boolean | null;
}): "avatar" | "main" | "none" {
  if (!input.adminMode) return "none";
  if (input.window === "avatar") return "avatar";
  return input.avatarVisible === true ? "none" : "main";
}

/**
 * One bounded paged delivery loop.
 *
 * A poll reads the paged feed, claims unpresented deliveries through the Task 4
 * lease API, drains contiguous lease pages without overlapping requests, and
 * coalesces the whole drain into one counted arrival. Nothing opens, expands or
 * focuses a window. A presentation acknowledgement is sent only after the
 * arrival handler accepted the group; a failure or a denied OS permission
 * leaves the deliveries unpresented for the next poll.
 *
 * The returned value is callable for a one-line cleanup and also exposes test
 * and shell seams (`pollNow`, `snapshot`, `setMode`, `stop`).
 */
export function startAdminRecapDelivery(deps: AdminRecapDeliveryDeps): AdminRecapDeliveryHandle {
  const pollMs = deps.pollMs ?? ADMIN_RECAP_POLL_MS;
  const maxDrainPages = Math.max(1, deps.maxDrainPages ?? ADMIN_RECAP_MAX_DRAIN_PAGES);
  const isCurrent = () => deps.isCurrent ? deps.isCurrent(deps.epoch, deps.scope) : true;
  const now = () => deps.now?.() ?? Date.now();

  let stopped = false;
  let presentation: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let queued = false;
  let failureCount = 0;
  let mode: "admin" | "employee" = deps.getMode?.() ?? deps.scope.mode;
  let active: Claimed[] = [];
  let lastError: string | null = null;
  let presented = 0;
  let lastPollAt: string | null = null;
  let unread = 0;
  let catchupPending = false;

  const snapshot = (): AdminRecapDeliverySnapshot => ({
    scope: { ...deps.scope },
    epoch: deps.epoch,
    mode,
    polling: !!inFlight,
    unread,
    catchupPending,
    lastPollAt,
    lastError,
    presented,
  });

  const emitState = () => deps.onState?.(snapshot());

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delay: number) => {
    clearTimer();
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void run("poll");
    }, Math.max(0, delay));
  };

  const releaseAll = async () => {
    const leases = active;
    active = [];
    for (const claimed of leases) {
      try {
        await deps.api.updateState({
          eventIds: claimed.eventIds,
          action: "release",
          leaseToken: claimed.lease.token,
        });
      } catch {
        // Expiry is the recovery path when the release itself cannot land.
      }
    }
  };

  const acceptLease = async (lease: DeliveryLease): Promise<Claimed | null> => {
    if (!lease || !Array.isArray(lease.eventIds)) return null;
    const claimedAt = now();
    const seen = new Set<string>();
    const eventIds = lease.eventIds.filter((id) => {
      if (typeof id !== "string" || !id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!eventIds.length) return null;
    // A malformed expiry is still a malformed lease. A parseable one is never
    // compared to this clock: the server may run behind it.
    if (!Number.isFinite(Date.parse(lease.expiresAt))) {
      await deps.api.updateState({ eventIds, action: "release", leaseToken: lease.token }).catch(() => undefined);
      return null;
    }
    return { lease, eventIds, deadline: claimedAt + ADMIN_RECAP_LOCAL_LEASE_MS };
  };

  const poll = async (source: AdminRecapArrival["source"]) => {
    if (stopped || !isCurrent()) return;
    if (!(deps.isOnline?.() ?? true)) {
      throw new Error("Offline — recap delivery is paused.");
    }
    const page = await deps.api.fetchInbox({ limit: 12 });
    if (stopped || !isCurrent()) return;
    unread = page.unread;
    catchupPending = page.catchupPending;
    lastPollAt = iso(now());
    emitState();

    if (mode === "employee") {
      // Personal mode keeps the team feed state but never claims, presents or
      // acknowledges the team delivery; that changes only when Administration
      // returns to the screen.
      return;
    }

    const ids = new Set<string>();
    const claimed: Claimed[] = [];
    for (let pageIndex = 0; pageIndex < maxDrainPages; pageIndex += 1) {
      if (stopped || !isCurrent()) break;
      if (!(await (deps.canPresent?.() ?? true))) break;
      if (stopped || !isCurrent() || mode !== "admin") break;
      const lease = await deps.api.claim({ deviceId: deps.deviceId, windowId: deps.windowId });
      if (!lease) break;
      const accepted = await acceptLease(lease);
      if (!accepted) break;
      const fresh = accepted.eventIds.filter((id) => !ids.has(id));
      if (!fresh.length) {
        // A duplicate lease must never make the drain loop forever.
        await deps.api.updateState({
          eventIds: accepted.eventIds,
          action: "release",
          leaseToken: accepted.lease.token,
        }).catch(() => undefined);
        break;
      }
      active.push(accepted);
      claimed.push(accepted);
      for (const id of fresh) ids.add(id);
    }

    if (stopped || !isCurrent()) {
      await releaseAll();
      return;
    }
    if (!claimed.length) return;
    if (!(await (deps.canPresent?.() ?? true)) || stopped || !isCurrent() || mode !== "admin") {
      await releaseAll();
      return;
    }
    if (claimed.some((item) => item.deadline <= now())) {
      await releaseAll();
      throw new Error("The recap delivery lease expired while catching up.");
    }

    const arrival: AdminRecapArrival = {
      scope: { ...deps.scope },
      epoch: deps.epoch,
      eventIds: [...ids],
      count: ids.size,
      unread,
      catchupPending,
      source,
    };

    let accepted: boolean;
    presentation?.abort();
    const controller = new AbortController();
    presentation = controller;
    const fence: AdminRecapPresentationFence = {
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted && !stopped && mode === "admin" && isCurrent(),
    };
    try {
      if (!fence.isCurrent()) { await releaseAll(); return; }
      accepted = (await deps.onArrival(arrival, fence)) !== false;
    } catch (error) {
      await releaseAll();
      throw error;
    }
    if (!accepted || !fence.isCurrent()) {
      await releaseAll();
      return;
    }

    for (const item of claimed) {
      // Personal mode or a stale epoch must never consume the team ack.
      if (mode !== "admin" || stopped || !isCurrent()) {
        await releaseAll();
        return;
      }
      // The local claim deadline sits inside the server's 30-second lease. A
      // late presentation leaves the delivery in the inbox rather than
      // acknowledging it, and the server re-checks its own expiry.
      if (item.deadline <= now()) {
        active = active.filter((entry) => entry !== item);
        await deps.api.updateState({
          eventIds: item.eventIds,
          action: "release",
          leaseToken: item.lease.token,
        }).catch(() => undefined);
        throw new Error("The recap delivery lease expired before presentation.");
      }
      try {
        await deps.api.updateState({
          eventIds: item.eventIds,
          action: "presented",
          leaseToken: item.lease.token,
        });
      } catch (error) {
        // A failed acknowledgement is not a presentation. Release this
        // transient claim so the next poll can retry it, and leave the event
        // unpresented in the inbox.
        active = active.filter((entry) => entry !== item);
        await deps.api.updateState({
          eventIds: item.eventIds,
          action: "release",
          leaseToken: item.lease.token,
        }).catch(() => undefined);
        // A later claim in the same drain was never presented; release it
        // promptly instead of waiting for the 30-second lease to expire.
        await releaseAll();
        throw error;
      }
      active = active.filter((entry) => entry !== item);
      presented += 1;
    }
    lastError = null;
    emitState();
  };

  async function run(source: AdminRecapArrival["source"]): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        if (!isCurrent()) return;
        await poll(source);
        failureCount = 0;
        lastError = null;
      } catch (error) {
        // Claim and visibility checks can fail after earlier pages acquired
        // leases. Do not strand those pages until server expiry.
        await releaseAll();
        lastError = messageOf(error);
        deps.onError?.(error);
        const delay = ADMIN_RECAP_BACKOFF_MS[Math.min(failureCount, ADMIN_RECAP_BACKOFF_MS.length - 1)];
        failureCount += 1;
        if (!stopped) schedule(delay);
      } finally {
        inFlight = null;
        emitState();
        if (!stopped && timer === null) {
          const delay = lastError
            ? ADMIN_RECAP_BACKOFF_MS[Math.min(Math.max(0, failureCount - 1), ADMIN_RECAP_BACKOFF_MS.length - 1)]
            : pollMs;
          schedule(delay);
        }
        if (queued) {
          queued = false;
          if (!stopped) void run("focus");
        }
      }
    })();
    return inFlight;
  }

  const handle = (() => { void handle.stop(); }) as AdminRecapDeliveryHandle;
  handle.pollNow = (source = "manual") => run(source);
  handle.snapshot = snapshot;
  handle.setMode = async (next) => {
    if (stopped || next === mode) {
      mode = next;
      return;
    }
    const leavingAdmin = mode === "admin" && next === "employee";
    mode = next;
    emitState();
    if (leavingAdmin) {
      presentation?.abort();
      // Never consume a team acknowledgement while the employee prompt owns
      // the screen. Release the transient lease; the event stays in the inbox.
      await releaseAll();
    }
    if (next === "admin" && !stopped) await run("mode");
  };
  handle.stop = async () => {
    if (stopped) return;
    stopped = true;
    presentation?.abort();
    clearTimer();
    await releaseAll();
  };

  // First poll is one cadence after launch; shells call pollNow on mount, focus
  // and reconnect so a sleeping device catches up immediately.
  schedule(pollMs);
  return handle;
}
