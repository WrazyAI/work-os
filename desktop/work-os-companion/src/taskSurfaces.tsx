import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FadeArc, Skeleton, TaskDetailSkeleton } from "./LoadingUi";
import { createPortal } from "react-dom";
import { Archive, Check, ChevronRight, ListChecks, MoreHorizontal, MoveRight, Pencil, Plus, RotateCcw, Trash2, UserRound, X } from "lucide-react";
import { computeMenuPlacement } from "./menuPlacement";
import { BOTTLENECK_QUESTION, composeEodMarkdown, hasBottleneckAnswer } from "./interpretation";
import { ChatMarkdown } from "./ChatMarkdown";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText, taskKind, type TaskRow } from "./taskWorkspace";
import { Otto } from "./Otto";
import { SelectionAnnotator, type SelectionRect } from "./SelectionAnnotator";
import { isAnnotationCommentValid, sanitizeComment } from "./planningAnnotations";

const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());

export function useAnchoredMenu(open: boolean) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    let frames = 0;
    let observer: ResizeObserver | undefined;
    const compute = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu || !menu.isConnected) return;
      const box = trigger.getBoundingClientRect();
      const placement = computeMenuPlacement({
        trigger: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        menu: { width: menu.offsetWidth, height: menu.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      setStyle({
        position: "fixed",
        top: placement.top,
        left: placement.left,
        transformOrigin: placement.placement === "up" ? "bottom right" : "top right",
      });
    };
    // Recompute across the first several frames and on any size change: web
    // fonts, image loads, and entry animations all shift the measured boxes
    // after the first paint, and a stale placement strands the menu.
    const tick = () => { compute(); frames += 1; if (frames < 10) frame = window.requestAnimationFrame(tick); };
    let frame = window.requestAnimationFrame(tick);
    const settle = () => { frames = 0; frame = window.requestAnimationFrame(tick); };
    if (typeof ResizeObserver === "function" && menuRef.current) {
      observer = new ResizeObserver(settle);
      observer.observe(menuRef.current);
    }
    document.fonts?.ready.then(settle).catch(() => undefined);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);
  return { triggerRef, menuRef, style };
}

/**
 * Anchored ellipsis menu rendered through a portal at fixed viewport
 * coordinates. Placement is measured from the real trigger/menu boxes, so
 * menus flip above near the bottom edge and clamp horizontally instead of
 * relying on any "last row opens upward" assumption or ancestor stacking.
 */
export function EllipsisMenu({ open, label, onToggle, onClose, children, disabled }: {
  open: boolean; label: string; onToggle: () => void; onClose: () => void; children: ReactNode; disabled?: boolean;
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(open);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (moveMenuFocus(event)) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target))) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);
  return <>
    <button
      className="ellipsis-button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      ref={(node) => { triggerRef.current = node; }}
      onClick={onToggle}
    ><MoreHorizontal size={17} /></button>
    {open && createPortal(
      <div className="subtask-menu anchored-menu" role="menu" style={style} ref={menuRef}>{children}</div>,
      document.body,
    )}
  </>;
}

export function moveMenuFocus(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const active = document.activeElement as HTMLElement | null;
  const menu = active?.closest<HTMLElement>('[role="menu"]');
  if (!menu) return false;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (!items.length) return false;
  event.preventDefault();
  const current = Math.max(0, items.indexOf(active!));
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
  items[next]?.focus();
  return true;
}

type AnyTask = Record<string, any>;

/** Truthful source label: planner-created tasks live in Work OS itself; all
 * other rows are Nifty mirrors until the local-first migration completes. */
export function taskSourceLabel(task: AnyTask): string {
  return String(task?.provider ?? "") === "local" ? "Work OS" : "Nifty";
}

