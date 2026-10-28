import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { AdminRead, ChatRequest, ChatResult, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { fetchAdminOttoThread, sendAdminOttoChat, type AdminOttoThreadView } from "./api";
import { createAdminOttoEntryController, type AdminOttoEntryRecovery } from "./chatEntry";

export type AdminOttoEntryTransport = {
  send?: (input: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>;
  load?: (conversationId: string, signal?: AbortSignal) => Promise<AdminOttoThreadView>;
};

/** A deliberately thin entry for Task 8's controller wiring. Task 9 owns the
 * shared read-only chat surface; this sheet proves New chat opens a real scoped
 * thread, preserves a failed draft, and never offers an employee action. */
export function AdminOttoChatEntry({ scope, initialConversationId = null, initialDraft = "", initialRequestId = null, onConversation, onDraftChange, onRecoveryChange, onClose, transport }: {
  scope: OttoScope;
  initialConversationId?: string | null;
  initialDraft?: string;
  initialRequestId?: string | null;
  onConversation?: (conversationId: string | null) => void;
  onDraftChange?: (draft: string) => void;
  onRecoveryChange?: (recovery: AdminOttoEntryRecovery) => void;
  onClose: () => void;
  transport?: AdminOttoEntryTransport;
}) {
  const [controller] = useState(() => createAdminOttoEntryController({
    scope,
    send: transport?.send ?? sendAdminOttoChat,
    load: transport?.load ?? fetchAdminOttoThread,
    initialDraft,
    initialRequestId,
    initialConversationId,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const restoreFocus = useRef<Element | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const conversationRef = useRef<string | null>(initialConversationId);

  useEffect(() => {
    restoreFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    field.current?.focus();
    return () => {
      controller.dispose();
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus();
    };
  }, [controller]);

  useEffect(() => {
    conversationRef.current = initialConversationId;
    if (initialConversationId && (initialConversationId !== controller.snapshot().conversationId
      || controller.snapshot().hydration !== "idle")) void controller.open(initialConversationId);
  }, [controller, initialConversationId]);

  useEffect(() => {
    const recovery = controller.recovery();
    onDraftChange?.(recovery.draft);
    onRecoveryChange?.(recovery);
  }, [state, controller, onDraftChange, onRecoveryChange]);

  useEffect(() => {
    if (state.conversationId && state.conversationId !== conversationRef.current) {
      conversationRef.current = state.conversationId;
      onConversation?.(state.conversationId);
    }
  }, [state.conversationId, onConversation]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.cancel();
        onClose();
      }
      if (event.key === "Tab" && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]',
        )];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, onClose]);

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-otto-entry-title"
        className="task-modal"
        style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100vh - 64px)" }}
      >
        <header>
          <div>
            <span>Work OS · Administration</span>
            <h2 id="admin-otto-entry-title">Ask Otto about the team</h2>
          </div>
          <button type="button" aria-label="Close admin Otto" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="task-modal-body" style={{ overflowY: "auto", display: "grid", gap: 12 }}>
          <p style={{ margin: 0, color: "var(--color-muted)" }}>
            Read-only. Otto can look up tasks, records, workdays, and reviewed recaps for the people you administer; it cannot change employee data.
          </p>
          {state.hydration === "loading" ? <p role="status">Loading conversation…</p> : null}
          {state.turns.length === 0 && state.hydration === "idle" ? <p style={{ margin: 0 }}>Ask about unfinished work, a person’s day, or a reviewed recap.</p> : null}
          {state.turns.map((turn) => (
            <article key={turn.id} aria-label={turn.role === "user" ? "You" : "Admin Otto"} style={{ display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 11, color: "var(--color-muted)" }}>{turn.role === "user" ? "You" : "Admin Otto"}</strong>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{turn.text}</p>
              {turn.result ? <small style={{ color: "var(--color-muted)" }}>{resultSummary(turn.result)}</small> : null}
            </article>
          ))}
          {state.error ? <p role="alert" style={{ margin: 0, color: "var(--color-danger)" }}>{state.error}</p> : null}
          {state.hydration === "failed" && state.conversationId ? (
            <button type="button" onClick={() => {
              if (state.conversationId) void controller.open(state.conversationId);
              field.current?.focus();
            }}>Retry loading conversation</button>
          ) : null}
        </div>
        <footer style={{ display: "grid", gap: 8 }}>
          <label htmlFor="admin-otto-entry-input" style={{ fontSize: 11, color: "var(--color-muted)" }}>Ask about the team</label>
          <textarea
            id="admin-otto-entry-input"
            ref={field}
            value={state.draft}
            disabled={state.busy}
            maxLength={4000}
            onChange={(event) => controller.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void controller.submit();
              }
            }}
            placeholder="What is unfinished for the team today?"
            rows={3}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose}>Close</button>
            <button type="button" className="primary" disabled={state.busy || state.hydration !== "idle" || !state.draft.trim()} onClick={() => void controller.submit()}>
              {state.hydration === "loading" ? "Loading…" : state.busy ? "Reading…" : "Ask Otto"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function resultSummary(result: AdminRead): string {
  switch (result.kind) {
    case "tasks": return `${result.page.total} task${result.page.total === 1 ? "" : "s"} in this result.`;
    case "records": return `${result.page.total} record${result.page.total === 1 ? "" : "s"} in this result.`;
    case "recaps": return `${result.page.total} reviewed recap${result.page.total === 1 ? "" : "s"} in this result.`;
    case "recap": return `Reviewed recap for ${result.recap.person.displayName}.`;
    case "resolution":
      return result.resolution.kind === "ambiguous"
        ? `Which ${result.resolution.name} did you mean?`
        : `No employee named ${result.resolution.name} was found.`;
    default: return "";
  }
}
