import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FadeArc, Skeleton, TaskDetailSkeleton } from "./LoadingUi";
import { createPortal } from "react-dom";
import { Archive, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, ListChecks, MoreHorizontal, MoveRight, Pencil, Plus, RotateCcw, Target, Trash2, UserRound, Video, X } from "lucide-react";
import { computeMenuPlacement } from "./menuPlacement";
import { BOTTLENECK_QUESTION, composeEodMarkdown, extractBottleneckAnswer, hasBottleneckAnswer, resolvedBottleneck } from "./interpretation";
import { ChatMarkdown } from "./ChatMarkdown";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText, taskKind, type TaskRow } from "./taskWorkspace";
import { ProgressRing } from "./ProgressRing";
import { Otto } from "./Otto";
import { SelectionAnnotator, type SelectionRect } from "./SelectionAnnotator";
import { isAnnotationCommentValid, sanitizeComment } from "./planningAnnotations";
import { EodScreenshotPanel, type PreviewResolver } from "./ScreenshotGallery";
import type { EodScreenshotGallery, EodScreenshotHour } from "./types";

const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
const formatLoomLength = (seconds: number | null | undefined) => {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return "";
  const total = Math.round(seconds as number);
  return ` · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

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

/**
 * App-wide task surfaces have one seam: they render through document.body so
 * fixed positioning cannot be scoped by the scrolling workspace or its chat
 * dock. The server-rendered fallback keeps static markup tests and previews
 * deterministic when no document exists yet.
 */
function renderViewportSurface(node: ReactNode) {
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

function AppWideSidePanel({ children, className = "", closeLabel, onClose, busy = false }: {
  children: ReactNode;
  className?: string;
  closeLabel: string;
  onClose: () => void;
  busy?: boolean;
}) {
  return renderViewportSurface(
    <div className={`work-os-side-panel-layer ${className}`.trim()}>
      <button type="button" className="work-os-side-panel-scrim" aria-label={closeLabel} disabled={busy} onClick={onClose} />
      {children}
    </div>,
  );
}

/** Historical Nifty mirrors remain identifiable; new tasks are Work OS records. */
export function taskSourceLabel(task: AnyTask): string {
  return String(task?.provider ?? "") === "local" ? "Work OS" : "Nifty";
}

export function TaskComposerModal({ busy, closing = false, title, description, assignees, options, optionsLoading, onTitle, onDescription, onToggleAssignee, onClose, onSubmit }: {
  busy: boolean; closing?: boolean; title: string; description: string; assignees: string[];
  options: Array<{ id: string; displayName: string; email: string | null }>; optionsLoading: boolean;
  onTitle: (value: string) => void; onDescription: (value: string) => void; onToggleAssignee: (id: string) => void;
  onClose: () => void; onSubmit: () => void;
}) {
  return <div className={`task-modal-backdrop${closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
      <header><div><span>New task</span><h2 id="task-modal-title">What needs to get done?</h2></div><button aria-label="Close task composer" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="task-modal-body">
        <label><span>Task title</span><input autoFocus maxLength={240} value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Give the task a clear outcome" /></label>
        <label><span>Description <em>optional</em></span><textarea maxLength={20000} value={description} onChange={(event) => onDescription(event.target.value)} placeholder="Add context, expectations, links, or a definition of done…" /></label>
        <fieldset><legend><UserRound size={14} /> Assignees <em>optional</em></legend>
          {optionsLoading ? <div className="assignee-skeleton">{[0, 1, 2].map((index) => <Skeleton key={index} className="skeleton-assignee" />)}</div> : options.length ? <div className="assignee-grid">{options.map((person) => {
            const selected = assignees.includes(person.id);
             return <label className={selected ? "selected" : ""} key={person.id}><input type="checkbox" checked={selected} onChange={() => onToggleAssignee(person.id)} /><span><strong>{person.displayName}</strong><small>{person.email || "Organization member"}</small></span><Check size={14} /></label>;
          })}</div> : <p>No active organization members were found. You can still create this task unassigned.</p>}
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

export function TaskDetailsModal({ details, loading, readOnly, currentDate, busy, subtaskTitle, subtaskDescription, subtaskMenuId, moveMenuId, onSubtaskTitle, onSubtaskDescription, onSubtaskMenu, onMoveMenu, onSubtaskCreate, onEditTask, onCompleteTask, onMoveSubtask, onToggleSubtask, onArchiveSubtask, onDeleteSubtask, onClose }: {
  details: { task: AnyTask; subtasks: AnyTask[]; moveTargets: AnyTask[]; subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null } };
  loading: boolean; readOnly: boolean; currentDate: string; busy: boolean;
  subtaskTitle: string; subtaskDescription: string; subtaskMenuId: string | null; moveMenuId: string | null;
  onSubtaskTitle: (value: string) => void; onSubtaskDescription: (value: string) => void;
  onSubtaskMenu: (id: string | null) => void; onMoveMenu: (id: string | null) => void;
  onSubtaskCreate: () => void; onEditTask: (task: AnyTask) => void; onCompleteTask?: () => void; onMoveSubtask: (subtask: AnyTask, target: AnyTask) => void;
  onToggleSubtask: (subtask: AnyTask) => void; onArchiveSubtask: (subtask: AnyTask) => void; onDeleteSubtask: (subtask: AnyTask) => void; onClose: () => void;
}) {
  const task = details.task;
  const state = task.completed ? "complete" as const : typeof task.due_date === "string" && task.due_date.slice(0, 10) < currentDate ? "overdue" as const : "open" as const;
  const subtasks = Array.isArray(details.subtasks) ? details.subtasks : [];
  const moveTargets = Array.isArray(details.moveTargets) ? details.moveTargets : [];
  const sync = details.subtaskSync;
  const title = safeTaskText(task.title, `Untitled ${taskSourceLabel(task)} task`);
  const project = safeTaskText(task.project?.name, taskSourceLabel(task));
  const milestone = safeTaskText(task.milestone?.name, "");
  const dueDate = typeof task.due_date === "string" && task.due_date ? formatWorkOsDate(task.due_date) : "No due date";
  const addedDate = typeof task.provider_created_at === "string" && task.provider_created_at
    ? formatWorkOsDate(task.provider_created_at.slice(0, 10))
    : typeof task.created_at === "string" && task.created_at ? formatWorkOsDate(task.created_at.slice(0, 10)) : "Not recorded";
  const priority = task.priority ? sentence(String(task.priority)) : "Normal";
  const completedSubtasks = subtasks.filter((subtask) => subtask.completed === true).length;
  const progressPercent = subtasks.length ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
  const contextDay = typeof task.due_date === "string" && task.due_date.slice(0, 10) === currentDate ? "Today" : task.due_date ? formatWorkOsDate(task.due_date) : "Today";
  const breadcrumbs = [contextDay, taskSourceLabel(task), project !== taskSourceLabel(task) ? project : null, milestone || null].filter(Boolean) as string[];
  return <AppWideSidePanel className="task-detail-layer" closeLabel="Close task details" onClose={onClose} busy={busy}>
    <section className="task-modal task-detail-modal work-os-side-panel" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
      <header><div><span>{task.completed ? "Completed task" : "Active task"}</span></div><button aria-label="Close task details" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="task-modal-body">
        {loading ? <><h2 className="task-detail-title" id="task-detail-title">{title}</h2><TaskDetailSkeleton /></> : <>
          {readOnly && <div className="task-readonly-banner" role="note"><strong>Historical view</strong><span>Read-only record. Make changes from the current day in Tasks.</span></div>}
          <nav className="task-detail-breadcrumb" aria-label="Task location">{breadcrumbs.map((crumb, index) => <span key={`${crumb}-${index}`}>{index > 0 && <ChevronRight size={13} aria-hidden="true" />}{crumb}</span>)}</nav>
          <section className="task-detail-intro"><h2 className="task-detail-title" id="task-detail-title">{title}</h2><p>{safeTaskText(task.description, "No description has been added.")}</p><AssigneeTags task={task} /></section>
          <section className="task-detail-meta" aria-label="Task metadata">
            <div><CalendarDays size={18} aria-hidden="true" /><span>Due</span><strong>{dueDate}</strong></div>
            <div><Clock3 size={18} aria-hidden="true" /><span>Added</span><strong>{addedDate}</strong></div>
            <div><Target size={18} aria-hidden="true" /><span>Priority</span><strong>{priority}</strong></div>
          </section>
          <section className="task-detail-progress" aria-label="Subtask progress">
            <header><span>Subtasks <b>{completedSubtasks} / {subtasks.length}</b></span><span>{progressPercent}%</span></header>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label={`${progressPercent}% of subtasks complete`}><i style={{ width: `${progressPercent}%` }} /></div>
          </section>
          <section className="subtask-section task-detail-next-steps"><header><div><strong>Next steps</strong><small>Keep the next concrete move visible.</small></div><span className="task-detail-next-count">{subtasks.length}</span></header>
            {sync?.error && String(task.provider ?? "") !== "local" && <p className="subtask-sync-warning" role="status">Couldn’t refresh subtasks from Nifty. Showing the last mirrored records.</p>}
            <div className="subtask-list">{subtasks.length ? subtasks.map((subtask) => {
              const subtaskId = String(subtask.provider_task_id || subtask.id);
              const subtaskState = subtask.completed ? "complete" as const : typeof subtask.due_date === "string" && subtask.due_date.slice(0, 10) < currentDate ? "overdue" as const : "open" as const;
              return <article key={subtask.id} className={`task-detail-subtask-row${subtask.completed ? " completed" : ""}`}><button type="button" className="task-detail-subtask-check" disabled={readOnly || busy} aria-label={subtask.completed ? `Reopen ${safeTaskText(subtask.title, "subtask")}` : `Complete ${safeTaskText(subtask.title, "subtask")}`} onClick={() => onToggleSubtask(subtask)}>{subtask.completed && <Check size={13} />}</button><div className="task-detail-subtask-copy"><strong>{safeTaskText(subtask.title, "Untitled subtask")}</strong>{safeTaskText(subtask.description, "") && <p>{safeTaskText(subtask.description, "")}</p>}<AssigneeTags task={subtask} /></div><span className={`task-state ${subtaskState}`}>{sentence(subtaskState)}</span>{!readOnly && <SubtaskActions
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
          <div className="task-detail-provenance"><span className={`task-state ${state}`}>{sentence(state)}</span><SyncChip task={task} /></div>
        </>}
      </div>
      <footer className="task-detail-footer"><small>{project} · {taskSourceLabel(task)} is the task record</small><div className="task-detail-footer-actions">{!readOnly && !task.completed ? <><button disabled={busy} onClick={() => onEditTask(task)}>Edit task</button><button className="primary" disabled={busy} onClick={() => onCompleteTask?.()}><Check size={15} /> Mark complete</button></> : <button onClick={onClose}>Close</button>}</div></footer>
    </section>
  </AppWideSidePanel>;
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

export function TaskCarryOverFlyout({ groups, busy, onClose, onSurfaceTask, onTaskCompletion, onOpenDay, taskFlight }: {
  groups: Array<{ date: string; label: string; items: Array<{ task: TaskRow; attribution: { date: string | null; reason: string } }> }>;
  busy: boolean; onClose: () => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void;
  onTaskCompletion: (task: TaskRow, completed: boolean) => void; onOpenDay: (date: string) => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
}) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return <AppWideSidePanel className="carry-over-layer carry-flyout-backdrop" closeLabel="Close unfinished work" onClose={onClose} busy={busy}>
    <aside className="carry-flyout work-os-side-panel" aria-label="Unfinished work" role="dialog" aria-modal="true" aria-labelledby="unfinished-work-title">
      <header><div><span>From previous days</span><h2 id="unfinished-work-title">Review unfinished work.</h2><small>{total} unfinished task{total === 1 ? "" : "s"} across {groups.length} workday{groups.length === 1 ? "" : "s"}. Decide what moves forward.</small></div><button aria-label="Close unfinished work" onClick={onClose}><X size={18} /></button></header>
      <div>{groups.length ? groups.map((group) => <section key={group.date}><h3>{group.label}</h3>{group.items.map(({ task, attribution }) => <article key={task.id}>
        <div className="carry-row-copy"><strong>{safeTaskText(task.title, `Untitled ${taskSourceLabel(task)} task`)}</strong><small>{attribution.reason === "due" ? "Due on that day" : attribution.reason === "created" ? "Created on that day" : "Previously surfaced"}</small></div>
        <div className="carry-row-actions"><button disabled={busy} onClick={() => onSurfaceTask(task)}><Plus size={13} /> Add to today</button><button disabled={busy || taskFlight?.has(String(task.provider_task_id || task.id))} onClick={() => onTaskCompletion(task, true)}>{taskFlight?.get(String(task.provider_task_id || task.id)) === "completing" ? <FadeArc size={13} /> : <Check size={13} />} Complete</button><button disabled={busy} onClick={() => onSurfaceTask(task, "deferred")}>Defer</button><button onClick={() => onOpenDay(attribution.date!)}>Open day</button></div>
      </article>)}</section>) : <div className="carry-empty"><Check size={20} /><strong>Nothing left behind</strong><span>Earlier work is complete or carried forward.</span></div>}</div>
      <footer><small>Nothing changes in Nifty until you act.</small><button onClick={onClose}>Close</button></footer>
    </aside>
  </AppWideSidePanel>;
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

export { sentence, taskKind };

/** Review-workspace loading state: composer-shaped so the draft lands without
 * a layout jump (design §31). One status line, a skeleton body, and an
 * optional quiet escape hatch. */
export function EodLoadingState({ title, detail, progress = null, onDraftAnyway }: {
  title: string;
  detail: string;
  progress?: string | null;
  onDraftAnyway?: () => void;
}) {
  return <section className="panel eod-composer eod-loading" role="status" aria-live="polite">
    <header className="eod-loading-status">
      <FadeArc size={20} />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
        {progress ? <small className="eod-loading-progress">{progress}</small> : null}
      </div>
    </header>
    <div className="eod-loading-skeleton" aria-hidden="true">
      <Skeleton className="eod-loading-line is-heading" />
      <Skeleton className="eod-loading-line" />
      <Skeleton className="eod-loading-line is-short" />
      <Skeleton className="eod-loading-line" />
      <Skeleton className="eod-loading-line is-tiny" />
    </div>
    {onDraftAnyway ? <footer className="eod-loading-footer">
      <small>Drafting starts when the analysis finishes; you can draft with the frames that are ready.</small>
      <button type="button" className="quiet-action" onClick={onDraftAnyway}>Draft Anyway</button>
    </footer> : null}
  </section>;
}

export type LoomReadback = {
  title: string | null;
  durationSeconds: number | null;
  createdLocalDate: string | null;
  verdict: string;
  usableForDay: boolean;
  metadataAvailable: boolean;
};

export type LoomAttached = {
  title: string | null;
  durationSeconds: number | null;
  createdLocalDate: string | null;
  verdict: string;
  url: string;
};

export function EodComposer({ reportId, initialMarkdown, source, dayLabel = "today", suggestedBottleneck, allTasksCompleted, redrafting, clockedOut = false, screenshotContext = null, screenshotGallery = null, screenshotResolveSrc, screenshotSyncUnavailable = false, screenshotNotice = null, preparing = null, onDraftAnyway, loomEnabled = false, loomAttached = null, onLoomPreview, onLoomDraft, busy, onRedraft, onRefresh, onRefine, onSubmit }: {
  reportId: string; initialMarkdown: string; source: "ai" | "deterministic" | "simulated" | null; dayLabel?: string; suggestedBottleneck: string | null;
  allTasksCompleted: boolean; redrafting: boolean; clockedOut?: boolean; screenshotContext?: { processed: number; excluded: number; failed: number; pending: number; hours: EodScreenshotHour[] } | null; screenshotGallery?: EodScreenshotGallery | null; screenshotResolveSrc?: PreviewResolver; screenshotSyncUnavailable?: boolean; screenshotNotice?: string | null; preparing?: { analyzed: number; total: number; pending: number | null } | null; onDraftAnyway?: () => void; loomEnabled?: boolean; loomAttached?: LoomAttached | null; onLoomPreview?: (url: string) => Promise<LoomReadback | null>; onLoomDraft?: (loom: { url: string; transcript?: string }) => Promise<{ ok: boolean; message?: string }>; busy: boolean; onRedraft: () => void; onRefresh?: () => void; onRefine: (markdown: string, feedback: string, annotations: Array<{ quote: string; comment: string }>) => Promise<boolean>; onSubmit: (markdown: string, idempotencyKey: string) => void;
}) {
  const dayReference = dayLabel === "today" ? "today's" : `${dayLabel}'s`;
  const hasGalleryFrames = (screenshotGallery?.viewable.length ?? 0) > 0 || (screenshotGallery?.processed ?? 0) > 0;
  const pendingFrames = screenshotGallery?.pending ?? screenshotContext?.pending ?? 0;
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [bottleneck, setBottleneck] = useState(suggestedBottleneck ?? "");
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [annotations, setAnnotations] = useState<Array<{ quote: string; comment: string }>>([]);
  const [pending, setPending] = useState<{ quote: string; rect: SelectionRect } | null>(null);
  const [pendingComment, setPendingComment] = useState("");
  const [loomOpen, setLoomOpen] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const [loomTranscript, setLoomTranscript] = useState("");
  const [loomReading, setLoomReading] = useState(false);
  const [loomDrafting, setLoomDrafting] = useState(false);
  const [loomError, setLoomError] = useState<string | null>(null);
  const [loomReadback, setLoomReadback] = useState<LoomReadback | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  // A redraft replaces the buffer (and any in-progress edits) by design.
  useEffect(() => { setMarkdown(initialMarkdown); }, [initialMarkdown]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  const draftBottleneck = extractBottleneckAnswer(markdown);
  const reason = resolvedBottleneck(bottleneck, markdown);
  // Report actions compete for the same draft, so a Loom analysis locks them
  // exactly like a redraft or refine does.
  const reportLocked = busy || redrafting || loomDrafting;
  const canSubmit = (allTasksCompleted || !!reason) && markdown.trim() && !reportLocked && !refining;
  const refineReady = (Boolean(feedback.trim()) || annotations.length > 0) && !reportLocked && !refining;
  // A disabled Submit always names its blocker, so the employee is never left
  // guessing why the reason they typed did not unlock the report.
  const submitHint = busy
    ? "Submitting…"
    : loomDrafting
      ? "Analyzing your Loom — report actions unlock when it finishes."
      : redrafting
        ? "Waiting for the draft to finish before this can be submitted."
        : refining
          ? "Refine is still running — submit unlocks when it finishes."
          : !markdown.trim()
            ? "The report is empty. Add content in Raw before submitting."
            : !allTasksCompleted && !reason
              ? "Add the reason above (Bottleneck) to submit."
              : null;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(composeEodMarkdown(markdown, reason, !allTasksCompleted), crypto.randomUUID());
  };
  /** Reads the pasted Loom link's public metadata and day verdict. */
  const readLoom = async () => {
    if (!loomUrl.trim() || !onLoomPreview || loomReading) return;
    setLoomReading(true);
    setLoomError(null);
    try {
      const result = await onLoomPreview(loomUrl.trim());
      setLoomReadback(result);
      if (!result) setLoomError("Loom could not be read. Check the link and try again.");
    } finally {
      setLoomReading(false);
    }
  };
  /** Rebuilds the draft from the analyzed recording. Nothing is filed. */
  const useLoomInDraft = async () => {
    if (!loomUrl.trim() || !onLoomDraft || loomDrafting) return;
    setLoomDrafting(true);
    setLoomError(null);
    try {
      const result = await onLoomDraft({ url: loomUrl.trim(), ...(loomTranscript.trim() ? { transcript: loomTranscript.trim() } : {}) });
      if (result.ok) {
        setLoomOpen(false);
        setLoomUrl("");
        setLoomTranscript("");
        setLoomReadback(null);
      } else {
        setLoomError(result.message ?? "The Loom could not be analyzed.");
      }
    } finally {
      setLoomDrafting(false);
    }
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
      <div className="eod-composer-actions">{onRefresh && <button disabled={reportLocked} onClick={onRefresh}>Refresh from record</button>}<button disabled={reportLocked} onClick={onRedraft}>{redrafting ? <><FadeArc size={14} /> Drafting…</> : "Draft with AI"}</button></div>
    </header>
    {preparing && <div className="eod-screenshot-preparing" role="status">
      <FadeArc size={14} />
      <span>
        <strong>Preparing Worktivity analysis…</strong>
        <small>{preparing.pending == null
          ? `Checking ${dayReference} screenshots.`
          : `${preparing.analyzed} of ${preparing.total} frames analyzed${preparing.pending > 0 ? ` — ${preparing.pending} still analyzing` : ""}.`}</small>
      </span>
      {onDraftAnyway && <button type="button" className="quiet-action" onClick={onDraftAnyway}>Draft Anyway</button>}
    </div>}
    {screenshotNotice && !preparing && <p className="eod-screenshot-unavailable" role="status">Screenshot context: {screenshotNotice}</p>}
    {(hasGalleryFrames || pendingFrames > 0 || (source === "ai" && screenshotContext)) && <details className="eod-screenshot-context" open={false}><summary>{(screenshotGallery?.processed ?? screenshotContext?.processed ?? 0)} screenshot sample{(screenshotGallery?.processed ?? screenshotContext?.processed ?? 0) === 1 ? "" : "s"} analyzed for this day{pendingFrames > 0 ? ` · ${pendingFrames} still analyzing` : ""}</summary><div className="eod-screenshot-body"><p>Sampled activity context only. It does not prove task completion, effort, or output quality.</p><EodScreenshotPanel context={source === "ai" ? screenshotContext : null} gallery={screenshotGallery} resolveSrc={screenshotResolveSrc} /></div></details>}
    {source === "ai" && screenshotSyncUnavailable && <p className="eod-screenshot-unavailable" role="status">Screenshot context was unavailable for this draft. It uses {dayReference} recorded work only.</p>}
    {loomEnabled && <div className="eod-loom">
      <button type="button" className={`eod-loom-toggle ${loomOpen ? "active" : ""}`} aria-expanded={loomOpen} onClick={() => { setLoomOpen((current) => !current); setLoomError(null); }}>
        <Video size={14} /> {loomOpen ? "Cancel Loom analysis" : "Recorded a Loom instead?"}
      </button>
      {loomAttached ? <p className="eod-loom-readback" role="status">In this draft: {loomAttached.title ?? "Loom recording"}{formatLoomLength(loomAttached.durationSeconds)} · recorded {loomAttached.createdLocalDate ? formatWorkOsDate(loomAttached.createdLocalDate) : "an unverified date"}{loomAttached.verdict === "unknown" ? " (unverified)" : ""}.</p> : null}
      {loomOpen ? <div className="eod-loom-panel" role="group" aria-label="Loom analysis">
        <p className="eod-loom-hint">Paste your Loom link and Work OS rebuilds the draft from what you said — the recording never has to be a second EOD, and no video is stored.</p>
        <div className="eod-loom-row">
          <input value={loomUrl} onChange={(event) => { setLoomUrl(event.target.value); setLoomReadback(null); setLoomError(null); }} placeholder="https://www.loom.com/share/…" maxLength={500} aria-label="Loom share link" />
          <button type="button" disabled={!loomUrl.trim() || loomReading} onClick={() => void readLoom()}>{loomReading ? "Reading…" : "Read Loom"}</button>
        </div>
        {loomReadback?.metadataAvailable ? <p className={`eod-loom-readback ${loomReadback.usableForDay ? "" : "is-warning"}`} role="status">
          {loomReadback.title ?? "Loom recording"}{formatLoomLength(loomReadback.durationSeconds)} · recorded {loomReadback.createdLocalDate ? formatWorkOsDate(loomReadback.createdLocalDate) : "an unverified date"}{loomReadback.usableForDay ? "" : ` — it can't be used for ${dayReference} report`}.
        </p> : null}
        {loomReadback && !loomReadback.metadataAvailable ? <p className="eod-loom-readback is-warning" role="status">Loom returned no public metadata — the recording may be private. Paste the transcript so the draft can still use what you said.</p> : null}
        <details className="eod-loom-transcript">
          <summary>Paste transcript (optional)</summary>
          <textarea value={loomTranscript} onChange={(event) => setLoomTranscript(event.target.value)} rows={3} maxLength={50000} placeholder="In Loom open Transcript, then Copy — paste it here so the draft can use what you said." aria-label="Loom transcript" />
        </details>
        <div className="eod-loom-actions">
          <small>Analysis only shapes this draft. It never files an update, task, or evidence row.</small>
          <button type="button" className="primary" disabled={!loomUrl.trim() || loomDrafting || redrafting || loomReadback?.usableForDay === false} onClick={() => void useLoomInDraft()}>{loomDrafting || redrafting ? "Analyzing…" : "Analyze and rebuild draft"}</button>
        </div>
        {loomError ? <p className="eod-loom-error" role="alert">{loomError}</p> : null}
      </div> : null}
    </div>}
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
    <label className="eod-bottleneck-label"><span>{allTasksCompleted ? "Bottleneck not needed" : "Bottleneck — required"}</span>
      <textarea value={bottleneck} rows={2} maxLength={2000} disabled={allTasksCompleted} placeholder={allTasksCompleted ? `Every task in ${dayReference} list is complete.` : BOTTLENECK_QUESTION} onChange={(event) => setBottleneck(event.target.value)} aria-label={allTasksCompleted ? "No bottleneck is needed because every task is complete" : BOTTLENECK_QUESTION} />
      <small>{allTasksCompleted
        ? `Every task in ${dayReference} list is complete, so no reason is needed or sent with this report.`
        : hasBottleneckAnswer(bottleneck)
          ? "This goes to your manager with the report."
          : draftBottleneck
            ? "Found in the report draft. Submitting uses it, or type here to replace it."
            : "What prevented you from completing your task list? This goes to your manager with the report."}</small>
    </label>
    <section className="eod-refine" aria-label="Draft feedback">
      <span>Refine this draft</span>
      <small>Select text in the preview to add a note, or describe the change. Your bottleneck answer stays separate.</small>
      <textarea value={feedback} rows={2} maxLength={2000} placeholder="For example: make the summary shorter and mention the client handoff." onChange={(event) => setFeedback(event.target.value)} aria-label="Feedback for refining this draft" />
      <div className="eod-refine-actions"><button disabled={!refineReady} onClick={() => void refine()}>{refining ? <><FadeArc size={14} /> Refining…</> : "Refine draft"}</button></div>
    </section>
    <footer><small>{submitHint ?? "Nothing is filed until you submit."}</small><button className="primary" disabled={!canSubmit} onClick={submit}>{busy ? "Submitting…" : "Submit EOD"}</button></footer>
    {pending && <SelectionAnnotator quote={pending.quote} anchor={pending.rect} value={pendingComment} canSave={isAnnotationCommentValid(pendingComment)} disabled={busy || redrafting || refining} onChange={setPendingComment} onSave={addAnnotation} onCancel={() => { setPending(null); setPendingComment(""); }} />}
  </section>;
}
