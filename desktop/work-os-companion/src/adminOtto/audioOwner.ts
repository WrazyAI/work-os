import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { isOttoScope } from "./mode";
import { emit as tauriEmit, listen as tauriListen } from "../tauriEvents";

/** One audio owner across every companion window. These payloads deliberately
 * carry identifiers only: actor, organization, mode, epoch, window and the
 * request token. No transcript, recap text, URL or credential crosses. */
export const OTTO_AUDIO_REQUEST_EVENT = "work-os://otto-audio-request";
export const OTTO_AUDIO_REVOKE_EVENT = "work-os://otto-audio-revoke";
export const OTTO_AUDIO_STOPPED_EVENT = "work-os://otto-audio-stopped";
export const OTTO_AUDIO_GRANT_EVENT = "work-os://otto-audio-grant";
export const OTTO_AUDIO_DENY_EVENT = "work-os://otto-audio-deny";
export const OTTO_AUDIO_RELEASE_EVENT = "work-os://otto-audio-release";
export const OTTO_AUDIO_WINDOW_DESTROYED_EVENT = "tauri://destroyed";
export const OTTO_AUDIO_STOP_TIMEOUT_MS = 2_000;

export type OttoAudioKind = "speech" | "recording";
export type OttoAudioWindowId = "main" | "avatar";

export type OttoAudioPayload = {
  scope: OttoScope;
  epoch: number;
  windowId: string;
  token: string;
};

export type OttoAudioLease = {
  token: string;
  /** True while this exact grant is still the one owned by this window. A
   * revoke between grant and the first media play makes it false. */
  isActive: () => boolean;
  release: () => void;
};

export type OttoAudioBus = {
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  emit: (event: string, payload: unknown) => Promise<void>;
};

export type OttoAudioBroker = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  windowDestroyed: (windowId: string) => void;
  snapshot: () => { owner: OttoAudioPayload | null; waiting: OttoAudioPayload | null };
};

export type OttoAudioRequester = {
  request: (scope: OttoScope, epoch: number, kind: OttoAudioKind) => Promise<OttoAudioLease>;
  active: () => (OttoAudioPayload & { kind: OttoAudioKind }) | null;
  dispose: () => void;
};

const listeners = new Set<() => void>();
const speechListeners = new Set<() => void>();

/** Admin Otto's one speech stop seam. Speech players register here; the
 * microphone records only through the all-audio seam below, so starting a
 * capture can stop narration without cancelling the capture itself. */
export function onOttoSpeechStop(listener: () => void): () => void {
  speechListeners.add(listener);
  return () => speechListeners.delete(listener);
}

/** Admin Otto's all-audio stop seam. A mode/session boundary and a broker
 * revoke stop both narration and the microphone. */
export function onOttoAudioStop(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stop narration only. This is the seam a recording start uses: it stops
 * every speech player, but never signals the microphone that is just opening. */
export function requestOttoSpeechStop(): void {
  for (const listener of [...speechListeners]) {
    try {
      listener();
    } catch {
      // A disposed player is already stopped.
    }
  }
}

/** Stop every registered read or capture. One failing disposer never blocks
 * the others; the caller cannot await a hidden player forever. */
export function requestOttoAudioStop(): void {
  requestOttoSpeechStop();
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A disposed player is already stopped.
    }
  }
}

function copyScope(scope: OttoScope): OttoScope {
  return { userId: scope.userId, organizationId: scope.organizationId, mode: scope.mode };
}

function payloadValue(value: unknown): OttoAudioPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isOttoScope(record.scope)) return null;
  if (!Number.isInteger(record.epoch) || Number(record.epoch) < 1) return null;
  if (typeof record.windowId !== "string" || !record.windowId || record.windowId.length > 64) return null;
  if (typeof record.token !== "string" || !record.token || record.token.length > 128) return null;
  return {
    scope: copyScope(record.scope),
    epoch: Number(record.epoch),
    windowId: record.windowId,
    token: record.token,
  };
}

