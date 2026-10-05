import { useState } from "react";
import { Check, Pencil, RotateCw, SkipForward, Sparkles } from "lucide-react";
import type { RecapNextStepItem } from "./types";

export type RecapNextStepState = "pending" | "processing" | "applied" | "skipped" | "failed";

/** The chat moment's live state: the generation status, the suggestions, and
 * each item's decision state. Kept on the chat entry so the conversation keeps
 * the moment in place; it is not persisted (a reload degrades to its lead). */
export interface RecapNextStepsMoment {
  intervalId: string;
  label: string | null;
  status: "drafting" | "ready" | "empty" | "failed" | "done";
  items: RecapNextStepItem[];
  states: Record<string, RecapNextStepState>;
  failures: Record<string, string>;
  error?: string | null;
}

const KIND_LABEL: Record<RecapNextStepItem["operation"], string> = {
  complete_task: "Mark done",
  create_task: "New task",
  add_subtask: "Subtask",
};

const ACCEPT_LABEL: Record<RecapNextStepItem["operation"], string> = {
  complete_task: "Mark done",
  create_task: "Add task",
  add_subtask: "Add subtask",
};

const APPLIED_LABEL: Record<RecapNextStepItem["operation"], string> = {
  complete_task: "Done",
  create_task: "Added",
  add_subtask: "Added",
};

/** The next-step suggestions from an approved recap, rendered in the mascot
 * chat right after the recap is confirmed. Each item is decided inline through
 * the same proposal endpoint as any other review card; new task/subtask titles
 * can be edited before they are added. */
export function RecapNextStepsCard({
  moment,
  busy = false,
  onDecide,
  onRetry,
}: {
  moment: RecapNextStepsMoment;
  busy?: boolean;
  onDecide: (item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }) => void;
  onRetry?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});

  const titleFor = (item: RecapNextStepItem) => edited[item.proposalId] ?? item.title;
  const stateFor = (item: RecapNextStepItem) => moment.states[item.proposalId] ?? "pending";
  const shown = moment.status === "ready" || moment.status === "done";
  const applied = moment.items.filter((item) => stateFor(item) === "applied").length;
  const skipped = moment.items.filter((item) => stateFor(item) === "skipped").length;
  const failed = moment.items.filter((item) => stateFor(item) === "failed").length;
  const summary = [
    applied ? `${applied} ${applied === 1 ? "change" : "changes"} applied` : null,
    skipped ? `${skipped} skipped` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section
      className="chat-next-steps"
      aria-label="Suggested next steps"
      data-workos-tool-surface="recap-next-steps"
      data-workos-tool-state={moment.status}
    >
      <header className="chat-next-steps-head">
        <Sparkles size={13} aria-hidden="true" />
        <div>
          <strong>Next steps</strong>
          <small>{moment.label ? `From your ${moment.label} recap` : "From your approved recap"}</small>
        </div>
      </header>

      {moment.status === "drafting" ? (
        <p className="chat-next-steps-note" role="status">Drafting next steps from your recap…</p>
      ) : null}
      {moment.status === "empty" ? (
        <p className="chat-next-steps-note" role="status">Nothing new to action from this recap.</p>
      ) : null}
      {moment.status === "failed" ? (
        <div className="chat-next-steps-failed" role="status">
          <p>{moment.error ?? "Next steps could not be drafted from this recap."}</p>
          {onRetry ? <button type="button" onClick={onRetry}><RotateCw size={12} aria-hidden="true" /> Retry</button> : null}
        </div>
      ) : null}

      {shown ? (
        <ul className="chat-next-steps-list">
          {moment.items.map((item) => {
            const state = stateFor(item);
            const editing = editingId === item.proposalId;
            const editedTitle = edited[item.proposalId];
            return (
              <li key={item.proposalId} data-state={state}>
                <div className="chat-next-steps-row">
                  <span className="chat-next-steps-kind">{KIND_LABEL[item.operation]}</span>
                  <div className="chat-next-steps-copy">
                    {editing ? (
                      <input
                        value={draft}
                        maxLength={240}
                        aria-label="Suggestion title"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && draft.trim()) {
                            setEdited((current) => ({ ...current, [item.proposalId]: draft.trim() }));
                            setEditingId(null);
                          }
                          if (event.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <strong>{titleFor(item)}</strong>
                    )}
                    <small>{item.rationale}</small>
                  </div>
                </div>
                {state === "pending" || state === "processing" ? (
                  <div className="chat-next-steps-actions">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="primary"
                          disabled={!draft.trim() || busy}
                          onClick={() => {
                            setEdited((current) => ({ ...current, [item.proposalId]: draft.trim() }));
                            setEditingId(null);
                          }}
                        >
                          <Check size={12} aria-hidden="true" /> Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || state === "processing"}
                          onClick={() => onDecide(item, "accept", editedTitle && editedTitle !== item.title ? { name: editedTitle } : undefined)}
                        >
                          {state === "processing" ? "Saving…" : ACCEPT_LABEL[item.operation]}
                        </button>
                        {item.editable ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { setEditingId(item.proposalId); setDraft(titleFor(item)); }}
                          >
                            <Pencil size={12} aria-hidden="true" /> Edit
                          </button>
                        ) : null}
                        <button type="button" disabled={busy || state === "processing"} onClick={() => onDecide(item, "skip")}>
                          <SkipForward size={12} aria-hidden="true" /> Skip
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="chat-next-steps-state">
                    <span>{state === "applied" ? `${APPLIED_LABEL[item.operation]} ✓` : state === "skipped" ? "Skipped" : "Failed"}</span>
                    {state === "failed" ? (
                      <>
                        <small>{moment.failures[item.proposalId] ?? "The change could not be applied."}</small>
                        <button type="button" disabled={busy} onClick={() => onDecide(item, "accept", editedTitle && editedTitle !== item.title ? { name: editedTitle } : undefined)}>
                          <RotateCw size={12} aria-hidden="true" /> Retry
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {moment.status === "done" && summary ? <p className="chat-next-steps-result" role="status">{summary}</p> : null}
    </section>
  );
}
