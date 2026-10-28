"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, Trash2, X } from "lucide-react";
import { fetchJson, requestId, type AnyRow } from "./model";
import { Field, PrimaryButton, SecondaryButton, inputClass, inputStyle } from "./ui";

/**
 * The task detail drawer (design.md §6.5): a stable header, a scrollable body,
 * and footer actions. The underlying list stays in place; Escape, the backdrop,
 * and the close control all dismiss it and focus returns to the trigger the
 * caller restores.
 */
export default function EmployeeTaskDrawer({
  mode,
  task,
  isWorkOsTask,
  onClose,
  onSaved,
  onCreate,
}: {
  mode: "create" | "edit";
  task?: AnyRow | null;
  /** Retained for callers that still pass it; every task is a Work OS task now. */
  isWorkOsTask?: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Create is owned by the list so it can show a pending row until the
   * server confirms (the companion's optimistic-add receipt). */
  onCreate?: (title: string, description: string) => void;
}) {
  const [title, setTitle] = useState(mode === "edit" ? String(task?.title ?? "") : "");
  const [description, setDescription] = useState(mode === "edit" ? String(task?.description ?? "") : "");
  const titleRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  /* Keep the latest onClose in a ref so the mount-only focus/Escape effect
     never re-runs (and never steals focus) when the parent re-renders. */
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, []);

  const save = useMutation({
    mutationFn: () => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(task?.provider_task_id || task?.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ name: title.trim(), description }),
    }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: (deleteMode: "archive" | "delete") => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(task?.provider_task_id || task?.id))}?mode=${deleteMode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
    }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const error = save.error || remove.error;
  // The server attaches the caller's task capabilities. A payload without them
  // predates the seam and keeps the existing controls; a live payload hides
  // every write the server would refuse.
  const capabilities = task?.capabilities && typeof task.capabilities === "object"
    ? task.capabilities as Partial<{ canEdit: boolean; canArchive: boolean; canDelete: boolean }>
    : null;
  const canEdit = !capabilities || capabilities.canEdit === true;
  const canArchive = !capabilities || capabilities.canArchive === true;
  const canDelete = !capabilities || capabilities.canDelete === true;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/35"
        tabIndex={-1}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "Add task" : "Task details"}
        className="absolute right-0 top-0 flex h-full w-full max-w-[540px] flex-col border-l shadow-2xl"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{mode === "create" ? "Add task" : "Task details"}</h2>
            {mode === "edit" ? <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{String(task?.provider ?? "local") === "local" ? "Work OS task" : "Imported task"}{task?.project?.name ? ` · ${task.project.name}` : ""}</p> : null}
          </div>
          <SecondaryButton onClick={onClose} aria-label="Close" className="!p-2">
            <X size={15} />
          </SecondaryButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <p className="mb-4 rounded-xl border px-3.5 py-2.5 text-[12px] leading-5" style={{ borderColor: "color-mix(in srgb, var(--status-error) 45%, var(--border))", color: "var(--text-primary)" }}>
              {(error as Error).message}
            </p>
          ) : null}
          <div className="grid gap-4">
            <Field label="Title">
              <input
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!canEdit}
                className={inputClass}
                style={inputStyle}
                placeholder="What needs to happen?"
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canEdit}
                rows={6}
                className={`${inputClass} resize-y`}
                style={inputStyle}
                placeholder="Context, expected outcome, or definition of done."
              />
            </Field>
            {mode === "edit" ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                {task?.project?.name ? (<><dt className="text-[var(--text-tertiary)]">Project</dt><dd className="text-[var(--text-primary)]">{task.project.name}</dd></>) : null}
                {task?.milestone?.name ? (<><dt className="text-[var(--text-tertiary)]">Milestone</dt><dd className="text-[var(--text-primary)]">{task.milestone.name}</dd></>) : null}
                {task?.due_date ? (<><dt className="text-[var(--text-tertiary)]">Due</dt><dd className="text-[var(--text-primary)]">{task.due_date}</dd></>) : null}
                <dt className="text-[var(--text-tertiary)]">Source</dt>
                <dd className="text-[var(--text-primary)]">{String(task?.provider ?? "local") === "local" ? "Work OS task" : "Imported task"}</dd>
              </dl>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          {mode === "edit" ? (
            <div className="flex flex-wrap gap-2">
              {canArchive ? <SecondaryButton
                disabled={remove.isPending}
                onClick={() => window.confirm("Archive this task? It will be hidden from active work.") && remove.mutate("archive")}
              >
                <Archive size={13} /> Archive
              </SecondaryButton> : null}
              {canDelete ? <SecondaryButton
                disabled={remove.isPending}
                style={{ color: "var(--status-error)" }}
                onClick={() => window.confirm("Permanently delete this task from Work OS? This cannot be undone.") && remove.mutate("delete")}
              >
                <Trash2 size={13} /> Delete
              </SecondaryButton> : null}
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <SecondaryButton onClick={onClose}>{canEdit || mode === "create" ? "Cancel" : "Close"}</SecondaryButton>
            {mode === "create" ? (
              <PrimaryButton
                disabled={!title.trim()}
                onClick={() => {
                  onCreate?.(title.trim(), description.trim());
                  onClose();
                }}
              >
                Add task
              </PrimaryButton>
            ) : canEdit ? (
              <PrimaryButton disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save changes"}
              </PrimaryButton>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  );
}
