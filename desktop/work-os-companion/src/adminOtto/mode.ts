import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";

export const OTTO_CONTEXT_EVENT = "work-os://otto-context-changed";
export const OTTO_CHANGED_EVENT = "work-os://admin-otto-changed";
export const OTTO_DELIVERY_OWNER_EVENT = "work-os://otto-delivery-owner";
export const OTTO_CONTEXT_CLEARED_EVENT = "work-os://otto-context-cleared";

export type OttoMode = "admin" | "employee";
export type OttoIdentity = { userId: string; organizationId: string };

/** The authoritative actor/organization identity. A scope is only ever built
 * from this value plus the selected mode; no client body can widen it. */
export type OttoActor = { userId: string; organizationId: string };

export type AdminOttoContext = {
  scope: OttoScope;
  personId: string | null;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
};

/** The two-window-visible snapshot. It intentionally carries no team record,
 * conversation text, lease token, or provider credential. */
export type OttoModeSnapshot = {
  scope: OttoScope;
  epoch: number;
  personId: string | null;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
};

export type OttoContextEvent = { scope: OttoScope; epoch: number };

export type AdminOttoChangedEvent = {
  scope: OttoScope;
  epoch: number;
  eventIds: string[];
  conversationId?: string;
};

export type OttoModeUnavailableReason =
  | "admin_context_unavailable"
  | "employee_context_unavailable"
  | "disposed";

export class OttoModeUnavailableError extends Error {
  readonly reason: OttoModeUnavailableReason;
  constructor(reason: OttoModeUnavailableReason) {
    super(reason === "employee_context_unavailable"
      ? "This account has no personal workday to switch to."
      : reason === "admin_context_unavailable"
        ? "The administration context is not available yet."
        : "This companion context has been disposed.");
    this.name = "OttoModeUnavailableError";
    this.reason = reason;
  }
}

export type OttoModeControllerDeps = {
  /** The context this controller starts on. Required so there is never a
   * half-formed snapshot without a validated actor/organization. */
  initialContext: AdminOttoContext;
  initialEpoch?: number;
  adminContext?: AdminOttoContext | null;
  employeeContext?: AdminOttoContext | null;
  /** Called with the *old* epoch before any old-mode result is cleared. */
  abort?: (epoch: number, reason: "mode_switch" | "dispose") => void;
  stopAudio?: () => void;
  stopMicrophone?: () => void;
  /** Clears only this mode's visible Otto result state. Employee prompt state
   * is owned by the shell and never passed here. */
  clearResults?: (mode: OttoMode, reason: "mode_switch" | "dispose") => void;
  /** Receives the full typed snapshot; callers sanitize before broadcasting. */
  publish?: (snapshot: OttoModeSnapshot) => void;
};

export type OttoModeController = {
  snapshot(): OttoModeSnapshot;
  switchMode(mode: OttoMode): Promise<OttoModeSnapshot>;
  /** Adopt the main window's owner epoch in the floating companion. */
  adoptEvent(event: OttoContextEvent): boolean;
  isCurrent(epoch: number): boolean;
  setContexts(contexts: { adminContext?: AdminOttoContext | null; employeeContext?: AdminOttoContext | null }): void;
  dispose(): void;
};

function copyScope(scope: OttoScope): OttoScope {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
    mode: scope.mode,
  };
}

function assertContext(context: AdminOttoContext, actor: OttoActor) {
  if (context.scope.userId !== actor.userId || context.scope.organizationId !== actor.organizationId) {
    throw new Error("Admin Otto context belongs to another account.");
  }
  if (context.scope.mode !== "admin" && context.scope.mode !== "employee") {
    throw new Error("Admin Otto context has an invalid mode.");
  }
  if (typeof context.personId !== "string" && context.personId !== null) {
    throw new Error("Admin Otto context has an invalid person id.");
  }
}

function snapshotFrom(context: AdminOttoContext, epoch: number): OttoModeSnapshot {
  return {
    scope: copyScope(context.scope),
    epoch,
    personId: context.personId,
    voiceAvailable: context.voiceAvailable === true,
    transcriptionAvailable: context.transcriptionAvailable === true,
  };
}