function samePayload(left: OttoAudioPayload, right: OttoAudioPayload): boolean {
  return left.token === right.token
    && left.windowId === right.windowId
    && left.epoch === right.epoch
    && left.scope.userId === right.scope.userId
    && left.scope.organizationId === right.scope.organizationId
    && left.scope.mode === right.scope.mode;
}

function destroyedWindowId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const label = (value as Record<string, unknown>).label;
    if (typeof label === "string" && label) return label;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Audio is busy in another companion window.";
}

/**
 * The persistent main window brokers every audio request, including while the
 * main window is hidden. An existing owner is revoked first; the next request
 * is granted only after that owner acknowledges that its player stopped. A
 * two-second acknowledgement timeout fails the waiting request closed instead
 * of granting two readers.
 */
export function createOttoAudioBroker(input: {
  local?: OttoAudioBus;
  remote?: OttoAudioBus;
  timeoutMs?: number;
}): OttoAudioBroker {
  const timeoutMs = Math.max(1, input.timeoutMs ?? OTTO_AUDIO_STOP_TIMEOUT_MS);
  const local = input.local;
  const remote = input.remote;
  const buses = [local, remote].filter((bus, index, all): bus is OttoAudioBus => !!bus && all.indexOf(bus) === index);
  let owner: OttoAudioPayload | null = null;
  let waiting: OttoAudioPayload | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let starting: Promise<void> | null = null;
  const unsubscribe: Array<() => void> = [];

  const send = (event: string, payload: OttoAudioPayload) => {
    const bus = payload.windowId === "main" ? local ?? remote : remote ?? local;
    return bus ? bus.emit(event, { ...payload, scope: copyScope(payload.scope) }) : Promise.resolve();
  };
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const grant = (payload: OttoAudioPayload) => {
    owner = payload;
    waiting = null;
    clearTimer();
    void send(OTTO_AUDIO_GRANT_EVENT, payload);
  };
  const deny = (payload: OttoAudioPayload) => {
    void send(OTTO_AUDIO_DENY_EVENT, payload);
  };
  const startRevoke = (next: OttoAudioPayload) => {
    if (!owner) {
      grant(next);
      return;
    }
    waiting = next;
    const revoked = owner;
    void send(OTTO_AUDIO_REVOKE_EVENT, revoked);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (waiting && samePayload(waiting, next)) {
        waiting = null;
        deny(next);
      }
    }, timeoutMs);
  };
  const onRequest = (value: unknown) => {
    if (stopped) return;
    const request = payloadValue(value);
    if (!request) return;
    if (owner && samePayload(owner, request)) {
      void send(OTTO_AUDIO_GRANT_EVENT, request);
      return;
    }
    if (waiting && samePayload(waiting, request)) return;
    if (waiting) {
      // Exactly one request is queued. A third start is refused rather than
      // silently replacing the one already waiting behind the owner.
      deny(request);
      return;
    }
    startRevoke(request);
  };
  const onStopped = (value: unknown) => {
    if (stopped) return;
    const stoppedPayload = payloadValue(value);
    if (!stoppedPayload || !owner || !samePayload(owner, stoppedPayload)) return;
    owner = null;
    clearTimer();
    if (waiting) grant(waiting);
  };
  const onRelease = (value: unknown) => {
    if (stopped) return;
    const released = payloadValue(value);
    if (!released) return;
    if (waiting && samePayload(waiting, released)) {
      waiting = null;
      clearTimer();
      return;
    }
    if (!owner || !samePayload(owner, released)) return;
    owner = null;
    clearTimer();
    if (waiting) grant(waiting);
  };
  const windowDestroyed = (windowId: string) => {
    if (stopped || !windowId) return;
    if (waiting?.windowId === windowId) {
      waiting = null;
      clearTimer();
    }
    if (owner?.windowId !== windowId) return;
    owner = null;
    clearTimer();
    if (waiting) grant(waiting);
  };

  return {
    async start() {
      if (stopped) return;
      if (starting) return starting;
      starting = (async () => {
        for (const bus of buses) {
          for (const [event, handler] of [
            [OTTO_AUDIO_REQUEST_EVENT, onRequest],
            [OTTO_AUDIO_STOPPED_EVENT, onStopped],
            [OTTO_AUDIO_RELEASE_EVENT, onRelease],
          ] as const) {
            try {
              unsubscribe.push(await bus.listen(event, handler));
            } catch {
              // A missing cross-window channel still leaves the local broker
              // usable; avatar requests simply cannot arrive.
            }
          }
        }
        try {
          const remoteBus = remote ?? local;
          if (remoteBus) {
            unsubscribe.push(await remoteBus.listen(OTTO_AUDIO_WINDOW_DESTROYED_EVENT, (payload) => {
              const windowId = destroyedWindowId(payload);
              if (windowId) windowDestroyed(windowId === "avatar" ? "avatar" : windowId === "main" ? "main" : windowId);
            }));
          }
        } catch {
          // Window destruction is best-effort; release/stop remains the normal path.
        }
      })();
      return starting;
    },
    async stop() {
      stopped = true;
      clearTimer();
      owner = null;
      waiting = null;
      for (const off of unsubscribe.splice(0)) {
        try { off(); } catch { /* already removed */ }
      }
    },
    windowDestroyed,
    snapshot: () => ({ owner: owner ? { ...owner, scope: copyScope(owner.scope) } : null, waiting: waiting ? { ...waiting, scope: copyScope(waiting.scope) } : null }),
  };
}

