"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { taskIsOverdue } from "@/lib/work-os-task-permissions";
import { calendarDateLabel, fetchJson, operationLabel, requestId, type AnyRow } from "./model";
import styles from "./EmployeeTasks.module.css";

export type TaskDraft = {
  name: string;
  description: string;
  assigneePersonIds: string[];
  projectId: string;
  dueDate: string;
  priority: string;
  expectedOutcome: string;
  definitionOfDone: string;
};

type PersonOption = { id: string; displayName: string; email: string | null };
type ProjectOption = { id: string; name: string };
export type TaskOptions = { people: PersonOption[]; projects: ProjectOption[] };

const PRIORITIES = [
  { value: "", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function draftFromTask(task: AnyRow | null | undefined): TaskDraft {
  return {
    name: String(task?.title ?? ""),
    description: String(task?.description ?? ""),
    assigneePersonIds: Array.isArray(task?.assignees)
      ? task.assignees.map((person: AnyRow) => String(person.personId ?? person.id ?? "")).filter(Boolean)
      : Array.isArray(task?.assignee_person_ids)
        ? task.assignee_person_ids.map(String)
        : [],
    projectId: String(task?.project?.id ?? ""),
    dueDate: String(task?.due_date ?? "").slice(0, 10),
    priority: String(task?.priority ?? ""),
    expectedOutcome: String(task?.expected_outcome ?? ""),
    definitionOfDone: String(task?.definition_of_done ?? ""),
  };
}

function addedLabel(task: AnyRow) {
  const value = String(task?.provider_created_at ?? task?.created_at ?? "").slice(0, 10);
  return value ? calendarDateLabel(value) : "Not recorded";
}

function dueValue(task: AnyRow, today?: string) {
  const value = String(task?.due_date ?? "").slice(0, 10);
  if (!value) return "No due date";
  if (today && value === today) return "Today";
  return calendarDateLabel(value);
}

function sourceLabel(task: AnyRow) {
  return String(task?.provider ?? "local") === "local" ? "Work OS task" : "Imported task";
}

function taskState(task: AnyRow, today?: string) {
  if (task.completed) return { label: "Done", className: styles.pillDone };
  if (today && taskIsOverdue(task, today)) return { label: "Overdue", className: styles.pillOverdue };
  return { label: "Open", className: styles.pillOpen };
}

export default function EmployeeTaskDrawer({
  mode,
  task,
  today,
  options,
  optionsLoading = false,
  defaultAssigneeId,
  onClose,
  onSaved,
  onCreate,
}: {
  mode: "create" | "edit";
  task?: AnyRow | null;
  today?: string;
  options?: TaskOptions;
  optionsLoading?: boolean;
  defaultAssigneeId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onCreate?: (draft: TaskDraft) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const [view, setView] = useState<"detail" | "edit">("detail");
  const [focusTask, setFocusTask] = useState<AnyRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<"archive" | "delete" | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [draft, setDraft] = useState<TaskDraft>(() => {
    if (mode === "create") {
      return { name: "", description: "", assigneePersonIds: defaultAssigneeId ? [defaultAssigneeId] : [], projectId: "", dueDate: "", priority: "", expectedOutcome: "", definitionOfDone: "" };
    }
    return draftFromTask(task);
  });

  const currentTask = focusTask ?? task ?? null;
  const currentId = currentTask ? String(currentTask.provider_task_id ?? currentTask.id) : null;

  const detail = useQuery<{ task: AnyRow; subtasks: AnyRow[]; completionEvidence?: AnyRow[] }>({
    queryKey: ["work-os", "task-details", currentId ?? "none"],
    queryFn: () => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(currentId))}`),
    enabled: mode === "edit" && !!currentId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // The detail read is the authority for status and subtask state, while the
  // list row already carries the project/milestone/assignee joins. Merge them
  // so a refetch never strips context the drawer was already showing.
  const detailTask: AnyRow | null = detail.data?.task
    ? { ...(currentTask ?? {}), ...detail.data.task }
    : currentTask;
  const subtasks: AnyRow[] = Array.isArray(detail.data?.subtasks)
    ? detail.data.subtasks
    : Array.isArray(currentTask?.subtasks)
      ? currentTask.subtasks
      : [];
  const completedSubtasks = subtasks.filter((subtask) => subtask.completed === true).length;
  const progressPercent = subtasks.length ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, []);

  useEffect(() => {
    if (mode === "create" || view === "edit") {
      const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [mode, view]);

  const save = useMutation({
    mutationFn: () => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(currentId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({
        name: draft.name.trim(),
        description: draft.description,
        due_date: draft.dueDate || null,
        priority: draft.priority || null,
        ...(canAssign ? { assignee_person_ids: draft.assigneePersonIds } : {}),
        expected_outcome: draft.expectedOutcome || null,
        definition_of_done: draft.definitionOfDone || null,
      }),
    }),
    onSuccess: () => {
      void detail.refetch();
      setView("detail");
      onSaved();
    },
  });

  const toggleComplete = useMutation({
    mutationFn: () => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(currentId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ completed: !detailTask?.completed }),
    }),
    onSuccess: () => {
      void detail.refetch();
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: (removeMode: "archive" | "delete") => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(currentId))}?mode=${removeMode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
    }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const toggleSubtask = useMutation({
    mutationFn: (subtask: AnyRow) => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(subtask.provider_task_id ?? subtask.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ completed: !subtask.completed }),
    }),
    onSuccess: () => {
      void detail.refetch();
      onSaved();
    },
  });

  const addSubtask = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({
        name: subtaskTitle.trim(),
        parent_task_id: currentTask?.id,
      }),
    }),
    onSuccess: () => {
      setSubtaskTitle("");
      void detail.refetch();
      onSaved();
    },
  });

  const error = save.error || remove.error || toggleComplete.error || toggleSubtask.error || addSubtask.error;
  const capabilities = detailTask?.capabilities && typeof detailTask.capabilities === "object" ? detailTask.capabilities as AnyRow : null;
  const canEdit = !capabilities || capabilities.canEdit === true;
  const canArchive = !capabilities || capabilities.canArchive === true;
  const canDelete = !capabilities || capabilities.canDelete === true;
  const canComplete = !capabilities || (detailTask?.completed ? capabilities.canReopen === true : capabilities.canComplete === true);
  const canAssign = !capabilities || capabilities.canAssign === true;

  const people = options?.people ?? [];
  const projects = options?.projects ?? [];
  const title = mode === "create" ? "Add task" : view === "edit" ? "Edit task" : "Task details";
  const state = detailTask ? taskState(detailTask, today) : null;

  function clearErrors() {
    save.reset();
    remove.reset();
    toggleComplete.reset();
    toggleSubtask.reset();
    addSubtask.reset();
  }

  function startEdit(next: AnyRow) {
    // The detail read is merged into a fresh object, so identity comparison
    // would mark the top-level task as a subtask. Compare the record ids.
    clearErrors();
    setFocusTask(String(next.id) === String(task?.id) ? null : next);
    setDraft(draftFromTask(next));
    setView("edit");
  }

  function openSubtask(subtask: AnyRow) {
    clearErrors();
    setFocusTask(subtask);
    setConfirmRemove(null);
  }

  function toggleAssignee(personId: string) {
    setDraft((current) => ({
      ...current,
      assigneePersonIds: current.assigneePersonIds.includes(personId)
        ? current.assigneePersonIds.filter((id) => id !== personId)
        : [...current.assigneePersonIds, personId],
    }));
  }

  const isCreate = mode === "create";
  const editing = isCreate || view === "edit";

  return (
    <>
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className={styles.backdrop}
        tabIndex={-1}
      />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.drawerHeader}>
          <div>
            <span className={styles.drawerEyebrow}>
              {isCreate ? "New task" : detailTask?.completed ? "Completed task" : "Active task"}
            </span>
            <span className={styles.drawerSource}>
              {isCreate ? "TASKS · Work OS record" : `${sourceLabel(detailTask ?? {})}${detailTask?.project?.name ? ` · ${detailTask.project.name}` : ""}`}
            </span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className={styles.close}>
            <X size={16} />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && editing ? <div className={styles.formError}>{(error as Error).message}</div> : null}

          {editing ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                if (isCreate) {
                  if (!draft.name.trim()) return;
                  onCreate?.(draft);
                  onClose();
                  return;
                }
                save.mutate();
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Task title</span>
                <input
                  ref={titleRef}
                  className={styles.input}
                  value={draft.name}
                  maxLength={240}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Give the task a clear outcome"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Description <em>optional</em></span>
                <textarea
                  className={styles.textarea}
                  value={draft.description}
                  maxLength={20000}
                  rows={5}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Context, expectations, links, or a definition of done…"
                />
              </label>

              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Due date <em>optional</em></span>
                  <input
                    type="date"
                    className={styles.input}
                    value={draft.dueDate}
                    onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Priority <em>optional</em></span>
                  <select
                    className={styles.select}
                    value={draft.priority}
                    onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}
                  >
                    {PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
                  </select>
                </label>
              </div>

              {isCreate ? (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Project <em>optional</em></span>
                  <select
                    className={styles.select}
                    value={draft.projectId}
                    onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
                  >
                    <option value="">Default (TASKS)</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
              ) : null}

              <fieldset className={styles.field}>
                <legend className={styles.fieldLabel}><UserRound size={12} aria-hidden /> Assignees <em>optional</em></legend>
                {optionsLoading ? (
                  <div className={styles.peopleGrid}>
                    {[0, 1, 2].map((index) => <div key={index} className={styles.skeletonBlock} style={{ height: 40 }} />)}
                  </div>
                ) : people.length ? (
                  <div className={styles.peopleGrid}>
                    {people.map((person) => {
                      const selected = draft.assigneePersonIds.includes(person.id);
                      return (
                        <label key={person.id} className={`${styles.person} ${selected ? styles.personSelected : ""}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAssignee(person.id)}
                            disabled={!canAssign}
                          />
                          <span className={styles.personCopy}>
                            <strong>{person.displayName}</strong>
                            <small>{person.email || "Organization member"}</small>
                          </span>
                          <span className={styles.personCheck}><Check size={10} strokeWidth={3} /></span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.optionsNote}>No active organization members were found. You can still create this task unassigned.</p>
                )}
              </fieldset>

              <details className={styles.advanced}>
                <summary>Outcome and definition of done</summary>
                <div className={styles.advancedBody}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Expected outcome <em>optional</em></span>
                    <textarea
                      className={styles.textarea}
                      value={draft.expectedOutcome}
                      maxLength={20000}
                      rows={3}
                      onChange={(event) => setDraft((current) => ({ ...current, expectedOutcome: event.target.value }))}
                      placeholder="What should exist when this is finished?"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Definition of done <em>optional</em></span>
                    <textarea
                      className={styles.textarea}
                      value={draft.definitionOfDone}
                      maxLength={20000}
                      rows={3}
                      onChange={(event) => setDraft((current) => ({ ...current, definitionOfDone: event.target.value }))}
                      placeholder="What must be true before it can be marked complete?"
                    />
                  </label>
                </div>
              </details>
            </form>
          ) : detail.isLoading && !detailTask ? (
            <div className={styles.form}>
              <div className={styles.skeleton} style={{ width: "45%" }} />
              <div className={styles.skeleton} style={{ width: "80%", height: 22 }} />
              <div className={styles.skeletonBlock} />
              <div className={styles.skeletonBlock} style={{ height: 120 }} />
            </div>
          ) : detailTask ? (
            <>
              {focusTask ? (
                <button type="button" className={styles.backLink} onClick={() => { clearErrors(); setFocusTask(null); setConfirmRemove(null); }}>
                  <ChevronLeft size={12} /> Back to parent task
                </button>
              ) : null}

              <nav className={styles.breadcrumb} aria-label="Task location">
                <span>{focusTask ? "Subtask" : dueValue(detailTask, today)}</span>
                <ChevronRight aria-hidden />
                <span>{sourceLabel(detailTask)}</span>
                {detailTask.project?.name ? <><ChevronRight aria-hidden /><span>{detailTask.project.name}</span></> : null}
                {detailTask.milestone?.name ? <><ChevronRight aria-hidden /><span>{detailTask.milestone.name}</span></> : null}
              </nav>

              <h2 className={styles.detailTitle} id="task-drawer-title">{String(detailTask.title || "Untitled task")}</h2>
              <p className={`${styles.detailDescription} ${detailTask.description ? "" : styles.descriptionEmpty}`}>
                {detailTask.description || "No description has been added."}
              </p>

              {Array.isArray(detailTask.assignees) && detailTask.assignees.length ? (
                <div className={styles.assigneeRow} aria-label="Assignees">
                  {detailTask.assignees.map((person: AnyRow) => (
                    <span key={person.personId ?? person.displayName} className={styles.assigneeChip}>
                      <UserRound size={11} aria-hidden /> <strong>{person.displayName}</strong>
                    </span>
                  ))}
                </div>
              ) : null}

              <dl className={styles.metaGrid}>
                <div className={styles.metaCell}><dt>Due</dt><dd>{dueValue(detailTask, today)}</dd></div>
                <div className={styles.metaCell}><dt>Added</dt><dd>{addedLabel(detailTask)}</dd></div>
                <div className={styles.metaCell}><dt>Priority</dt><dd>{detailTask.priority ? operationLabel(String(detailTask.priority)) : "No priority"}</dd></div>
                <div className={styles.metaCell}><dt>Status</dt><dd>{state ? <span className={`${styles.pill} ${state.className}`}>{state.label}</span> : "—"}</dd></div>
              </dl>

              {detailTask.expected_outcome || detailTask.definition_of_done ? (
                <section className={styles.section} aria-label="Outcome">
                  <div className={styles.sectionHead}><h3>Outcome</h3></div>
                  {detailTask.expected_outcome ? (
                    <div style={{ marginTop: 10 }}>
                      <span className={styles.fieldLabel}>Expected outcome</span>
                      <p className={styles.detailDescription}>{String(detailTask.expected_outcome)}</p>
                    </div>
                  ) : null}
                  {detailTask.definition_of_done ? (
                    <div style={{ marginTop: 12 }}>
                      <span className={styles.fieldLabel}>Definition of done</span>
                      <p className={styles.detailDescription}>{String(detailTask.definition_of_done)}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className={styles.section} aria-label="Subtasks">
                <div className={styles.sectionHead}>
                  <h3>Next steps</h3>
                  <span className={styles.sectionCount}>{completedSubtasks} / {subtasks.length} · {progressPercent}%</span>
                </div>
                <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label={`${progressPercent}% of subtasks complete`}>
                  <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
                </div>

                {subtasks.length ? (
                  <ul className={styles.subtaskList}>
                    {subtasks.map((subtask) => {
                      const done = subtask.completed === true;
                      const overdue = !done && today ? taskIsOverdue(subtask, today) : false;
                      return (
                        <li key={subtask.id} className={styles.subtaskRow}>
                          <button
                            type="button"
                            aria-label={done ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
                            disabled={toggleSubtask.isPending}
                            onClick={() => toggleSubtask.mutate(subtask)}
                            className={`${styles.subtaskCheck} ${done ? styles.subtaskCheckDone : ""}`}
                          >
                            <Check size={10} strokeWidth={3} />
                          </button>
                          <div className={styles.subtaskCopy}>
                            <button
                              type="button"
                              className={`${styles.subtaskTitle} ${done ? styles.subtaskTitleDone : ""}`}
                              onClick={() => openSubtask(subtask)}
                            >
                              {String(subtask.title || "Untitled subtask")}
                            </button>
                            <span className={styles.subtaskMeta}>
                              {overdue ? <span>Overdue</span> : done ? <span>Done</span> : <span>Open</span>}
                              {subtask.due_date ? <><span>·</span><span>{dueValue(subtask, today)}</span></> : null}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className={styles.note}>No subtasks yet. Add the next concrete step below.</p>
                )}

                {!focusTask ? (
                  <form
                    className={styles.subtaskAdd}
                    onSubmit={(event) => { event.preventDefault(); if (subtaskTitle.trim()) addSubtask.mutate(); }}
                  >
                    <input
                      className={styles.subtaskInput}
                      value={subtaskTitle}
                      maxLength={240}
                      onChange={(event) => setSubtaskTitle(event.target.value)}
                      placeholder="What is the next concrete step?"
                      aria-label="New subtask title"
                    />
                    <button
                      type="submit"
                      className={styles.secondaryButton}
                      style={{ height: 34, paddingInline: 10 }}
                      disabled={!subtaskTitle.trim() || addSubtask.isPending}
                      aria-label="Add subtask"
                    >
                      <Plus size={15} />
                    </button>
                  </form>
                ) : null}
              </section>

              <p className={styles.provenance}>
                {sourceLabel(detailTask)} is the task record. {detailTask.completed_at ? `Completed ${calendarDateLabel(String(detailTask.completed_at).slice(0, 10))}.` : "Changes save directly to the workspace."}
              </p>

              {!focusTask && (canArchive || canDelete) ? (
                <section className={styles.actionsSection} aria-label="Task actions">
                  <div className={styles.sectionHead}><h3>Task actions</h3></div>
                  <div className={styles.actionsRow}>
                    {canArchive ? <button type="button" className={styles.dangerButton} style={{ color: "var(--text-secondary)" }} onClick={() => setConfirmRemove("archive")}><Archive size={13} /> Archive</button> : null}
                    {canDelete ? <button type="button" className={styles.dangerButton} onClick={() => setConfirmRemove("delete")}><Trash2 size={13} /> Delete</button> : null}
                  </div>
                  {confirmRemove ? (
                    <div className={styles.confirmBox}>
                      <p>{confirmRemove === "archive" ? "Archive this task? It will be hidden from active work and can be restored later." : "Delete this task permanently? This cannot be undone."}</p>
                      <div className={styles.confirmActions}>
                        <button type="button" className={styles.dangerButton} style={{ color: "var(--text-secondary)" }} onClick={() => setConfirmRemove(null)}>Cancel</button>
                        <button type="button" className={styles.dangerButton} disabled={remove.isPending} onClick={() => remove.mutate(confirmRemove)}>
                          {remove.isPending ? "Working…" : confirmRemove === "archive" ? "Archive task" : "Delete permanently"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            <p className={styles.note}>This task could not be loaded. Close the panel and try again.</p>
          )}
        </div>

        <footer className={styles.drawerFooter}>
          {editing ? (
            <>
              <span className={styles.footerNote}>{isCreate ? "Visible to your workspace once created." : "Changes save directly to the task record."}</span>
              <div className={styles.footerActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => { if (isCreate) { onClose(); return; } clearErrors(); setView("detail"); }}>Cancel</button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!draft.name.trim() || save.isPending}
                  onClick={() => {
                    if (isCreate) {
                      if (!draft.name.trim()) return;
                      onCreate?.(draft);
                      onClose();
                      return;
                    }
                    save.mutate();
                  }}
                >
                  {isCreate ? "Create task" : save.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </>
          ) : (
            <>
              {error ? (
                <span className={styles.footerNote} style={{ color: "var(--status-error)", maxWidth: "42ch" }}>
                  {(error as Error).message}
                </span>
              ) : (
                <span className={styles.footerNote}>{detailTask ? `${sourceLabel(detailTask)}${detailTask.project?.name ? ` · ${detailTask.project.name}` : ""}` : ""}</span>
              )}
              <div className={styles.footerActions}>
                {canEdit && detailTask ? (
                  <button type="button" className={styles.secondaryButton} onClick={() => startEdit(focusTask ?? detailTask)}>Edit task</button>
                ) : null}
                {canComplete && detailTask ? (
                  <button
                    type="button"
                    className={detailTask.completed ? styles.secondaryButton : styles.primaryButton}
                    disabled={toggleComplete.isPending}
                    onClick={() => toggleComplete.mutate()}
                  >
                    <Check size={13} /> {detailTask.completed ? "Reopen" : "Mark complete"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
