import { useEffect, useId, useState } from "react";
import { AlertTriangle, Check, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText } from "./taskWorkspace";
import { cx } from "./chat/cx";

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
  presentation?: "list" | "table";
  maxHeight?: number;
  emptyTitle?: string;
  emptyMessage?: string;
};

/**
 * A local selection surface only. Completion is intentionally delegated to the
 * parent so this component never claims that a provider mutation succeeded.
 * Two explicit loops: checking rows only arms the footer; `Confirm Done` files
 * the proposals (design §25.7, §25.10).
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
  presentation = "list",
  maxHeight = 320,
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
  const [filter, setFilter] = useState<"all" | "pending" | "overdue">("all");
  const uid = useId();

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
    setConfirming(false);
  }, [taskIdsKey]);

  const selectedTasks = listedTasks.filter((task) => selectedIds.has(task.id));
  const loading = status === "loading";
  const failed = status === "error";
  const contentId = `${uid}-content`;
  const titleId = `${uid}-title`;
  const canConfirm = !loading && !failed && selectedTasks.length > 0;
  const filteredTasks = listedTasks.filter((task) => filter === "all" || (filter === "overdue" ? task.state === "overdue" : task.state !== "overdue"));
  const filterOptions = [
    { key: "all" as const, label: "All", count: listedTasks.length },
    { key: "pending" as const, label: "Pending", count: listedTasks.filter((task) => task.state !== "overdue").length },
    { key: "overdue" as const, label: "Overdue", count: listedTasks.filter((task) => task.state === "overdue").length },
  ];

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

  const hint = confirming
    ? `Confirm marking ${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} done? Proposals are created for your approval.`
    : selectedTasks.length
      ? `${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} selected. Review them, then confirm.`
      : "Select one or more tasks to continue.";

  return (
    <section
      className={cx(
        "chat-task-card flex w-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-card",
        dense && "is-dense",
        presentation === "table" && "is-table",
        confirming && "is-confirming",
      )}
      aria-labelledby={titleId}
      aria-busy={loading}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-ink-3">Task selection</span>
          <h2 id={titleId} title={title} className="m-0 truncate text-[13px] font-semibold text-ink">
            {title}
          </h2>
        </div>
        <output
          className="shrink-0 rounded-full bg-inset px-2 py-1 text-[10px] font-bold tabular-nums text-ink-2"
          htmlFor={contentId}
          aria-live="polite"
        >
          {selectedTasks.length} selected
        </output>
      </header>

      {degraded && !loading && !failed && (
        <p
          className="m-0 flex shrink-0 items-center gap-1.5 border-b border-line bg-danger-tint/40 px-3 py-1.5 text-[11px] leading-snug text-ink-2"
          role="status"
        >
          <AlertTriangle size={13} aria-hidden="true" />
          Showing the last available task details.
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        id={contentId}
        style={{ maxHeight }}
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-3" role="status">
            <span className="h-10 animate-pulse rounded-[9px] bg-inset" />
            <span className="h-10 animate-pulse rounded-[9px] bg-inset" />
            <span className="h-10 animate-pulse rounded-[9px] bg-inset" />
            <span className="sr-only">Loading tasks</span>
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-7 text-center" role="alert">
            <span className="chat-turn-mark bg-danger-tint text-danger">
              <CircleAlert size={15} aria-hidden="true" />
            </span>
            <strong className="text-[13px] font-semibold text-ink">Tasks are unavailable</strong>
            <p className="m-0 max-w-[38ch] text-[11.5px] leading-snug text-ink-2">{errorMessage}</p>
            {onRetry && (
              <button
                type="button"
                className="mt-1 inline-flex min-h-[30px] items-center gap-1.5 rounded-[8px] border border-line bg-white px-2.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:border-signal-strong hover:text-ink"
                onClick={onRetry}
              >
                <RefreshCw size={13} aria-hidden="true" />Try again
              </button>
            )}
          </div>
        ) : listedTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-7 text-center">
            <span className="chat-turn-mark">
              <ListChecks size={15} aria-hidden="true" />
            </span>
            <strong className="text-[13px] font-semibold text-ink">{emptyTitle}</strong>
            <p className="m-0 max-w-[38ch] text-[11.5px] leading-snug text-ink-2">{emptyMessage}</p>
          </div>
        ) : presentation === "table" ? (
          <div className="chat-task-table-wrap">
            <nav className="chat-task-filters" aria-label="Filter tasks">
              {filterOptions.map((option) => (
                <button key={option.key} type="button" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
                  {option.key !== "all" ? <span className={`task-filter-dot is-${option.key}`} aria-hidden="true" /> : null}
                  {option.label}<em>{option.count}</em>
                </button>
              ))}
            </nav>
            {filteredTasks.length ? (
              <div className="chat-task-table" role="table" aria-label={title}>
                <div className="chat-task-table-head" role="row">
                  <span role="columnheader" aria-label="Select" />
                  <span role="columnheader">Task</span>
                  <span role="columnheader">Due</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Project</span>
                </div>
                {filteredTasks.map((task) => {
                  const titleText = safeTaskText(task.title, "Untitled Nifty task");
                  const overdue = task.state === "overdue";
                  const selected = selectedIds.has(task.id);
                  return (
                    <label key={task.id} className={cx("chat-task-table-row", selected && "is-selected")} role="row">
                      <span role="cell" className="chat-task-check">
                        <input type="checkbox" className="peer sr-only" checked={selected} onChange={() => toggle(task.id)} aria-label={`Select ${titleText}`} />
                        <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                      </span>
                      <span role="cell" className="chat-task-table-title" title={task.description ? safeTaskText(task.description, "") : titleText}><strong>{titleText}</strong>{task.description ? <small>{safeTaskText(task.description, "")}</small> : null}</span>
                      <span role="cell" className={overdue ? "is-overdue" : ""}>{task.dueDate ? formatWorkOsDate(task.dueDate) : "No date"}</span>
                      <span role="cell"><em className={overdue ? "is-overdue" : "is-pending"}>{overdue ? "Overdue" : "Pending"}</em></span>
                      <span role="cell" title={task.projectName ?? "Nifty"}>{task.projectName ? safeTaskText(task.projectName, "Nifty") : "Nifty"}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="chat-task-filter-empty" role="status"><ListChecks size={16} aria-hidden="true" /><strong>No {filter} tasks</strong><span>Choose another filter to see the remaining work.</span></div>
            )}
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {listedTasks.map((task) => {
              const titleText = safeTaskText(task.title, "Untitled Nifty task");
              const overdue = task.state === "overdue";
              const selected = selectedIds.has(task.id);
              const metadata = [
                task.projectName ? safeTaskText(task.projectName, "Nifty") : "Nifty",
                task.priority ? `${task.priority} priority` : null,
                task.dueDate ? `Due ${formatWorkOsDate(task.dueDate)}` : overdue ? "Overdue" : null,
              ].filter(Boolean).join(" · ");
              return (
                <li
                  key={task.id}
                  className={cx(
                    "flex min-h-[48px] items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 transition-colors",
                    selected ? "bg-accent-tint/50" : "hover:bg-hover",
                  )}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={selected}
                      onChange={() => toggle(task.id)}
                      aria-label={`Select ${titleText}`}
                    />
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-white text-transparent transition-colors duration-150 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal-strong"
                    >
                      <Check size={13} strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-semibold text-ink">{titleText}</strong>
                      {task.description && (
                        <small className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-ink-2">
                          {safeTaskText(task.description, "No description added.")}
                        </small>
                      )}
                      <em className="mt-0.5 block truncate text-[10.5px] not-italic text-ink-3">{metadata}</em>
                    </span>
                  </label>
                  <span
                    className={cx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                      overdue ? "bg-danger-tint text-danger" : "bg-inset text-ink-2",
                    )}
                  >
                    {overdue ? "Overdue" : "Pending"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <small className="min-w-0 flex-1 text-[11px] leading-snug text-ink-2">{hint}</small>
        <span className="flex shrink-0 items-center gap-1.5">
          {confirming ? (
            <>
              <button
                className="task-selection-secondary min-h-[32px] rounded-[9px] px-2.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                type="button"
                onClick={() => setConfirming(false)}
              >
                Back
              </button>
              <button
                className="task-selection-primary inline-flex min-h-[32px] items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[11.5px] font-semibold text-white transition-transform enabled:active:scale-[0.97] disabled:cursor-default disabled:bg-line disabled:text-ink-2"
                type="button"
                disabled={!canConfirm}
                onClick={confirmDone}
              >
                <Check size={14} aria-hidden="true" />Confirm Done
              </button>
            </>
          ) : (
            <button
              className="task-selection-primary inline-flex min-h-[32px] items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[11.5px] font-semibold text-white transition-transform enabled:active:scale-[0.97] disabled:cursor-default disabled:bg-line disabled:text-ink-2"
              type="button"
              disabled={!canConfirm}
              onClick={() => setConfirming(true)}
            >
              <Check size={14} aria-hidden="true" />Mark selected done
            </button>
          )}
        </span>
      </footer>
    </section>
  );
}