export function TaskComposerModal({ busy, title, description, assignees, options, optionsLoading, onTitle, onDescription, onToggleAssignee, onClose, onSubmit }: {
  busy: boolean; title: string; description: string; assignees: string[];
  options: Array<{ id: string; displayName: string; email: string | null }>; optionsLoading: boolean;
  onTitle: (value: string) => void; onDescription: (value: string) => void; onToggleAssignee: (id: string) => void;
  onClose: () => void; onSubmit: () => void;
}) {
  return <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
      <header><div><span>New task</span><h2 id="task-modal-title">What needs to get done?</h2></div><button aria-label="Close task composer" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="task-modal-body">
        <label><span>Task title</span><input autoFocus maxLength={240} value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Give the task a clear outcome" /></label>
        <label><span>Description <em>optional</em></span><textarea maxLength={20000} value={description} onChange={(event) => onDescription(event.target.value)} placeholder="Add context, expectations, links, or a definition of done…" /></label>
        <fieldset><legend><UserRound size={14} /> Assignees <em>optional</em></legend>
          {optionsLoading ? <div className="assignee-skeleton">{[0, 1, 2].map((index) => <Skeleton key={index} className="skeleton-assignee" />)}</div> : options.length ? <div className="assignee-grid">{options.map((person) => {
            const selected = assignees.includes(person.id);
            return <label className={selected ? "selected" : ""} key={person.id}><input type="checkbox" checked={selected} onChange={() => onToggleAssignee(person.id)} /><span><strong>{person.displayName}</strong><small>{person.email || "Nifty member"}</small></span><Check size={14} /></label>;
          })}</div> : <p>No assignable Nifty-mapped members were found. You can still create this task unassigned.</p>}
        </fieldset>
      </div>
      <footer><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !title.trim()} onClick={onSubmit}>{busy ? <><FadeArc size={14} /> Creating…</> : "Create task"}</button></footer>
    </section>
  </div>;
}