export function isOttoActor(value: unknown): value is OttoActor {
  if (!value || typeof value !== "object") return false;
  const actor = value as Record<string, unknown>;
  return typeof actor.userId === "string" && actor.userId.length > 0
    && typeof actor.organizationId === "string" && actor.organizationId.length > 0;
}

export function isOttoScope(value: unknown): value is OttoScope {
  if (!isOttoActor(value)) return false;
  const scope = value as unknown as Record<string, unknown>;
  return scope.mode === "admin" || scope.mode === "employee";
}

/** The only shape allowed over `work-os://otto-context-changed`. */
export function ottoContextEvent(snapshot: Pick<OttoModeSnapshot, "scope" | "epoch">): OttoContextEvent {
  return { scope: copyScope(snapshot.scope), epoch: snapshot.epoch };
}

export function parseOttoContextEvent(value: unknown): OttoContextEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (!isOttoScope(event.scope)) return null;
  if (!Number.isInteger(event.epoch) || Number(event.epoch) < 1) return null;
  return { scope: copyScope(event.scope), epoch: Number(event.epoch) };
}

/** Sanitize an event that announces a changed record set or conversation.
 * Recap bodies, lease tokens, and account credentials are never copied. */
export function adminOttoChangedEvent(input: {
  scope: OttoScope;
  epoch: number;
  eventIds?: string[];
  conversationId?: string | null;
}): AdminOttoChangedEvent {
  const eventIds = (Array.isArray(input.eventIds) ? input.eventIds : [])
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 100);
  const event: AdminOttoChangedEvent = {
    scope: copyScope(input.scope),
    epoch: input.epoch,
    eventIds,
  };
  if (typeof input.conversationId === "string" && input.conversationId.length > 0) {
    event.conversationId = input.conversationId;
  }
  return event;
}

export function parseAdminOttoChangedEvent(value: unknown): AdminOttoChangedEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (!isOttoScope(event.scope) || !Number.isInteger(event.epoch) || Number(event.epoch) < 1) return null;
  if (!Array.isArray(event.eventIds) || event.eventIds.length > 100) return null;
  if (event.eventIds.some((id) => typeof id !== "string" || id.length === 0)) return null;
  return adminOttoChangedEvent({
    scope: event.scope,
    epoch: Number(event.epoch),
    eventIds: event.eventIds as string[],
    conversationId: typeof event.conversationId === "string" ? event.conversationId : undefined,
  });
}

/** Identity equality for a scope. Never grants authorization; it only fences
 * asynchronous work from a previous actor, organization or mode. */
export function sameOttoScope(left: OttoScope | null | undefined, right: OttoScope | null | undefined): boolean {
  return !!left && !!right
    && left.userId === right.userId
    && left.organizationId === right.organizationId
    && left.mode === right.mode;
}

function sameScope(left: OttoScope, right: OttoScope) {
  return sameOttoScope(left, right);
}

/** The post-await recording fence. A plain employee window has no admin mode
 * controller, so the authoritative session alone decides; when a controller
 * exists it must also still be on the same actor/org/mode and epoch. */
export function captureScopeStillCurrent(input: {
  requested: OttoScope;
  requestedEpoch: number;
  actor: OttoActor;
  session: OttoActor | null;
  mode: Pick<OttoModeSnapshot, "scope" | "epoch"> | null;
}): boolean {
  const sameActor = !!input.session
    && input.session.userId === input.actor.userId
    && input.session.organizationId === input.actor.organizationId;
  if (!sameActor) return false;
  if (!input.mode) return true;
  return input.mode.epoch === input.requestedEpoch
    && sameOttoScope(input.mode.scope, input.requested);
}

/**
 * Owns the one explicit actor + organization + mode + epoch for admin Otto.
 *
 * The epoch is a local fence, not an authorization token: a response that
 * returns after the scope changed is dropped before it can touch visible
 * results. Every mode change also cancels the old mode's microphone, audio and
 * network work; switching to the mode already on screen (minimize/expand) is
 * deliberately a no-op.
 */