export type OttoAudioRequesterOptions = {
  windowId: OttoAudioWindowId;
  bus: OttoAudioBus;
  timeoutMs?: number;
  /** The kind is included so a window can stop the thing that was revoked
   * without cancelling a capture that started after an old speech lease. */
  onRevoke?: (token: string, kind: OttoAudioKind) => void;
  createToken?: () => string;
};

/** The client half of the broker: request, hold one lease, and acknowledge a
 * revoke only after the registered stop seam has run. A request with no answer
 * fails closed, including a grant that arrives after its timeout. */
export function createOttoAudioRequester(options: OttoAudioRequesterOptions): OttoAudioRequester {
  const timeoutMs = Math.max(1, options.timeoutMs ?? OTTO_AUDIO_STOP_TIMEOUT_MS);
  const createToken = options.createToken ?? (() => crypto.randomUUID());
  let active: (OttoAudioPayload & { kind: OttoAudioKind }) | null = null;
  let pending: {
    payload: OttoAudioPayload;
    kind: OttoAudioKind;
    resolve: (lease: OttoAudioLease) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let disposed = false;
  const abandoned = new Set<string>();
  const unsubscribe: Array<() => void> = [];

  const send = (event: string, payload: OttoAudioPayload) => options.bus.emit(event, { ...payload, scope: copyScope(payload.scope) });
  const releaseActive = () => {
    if (!active) return;
    const lease = active;
    active = null;
    void send(OTTO_AUDIO_RELEASE_EVENT, lease);
  };
  const settleTimeout = () => {
    const current = pending;
    if (!current) return;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    abandoned.add(current.payload.token);
    void send(OTTO_AUDIO_RELEASE_EVENT, current.payload);
    current.reject(new Error("Audio is busy in another companion window. Try again when it finishes."));
  };
  const onGrant = (value: unknown) => {
    const payload = payloadValue(value);
    if (!payload || disposed || payload.windowId !== options.windowId) return;
    if (!pending) {
      // A late grant for a request that already timed out must not start
      // playback. Release the broker so it is not held by a phantom owner.
      if (abandoned.delete(payload.token)) void send(OTTO_AUDIO_RELEASE_EVENT, payload);
      return;
    }
    if (!samePayload(pending.payload, payload)) return;
    const current = pending;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    active = { ...payload, kind: current.kind };
    current.resolve({
      token: payload.token,
      isActive: () => !!active && samePayload(active, payload),
      release: () => {
        if (active && samePayload(active, payload)) releaseActive();
      },
    });
  };
  const onDeny = (value: unknown) => {
    const payload = payloadValue(value);
    if (!payload || !pending || !samePayload(pending.payload, payload)) return;
    const current = pending;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    current.reject(new Error("Audio is busy in another companion window. Try again when it finishes."));
  };
  const onRevoke = (value: unknown) => {
    const payload = payloadValue(value);
    if (!payload) return;
    if (active && samePayload(active, payload)) {
      const lease = active;
      active = null;
      try {
        options.onRevoke?.(lease.token, lease.kind);
        // A revoked speech lease must not cancel a microphone that started
        // after it (the recording gate prevents that overlap). A revoked
        // recording lease closes the microphone before the stopped ack.
        if (lease.kind === "recording") requestOttoAudioStop();
        else requestOttoSpeechStop();
      } catch {
        // A failing stop never leaves the broker waiting for an ack that can
        // never arrive; the lease is still released below.
      }
      void send(OTTO_AUDIO_STOPPED_EVENT, lease);
      return;
    }
    // A stale revoke names a token this window no longer owns. It is ignored.
  };

  const ready = (async () => {
    for (const [event, handler] of [
      [OTTO_AUDIO_GRANT_EVENT, onGrant],
      [OTTO_AUDIO_DENY_EVENT, onDeny],
      [OTTO_AUDIO_REVOKE_EVENT, onRevoke],
    ] as const) {
      try {
        unsubscribe.push(await options.bus.listen(event, handler));
      } catch {
        // Without a bus no request can be granted; request() fails closed.
      }
    }
  })();

  return {
    async request(scope, epoch, kind) {
      await ready;
      if (disposed) throw new Error("Audio ownership is unavailable.");
      if (!isOttoScope(scope)) throw new Error("Audio ownership is unavailable.");
      if (!Number.isInteger(epoch) || epoch < 1) throw new Error("Audio ownership is unavailable.");
      if (pending) throw new Error("Another audio request is already starting in this window.");
      releaseActive();
      const token = createToken();
      const payload: OttoAudioPayload = { scope: copyScope(scope), epoch, windowId: options.windowId, token };
      return new Promise<OttoAudioLease>((resolve, reject) => {
        const current = { payload, kind, resolve, reject, timer: null as ReturnType<typeof setTimeout> | null };
        pending = current;
        current.timer = setTimeout(() => {
          if (pending === current) settleTimeout();
        }, timeoutMs);
        void send(OTTO_AUDIO_REQUEST_EVENT, payload).catch(() => {
          if (pending !== current) return;
          pending = null;
          if (current.timer) clearTimeout(current.timer);
          reject(new Error("Audio ownership is unavailable."));
        });
      });
    },
    active: () => active ? { ...active, scope: copyScope(active.scope) } : null,
    dispose() {
      disposed = true;
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error("Audio ownership was released."));
        pending = null;
      }
      releaseActive();
      for (const off of unsubscribe.splice(0)) {
        try { off(); } catch { /* already removed */ }
      }
    },
  };
}

