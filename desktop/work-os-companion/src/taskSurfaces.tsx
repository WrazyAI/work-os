import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FadeArc, Skeleton, TaskDetailSkeleton } from "./LoadingUi";
import { createPortal } from "react-dom";
import { Archive, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, ListChecks, MoreHorizontal, MoveRight, Pencil, Plus, RotateCcw, Target, Trash2, UserRound, Video, X } from "lucide-react";
import { computeMenuPlacement } from "./menuPlacement";
import { renderViewportSurface } from "./viewportSurface";
import { stripPlaceholderBottleneck } from "./interpretation";
import { ChatMarkdown } from "./ChatMarkdown";
import { TaskEvidenceList } from "./CompletionEvidence";
import type { EvidenceLoader } from "./EvidencePreview";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText, taskKind, type TaskRow } from "./taskWorkspace";
import type { TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";
import { ProgressRing } from "./ProgressRing";
import { Otto } from "./Otto";
import { SelectionAnnotator, type SelectionRect } from "./SelectionAnnotator";
import { isAnnotationCommentValid, sanitizeComment } from "./planningAnnotations";
import { EodScreenshotPanel, type PreviewResolver } from "./ScreenshotGallery";
import { EOD_SHIFT_OPEN_LINK_LABEL, EOD_SHIFT_OPEN_REBUILD_PREFIX, EOD_SHIFT_OPEN_SUFFIX } from "../../../src/lib/work-os-shift-gate";
import type { EodScreenshotGallery, EodScreenshotHour } from "./types";
import { displayTaskState, taskActionItems, taskStatusOptions } from "./taskActions";

export function TaskActionMenuItems({ task, currentDate, busy, onStatus, onComplete, onEdit, onAssign, onArchive, onDelete, onClose }: {
  task: TaskRow; currentDate: string; busy: boolean;
  onStatus: (status: "pending" | "in_progress") => void;
  onComplete: (completed: boolean) => void;
  onEdit: () => void; onAssign?: () => void; onArchive: () => void; onDelete: () => void; onClose: () => void;
}) {
  const actions = taskActionItems(task, currentDate);
  const choose = (action: () => void) => { onClose(); action(); };
  const state = displayTaskState(task, currentDate);
  const statusOptions = taskStatusOptions(task, currentDate);
  // An overdue task keeps its status control, disabled with the due-date note.
  // Otherwise an actor who may not change status gets no dead control at all.
  const showStatus = statusOptions.some((option) => !option.disabled || option.note);
  if (!showStatus && !actions.length) return null;
  return <>
    {showStatus && statusOptions.map((option) => <button key={option.value} role="menuitem" disabled={busy || option.disabled} onClick={() => choose(() => onStatus(option.value))}>{state === option.value && <Check size={14} aria-hidden="true" />}{option.label}{option.note && <small>{option.note}</small>}</button>)}
    {actions.includes("complete") && <button role="menuitem" disabled={busy} onClick={() => choose(() => onComplete(true))}><CheckCircle2 size={14} /> Mark task done</button>}
    {actions.includes("reopen") && <button role="menuitem" disabled={busy} onClick={() => choose(() => onComplete(false))}><RotateCcw size={14} /> Reopen task</button>}
    {actions.includes("edit") && <button role="menuitem" disabled={busy} onClick={() => choose(onEdit)}><Pencil size={14} /> Edit task</button>}
    {actions.includes("assign") && onAssign && <button role="menuitem" disabled={busy} onClick={() => choose(onAssign)}><UserRound size={14} /> Assign</button>}
    {actions.includes("archive") && <button role="menuitem" disabled={busy} onClick={() => choose(onArchive)}><Archive size={14} /> Archive <small>reversible</small></button>}
    {actions.includes("delete") && <button className="danger" role="menuitem" disabled={busy} onClick={() => choose(onDelete)}><Trash2 size={14} /> Delete permanently</button>}
  </>;
}

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

type MenuElementRef = { current: HTMLElement | null };

/**
 * Owns the interaction contract for a detached menu: clicks in any related
 * trigger/menu stay inside the interaction, Escape closes it, the first item
 * receives focus, and focus returns to the trigger afterwards. Keeping this
 * beside the portal placement hook prevents each surface from inventing a
 * slightly different outside-click boundary.
 */
function usePortalMenuInteraction({ open, triggerRefs, menuRefs, focusMenuRef, onClose }: {
  open: boolean;
  triggerRefs: readonly MenuElementRef[];
  menuRefs: readonly MenuElementRef[];
  focusMenuRef: MenuElementRef;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => focusMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    const isInsideMenu = (target: Node) => triggerRefs.some((ref) => ref.current?.contains(target)) || menuRefs.some((ref) => ref.current?.contains(target));
    const onKey = (event: KeyboardEvent) => {
      // The App-level dialog trap may receive the same event first. Avoid
      // moving a menu item twice when a detached menu sits inside a drawer.
      if (event.defaultPrevented) return;
      if (moveMenuFocus(event)) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && isInsideMenu(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [focusMenuRef, menuRefs, onClose, open, triggerRefs]);
}

/**
 * Nested task dialogs can open while the detail drawer remains mounted. Keep
 * their focus lifecycle local so the App-level modal effect does not have to
 * observe a boolean that is already true for the parent drawer.
 */
function useDialogFocus(dialogRef: { current: HTMLElement | null }) {
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const field = dialog.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
      (field ?? dialog.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'))?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dialogRef]);
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
  const triggerRefs = useMemo(() => [triggerRef], [triggerRef]);
  const menuRefs = useMemo(() => [menuRef], [menuRef]);
  usePortalMenuInteraction({ open, triggerRefs, menuRefs, focusMenuRef: menuRef, onClose });
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

/** Every task is a Work OS record; the chip states its own saving state. */
export function taskSourceLabel(task: AnyTask): string {
  return String(task?.provider ?? "") === "local" ? "Work OS" : "Work OS";
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

function SubtaskActions({ subtask, busy, menuOpen, moveOpen, onMenuToggle, onMoveToggle, onClose, onToggle, onEdit, onMove, onArchive, onDelete, moveTargets }: {
  subtask: AnyTask; busy: boolean; menuOpen: boolean; moveOpen: boolean;
  onMenuToggle: () => void; onMoveToggle: () => void; onClose: () => void; onToggle: () => void; onEdit: () => void;
  onMove: (target: AnyTask) => void; onArchive: () => void; onDelete: () => void; moveTargets: AnyTask[];
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(menuOpen);
  const move = useAnchoredMenu(moveOpen);
  const triggerRefs = useMemo(() => [triggerRef, move.triggerRef], [move.triggerRef, triggerRef]);
  const menuRefs = useMemo(() => [menuRef, move.menuRef], [menuRef, move.menuRef]);
  usePortalMenuInteraction({ open: menuOpen || moveOpen, triggerRefs, menuRefs, focusMenuRef: moveOpen ? move.menuRef : menuRef, onClose });
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
    {menuOpen && renderViewportSurface(<div className="subtask-menu task-detail-menu anchored-menu" role="menu" style={style} ref={menuRef}>
      <button role="menuitem" onClick={onToggle}>{subtask.completed ? <RotateCcw size={14} /> : <Check size={14} />} {subtask.completed ? "Reopen subtask" : "Mark subtask done"}</button>
      <button role="menuitem" onClick={onEdit}><Pencil size={14} /> Edit</button>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={moveOpen} ref={(node) => { move.triggerRef.current = node; }} onClick={onMoveToggle}><MoveRight size={14} /> Move to <ChevronRight size={13} /></button>
      <button role="menuitem" onClick={onArchive}><Archive size={14} /> Archive <small>reversible</small></button>
      <button className="danger" role="menuitem" onClick={onDelete}><Trash2 size={14} /> Delete permanently</button>
    </div>)}
    {moveOpen && renderViewportSurface(<div className="move-target-menu task-detail-move-menu anchored-menu" role="menu" aria-label="Move subtask to" style={move.style} ref={move.menuRef}>
      <span>Move to task</span>
      {(moveTargets || []).length ? moveTargets.map((target) => <button role="menuitem" key={target.id} onClick={() => onMove(target)}>{safeTaskText(target.title, "Untitled task")}</button>) : <p>No other open tasks available.</p>}
    </div>)}
  </div>;
}

export function TaskDetailsModal({ details, loading, readOnly, currentDate, busy, subtaskTitle, subtaskDescription, subtaskMenuId, moveMenuId, completionEvidence = [], loadEvidence, onSubtaskTitle, onSubtaskDescription, onSubtaskMenu, onMoveMenu, onSubtaskCreate, onEditTask, onCompleteTask, onAttachEvidence, onDownloadEvidence, onMoveSubtask, onToggleSubtask, onArchiveSubtask, onDeleteSubtask, onClose }: {
  details: { task: AnyTask; subtasks: AnyTask[]; moveTargets: AnyTask[]; subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null } };
  loading: boolean; readOnly: boolean; currentDate: string; busy: boolean;
  subtaskTitle: string; subtaskDescription: string; subtaskMenuId: string | null; moveMenuId: string | null;
  completionEvidence?: TaskEvidenceRecord[];
  loadEvidence: EvidenceLoader;
  onSubtaskTitle: (value: string) => void; onSubtaskDescription: (value: string) => void;
  onSubtaskMenu: (id: string | null) => void; onMoveMenu: (id: string | null) => void;
  onSubtaskCreate: () => void; onEditTask: (task: AnyTask) => void; onCompleteTask?: () => void; onAttachEvidence?: () => void; onDownloadEvidence?: (evidence: TaskEvidenceRecord) => void; onMoveSubtask: (subtask: AnyTask, target: AnyTask) => void;
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
          {String(task.expected_outcome ?? "").trim() ? <section className="task-detail-outcome" aria-label="Expected outcome"><span>Expected outcome</span><p>{safeTaskText(task.expected_outcome, "")}</p></section> : null}
          <section className="task-detail-meta" aria-label="Task metadata">
            <div><CalendarDays size={18} aria-hidden="true" /><span>Due</span><strong>{dueDate}</strong></div>
            <div><Clock3 size={18} aria-hidden="true" /><span>Added</span><strong>{addedDate}</strong></div>
            <div><Target size={18} aria-hidden="true" /><span>Priority</span><strong>{priority}</strong></div>
          </section>
          <section className="task-detail-progress" aria-label="Subtask progress">
            <header><span>Subtasks <b>{completedSubtasks} / {subtasks.length}</b></span><span>{progressPercent}%</span></header>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label={`${progressPercent}% of subtasks complete`}><i style={{ width: `${progressPercent}%` }} /></div>
          </section>
          <TaskEvidenceList evidence={completionEvidence} loadEvidence={loadEvidence} readOnly={readOnly} busy={busy} completed={task.completed === true} onAttach={onAttachEvidence} onDownload={onDownloadEvidence} />
          <section className="subtask-section task-detail-next-steps"><header><div><strong>Next steps</strong><small>Keep the next concrete move visible.</small></div><span className="task-detail-next-count">{subtasks.length}</span></header>
            {sync?.error && String(task.provider ?? "") !== "local" && <p className="subtask-sync-warning" role="status">Couldn’t refresh subtasks. Showing the last records.</p>}
            <div className="subtask-list">{subtasks.length ? subtasks.map((subtask) => {
              const subtaskId = String(subtask.provider_task_id || subtask.id);
              const subtaskState = subtask.completed ? "complete" as const : typeof subtask.due_date === "string" && subtask.due_date.slice(0, 10) < currentDate ? "overdue" as const : "open" as const;
              return <article key={subtask.id} className={`task-detail-subtask-row${subtask.completed ? " completed" : ""}`}><button type="button" className="task-detail-subtask-check" disabled={readOnly || busy} aria-label={subtask.completed ? `Reopen ${safeTaskText(subtask.title, "subtask")}` : `Complete ${safeTaskText(subtask.title, "subtask")}`} onClick={() => onToggleSubtask(subtask)}>{subtask.completed && <Check size={13} />}</button><div className="task-detail-subtask-copy">{readOnly ? <strong>{safeTaskText(subtask.title, "Untitled subtask")}</strong> : <button type="button" className="task-detail-subtask-title" disabled={busy} title="Edit subtask" aria-label={`Edit ${safeTaskText(subtask.title, "subtask")}`} onClick={() => onEditTask(subtask)}>{safeTaskText(subtask.title, "Untitled subtask")}</button>}{safeTaskText(subtask.description, "") && <p>{safeTaskText(subtask.description, "")}</p>}<AssigneeTags task={subtask} /></div><span className={`task-state ${subtaskState}`}>{sentence(subtaskState)}</span>{!readOnly && <SubtaskActions
                subtask={subtask} busy={busy}
                menuOpen={subtaskMenuId === subtaskId} moveOpen={moveMenuId === subtaskId}
                onMenuToggle={() => { onSubtaskMenu(subtaskMenuId === subtaskId ? null : subtaskId); onMoveMenu(null); }}
                onMoveToggle={() => onMoveMenu(moveMenuId === subtaskId ? null : subtaskId)}
                onClose={() => { onSubtaskMenu(null); onMoveMenu(null); }}
                onToggle={() => { onSubtaskMenu(null); onMoveMenu(null); onToggleSubtask(subtask); }}
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
  mode: "archive" | "delete"; scope: "task" | "subtask" | "draft"; title: string; subtaskCount: number; busy: boolean; localTask?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const permanent = mode === "delete";
  const draft = scope === "draft";
  const source = "Work OS";
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef);
  return renderViewportSurface(<div className="task-modal-backdrop confirmation-backdrop"><section ref={dialogRef} className={`delete-confirmation ${permanent ? "" : "reversible"}`} role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description">
    <span className={permanent ? "danger-icon" : "reversible-icon"}>{permanent ? <Trash2 size={18} /> : <Archive size={18} />}</span>
    <h2 id="delete-confirmation-title">{permanent ? "Permanently delete" : "Archive"} this {scope}?</h2>
    <p id="delete-confirmation-description">{permanent ? <>“{title}” will be permanently removed from {source} and cannot be restored.</> : <>“{title}” will be hidden from active work but retained in Work OS history.</>}{scope === "task" && subtaskCount > 0 ? ` Its ${subtaskCount} remaining subtask${subtaskCount === 1 ? "" : "s"} will also be ${permanent ? "permanently deleted" : "archived"}.` : ""}</p>
    <div><button disabled={busy} onClick={onCancel}>Cancel</button><button className={permanent ? "confirm-delete" : "confirm-archive"} disabled={busy} onClick={onConfirm}>{busy ? (permanent ? "Deleting…" : "Archiving…") : permanent ? (draft ? "Delete draft" : "Delete permanently") : "Archive task"}</button></div>
  </section></div>);
}

export function TaskEditModal({ kind, title, description, busy, localTask = false, onTitle, onDescription, onClose, onSubmit }: {
  kind: "task" | "subtask"; title: string; description: string; busy: boolean; localTask?: boolean;
  onTitle: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef);
  return renderViewportSurface(<div className="task-modal-backdrop"><section ref={dialogRef} className="task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
    <header><div><span>Edit {kind}</span><h2 id="edit-task-title">Update the {localTask ? "Work OS" : "Work OS"} record</h2></div><button aria-label="Close editor" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="task-modal-body">
      <label><span>Title</span><input autoFocus maxLength={240} value={title} onChange={(event) => onTitle(event.target.value)} /></label>
      <label><span>Description</span><textarea maxLength={20000} value={description} onChange={(event) => onDescription(event.target.value)} /></label>
    </div>
    <footer><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !title.trim()} onClick={onSubmit}>Save changes</button></footer>
  </section></div>);
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
      <footer><small>Nothing is written until you act.</small><button onClick={onClose}>Close</button></footer>
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
  if (task.sync_error) return <span className="sync-chip degraded">Details unavailable</span>;
  if (task.synced_at) return <span className="sync-chip synced">Work OS task</span>;
  return <span className="sync-chip awaiting">Saving…</span>;
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

/** The prompt for a workday that has not ended. The clock-out reads as inline
 * text, underlined, and behaves like the action it names: it takes the
 * employee to the dashboard, where the Clock out button closes the shift. */
export function EodShiftOpenNotice({ prefix, suffix, onClockOut }: { prefix: string; suffix: string; onClockOut: () => void }) {
  return <p className="eod-shift-open-notice" role="status">
    {prefix} <button type="button" className="eod-inline-action" onClick={onClockOut}>{EOD_SHIFT_OPEN_LINK_LABEL}</button>{suffix}
  </p>;
}

export function EodComposer({ initialMarkdown, source, dayLabel = "today", redrafting, clockedOut = false, screenshotContext = null, screenshotGallery = null, screenshotResolveSrc, screenshotSyncUnavailable = false, screenshotNotice = null, preparing = null, onDraftAnyway, loomEnabled = false, loomAttached = null, onLoomPreview, onLoomDraft, busy, onRedraft, onRefresh, onDelete, shiftOpen = false, onOpenDashboard, onRefine, onSubmit }: {
  initialMarkdown: string; source: "ai" | "deterministic" | "simulated" | null; dayLabel?: string; redrafting: boolean; clockedOut?: boolean; screenshotContext?: { processed: number; excluded: number; failed: number; pending: number; hours: EodScreenshotHour[] } | null; screenshotGallery?: EodScreenshotGallery | null; screenshotResolveSrc?: PreviewResolver; screenshotSyncUnavailable?: boolean; screenshotNotice?: string | null; preparing?: { analyzed: number; total: number; pending: number | null } | null; onDraftAnyway?: () => void; loomEnabled?: boolean; loomAttached?: LoomAttached | null; onLoomPreview?: (url: string) => Promise<LoomReadback | null>; onLoomDraft?: (loom: { url: string; transcript?: string }) => Promise<{ ok: boolean; message?: string }>; busy: boolean; onRedraft: () => void; onRefresh?: () => void; onDelete?: () => void; shiftOpen?: boolean; onOpenDashboard?: () => void; onRefine: (markdown: string, feedback: string, annotations: Array<{ quote: string; comment: string }>) => Promise<boolean>; onSubmit: (markdown: string, idempotencyKey: string) => void;
}) {
  const dayReference = dayLabel === "today" ? "today's" : `${dayLabel}'s`;
  const hasGalleryFrames = (screenshotGallery?.viewable.length ?? 0) > 0 || (screenshotGallery?.processed ?? 0) > 0;
  const pendingFrames = screenshotGallery?.pending ?? screenshotContext?.pending ?? 0;
  const [markdown, setMarkdown] = useState(() => stripPlaceholderBottleneck(initialMarkdown));
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
  useEffect(() => { setMarkdown(stripPlaceholderBottleneck(initialMarkdown)); }, [initialMarkdown]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  // Report actions compete for the same draft, so a Loom analysis locks them
  // exactly like a redraft or refine does.
  const reportLocked = busy || redrafting || loomDrafting;
  const canSubmit = !!markdown.trim() && !reportLocked && !refining;
  const refineReady = (Boolean(feedback.trim()) || annotations.length > 0) && !reportLocked && !refining;
  // A disabled Submit always names its blocker, so the employee is never left
  // guessing why the report cannot be filed.
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
            : null;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(stripPlaceholderBottleneck(markdown), crypto.randomUUID());
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
      <div className="eod-title-with-pet"><Otto pose="focus" className="otto-eod" /><div><h2>Record the day, then hand it to your manager.</h2>
      {clockedOut && <small className="eod-clocked-out-note">Your shift was clocked out automatically when this draft was created.</small>}</div></div>
      <div className="eod-composer-actions">{onRefresh && !shiftOpen ? <button disabled={reportLocked} onClick={onRefresh}>Refresh from record</button> : null}{!shiftOpen ? <button disabled={reportLocked} onClick={onRedraft}>{redrafting ? <><FadeArc size={14} /> Drafting…</> : "Draft with AI"}</button> : null}{onDelete ? <button className="eod-delete-draft" disabled={reportLocked} onClick={onDelete}><Trash2 size={13} /> Delete draft</button> : null}</div>
    </header>
    {shiftOpen && onOpenDashboard ? <EodShiftOpenNotice prefix={EOD_SHIFT_OPEN_REBUILD_PREFIX} suffix={EOD_SHIFT_OPEN_SUFFIX.companionRebuild} onClockOut={onOpenDashboard} /> : null}
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
    <section className="eod-refine" aria-label="Draft feedback">
      <span>Refine this draft</span>
      <small>Select text in the preview to add a note, or describe the change.</small>
      <textarea value={feedback} rows={2} maxLength={2000} placeholder="For example: make the summary shorter and mention the client handoff." onChange={(event) => setFeedback(event.target.value)} aria-label="Feedback for refining this draft" />
      <div className="eod-refine-actions"><button disabled={!refineReady} onClick={() => void refine()}>{refining ? <><FadeArc size={14} /> Refining…</> : "Refine draft"}</button></div>
    </section>
    <footer><small>{submitHint ?? "Nothing is filed until you submit."}</small><button className="primary" disabled={!canSubmit} onClick={submit}>{busy ? "Submitting…" : "Submit EOD"}</button></footer>
    {pending && <SelectionAnnotator quote={pending.quote} anchor={pending.rect} value={pendingComment} canSave={isAnnotationCommentValid(pendingComment)} disabled={busy || redrafting || refining} onChange={setPendingComment} onSave={addAnnotation} onCancel={() => { setPending(null); setPendingComment(""); }} />}
  </section>;
}
