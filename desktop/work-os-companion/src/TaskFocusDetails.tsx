import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Circle, Target, X } from "lucide-react";
import type { DailyPlan } from "./types";
import { buildFocusPlan, type FocusPlanGroup } from "./focusPlan";
import { useModalScrollLock } from "./modalScrollLock";
import type { TaskRow } from "./taskWorkspace";

/** The plan's parent rows stay closed by default; each one owns its subtasks. */
export function FocusPlanList({ groups, expandedIds, onToggle }: {
  groups: readonly FocusPlanGroup[];
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const uid = useId();
  return <ul className="task-focus-plan-list">
    {groups.map((group, index) => {
      const panelId = `${uid}-group-${index}`;
      const expandable = group.subtasks.length > 0;
      const expanded = expandable && expandedIds.has(group.id);
      const stateLabel = group.recordedState === "completed" ? "Recorded done" : "Recorded open";
      const subtaskSummary = group.subtasks.length > 0
        ? `${group.subtaskCompleted} of ${group.subtaskTotal} subtasks done`
        : group.subtaskTotal > 0 ? `${group.subtaskTotal} subtask${group.subtaskTotal === 1 ? "" : "s"}` : null;
      const mark = <span className={`task-focus-plan-mark${group.recordedState === "completed" ? " is-done" : ""}`} aria-hidden="true">{group.recordedState === "completed" ? <Check size={13} /> : <Circle size={13} />}</span>;
      const copy = <span className="task-focus-plan-copy"><strong>{group.title}</strong>{subtaskSummary && <small>{subtaskSummary}</small>}</span>;
      return <li key={group.id} className="task-focus-plan-group">
        {expandable ? <button type="button" className="task-focus-plan-row" aria-expanded={expanded} aria-controls={panelId} onClick={() => onToggle(group.id)}>
          {mark}
          {copy}
          <small className="task-focus-plan-state">{stateLabel}</small>
          <ChevronDown size={15} aria-hidden="true" className={`task-focus-plan-chevron${expanded ? " is-open" : ""}`} />
        </button> : <div className="task-focus-plan-row is-static">
          {mark}
          {copy}
          <small className="task-focus-plan-state">{stateLabel}</small>
        </div>}
        {!expandable && group.subtaskTotal > 0 && <p className="task-focus-subtask-more">Subtasks are available in the task details.</p>}
        {expandable && <div id={panelId} className="task-focus-subtasks" data-open={expanded ? "true" : undefined} aria-hidden={expanded ? undefined : true} role="group" aria-label={`${group.title} subtasks`}>
          <div className="task-focus-subtasks-clip">
            <ul className="task-focus-subtask-list">
              {group.subtasks.map((subtask) => <li key={subtask.id} className={`task-focus-subtask${subtask.planned ? " is-planned" : ""}`}>
                <span className={`task-focus-subtask-mark${subtask.completed ? " is-done" : ""}`} aria-hidden="true">{subtask.completed ? <Check size={11} /> : <Circle size={11} />}</span>
                <span>{subtask.title}</span>
                <small>{subtask.completed ? "Done" : subtask.planned ? "Planned" : "Open"}</small>
              </li>)}
            </ul>
            {group.subtasksTruncated && <p className="task-focus-subtask-more">Showing {group.subtasks.length} of {group.subtaskTotal} subtasks.</p>}
          </div>
        </div>}
      </li>;
    })}
  </ul>;
}

export function TaskFocusDetails({ text, provenance, date, historical, plan, tasks = [], onEdit, children }: {
  text: string; provenance: string; date: string; historical: boolean; plan: DailyPlan | null; tasks?: readonly TaskRow[]; onEdit: () => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useModalScrollLock(open);
  const planGroups = buildFocusPlan(plan, tasks);

  useEffect(() => {
    if (!open || closing || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    // Land on the dialog itself so the title is announced without painting a
    // focus ring on the close control; Tab enters the controls from here.
    dialog.current.focus({ preventScroll: true });
  }, [open, closing]);
  useEffect(() => {
    if (!open) return;
    // Keep Shift+Tab and a focus that has fallen to the document inside the
    // top layer; the native dialog handles the middle of the tab order.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const onDialog = active === dialog.current;
      if (event.shiftKey && (active === first || onDialog || !dialog.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || onDialog || !dialog.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const openDialog = () => {
    if (open) return;
    setExpandedIds(new Set());
    setClosing(false);
    setOpen(true);
  };
  const closeNow = (after?: () => void) => {
    if (dialog.current?.open) dialog.current.close();
    setOpen(false);
    setClosing(false);
    trigger.current?.focus({ preventScroll: true });
    after?.();
  };
  const dismiss = (after?: () => void) => {
    if (closing) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      closeNow(after);
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(() => { closeTimer.current = null; closeNow(after); }, 180);
  };
  const toggleGroup = (id: string) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return <>
    <section className={`panel task-agenda-strip ${historical ? "historical" : ""}`} aria-label="Agenda" onClick={(event) => {
      if (!(event.target as Element).closest("button, a, input, select, textarea")) openDialog();
    }}>
      {children}
      <button ref={trigger} className="task-focus-details-trigger" type="button" aria-haspopup="dialog" aria-label="Open focus details" title="Open focus details" onClick={openDialog}><span className="task-focus-details-label">Open focus</span><ChevronRight size={16} aria-hidden="true" /></button>
    </section>
    {open && <dialog ref={dialog} tabIndex={-1} className={`task-focus-dialog${closing ? " is-closing" : ""}`} aria-labelledby="task-focus-dialog-title" onCancel={(event) => { event.preventDefault(); dismiss(); }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
    }}>
      <header><div><small>{date} <span className="task-focus-date-separator">/</span> {historical ? "Workday" : "My day"}</small><h2 id="task-focus-dialog-title">{historical ? "Workday focus" : "Today’s focus"}</h2></div><button type="button" aria-label="Close focus details" title="Close focus details" onClick={() => dismiss()}><X size={18} /></button></header>
      <div className="task-focus-dialog-body">
        <section className="task-focus-statement"><div className="task-focus-statement-heading"><span className="task-focus-target"><Target size={18} aria-hidden="true" /></span><span>The focus</span></div><p>{text}</p><small>{provenance}</small></section>
        <section className="task-focus-plan" aria-label="Selected planned tasks"><div className="task-focus-plan-heading"><div><h3>On the plan</h3><p>{plan ? planGroups.total ? `${planGroups.completed} of ${planGroups.total} recorded done` : "No items were selected for this plan." : "No plan recorded for this day"}</p></div>{planGroups.total > 0 && <span aria-label={`${planGroups.total} planned tasks`}>{planGroups.total}</span>}</div>
          {planGroups.total > 0 ? <FocusPlanList groups={planGroups.groups} expandedIds={expandedIds} onToggle={toggleGroup} /> : <p className="task-focus-plan-empty">{plan ? "No items were selected for this plan." : "Your focus is available above."}</p>}
        </section>
      </div>
      {!historical && <footer><button type="button" onClick={() => dismiss(onEdit)}>Edit focus</button></footer>}
    </dialog>}
  </>;
}
