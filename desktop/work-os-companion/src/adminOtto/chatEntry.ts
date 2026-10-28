import type { AdminRead, ChatRequest, ChatResult, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import type { AdminOttoThreadView } from "./api";

export type AdminOttoEntryTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: AdminRead | null;
};

export type AdminOttoEntrySnapshot = {
  scope: OttoScope;
  conversationId: string | null;
  turns: AdminOttoEntryTurn[];
  draft: string;
  busy: boolean;
  hydration: "idle" | "loading" | "failed";
  error: string | null;
};

export type AdminOttoEntryDeps = {
  scope: OttoScope;
  send: (input: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>;
  load?: (conversationId: string, signal?: AbortSignal) => Promise<AdminOttoThreadView>;
  createRequestId?: () => string;
  initialDraft?: string;
  initialRequestId?: string | null;
  initialConversationId?: string | null;
};

export type AdminOttoEntryRecovery = { draft: string; requestId: string | null };

export type AdminOttoEntryTransport = {
  send?: (input: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>;
  load?: (conversationId: string, signal?: AbortSignal) => Promise<AdminOttoThreadView>;
};

export type AdminOttoEntryController = {
  snapshot: () => AdminOttoEntrySnapshot;
  recovery: () => AdminOttoEntryRecovery;
  subscribe: (listener: () => void) => () => void;
  open: (conversationId: string) => Promise<void>;
  setDraft: (draft: string) => void;
  submit: () => Promise<void>;
  cancel: () => void;
  reset: (scope: OttoScope, conversationId?: string | null) => void;
  dispose: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Admin Otto could not answer that request.";
}

/**
 * The admin entry's real draft/attempt state.
 *
 * The draft stays with the person until a send succeeds. A failed or cancelled
 * attempt removes its optimistic turn. Every request carries the scope it was
 * started for; a late answer after cancel, reset, or an account change can
 * never render, replace the conversation, or be mistaken for the new scope.
 */
export function createAdminOttoEntryController(deps: AdminOttoEntryDeps): AdminOttoEntryController {
  let state: AdminOttoEntrySnapshot = {
    scope: { ...deps.scope },
    conversationId: deps.initialConversationId ?? null,
    turns: [],
    draft: deps.initialDraft ?? "",
    busy: false,
    hydration: deps.initialConversationId && deps.load ? "loading" : "idle",
    error: null,
  };
  let sequence = 0;
  let attempt: AbortController | null = null;
  let pendingDraft = "";
  let pendingTurnId: string | null = null;
  let pendingRequest = deps.initialRequestId && deps.initialDraft
    ? { text: deps.initialDraft.trim(), requestId: deps.initialRequestId } : null;
  const listeners = new Set<() => void>();
  const createRequestId = deps.createRequestId ?? (() => crypto.randomUUID());

  const emit = () => { for (const listener of listeners) listener(); };
  const set = (patch: Partial<AdminOttoEntrySnapshot>) => {
    state = { ...state, ...patch };
    emit();
  };

  const cancelAttempt = () => {
    sequence += 1;
    attempt?.abort();
    attempt = null;
    const loading = state.hydration === "loading";
    if (pendingDraft || loading) {
      set({
        draft: pendingDraft || state.draft,
        busy: false,
        hydration: loading ? "failed" : state.hydration,
        error: loading ? "Conversation loading was cancelled. Retry loading the conversation." : state.error,
        turns: pendingTurnId ? state.turns.filter((turn) => turn.id !== pendingTurnId) : state.turns,
      });
      pendingDraft = "";
      pendingTurnId = null;
    }
  };

  const controller: AdminOttoEntryController = {
    snapshot: () => state,
    recovery: () => ({ draft: pendingDraft || state.draft, requestId: pendingRequest?.requestId ?? null }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async open(conversationId) {
      cancelAttempt();
      if (!deps.load) {
        set({ conversationId, hydration: "idle", error: null });
        return;
      }
      const id = ++sequence;
      const hydration = new AbortController();
      attempt = hydration;
      // Identity is not a result of GET. Keep it even if GET fails, and never
      // let sending supersede an unresolved hydration as a null-thread request.
      set({ conversationId, hydration: "loading", busy: false, error: null,
        turns: state.conversationId === conversationId ? state.turns : [] });
      try {
        const view = await deps.load(conversationId, hydration.signal);
        if (id !== sequence) return;
        if (view.conversationId !== conversationId) throw new Error("The loaded conversation did not match. Retry loading the conversation.");
        const lastAssistant = [...view.turns].reverse().find((turn) => turn.role === "assistant")?.turnId ?? null;
        set({
          conversationId: view.conversationId,
          turns: view.turns.map((turn) => ({
            id: turn.turnId,
            role: turn.role,
            text: turn.text,
            result: turn.role === "assistant" && turn.turnId === lastAssistant ? view.result : null,
          })),
          error: null,
          hydration: "idle",
        });
      } catch (error) {
        if (id === sequence) set({ hydration: "failed", error: messageOf(error) });
      } finally {
        if (id === sequence) attempt = null;
      }
    },

    setDraft(draft) {
      if (pendingRequest && draft.trim() !== pendingRequest.text) pendingRequest = null;
      set({ draft, error: state.hydration === "idle" ? null : state.error });
    },

    async submit() {
      const text = state.draft.trim();
      if (!text || state.busy || state.hydration !== "idle") return;
      const id = ++sequence;
      const requestId = pendingRequest?.text === text ? pendingRequest.requestId : createRequestId();
      pendingRequest = { text, requestId };
      const requestScope = { ...state.scope };
      const userTurn: AdminOttoEntryTurn = { id: `user:${requestId}`, role: "user", text };
      pendingDraft = text;
      pendingTurnId = userTurn.id;
      attempt = new AbortController();
      set({
        draft: "",
        busy: true,
        error: null,
        turns: [...state.turns, userTurn],
      });
      try {
        const result = await deps.send({
          conversationId: state.conversationId,
          requestId,
          text,
        }, attempt.signal);
        if (id !== sequence || state.scope.userId !== requestScope.userId
          || state.scope.organizationId !== requestScope.organizationId
          || state.scope.mode !== requestScope.mode) return;
        pendingDraft = "";
        pendingTurnId = null;
        pendingRequest = null;
        set({
          conversationId: result.conversationId,
          turns: [...state.turns, {
            id: result.turnId,
            role: "assistant",
            text: result.reply || "No readable result was returned.",
            result: result.result,
          }],
          draft: "",
          busy: false,
          error: null,
        });
      } catch (error) {
        if (id !== sequence) return;
        set({
          draft: pendingDraft,
          busy: false,
          error: messageOf(error),
          turns: state.turns.filter((turn) => turn.id !== userTurn.id),
        });
        pendingDraft = "";
        pendingTurnId = null;
      } finally {
        if (id === sequence) attempt = null;
      }
    },

    cancel() {
      cancelAttempt();
      if (state.hydration !== "failed") set({ error: null });
    },

    reset(scope, conversationId = null) {
      sequence += 1;
      attempt?.abort();
      attempt = null;
      pendingDraft = "";
      pendingTurnId = null;
      pendingRequest = null;
      state = {
        scope: { ...scope },
        conversationId,
        turns: [],
        draft: "",
        busy: false,
        hydration: conversationId && deps.load ? "loading" : "idle",
        error: null,
      };
      emit();
    },

    dispose() {
      cancelAttempt();
      listeners.clear();
    },
  };
  return controller;
}