/** A synchronous bus for the main window's own requester. Its events still go
 * through the same broker handlers; no Tauri round-trip is needed for a window
 * talking to itself. */
export function createLocalAudioBus(): OttoAudioBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    async listen(event, handler) {
      const group = handlers.get(event) ?? new Set();
      group.add(handler);
      handlers.set(event, group);
      return () => group.delete(handler);
    },
    async emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
}

export function tauriAudioBus(): OttoAudioBus {
  return {
    listen: (event, handler) => tauriListen<unknown>(event, ({ payload }) => handler(payload)),
    emit: (event, payload) => tauriEmit(event, payload),
  };
}

let installed: OttoAudioRequester | null = null;

export function installOttoAudioRequester(requester: OttoAudioRequester): () => void {
  installed = requester;
  return () => {
    if (installed === requester) installed = null;
  };
}

/** The window's one audio request entry point. Called only after an explicit
 * Listen or microphone press. */
export async function requestOttoAudio(scope: OttoScope, epoch: number, kind: OttoAudioKind): Promise<OttoAudioLease> {
  if (!installed) throw new Error("Audio ownership is unavailable.");
  return installed.request(scope, epoch, kind);
}

export function activeOttoAudioLease(): (OttoAudioPayload & { kind: OttoAudioKind }) | null {
  return installed?.active() ?? null;
}

export function ottoAudioFailure(error: unknown): string {
  return messageOf(error);
}
