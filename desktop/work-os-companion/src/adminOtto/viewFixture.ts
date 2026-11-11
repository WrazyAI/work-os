import { buildOttoViewState, resolveWorkspaceSwitch, type OttoViewFailure, type OttoViewState } from "./viewSwitch";
import type { OttoMode } from "./mode";

const PARAM = "avatar-view";
const SCOPE = { userId: "user-preview", organizationId: "org-preview", mode: "admin" as const };

export function avatarViewFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(PARAM) === "admin";
}

export function createAvatarViewFixture(search: string): {
  initial: OttoViewState;
  request: (mode: OttoMode) => Promise<{ ok: true; state: OttoViewState } | { ok: false; reason: OttoViewFailure }>;
  retry: () => OttoViewState;
} {
  const params = new URLSearchParams(search);
  const requested = params.get("view-state");
  const adminStatus = requested === "loading" ? "loading" as const
    : requested === "failed" ? "failed" as const
      : "ready" as const;
  const personId = requested === "unmapped" ? null : "person-preview";
  let state = buildOttoViewState({
    scope: SCOPE,
    epoch: 1,
    revision: 1,
    workspace: "admin",
    role: "admin",
    adminStatus,
    personId,
    voiceAvailable: adminStatus === "ready",
    transcriptionAvailable: adminStatus === "ready",
    adminConversationId: "admin-fixture-conversation",
    adminConversationGeneration: 1,
    adminConversationRevision: 1,
    adminConversationBusy: false,
  });
  return {
    initial: state,
    async request(mode) {
      const result = resolveWorkspaceSwitch({
        requested: mode,
        current: state.workspace,
        role: state.role,
        adminStatus: state.adminStatus,
        personId: state.personId,
        online: true,
        resetting: false,
      });
      if (!result.ok) return result;
      state = buildOttoViewState({
        ...state,
        scope: { ...state.scope, mode },
        workspace: mode,
        epoch: state.epoch + 1,
        revision: state.revision + 1,
      });
      return { ok: true, state };
    },
    retry() {
      state = buildOttoViewState({
        ...state,
        adminStatus: "ready",
        voiceAvailable: true,
        transcriptionAvailable: true,
        revision: state.revision + 1,
      });
      return state;
    },
  };
}
