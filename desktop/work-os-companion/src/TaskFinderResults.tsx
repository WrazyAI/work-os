import type { KeyboardEvent } from "react";
import { ArrowUpRight, Check, Search } from "lucide-react";
import { taskDisplayState } from "../../../src/lib/work-os-task-permissions";
import { formatWorkOsFullDate } from "./dateFormat";
import { TaskListSkeleton } from "./LoadingUi";
import { safeTaskText, type TaskRow } from "./taskWorkspace";

export type TaskFinderResultProps = {
  tasks: TaskRow[]; currentDate: string; loading: boolean; error: boolean; filtered: boolean; total: number;
  hasMore: boolean; loadingMore: boolean; loadMoreError: boolean;
  onRetry: () => void; onReset: () => void; onLoadMore: () => void; onOpen: (task: TaskRow) => void;
};

/** The finder's result lane is a pure render seam: keeping it out of the
 * dialog module lets render tests exercise loading, empty and failure states
 * without loading the query and modal dependencies. */
export function TaskFinderResults(props: TaskFinderResultProps) {
  const { tasks, currentDate, total } = props;
  function moveResult(event: KeyboardEvent<HTMLUListElement>) {
    if (event.nativeEvent.isComposing || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".task-finder-result"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
  }
  return <>
    <div className="task-finder-count" role="status" aria-live="polite">
      {props.loading ? "Finding your tasks…" : props.error && !tasks.length ? "Search unavailable" : `Showing ${tasks.length.toLocaleString()} of ${total.toLocaleString()} task${total === 1 ? "" : "s"}`}
    </div>
    <div className="task-finder-results">
      {props.loading ? <TaskListSkeleton rows={4} /> : <>
        {props.error && <div className="task-finder-notice" role="alert"><p>Tasks couldn’t be loaded. Your search is kept.</p><button type="button" onClick={props.onRetry}>Try again</button></div>}
        {!props.error && !tasks.length && <div className="task-finder-empty"><Search size={24} aria-hidden="true" /><h3>{props.filtered ? "No matching tasks" : "No tasks yet"}</h3><p>{props.filtered ? "Try another phrase, status or date range." : "Your tasks will appear here when they’re added."}</p>{props.filtered && <button type="button" onClick={props.onReset}>Reset filters</button>}</div>}
        <ul className="task-finder-list" aria-label="Task search results" onKeyDown={moveResult}>
          {tasks.map(task => {
            const state = taskDisplayState(task, currentDate);
            const label = { complete: "Done", overdue: "Overdue", in_progress: "In progress", pending: "Pending" }[state];
            const title = safeTaskText(task.title, "Untitled task");
            return <li key={String(task.id)}><button type="button" className="task-finder-result" onClick={() => props.onOpen(task)}>
              <span className={`task-finder-mark ${state === "complete" ? "is-done" : ""}`} aria-hidden="true">{state === "complete" ? <Check size={14} /> : <span />}</span>
              <span className="task-finder-copy"><strong>{title}</strong><small>{safeTaskText(task.project?.name, "Work OS")}{task.description ? ` · ${safeTaskText(task.description, "")}` : ""}</small></span>
              <span className="task-finder-meta"><span className={`task-state ${state}`}>{label}</span><span>{task.due_date ? formatWorkOsFullDate(task.due_date) : "No due date"}</span></span>
              <ArrowUpRight size={15} className="task-finder-open" aria-hidden="true" />
            </button></li>;
          })}
        </ul>
        {props.hasMore && <button type="button" className="task-finder-more" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.loadingMore ? "Loading tasks…" : props.loadMoreError ? "Retry load more" : "Load more"}</button>}
      </>}
    </div>
  </>;
}
