import type { OttoContextEvent, OttoIdentity } from "./mode";
import { copyOttoViewState, type OttoViewState } from "./viewSwitch";

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

export type AvatarViewAdoption = {
  adopt: true;
  view: OttoViewState;
  stopActiveWork: boolean;
  accountChanged: boolean;
  modeChanged: boolean;
  epochChanged: boolean;
  revisionChanged: boolean;
};

function sameScope(left: OttoContextEvent["scope"], right: OttoContextEvent["scope"]) {
  return left.userId === right.userId
    && left.organizationId === right.organizationId
    && left.mode === right.mode;
}

function sameActor(left: OttoIdentity, right: OttoIdentity) {
  return left.userId === right.userId && left.organizationId === right.organizationId;
}

function contextFromView(view: OttoViewState): OttoContextEvent {
  return { scope: { userId: view.scope.userId, organizationId: view.scope.organizationId, mode: view.scope.mode }, epoch: view.epoch };
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

/** Full presentation snapshots add a revision and conversation generation to
 * the epoch fence. A same-epoch mode contradiction is impossible; a newer
 * revision updates capabilities/thread identity without re-stopping audio. */
export function adoptAvatarView(
  current: OttoViewState | null,
  next: OttoViewState,
  identity: AvatarIdentity | null,
): AvatarViewAdoption | null {
  if (!identity) return null;
  if (next.scope.userId !== identity.userId || next.scope.organizationId !== identity.organizationId) return null;

  if (!current) {
    return {
      adopt: true,
      view: next,
      stopActiveWork: false,
      accountChanged: false,
      modeChanged: false,
      epochChanged: false,
      revisionChanged: false,
    };
  }

  const accountChanged = current.scope.userId !== next.scope.userId
    || current.scope.organizationId !== next.scope.organizationId;
  if (accountChanged) {
    return {
      adopt: true,
      view: next,
      stopActiveWork: true,
      accountChanged: true,
      modeChanged: current.scope.mode !== next.scope.mode,
      epochChanged: current.epoch !== next.epoch,
      revisionChanged: current.revision !== next.revision,
    };
  }
  if (next.adminConversationGeneration < current.adminConversationGeneration) return null;
  if (next.adminConversationGeneration === current.adminConversationGeneration
    && next.adminConversationRevision < current.adminConversationRevision) return null;
  if (next.epoch < current.epoch) return null;
  if (next.epoch === current.epoch) {
    if (next.scope.mode !== current.scope.mode) return null;
    if (next.revision <= current.revision) return null;
    return {
      adopt: true,
      view: next,
      stopActiveWork: false,
      accountChanged: false,
      modeChanged: false,
      epochChanged: false,
      revisionChanged: true,
    };
  }
  return {
    adopt: true,
    view: next,
    stopActiveWork: true,
    accountChanged: false,
    modeChanged: current.scope.mode !== next.scope.mode,
    epochChanged: true,
    revisionChanged: current.revision !== next.revision,
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
  onView?: (view: OttoViewState | null) => void;
  stopActiveWork: () => void;
};

export type AvatarContextController = {
  receive: (event: OttoContextEvent) => void;
  receiveView: (view: OttoViewState) => void;
  view: () => OttoViewState | null;
  identity: () => AvatarSessionIdentity | null;
  isCurrent: (context: OttoContextEvent) => boolean;
  isViewCurrent: (view: OttoViewState) => boolean;
  clear: () => void;
  sessionChanged: (load: () => Promise<AvatarSessionIdentity | null>) => Promise<void>;
};

/** Tokens never cross the bus. The shell calls sessionChanged on replacement;
 * all old work is fenced synchronously, before the new identity request waits.
 * Full values are published only by the owner; this controller adopts them
 * with an epoch floor that survives same-actor token replacement. */
export function createAvatarContextController(deps: AvatarContextControllerDeps): AvatarContextController {
  let sequence = 0;
  let identity: AvatarSessionIdentity | null = null;
  let currentContext: OttoContextEvent | null = null;
  let currentView: OttoViewState | null = null;
  let pendingContext: OttoContextEvent | null = null;
  let pendingView: OttoViewState | null = null;
  let resolving = false;
  let floorActor: OttoIdentity | null = null;
  let floorEpoch = 0;
  let stoppedEpoch = 0;

  const rememberFloor = () => {
    const source = currentView ?? currentContext;
    if (!source) return;
    if (!floorActor || !sameActor(floorActor, source.scope)) {
      floorActor = { userId: source.scope.userId, organizationId: source.scope.organizationId };
      floorEpoch = source.epoch;
      return;
    }
    floorEpoch = Math.max(floorEpoch, source.epoch);
  };

  const publishContext = (next: OttoContextEvent | null) => {
    deps.onContext(next);
  };

  const publishView = (next: OttoViewState | null) => {
    deps.onView?.(next);
  };

  const stopOnceForEpoch = (epoch: number) => {
    if (stoppedEpoch === epoch) return;
    stoppedEpoch = epoch;
    deps.stopActiveWork();
  };

  const clearState = () => {
    rememberFloor();
    const hadWork = currentContext !== null || currentView !== null;
    currentContext = null;
    currentView = null;
    pendingContext = null;
    pendingView = null;
    identity = null;
    if (hadWork) deps.stopActiveWork();
    publishContext(null);
    publishView(null);
  };

  const adoptView = (next: OttoViewState) => {
    const copy = copyOttoViewState(next);
    const adoption = adoptAvatarView(currentView, copy, identity);
    if (!adoption) return;
    if (adoption.stopActiveWork) stopOnceForEpoch(copy.epoch);
    const previousContext = currentContext;
    currentView = adoption.view;
    currentContext = contextFromView(adoption.view);
    floorActor = { userId: adoption.view.scope.userId, organizationId: adoption.view.scope.organizationId };
    floorEpoch = Math.max(floorEpoch, adoption.view.epoch);
    if (!previousContext
      || previousContext.epoch !== currentContext.epoch
      || !sameScope(previousContext.scope, currentContext.scope)) {
      publishContext({ ...currentContext, scope: { ...currentContext.scope } });
    }
    publishView(copyOttoViewState(adoption.view));
  };

  const adoptContext = (next: OttoContextEvent) => {
    if (currentView) {
      if (next.epoch < currentView.epoch) return;
      if (next.epoch === currentView.epoch) {
        if (next.scope.mode !== currentView.scope.mode) return;
        currentContext = { scope: { ...next.scope }, epoch: next.epoch };
        return;
      }
      // Suspend the full capabilities until the matching full snapshot arrives.
      stopOnceForEpoch(next.epoch);
      currentView = null;
      currentContext = { scope: { ...next.scope }, epoch: next.epoch };
      floorActor = { userId: next.scope.userId, organizationId: next.scope.organizationId };
      floorEpoch = Math.max(floorEpoch, next.epoch);
      publishView(null);
      publishContext({ ...currentContext, scope: { ...currentContext.scope } });
      return;
    }
    if (currentContext) {
      if (next.epoch < currentContext.epoch) return;
      if (next.epoch === currentContext.epoch) {
        if (next.scope.mode !== currentContext.scope.mode) return;
        return;
      }
      stopOnceForEpoch(next.epoch);
    } else if (next.epoch <= floorEpoch) {
      return;
    }
    currentContext = { scope: { ...next.scope }, epoch: next.epoch };
    floorActor = { userId: next.scope.userId, organizationId: next.scope.organizationId };
    floorEpoch = Math.max(floorEpoch, next.epoch);
    publishContext({ ...currentContext, scope: { ...currentContext.scope } });
  };

  const newerContext = (current: OttoContextEvent | null, next: OttoContextEvent) => !current
    || next.epoch > current.epoch
    || (next.epoch === current.epoch && next.scope.mode === current.scope.mode);
  const newerView = (current: OttoViewState | null, next: OttoViewState) => !current
    || next.epoch > current.epoch
    || (next.epoch === current.epoch && (next.revision > current.revision
      || next.adminConversationGeneration > current.adminConversationGeneration
      || (next.adminConversationGeneration === current.adminConversationGeneration
        && next.adminConversationRevision > current.adminConversationRevision)));

  const receive = (next: OttoContextEvent) => {
    if (resolving) {
      if (newerContext(pendingContext, next)) pendingContext = next;
      return;
    }
    if (!identity || identity.role !== "admin") return;
    if (next.scope.userId !== identity.userId || next.scope.organizationId !== identity.organizationId) return;
    if (next.epoch < floorEpoch) return;
    adoptContext(next);
  };

  const receiveView = (next: OttoViewState) => {
    if (resolving) {
      if (newerView(pendingView, next)) pendingView = next;
      return;
    }
    if (!identity || identity.role !== "admin") return;
    if (next.scope.userId !== identity.userId || next.scope.organizationId !== identity.organizationId) return;
    if (next.epoch < floorEpoch) return;
    if (!currentView && currentContext) {
      if (next.epoch < currentContext.epoch) return;
      if (next.epoch === currentContext.epoch && next.scope.mode !== currentContext.scope.mode) return;
      if (next.epoch > currentContext.epoch) stopOnceForEpoch(next.epoch);
    }
    if (!currentView && !currentContext && next.epoch <= floorEpoch) return;
    adoptView(next);
  };

  return {
    receive,
    receiveView,
    view: () => currentView ? copyOttoViewState(currentView) : null,
    identity: () => identity,
    isCurrent: (context) => !!currentContext
      && currentContext.epoch === context.epoch && sameScope(currentContext.scope, context.scope),
    isViewCurrent: (view) => !!currentView
      && currentView.epoch === view.epoch
      && currentView.revision === view.revision
      && currentView.scope.userId === view.scope.userId
      && currentView.scope.organizationId === view.scope.organizationId
      && currentView.scope.mode === view.scope.mode
      && currentView.adminConversationGeneration === view.adminConversationGeneration
      && currentView.adminConversationRevision === view.adminConversationRevision,
    clear: () => {
      sequence += 1;
      resolving = false;
      clearState();
    },
    async sessionChanged(load) {
      const previousIdentity = identity;
      const previousActor = currentView ?? currentContext;
      rememberFloor();
      if (previousActor && (!previousIdentity || !sameActor(previousIdentity, previousActor.scope))) {
        floorActor = null;
        floorEpoch = 0;
      }
      sequence += 1;
      resolving = true;
      clearState();
      const attempt = sequence;
      try {
        const next = await load();
        if (attempt !== sequence) return;
        identity = next;
        resolving = false;
        if (!next || next.role !== "admin") {
          pendingContext = null;
          pendingView = null;
          return;
        }
        if (!floorActor || !sameActor(floorActor, next)) {
          floorActor = { userId: next.userId, organizationId: next.organizationId };
          floorEpoch = 0;
          stoppedEpoch = 0;
        }
        const queuedView = pendingView;
        const queuedContext = pendingContext;
        pendingView = null;
        pendingContext = null;
        if (queuedView) receiveView(queuedView);
        else if (queuedContext) receive(queuedContext);
      } catch {
        if (attempt === sequence) {
          resolving = false;
          clearState();
        }
      }
    },
  };
}
