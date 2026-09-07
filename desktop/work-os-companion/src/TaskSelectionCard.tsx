import { useEffect, useState, type CSSProperties } from "react";
import { AlertTriangle, Check, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText } from "./taskWorkspace";

export type TaskSelectionCardTask = {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  projectName?: string | null;
  priority?: string | null;
  state?: string;
};

export type TaskSelectionCardStatus = "ready" | "loading" | "error";

export type TaskSelectionCardProps = {
  tasks: readonly TaskSelectionCardTask[];
  onMarkSelectedDone: (taskIds: string[]) => void;
  title?: string;
  status?: TaskSelectionCardStatus;
  degraded?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  dense?: boolean;
  maxHeight?: number;
  emptyTitle?: string;
  emptyMessage?: string;
};

/**
 * A local selection surface only. Completion is intentionally delegated to the
 * parent so this component never claims that a provider mutation succeeded.
 */
export function TaskSelectionCard({
  tasks,
  onMarkSelectedDone,
  title = "Pending tasks",
  status = "ready",
  degraded = false,
  errorMessage = "Could not load tasks. Try again.",
  onRetry,
  dense = false,
  maxHeight = 372,
  emptyTitle = "No pending tasks",
  emptyMessage = "Tasks waiting to be completed will appear here.",
}: TaskSelectionCardProps) {
  const listedTasks: TaskSelectionCardTask[] = [];
  const knownIds = new Set<string>();
  for (const task of tasks) {
    if (task.id && !knownIds.has(task.id)) {
      knownIds.add(task.id);
      listedTasks.push(task);
    }
  }
  const taskIdsKey = listedTasks.map((task) => task.id).join("\u0000");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
    setConfirming(false);
  }, [taskIdsKey]);

  const selectedTasks = listedTasks.filter((task) => selectedIds.has(task.id));
  const loading = status === "loading";
  const failed = status === "error";
  const contentId = "task-selection-card-content";
  const cardStyle = { "--task-selection-card-height": `${maxHeight}px` } as CSSProperties;

  const toggle = (taskId: string) => {
    setConfirming(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const confirmDone = () => {
    if (!selectedTasks.length) return;
    setConfirming(false);
    onMarkSelectedDone(selectedTasks.map((task) => task.id));
  };

  return <section className={`task-selection-card ${dense ? "is-dense" : ""}`} style={cardStyle} aria-labelledby="task-selection-card-title" aria-busy={loading}>
    <header className="task-selection-card-header">
      <div><span>Task selection</span><h2 id="task-selection-card-title">{title}</h2></div>
      <output className="task-selection-count" htmlFor={contentId} aria-live="polite">{selectedTasks.length} selected</output>
    </header>
    {degraded && !loading && !failed && <p className="task-selection-notice degraded" role="status"><AlertTriangle size={15} aria-hidden="true" />Showing the last available task details.</p>}
    <div className="task-selection-scroll" id={contentId}>
      {loading ? <div className="task-selection-loading" role="status"><span className="task-selection-skeleton" /><span className="task-selection-skeleton" /><span className="task-selection-skeleton" /><span className="sr-only">Loading tasks</span></div>
        : failed ? <div className="task-selection-state error" role="alert"><CircleAlert size={21} aria-hidden="true" /><strong>Tasks are unavailable</strong><p>{errorMessage}</p>{onRetry && <button type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button>}</div>
          : listedTasks.length === 0 ? <div className="task-selection-state empty"><ListChecks size={21} aria-hidden="true" /><strong>{emptyTitle}</strong><p>{emptyMessage}</p></div>
            : <ul className="task-selection-list">{listedTasks.map((task) => {
              const titleText = safeTaskText(task.title, "Untitled Nifty task");
              const overdue = task.state === "overdue";
              const metadata = [
                task.projectName ? safeTaskText(task.projectName, "Nifty") : "Nifty",
                task.priority ? `${task.priority} priority` : null,
                task.dueDate ? `Due ${formatWorkOsDate(task.dueDate)}` : overdue ? "Overdue" : null,
              ].filter(Boolean).join(" · ");
              return <li className={`task-selection-row ${overdue ? "is-overdue" : ""}`} key={task.id}>
                <label><input type="checkbox" checked={selectedIds.has(task.id)} onChange={() => toggle(task.id)} aria-label={`Select ${titleText}`} /><span className="task-selection-checkbox" aria-hidden="true"><Check size={14} /></span><span className="task-selection-copy"><strong>{titleText}</strong>{task.description && <small>{safeTaskText(task.description, "No description added.")}</small>}<em>{metadata}</em></span></label>
                <span className={`task-selection-state-label ${overdue ? "overdue" : "pending"}`}>{overdue ? "Overdue" : "Pending"}</span>
              </li>;
            })}</ul>}
    </div>
    <footer className="task-selection-card-footer"><small>{confirming ? `Confirm marking ${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} done? Proposals are created for your approval.` : selectedTasks.length ? `${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} selected. Review them, then confirm.` : "Select one or more tasks to continue."}</small>{confirming
      ? <><button className="ghost" type="button" onClick={() => setConfirming(false)}>Back</button><button className="primary" type="button" disabled={loading || failed || selectedTasks.length === 0} onClick={confirmDone}><Check size={15} aria-hidden="true" />Confirm Done</button></>
      : <button className="primary" type="button" disabled={loading || failed || selectedTasks.length === 0} onClick={() => setConfirming(true)}><Check size={15} aria-hidden="true" />Mark selected done</button>}</footer>
  </section>;
}
