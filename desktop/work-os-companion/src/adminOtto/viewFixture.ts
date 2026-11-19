import { buildOttoViewState, resolveWorkspaceSwitch, type OttoViewFailure, type OttoViewState } from "./viewSwitch";
import type { OttoMode } from "./mode";
import type { AdminAttentionItem } from "./attention";

const PARAM = "avatar-view";
const SCOPE = { userId: "user-preview", organizationId: "org-preview", mode: "admin" as const };

export function adminAttentionFixtureRequested(search: string): "eod" | "recap" | null {
  if (!import.meta.env.DEV) return null;
  const kind = new URLSearchParams(search).get("admin-attention");
  return kind === "eod" || kind === "recap" ? kind : null;
}

/** A grounded arrival for rendered QA of the compact bubble, the alert pose,
 * and the expanded card. It never reaches a real delivery feed. */
export function createAdminAttentionFixture(kind: "eod" | "recap"): AdminAttentionItem {
  return kind === "recap"
    ? {
        id: "recap:fixture", kind: "recap_reviewed", count: 2,
        title: "Reviewed recaps are ready", body: "2 recaps are waiting in the administration inbox.",
        section: "recaps", personId: null, at: "2026-11-18T17:05:00.000Z",
      }
    : {
        id: "eod:fixture", kind: "eod_submitted", count: 1,
        title: "EOD report submitted", body: "Maya Chen's report is waiting for your review.",
        section: "review", personId: "person-preview", at: "2026-11-18T17:04:00.000Z",
      };
}

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
