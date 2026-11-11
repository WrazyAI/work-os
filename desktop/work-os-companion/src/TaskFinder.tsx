import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, Check, ChevronDown, Search, X } from "lucide-react";
import { TASK_FINDER_STATUSES, type TaskFinderFilters } from "../../../src/modules/work-os/task-finder";
import { taskDisplayState } from "../../../src/lib/work-os-task-permissions";
import { formatWorkOsFullDate } from "./dateFormat";
import { TaskListSkeleton } from "./LoadingUi";
import { useModalScrollLock } from "./modalScrollLock";
import { safeTaskText, type TaskRow } from "./taskWorkspace";
import { taskFinderDatePreset, taskFinderRangeError } from "./taskFinder";
import { useTaskFinderQuery, type TaskFinderSource } from "./workOsQueries";
import "./task-finder.css";

const EMPTY: TaskFinderFilters = { search: "", status: "all", from: "", to: "" };

type ResultProps = {
  tasks: TaskRow[]; currentDate: string; loading: boolean; error: boolean; filtered: boolean; total: number;
  hasMore: boolean; loadingMore: boolean; loadMoreError: boolean;
  onRetry: () => void; onReset: () => void; onLoadMore: () => void; onOpen: (task: TaskRow) => void;
};

export function TaskFinderResults(props: ResultProps) {
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

export function TaskFinder({ entry, currentDate, scope, source, onClose, onOpenTask }: {
  entry: "search" | "date"; currentDate: string; scope?: string; source?: TaskFinderSource;
  onClose: () => void; onOpenTask: (task: TaskRow) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const [filters, setFilters] = useState<TaskFinderFilters>(EMPTY);
  const [debounced, setDebounced] = useState("");
  const [composing, setComposing] = useState(false);
  const [datesOpen, setDatesOpen] = useState(entry === "date");
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useModalScrollLock(true);
  const dateError = taskFinderRangeError(filters.from, filters.to);
  const waitingForText = composing || debounced !== filters.search.trim();
  const query = useTaskFinderQuery({ enabled: !dateError && !waitingForText && !closing, currentDate, scope, source, filters: { ...filters, search: debounced, ...(dateError ? { from: "", to: "" } : {}) } });
  const tasks = dateError || waitingForText ? [] : query.data?.pages.flatMap(page => page.tasks) ?? [];
  const total = dateError || waitingForText ? 0 : query.data?.pages[0]?.totalCount ?? 0;
  const filtered = !!filters.search.trim() || filters.status !== "all" || !!filters.from || !!filters.to;

  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setDebounced(filters.search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search, composing]);

  useEffect(() => {
    const dialog = dialogRef.current;
    originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    (entry === "date" ? dateRef.current : inputRef.current)?.focus();
    return () => { dialog?.close(); if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, [entry]);

  function finish(task?: TaskRow) {
    dialogRef.current?.close();
    originRef.current?.focus({ preventScroll: true });
    onClose();
    // Let the finder unmount and its scroll lock release before opening the
    // existing task drawer, whose own focus lifecycle then becomes the owner.
    if (task) requestAnimationFrame(() => onOpenTask(task));
  }
  function dismiss() {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    setClosing(true);
    closeTimer.current = setTimeout(() => finish(), 160);
  }
  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (composing || event.nativeEvent.isComposing || waitingForText || dateError) return;
    if (event.key === "ArrowDown") {
      const first = dialogRef.current?.querySelector<HTMLButtonElement>(".task-finder-result");
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === "Enter" && tasks[0]) { event.preventDefault(); finish(tasks[0]); }
  }
  return createPortal(<dialog ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className={`task-finder-dialog${closing ? " is-closing" : ""}`}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <section className="task-finder-panel">
      <header className="task-finder-heading"><div><h2 id={`${id}-title`}>Find a task</h2><p>Across all your tasks</p></div><button type="button" className="task-finder-close" aria-label="Close task search" title="Close task search" onClick={dismiss}><X size={18} /></button></header>
      <div className="task-finder-controls">
        <label className="task-finder-search"><Search size={21} aria-hidden="true" /><span className="sr-only">Search all your tasks</span><input ref={inputRef} value={filters.search} maxLength={200} placeholder="What are you looking for?" autoComplete="off" onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={searchKeys} />{filters.search && <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { setFilters(value => ({ ...value, search: "" })); inputRef.current?.focus(); }}><X size={16} /></button>}</label>
        <div className="task-finder-statuses" role="group" aria-label="Task status">{TASK_FINDER_STATUSES.map(item => <button type="button" key={item.value} aria-pressed={filters.status === item.value} onClick={() => setFilters(value => ({ ...value, status: item.value }))}>{filters.status === item.value && <Check size={12} aria-hidden="true" />}{item.label}</button>)}</div>
        <div className="task-finder-date-row"><button type="button" className="task-finder-date-toggle" aria-expanded={datesOpen} aria-controls={`${id}-dates`} onClick={() => setDatesOpen(value => !value)}><CalendarDays size={15} aria-hidden="true" />Task date{!filters.from && !filters.to && <span>Any time</span>}<ChevronDown size={13} aria-hidden="true" /></button>{(filters.from || filters.to) && <button type="button" className="task-finder-date-chip" aria-label="Clear date range" title="Clear date range" onClick={() => setFilters(value => ({ ...value, from: "", to: "" }))}>{filters.from ? formatWorkOsFullDate(filters.from) : "Any start"} – {filters.to ? formatWorkOsFullDate(filters.to) : "Any end"}<X size={12} aria-hidden="true" /></button>}</div>
        <div id={`${id}-dates`} className="task-finder-dates" hidden={!datesOpen}>
          <div className="task-finder-presets" role="group" aria-label="Date shortcuts">{([ ["today", "Today"], ["this_week", "This week"], ["last_week", "Last week"] ] as const).map(([preset, label]) => <button type="button" key={preset} onClick={() => setFilters(value => ({ ...value, ...taskFinderDatePreset(preset, currentDate) }))}>{label}</button>)}<button type="button" onClick={() => dateRef.current?.focus()}>Custom range</button></div>
          <div className="task-finder-date-fields"><label>From<input ref={dateRef} type="date" value={filters.from} aria-invalid={!!dateError} aria-describedby={dateError ? `${id}-date-error` : `${id}-date-note`} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))} /></label><span aria-hidden="true">–</span><label>To<input type="date" value={filters.to} aria-invalid={!!dateError} aria-describedby={dateError ? `${id}-date-error` : `${id}-date-note`} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))} /></label></div>
          <p id={`${id}-date-note`}>Uses the task’s attributed workday: its due date, recorded completion or creation date.</p>
          {dateError && <p id={`${id}-date-error`} className="task-finder-date-error" role="alert">{dateError}</p>}
        </div>
      </div>
      {dateError ? <div className="task-finder-empty"><p>Adjust your dates to see matching tasks.</p></div> : <TaskFinderResults tasks={tasks} currentDate={currentDate} loading={query.isPending || waitingForText} error={query.isError && !query.isFetchNextPageError} filtered={filtered} total={total} hasMore={!!query.hasNextPage && !waitingForText} loadingMore={query.isFetchingNextPage} loadMoreError={query.isFetchNextPageError} onRetry={() => void query.refetch()} onReset={() => { setFilters(EMPTY); setDebounced(""); inputRef.current?.focus(); }} onLoadMore={() => { if (!query.isFetching) void query.fetchNextPage(); }} onOpen={task => finish(task)} />}
      <footer className="task-finder-footer"><span><ArrowUp size={12} aria-hidden="true" /><ArrowDown size={12} aria-hidden="true" /> Navigate <kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
    </section>
  </dialog>, document.body);
}
