import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Target, X } from "lucide-react";
import type { DailyPlan } from "./types";

/** The focus strip keeps its own actions; its remaining surface opens the full note. */
export function TaskFocusDetails({ text, provenance, date, historical, plan, onEdit, children }: {
  text: string; provenance: string; date: string; historical: boolean; plan: DailyPlan | null; onEdit: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  const dismiss = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  const planItems = (plan?.items ?? []).filter((item) => item.disposition === "selected").slice().sort((a, b) => a.rank - b.rank);
  return <>
    <section className={`panel task-agenda-strip ${historical ? "historical" : ""}`} aria-label="Agenda" onClick={(event) => {
      if (!(event.target as Element).closest("button, a, input, select, textarea")) setOpen(true);
    }}>
      {children}
      <button ref={trigger} className="task-focus-details-trigger" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>View focus details</button>
    </section>
    {open && <dialog ref={dialog} className="task-focus-dialog" aria-labelledby="task-focus-dialog-title" onCancel={(event) => { event.preventDefault(); dismiss(); }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
    }}>
      <header><div><small>{date} <span className="task-focus-date-separator">/</span> {historical ? "Workday" : "My day"}</small><h2 id="task-focus-dialog-title">{historical ? "Workday focus" : "Today’s focus"}</h2></div><button type="button" aria-label="Close focus details" autoFocus onClick={dismiss}><X size={18} /></button></header>
      <div className="task-focus-dialog-body">
        <section className="task-focus-statement"><div className="task-focus-statement-heading"><span className="task-focus-target"><Target size={18} aria-hidden="true" /></span><span>The focus</span></div><p>{text}</p><small>{provenance}</small></section>
        <section className="task-focus-plan" aria-label="Selected plan items"><div className="task-focus-plan-heading"><div><h3>On the plan</h3><p>{plan ? "Items selected for this workday" : "No plan recorded for this day"}</p></div>{planItems.length > 0 && <span>{planItems.length}</span>}</div>
          {planItems.length > 0 ? <ul>{planItems.map((item) => <li key={item.id}><span className={`task-focus-plan-mark${item.completion_state === "completed" ? " is-done" : ""}`}>{item.completion_state === "completed" ? <Check size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}</span><span>{item.title_snapshot || "Untitled plan item"}</span><small>{item.completion_state === "completed" ? "Recorded done" : "Recorded open"}</small></li>)}</ul> : <p className="task-focus-plan-empty">{plan ? "No items were selected for this plan." : "Your focus is available above."}</p>}
        </section>
      </div>
      {!historical && <footer><button type="button" onClick={() => { dismiss(); onEdit(); }}>Edit focus</button></footer>}
    </dialog>}
  </>;
}