function SubtaskActions({ subtask, busy, menuOpen, moveOpen, onMenuToggle, onMoveToggle, onToggle, onEdit, onMove, onArchive, onDelete, moveTargets }: {
  subtask: AnyTask; busy: boolean; menuOpen: boolean; moveOpen: boolean;
  onMenuToggle: () => void; onMoveToggle: () => void; onToggle: () => void; onEdit: () => void;
  onMove: (target: AnyTask) => void; onArchive: () => void; onDelete: () => void; moveTargets: AnyTask[];
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(menuOpen);
  const move = useAnchoredMenu(moveOpen);
  return <div className="subtask-actions">
    <button
      className="ellipsis-button"
      aria-label={`Actions for ${safeTaskText(subtask.title, "subtask")}`}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      disabled={busy}
      ref={(node) => { triggerRef.current = node; }}
      onClick={onMenuToggle}
    ><MoreHorizontal size={17} /></button>
    {menuOpen && createPortal(<div className="subtask-menu anchored-menu" role="menu" style={style} ref={menuRef}>
      <button role="menuitem" onClick={onToggle}>{subtask.completed ? <RotateCcw size={14} /> : <Check size={14} />} {subtask.completed ? "Reopen subtask" : "Mark subtask done"}</button>
      <button role="menuitem" onClick={onEdit}><Pencil size={14} /> Edit</button>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={moveOpen} ref={(node) => { move.triggerRef.current = node; }} onClick={onMoveToggle}><MoveRight size={14} /> Move to <ChevronRight size={13} /></button>
      <button role="menuitem" onClick={onArchive}><Archive size={14} /> Archive <small>reversible</small></button>
      <button className="danger" role="menuitem" onClick={onDelete}><Trash2 size={14} /> Delete permanently</button>
    </div>, document.body)}
    {moveOpen && createPortal(<div className="move-target-menu anchored-menu" role="menu" aria-label="Move subtask to" style={move.style} ref={move.menuRef}>
      <span>Move to task</span>
      {(moveTargets || []).length ? moveTargets.map((target) => <button role="menuitem" key={target.id} onClick={() => onMove(target)}>{safeTaskText(target.title, "Untitled task")}</button>) : <p>No other open tasks available.</p>}
    </div>, document.body)}
  </div>;
}

export function TaskDetailsModal({ details, loading, readOnly, currentDate, busy, subtaskTitle, subtaskDescription, subtaskMenuId, moveMenuId, onSubtaskTitle, onSubtaskDescription, onSubtaskMenu, onMoveMenu, onSubtaskCreate, onEditTask, onMoveSubtask, onToggleSubtask, onArchiveSubtask, onDeleteSubtask, onClose }: {
  details: { task: AnyTask; subtasks: AnyTask[]; moveTargets: AnyTask[]; subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null } };
  loading: boolean; readOnly: boolean; currentDate: string; busy: boolean;
  subtaskTitle: string; subtaskDescription: string; subtaskMenuId: string | null; moveMenuId: string | null;
  onSubtaskTitle: (value: string) => void; onSubtaskDescription: (value: string) => void;
  onSubtaskMenu: (id: string | null) => void; onMoveMenu: (id: string | null) => void;
  onSubtaskCreate: () => void; onEditTask: (task: AnyTask) => void; onMoveSubtask: (subtask: AnyTask, target: AnyTask) => void;
  onToggleSubtask: (subtask: AnyTask) => void; onArchiveSubtask: (subtask: AnyTask) => void; onDeleteSubtask: (subtask: AnyTask) => void; onClose: () => void;
}) {
  const task = details.task;
  const state = task.completed ? "complete" as const : typeof task.due_date === "string" && task.due_date.slice(0, 10) < currentDate ? "overdue" as const : "open" as const;
  const subtasks = Array.isArray(details.subtasks) ? details.subtasks : [];
  const moveTargets = Array.isArray(details.moveTargets) ? details.moveTargets : [];
  const sync = details.subtaskSync;
  return <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className="task-modal task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
      <header><div><span>{task.completed ? "Completed task" : "Active task"}</span><h2 id="task-detail-title">{safeTaskText(task.title, `Untitled ${taskSourceLabel(task)} task`)}</h2></div><button aria-label="Close task details" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="task-modal-body">
        {loading ? <TaskDetailSkeleton /> : <>
          {readOnly && <div className="task-readonly-banner" role="note"><strong>Historical view</strong><span>Read-only record. Make changes from the current day in Tasks.</span></div>}
          <section className="task-description"><span>Description</span><p>{safeTaskText(task.description, "No description has been added.")}</p><AssigneeTags task={task} /><div><small>{safeTaskText(task.project?.name, taskSourceLabel(task))}</small>{task.due_date && <small>Due {formatWorkOsDate(task.due_date)}</small>}{typeof task.start_date === "string" && task.start_date && task.start_date !== task.due_date && <small>Scheduled {formatWorkOsDate(task.start_date)}</small>}{task.completed_at && <small>Completed {formatWorkOsDate(String(task.completed_at).slice(0, 10))}</small>}{typeof task.provider_created_at === "string" && task.provider_created_at && <small>Logged {formatWorkOsDate(task.provider_created_at.slice(0, 10))}</small>}<span className={`task-state ${state}`}>{sentence(state)}</span><SyncChip task={task} /></div></section>
          <section className="subtask-section"><header><div><span>Subtasks</span><strong>{subtasks.length}</strong></div>{subtasks.length > 0 && <CompletionRingInline completed={subtasks.filter((subtask) => subtask.completed === true).length} total={subtasks.length} />}</header>
            {sync?.error && String(task.provider ?? "") !== "local" && <p className="subtask-sync-warning" role="status">Couldn’t refresh subtasks from Nifty. Showing the last mirrored records.</p>}
            <div className="subtask-list">{subtasks.length ? subtasks.map((subtask) => {
              const subtaskId = String(subtask.provider_task_id || subtask.id);
              const subtaskState = subtask.completed ? "complete" as const : typeof subtask.due_date === "string" && subtask.due_date.slice(0, 10) < currentDate ? "overdue" as const : "open" as const;
              return <article key={subtask.id} className={subtask.completed ? "completed" : ""}><div><strong>{safeTaskText(subtask.title, "Untitled subtask")}</strong><p>{safeTaskText(subtask.description, "No description")}</p><AssigneeTags task={subtask} /></div><span className={`task-state ${subtaskState}`}>{sentence(subtaskState)}</span>{!readOnly && <SubtaskActions
                subtask={subtask} busy={busy}
                menuOpen={subtaskMenuId === subtaskId} moveOpen={moveMenuId === subtaskId}
                onMenuToggle={() => { onSubtaskMenu(subtaskMenuId === subtaskId ? null : subtaskId); onMoveMenu(null); }}
                onMoveToggle={() => onMoveMenu(moveMenuId === subtaskId ? null : subtaskId)}
                onToggle={() => { onSubtaskMenu(null); onToggleSubtask(subtask); }}
                onEdit={() => onEditTask(subtask)}
                onMove={(target) => onMoveSubtask(subtask, target)}
                onArchive={() => onArchiveSubtask(subtask)}
                onDelete={() => onDeleteSubtask(subtask)}
                moveTargets={moveTargets}
              />}</article>;
            }) : <p className="empty-subtasks">No subtasks yet.</p>}</div>
            {!readOnly && <div className="inline-subtask"><span>Add a subtask</span><input value={subtaskTitle} maxLength={240} onChange={(event) => onSubtaskTitle(event.target.value)} placeholder="What is the next concrete step?" /><textarea value={subtaskDescription} maxLength={20000} onChange={(event) => onSubtaskDescription(event.target.value)} placeholder="Description (optional)" /><button className="primary" disabled={busy || !subtaskTitle.trim()} onClick={onSubtaskCreate}><Plus size={14} /> Add subtask</button></div>}
          </section>
        </>}
      </div>
      <footer className="task-detail-footer"><small>{safeTaskText(task.project?.name, taskSourceLabel(task))} · {taskSourceLabel(task)} is the task record</small><button onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

export function TaskRemovalConfirmation({ mode, scope, title, subtaskCount, busy, localTask = false, onCancel, onConfirm }: {
  mode: "archive" | "delete"; scope: "task" | "subtask"; title: string; subtaskCount: number; busy: boolean; localTask?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const permanent = mode === "delete";
  const source = localTask ? "Work OS" : "Nifty";
  return <div className="task-modal-backdrop confirmation-backdrop"><section className={`delete-confirmation ${permanent ? "" : "reversible"}`} role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description">
    <span className={permanent ? "danger-icon" : "reversible-icon"}>{permanent ? <Trash2 size={18} /> : <Archive size={18} />}</span>
    <h2 id="delete-confirmation-title">{permanent ? "Permanently delete" : "Archive"} this {scope}?</h2>
    <p id="delete-confirmation-description">{permanent ? <>“{title}” will be permanently removed from {source} and cannot be restored.</> : <>“{title}” will be hidden from active work but retained in {localTask ? "Work OS history" : `Nifty. It can be restored from Nifty’s archived tasks`}.</>}{scope === "task" && subtaskCount > 0 ? ` Its ${subtaskCount} remaining subtask${subtaskCount === 1 ? "" : "s"} will also be ${permanent ? "permanently deleted" : "archived"}.` : ""}</p>
    <div><button disabled={busy} onClick={onCancel}>Cancel</button><button className={permanent ? "confirm-delete" : "confirm-archive"} disabled={busy} onClick={onConfirm}>{busy ? (permanent ? "Deleting…" : "Archiving…") : permanent ? "Delete permanently" : "Archive task"}</button></div>
  </section></div>;
}

export function TaskEditModal({ kind, title, description, busy, localTask = false, onTitle, onDescription, onClose, onSubmit }: {
  kind: "task" | "subtask"; title: string; description: string; busy: boolean; localTask?: boolean;
  onTitle: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  return <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
    <header><div><span>Edit {kind}</span><h2 id="edit-task-title">Update the {localTask ? "Work OS" : "Nifty"} record</h2></div><button aria-label="Close editor" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="task-modal-body">
      <label><span>Title</span><input autoFocus maxLength={240} value={title} onChange={(event) => onTitle(event.target.value)} /></label>
      <label><span>Description</span><textarea maxLength={20000} value={description} onChange={(event) => onDescription(event.target.value)} /></label>
    </div>
    <footer><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !title.trim()} onClick={onSubmit}>Save changes</button></footer>
  </section></div>;
}

export function TaskCarryOverFlyout({ groups, busy, onClose, onSurfaceTask, onTaskCompletion, onOpenDay }: {
  groups: Array<{ date: string; label: string; items: Array<{ task: TaskRow; attribution: { date: string | null; reason: string } }> }>;
  busy: boolean; onClose: () => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void;
  onTaskCompletion: (task: TaskRow, completed: boolean) => void; onOpenDay: (date: string) => void;
}) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return <div className="carry-flyout-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="carry-flyout" aria-label="Unfinished work" role="dialog" aria-modal="true">
      <header><div><span>From previous days</span><h2>Review unfinished work.</h2><small>{total} unfinished task{total === 1 ? "" : "s"} across {groups.length} workday{groups.length === 1 ? "" : "s"}. Decide what moves forward.</small></div><button aria-label="Close unfinished work" onClick={onClose}><X size={18} /></button></header>
      <div>{groups.length ? groups.map((group) => <section key={group.date}><h3>{group.label}</h3>{group.items.map(({ task, attribution }) => <article key={task.id}>
        <div className="carry-row-copy"><strong>{safeTaskText(task.title, `Untitled ${taskSourceLabel(task)} task`)}</strong><small>{attribution.reason === "due" ? "Due on that day" : attribution.reason === "created" ? "Created on that day" : "Previously surfaced"}</small></div>
        <div className="carry-row-actions"><button disabled={busy} onClick={() => onSurfaceTask(task)}><Plus size={13} /> Add to today</button><button disabled={busy} onClick={() => onTaskCompletion(task, true)}><Check size={13} /> Complete</button><button disabled={busy} onClick={() => onSurfaceTask(task, "deferred")}>Defer</button><button onClick={() => onOpenDay(attribution.date!)}>Open day</button></div>
      </article>)}</section>) : <div className="carry-empty"><Check size={20} /><strong>Nothing left behind</strong><span>Earlier work is complete or carried forward.</span></div>}</div>
      <footer><small>Nothing changes in Nifty until you act.</small><button onClick={onClose}>Close</button></footer>
    </aside>
  </div>;
}

export function AssigneeTags({ task }: { task: AnyTask }) {
  const assignees = Array.isArray(task.assignees) ? task.assignees.filter((item) => item && typeof item.displayName === "string") : [];
  if (!assignees.length) return null;
  const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return <div className="task-assignee-tags" aria-label={`Assigned to ${assignees.map((person) => person.displayName).join(", ")}`}>
    {assignees.slice(0, 3).map((person) => <span key={person.personId || person.displayName} title={person.email || person.displayName}><i>{initials(person.displayName)}</i>{person.displayName}</span>)}
    {assignees.length > 3 && <span title={assignees.slice(3).map((person) => person.displayName).join(", ")}>+{assignees.length - 3}</span>}
  </div>;
}

export function SyncChip({ task }: { task: AnyTask }) {
  if (String(task.provider ?? "") === "local") return <span className="sync-chip synced">Work OS task</span>;
  if (task.sync_error) return <span className="sync-chip degraded">Nifty details unavailable</span>;
  if (task.synced_at) return <span className="sync-chip synced">Nifty synced</span>;
  return <span className="sync-chip awaiting">Awaiting Nifty sync</span>;
}

export function CompletionRingInline({ completed, total }: { completed: number; total: number }) {
  return <span className="subtask-count-ring" role="img" aria-label={`${completed} of ${total} subtasks complete`}>{completed}/{total}</span>;
}

export { sentence, taskKind };

export function EodComposer({ reportId, initialMarkdown, source, dayLabel = "today", suggestedBottleneck, allTasksCompleted, redrafting, clockedOut = false, screenshotContext = null, screenshotSyncUnavailable = false, busy, onRedraft, onRefresh, onRefine, onSubmit }: {
  reportId: string; initialMarkdown: string; source: "ai" | "deterministic" | "simulated" | null; dayLabel?: string; suggestedBottleneck: string | null;
  allTasksCompleted: boolean; redrafting: boolean; clockedOut?: boolean; screenshotContext?: { processed: number; excluded: number; failed: number; observations: Array<{ capturedAt: string; summary: string; visibleApp: string | null; confidence: number }> } | null; screenshotSyncUnavailable?: boolean; busy: boolean; onRedraft: () => void; onRefresh?: () => void; onRefine: (markdown: string, feedback: string, annotations: Array<{ quote: string; comment: string }>) => Promise<boolean>; onSubmit: (markdown: string, idempotencyKey: string) => void;
}) {
  const dayReference = dayLabel === "today" ? "today's" : `${dayLabel}'s`;
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [bottleneck, setBottleneck] = useState(suggestedBottleneck ?? "");
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [annotations, setAnnotations] = useState<Array<{ quote: string; comment: string }>>([]);
  const [pending, setPending] = useState<{ quote: string; rect: SelectionRect } | null>(null);
  const [pendingComment, setPendingComment] = useState("");
  const previewRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  // A redraft replaces the buffer (and any in-progress edits) by design.
  useEffect(() => { setMarkdown(initialMarkdown); }, [initialMarkdown]);
  useEffect(() => { if (allTasksCompleted) setBottleneck(""); }, [allTasksCompleted]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  const canSubmit = (allTasksCompleted || hasBottleneckAnswer(bottleneck)) && markdown.trim() && !busy && !redrafting && !refining;
  const refineReady = (Boolean(feedback.trim()) || annotations.length > 0) && !busy && !redrafting && !refining;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(composeEodMarkdown(markdown, bottleneck, !allTasksCompleted), crypto.randomUUID());
  };
  /** Selecting text in the preview raises the floating annotation pill. */
  const captureSelection = () => {
    if (view !== "preview" || redrafting || refining) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const quote = selection.toString().replace(/\s+/g, " ").trim();
    if (quote.length < 3) return;
    const range = selection.getRangeAt(0);
    const holder = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!holder || !previewRef.current?.contains(holder)) return;
    const box = range.getBoundingClientRect();
    setPending({ quote: quote.slice(0, 300), rect: { top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom } });
    setPendingComment("");
  };
  const addAnnotation = () => {
    if (!pending) return;
    const comment = sanitizeComment(pendingComment);
    if (!isAnnotationCommentValid(comment)) return;
    setAnnotations((current) => [...current, { quote: pending.quote, comment }]);
    setPending(null);
    setPendingComment("");
  };
  /** Flashes the quoted text in the preview so a note stays tied to its source. */
  const flashQuote = (quote: string) => {
    const root = previewRef.current;
    if (!root) return;
    const target = quote.slice(0, 60).toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? "").toLowerCase();
      const index = text.indexOf(target);
      if (index >= 0 && node.parentElement && !node.parentElement.closest(".eod-quote-flash")) {
        const span = document.createElement("span");
        span.className = "eod-quote-flash";
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + target.length);
        range.surroundContents(span);
        span.scrollIntoView({ block: "center", behavior: "smooth" });
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => {
          if (span.parentNode) {
            span.replaceWith(...Array.from(span.childNodes));
            root.normalize();
          }
        }, 1600);
        return;
      }
      node = walker.nextNode();
    }
  };
  const refine = async () => {
    if (!refineReady) return;
    setRefining(true);
    try {
      if (await onRefine(markdown, feedback, annotations)) {
        setFeedback("");
        setAnnotations([]);
      }
    } finally {
      setRefining(false);
    }
  };
  return <section className="panel eod-composer" aria-label="End-of-day report">
    <header className="eod-composer-header">
      <div className="eod-title-with-pet"><Otto pose="focus" className="otto-eod" /><div><span>EOD review</span><h2>Record the day, then hand it to your manager.</h2>
      {clockedOut && <small className="eod-clocked-out-note">Your shift was clocked out automatically when this draft was created.</small>}
      <small>{source === "ai" ? `Drafted by the assistant from ${dayReference} record — review every line before submitting.` : source === "simulated" ? "Simulated on-device draft (offline playground) — review every line before submitting." : `Standard draft from ${dayReference} record.`} Report id {reportId.slice(0, 8)}…</small></div></div>
      <div className="eod-composer-actions">{onRefresh && <button disabled={busy || redrafting} onClick={onRefresh}>Refresh from record</button>}<button disabled={busy || redrafting} onClick={onRedraft}>{redrafting ? <><FadeArc size={14} /> Drafting…</> : "Draft with AI"}</button></div>
    </header>
    {source === "ai" && screenshotContext && <details className="eod-screenshot-context"><summary>{screenshotContext.processed} screenshot sample{ screenshotContext.processed === 1 ? "" : "s" } analyzed for this day</summary><div className="eod-screenshot-body"><p>Sampled activity context only. It does not prove task completion, effort, or output quality.</p>{screenshotContext.observations.length > 0 && <ul>{screenshotContext.observations.map((item, index) => <li key={`${item.capturedAt}:${index}`}><time>{item.capturedAt.slice(11, 16) || "—"}</time><span>{item.visibleApp ? `${item.visibleApp} · ` : ""}{item.summary}</span></li>)}</ul>}{(screenshotContext.excluded > 0 || screenshotContext.failed > 0) && <small>{screenshotContext.excluded} excluded by privacy policy · {screenshotContext.failed} unavailable</small>}</div></details>}
    {source === "ai" && screenshotSyncUnavailable && <p className="eod-screenshot-unavailable" role="status">Screenshot context was unavailable for this draft. It uses {dayReference} recorded work only.</p>}
    <section className="eod-report" aria-label="Report draft">
      <div className="eod-report-head">
        <span>Report</span>
        {annotations.length > 0 && <small className="eod-note-count">{annotations.length} note{annotations.length === 1 ? "" : "s"}</small>}
        <div className="eod-view-toggle" role="group" aria-label="Report view">
          <button type="button" aria-pressed={view === "preview"} className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Preview</button>
          <button type="button" aria-pressed={view === "raw"} className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>Raw</button>
        </div>
      </div>
      {view === "preview"
        ? <div className="eod-preview" ref={previewRef} onMouseUp={captureSelection} onKeyUp={captureSelection} aria-label="Report preview" aria-live="polite"><ChatMarkdown text={markdown.trim() ? markdown : "Nothing to preview yet."} /></div>
        : <textarea className="eod-raw" value={markdown} rows={12} onChange={(event) => setMarkdown(event.target.value)} aria-label="End-of-day report draft" spellCheck={false} />}
    </section>
    {annotations.length > 0 && <section className="eod-notes" aria-label="Draft notes">
      <header><span>Draft notes</span><small>Sent with the Refine draft action. Select text in the preview to add another.</small></header>
      <ul>{annotations.map((annotation, index) => <li key={`${annotation.quote.slice(0, 24)}:${index}`}>
        <button type="button" className="eod-note-quote" title="Show this text in the draft" onClick={() => flashQuote(annotation.quote)}>“{annotation.quote.length > 90 ? `${annotation.quote.slice(0, 90)}…` : annotation.quote}”</button>
        <span className="eod-note-comment">{annotation.comment}</span>
        <button type="button" className="eod-note-remove" aria-label="Remove this note" onClick={() => setAnnotations((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button>
      </li>)}</ul>
    </section>}
    <section className="eod-refine" aria-label="Draft feedback">
      <span>Refine this draft</span>
      <small>Select text in the preview to add a note, or describe the change. Your bottleneck answer stays separate.</small>
      <textarea value={feedback} rows={2} maxLength={2000} placeholder="For example: make the summary shorter and mention the client handoff." onChange={(event) => setFeedback(event.target.value)} aria-label="Feedback for refining this draft" />
      <div className="eod-refine-actions"><button disabled={!refineReady} onClick={() => void refine()}>{refining ? <><FadeArc size={14} /> Refining…</> : "Refine draft"}</button></div>
    </section>
    <label className="eod-bottleneck-label"><span>{allTasksCompleted ? "Bottleneck not needed" : "Bottleneck — required"}</span>
      <textarea value={bottleneck} rows={2} maxLength={2000} disabled={allTasksCompleted} placeholder={allTasksCompleted ? `Every task in ${dayReference} list is complete.` : BOTTLENECK_QUESTION} onChange={(event) => setBottleneck(event.target.value)} aria-label={allTasksCompleted ? "No bottleneck is needed because every task is complete" : BOTTLENECK_QUESTION} />
      <small>{allTasksCompleted ? `Every task in ${dayReference} list is complete, so no reason is needed or sent with this report.` : "What prevented you from completing your task list? This goes to your manager with the report."}</small>
    </label>
    <footer><small>Nothing is filed until you submit.</small><button className="primary" disabled={!canSubmit} onClick={submit}>{busy ? "Submitting…" : "Submit EOD"}</button></footer>
    {pending && <SelectionAnnotator quote={pending.quote} anchor={pending.rect} value={pendingComment} canSave={isAnnotationCommentValid(pendingComment)} disabled={busy || redrafting || refining} onChange={setPendingComment} onSave={addAnnotation} onCancel={() => { setPending(null); setPendingComment(""); }} />}
  </section>;
}