export function createOttoModeController(deps: OttoModeControllerDeps): OttoModeController {
  const actor: OttoActor = {
    userId: deps.initialContext.scope.userId,
    organizationId: deps.initialContext.scope.organizationId,
  };
  assertContext(deps.initialContext, actor);
  if (deps.adminContext) assertContext(deps.adminContext, actor);
  if (deps.employeeContext) assertContext(deps.employeeContext, actor);

  let adminContext = deps.adminContext ?? (deps.initialContext.scope.mode === "admin" ? deps.initialContext : null);
  let employeeContext = deps.employeeContext ?? (deps.initialContext.scope.mode === "employee" ? deps.initialContext : null);
  let snapshot = snapshotFrom(deps.initialContext, Math.max(1, deps.initialEpoch ?? 1));
  let disposed = false;

  const stopOldWork = (mode: OttoMode, reason: "mode_switch" | "dispose") => {
    deps.abort?.(snapshot.epoch, reason);
    deps.stopAudio?.();
    deps.stopMicrophone?.();
    deps.clearResults?.(mode, reason);
  };

  return {
    snapshot: () => snapshotFrom(snapshot, snapshot.epoch),

    async switchMode(mode: OttoMode) {
      if (disposed) throw new OttoModeUnavailableError("disposed");
      if (mode === snapshot.scope.mode) return snapshotFrom(snapshot, snapshot.epoch);
      const target = mode === "admin" ? adminContext : employeeContext;
      if (!target) {
        throw new OttoModeUnavailableError(mode === "admin" ? "admin_context_unavailable" : "employee_context_unavailable");
      }
      const oldMode = snapshot.scope.mode;
      stopOldWork(oldMode, "mode_switch");
      snapshot = snapshotFrom(target, snapshot.epoch + 1);
      deps.publish?.(snapshotFrom(snapshot, snapshot.epoch));
      return snapshotFrom(snapshot, snapshot.epoch);
    },

    adoptEvent(event: OttoContextEvent) {
      if (disposed) return false;
      if (event.scope.userId !== actor.userId || event.scope.organizationId !== actor.organizationId) return false;
      if (event.epoch < snapshot.epoch) return false;
      if (event.epoch === snapshot.epoch) {
        return sameScope(event.scope, snapshot.scope);
      }
      const target = event.scope.mode === "admin" ? adminContext : employeeContext;
      const oldMode = snapshot.scope.mode;
      // A context broadcast means the other window crossed a scope boundary.
      // Stop this window's old read/recording before adopting the new fence.
      if (event.scope.mode !== oldMode) stopOldWork(oldMode, "mode_switch");
      if (target) {
        snapshot = snapshotFrom(target, event.epoch);
      } else {
        snapshot = {
          scope: copyScope(event.scope),
          epoch: event.epoch,
          personId: null,
          voiceAvailable: false,
          transcriptionAvailable: false,
        };
      }
      return true;
    },

    isCurrent(epoch: number) {
      return !disposed && epoch === snapshot.epoch;
    },

    setContexts(contexts) {
      if ("adminContext" in contexts) {
        if (contexts.adminContext) {
          assertContext(contexts.adminContext, actor);
          adminContext = contexts.adminContext;
        } else {
          adminContext = null;
        }
      }
      if ("employeeContext" in contexts) {
        if (contexts.employeeContext) {
          assertContext(contexts.employeeContext, actor);
          employeeContext = contexts.employeeContext;
        } else {
          employeeContext = null;
        }
      }
      const target = snapshot.scope.mode === "admin" ? adminContext : employeeContext;
      if (target) {
        snapshot = snapshotFrom(target, snapshot.epoch);
      } else {
        // A removed mapping is no longer switchable and the current snapshot
        // must not keep advertising its person/voice flags.
        snapshot = {
          ...snapshot,
          personId: null,
          voiceAvailable: false,
          transcriptionAvailable: false,
        };
      }
    },

    dispose() {
      if (disposed) return;
      stopOldWork(snapshot.scope.mode, "dispose");
      disposed = true;
    },
  };
}
