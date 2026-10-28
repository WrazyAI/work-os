import type { OttoContextEvent, OttoIdentity } from "./mode";

export type AvatarIdentity = OttoIdentity;
export type AvatarSessionIdentity = AvatarIdentity & { role: string };

export type AvatarContextAdoption = {
  adopt: true;
  event: OttoContextEvent;
  stopActiveWork: boolean;
  accountChanged: boolean;
  modeChanged: boolean;
  epochChanged: boolean;
};

function sameScope(left: OttoContextEvent["scope"], right: OttoContextEvent["scope"]) {
  return left.userId === right.userId
    && left.organizationId === right.organizationId
    && left.mode === right.mode;
}

/**
 * The avatar's real adoption rule.
 *
 * A same-organization account change is a hard scope boundary even when the
 * new main controller starts again at epoch 1; epoch ordering only applies
 * within the same user. A foreign organization or a lower same-account epoch
 * is ignored. Any adopted boundary tells the caller to stop its old
 * audio/microphone/network work before using the new context.
 */
export function adoptAvatarContext(
  current: OttoContextEvent | null,
  next: OttoContextEvent,
  identity: AvatarIdentity | null,
): AvatarContextAdoption | null {
  if (!identity) return null;
  if (next.scope.userId !== identity.userId || next.scope.organizationId !== identity.organizationId) return null;

  if (!current) {
    return {
      adopt: true,
      event: next,
      stopActiveWork: false,
      accountChanged: false,
      modeChanged: false,
      epochChanged: false,
    };
  }

  const accountChanged = current.scope.userId !== next.scope.userId
    || current.scope.organizationId !== next.scope.organizationId;
  if (!accountChanged && next.epoch < current.epoch) return null;
  if (sameScope(current.scope, next.scope) && current.epoch === next.epoch) return null;

  return {
    adopt: true,
    event: next,
    stopActiveWork: true,
    accountChanged,
    modeChanged: current.scope.mode !== next.scope.mode,
    epochChanged: current.epoch !== next.epoch,
  };
}

/** Sign-out, token replacement, or a different user must reset the adopted
 * epoch even when the organization has not changed. */
export function avatarIdentityChanged(
  current: OttoContextEvent | null,
  previous: AvatarIdentity | null,
  next: AvatarIdentity | null,
): boolean {
  if (!current) return false;
  if (!next || !previous) return current !== null && next === null;
  return previous.userId !== next.userId || previous.organizationId !== next.organizationId;
}

export type AvatarContextControllerDeps = {
  onContext: (context: OttoContextEvent | null) => void;
  stopActiveWork: () => void;
};

/** Tokens never cross the bus. The shell calls sessionChanged on replacement;
 * all old work is fenced synchronously, before the new identity request waits. */
export function createAvatarContextController(deps: AvatarContextControllerDeps) {
  let sequence = 0;
  let identity: AvatarSessionIdentity | null = null;
  let current: OttoContextEvent | null = null;
  let pending: OttoContextEvent | null = null;
  let resolving = false;
  const clear = () => {
    sequence++;
    resolving = false;
    identity = null;
    current = null;
    pending = null;
    deps.stopActiveWork();
    deps.onContext(null);
  };
  const receive = (next: OttoContextEvent) => {
    if (resolving) { pending = next; return; }
    if (identity?.role !== "admin") return;
    const adoption = adoptAvatarContext(current, next, identity);
    if (!adoption) return;
    if (adoption.stopActiveWork) deps.stopActiveWork();
    current = adoption.event;
    deps.onContext(current);
  };
  return {
    receive, clear,
    identity: () => identity,
    isCurrent: (context: OttoContextEvent) => !!current
      && current.epoch === context.epoch && sameScope(current.scope, context.scope),
    async sessionChanged(load: () => Promise<AvatarSessionIdentity | null>) {
      clear();
      resolving = true;
      const attempt = sequence;
      try {
        const next = await load();
        if (attempt !== sequence) return;
        identity = next;
        resolving = false;
        const queued = pending;
        pending = null;
        if (queued) receive(queued);
      } catch {
        if (attempt === sequence) clear();
      }
    },
  };
}
