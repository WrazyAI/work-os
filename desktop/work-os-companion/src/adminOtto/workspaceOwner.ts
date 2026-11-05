import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { resolveWorkspaceSwitch, type OttoViewFailure, type OttoViewRole } from "./viewSwitch";
import type { OttoMode } from "./mode";

export type OttoWorkspaceResult = { ok: true } | { ok: false; reason: OttoViewFailure };

export type WorkspaceOwnerState = {
  workspace: OttoMode;
  scope: OttoScope | null;
  actor: { userId: string; organizationId: string } | null;
  role: OttoViewRole | null;
  adminStatus: "loading" | "ready" | "failed" | "absent";
  personId: string | null;
  online: boolean;
  resetting: boolean;
};

export type WorkspaceOwnerDeps = {
  read: () => WorkspaceOwnerState;
  suspend: (next: OttoMode) => void;
  switchController: (next: OttoMode) => Promise<{ scope: OttoScope; epoch: number }>;
  commit: (next: OttoMode, snapshot: { scope: OttoScope; epoch: number }) => void;
  retryContext: () => Promise<boolean>;
};

export type WorkspaceOwner = {
  request: (next: OttoMode) => Promise<OttoWorkspaceResult>;
  retryContext: () => Promise<OttoWorkspaceResult>;
};

/** The effective shell follows the same bootstrap decision as the App: a
 * failed/unmapped context wins Administration, while a context that is still
 * loading keeps the selected side. */
export function effectiveWorkspaceMode(input: {
  selected: OttoMode;
  adminShell: boolean;
  waitingForContext: boolean;
}): OttoMode {
  if (input.waitingForContext) return input.selected;
  return input.adminShell ? "admin" : input.selected === "admin" ? "admin" : "employee";
}

function sameActor(left: { userId: string; organizationId: string }, right: { userId: string; organizationId: string }) {
  return left.userId === right.userId && left.organizationId === right.organizationId;
}

export function createWorkspaceOwner(deps: WorkspaceOwnerDeps): WorkspaceOwner {
  let inFlight: Promise<OttoWorkspaceResult> | null = null;
  let target: OttoMode | null = null;

  const validate = (next: OttoMode): OttoWorkspaceResult => {
    const state = deps.read();
    if (!state.actor || !state.scope || !sameActor(state.scope, state.actor)) {
      return { ok: false, reason: "stale_scope" };
    }
    return resolveWorkspaceSwitch({
      requested: next,
      current: state.workspace,
      role: state.role,
      adminStatus: state.adminStatus,
      personId: state.personId,
      online: state.online,
      resetting: state.resetting,
    });
  };

  const run = async (next: OttoMode): Promise<OttoWorkspaceResult> => {
    const before = deps.read();
    if (next === before.workspace) return { ok: true };
    const validation = validate(next);
    if (!validation.ok) return validation;
    deps.suspend(next);
    try {
      const snapshot = await deps.switchController(next);
      const after = deps.read();
      if (!after.actor || !after.scope || !sameActor(after.scope, after.actor)
        || snapshot.scope.userId !== after.actor.userId
        || snapshot.scope.organizationId !== after.actor.organizationId
        || snapshot.scope.mode !== next) {
        return { ok: false, reason: "switch_failed" };
      }
      deps.commit(next, snapshot);
      return { ok: true };
    } catch {
      return { ok: false, reason: "switch_failed" };
    }
  };

  return {
    request(next) {
      const state = deps.read();
      if (next === state.workspace) return Promise.resolve({ ok: true });
      if (inFlight) {
        return target === next ? inFlight : Promise.resolve({ ok: false, reason: "switch_failed" });
      }
      target = next;
      const promise = run(next);
      inFlight = promise;
      void promise.finally(() => {
        if (inFlight === promise) {
          inFlight = null;
          target = null;
        }
      });
      return promise;
    },
    async retryContext() {
      try {
        return await deps.retryContext() ? { ok: true } : { ok: false, reason: "admin_failed" };
      } catch {
        return { ok: false, reason: "admin_failed" };
      }
    },
  };
}
