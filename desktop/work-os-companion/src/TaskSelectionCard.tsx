import { useEffect, useId, useState } from "react";
import { AlertTriangle, Check, ChevronDown, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
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

/** Collapsed summary line and post-submit receipt text. Pure for testability. */
export function taskSelectionSummaryText(input: {
  selected: number;
  proposed: number;
  sentCount: number;
  approvalLocation: string;
}): string {
  if (input.sentCount > 0) {
    return `${input.sentCount} completion proposal${input.sentCount === 1 ? "" : "s"} created — review and approve ${input.approvalLocation}.`;
  }
  return [
    input.selected ? `${input.selected} selected` : null,
    input.proposed ? `${input.proposed} proposed` : null,
  ].filter(Boolean).join(" · ");
}

export type TaskSelectionCardProps = {
  tasks: readonly TaskSelectionCardTask[];
  onMarkSelectedDone: (taskIds: string[]) => void | Promise<void>;
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
  /** Task ids that already have completion proposals awaiting approval. */
  proposedTaskIds?: readonly string[];
  /** Where approvals live, used in the receipt sentence. */
  approvalLocation?: string;
  /** Renders a receipt action that reveals the approval flow. */
  onReview?: () => void;
  reviewLabel?: string;
};

/**
 * A local selection surface only. Completion is intentionally delegated to the
 * parent so this component never claims that a provider mutation succeeded.
 * Two explicit loops: checking rows only arms the footer; `Confirm Done` files
 * the proposals (design §25.7, §25.10). The card is collapsible at every state,
 * auto-collapses to a receipt after proposals are created, and marks rows that
 * already have proposals pending approval.
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
  proposedTaskIds,
  approvalLocation = "in Chat",
  onReview,
  reviewLabel = "Review in Chat",
}: TaskSelectionCardProps) {
  const listedTasks: TaskSelectionCardTask[] = [];
  const knownIds = new Set<string>();
  for (const task of tasks) {
    if (task.id && !knownIds.has(task.id)) {
      knownIds.add(task.id);
      listedTasks.push(task);
    }
  }
  const proposedIds = new Set(proposedTaskIds ?? []);
  const taskIdsKey = listedTasks.map((task) => task.id).join("\u0000");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "overdue">("all");
  const [collapsed, setCollapsed] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const uid = useId();

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
    setConfirming(false);
    setSubmitState("idle");
    setSubmitError(null);
    setSentCount(0);
    setCollapsed(false);
  }, [taskIdsKey]);

  const selectedTasks = listedTasks.filter((task) => selectedIds.has(task.id) && !proposedIds.has(task.id));
  const loading = status === "loading";
  const failed = status === "error";
  const sending = submitState === "sending";
  const contentId = `${uid}-content`;
  const titleId = `${uid}-title`;
  const canConfirm = !loading && !failed && !sending && selectedTasks.length > 0;
  const proposedCount = listedTasks.filter((task) => proposedIds.has(task.id)).length;
  const filteredTasks = listedTasks.filter((task) => filter === "all" || (filter === "overdue" ? task.state === "overdue" : task.state !== "overdue"));
  const filterOptions = [
    { key: "all" as const, label: "All", count: listedTasks.length },
    { key: "pending" as const, label: "Pending", count: listedTasks.filter((task) => task.state !== "overdue").length },
    { key: "overdue" as const, label: "Overdue", count: listedTasks.filter((task) => task.state === "overdue").length },
  ];

  const summary = taskSelectionSummaryText({ selected: selectedTasks.length, proposed: proposedCount, sentCount, approvalLocation });

  const toggle = (taskId: string) => {
    if (proposedIds.has(taskId) || sending) return;
    setConfirming(false);
    setSubmitError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const confirmDone = async () => {
    if (!selectedTasks.length || sending) return;
    const count = selectedTasks.length;
    setConfirming(false);
    setSubmitError(null);
    setSubmitState("sending");
    try {
      await onMarkSelectedDone(selectedTasks.map((task) => task.id));
      setSentCount(count);
      setSelectedIds(new Set());
      setSubmitState("sent");
      setCollapsed(true);
    } catch (value) {
      setSubmitState("idle");
      setSubmitError(value instanceof Error ? value.message : "Could not create the completion proposals.");
    }
  };

  const hint = submitError
    ? submitError
    : submittingHint(sending, confirming, selectedTasks.length);

  return (
    <section
      className={cx(
        "chat-task-card flex w-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-card",
        dense && "is-dense",
        presentation === "table" && "is-table",
        confirming && "is-confirming",
        collapsed && "is-collapsed",
      )}
      aria-labelledby={titleId}
      aria-busy={loading || sending}
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 id={titleId} title={title} className="m-0 min-w-0 flex-1">
          <button
            type="button"
            className="chat-task-toggle flex w-full items-start gap-2 text-left"
            aria-label={`${title}: show or hide task list`}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-ink-3">Task selection</span>
              <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
              {collapsed && submitState !== "sent" && summary && (
                <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">{summary}</span>
              )}
            </span>
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={cx("chat-task-chevron mt-0.5 shrink-0 text-ink-3 transition-transform duration-150", !collapsed && "is-open")}
            />
          </button>
        </h2>
        <output
          className="shrink-0 rounded-full bg-inset px-2 py-1 text-[10px] font-bold tabular-nums text-ink-2"
          htmlFor={contentId}
          aria-live="polite"
        >
          {selectedTasks.length} selected
        </output>
      </header>

      {submitError && (
        <p className="m-0 flex shrink-0 items-center gap-1.5 border-b border-line bg-danger-tint/40 px-3 py-1.5 text-[11px] leading-snug text-danger" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {submitError}
        </p>
      )}

      {submitState === "sent" && (
        <p className="m-0 flex shrink-0 items-center gap-1.5 border-b border-line bg-accent-tint/40 px-3 py-1.5 text-[11px] leading-snug text-ink-2" role="status">
          <Check size={13} aria-hidden="true" />
          <span className="min-w-0 flex-1">{summary}</span>
          {onReview && (
            <button
              type="button"
              className="chat-task-review shrink-0 rounded-[7px] border border-line bg-white px-2 py-0.5 text-[10.5px] font-semibold text-ink-2 transition-colors hover:border-signal-strong hover:text-ink"
              onClick={onReview}
            >
              {reviewLabel}
            </button>
          )}
        </p>
      )}

      <div id={contentId} className={cx(collapsed ? "hidden" : "flex min-h-0 flex-col")} hidden={collapsed}>
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
                    const proposed = proposedIds.has(task.id);
                    const selected = selectedIds.has(task.id) && !proposed;
                    return (
                      <label key={task.id} className={cx("chat-task-table-row", selected && "is-selected", proposed && "is-proposed")} role="row">
                        <span role="cell" className="chat-task-check">
                          <input type="checkbox" className="peer sr-only" checked={selected} disabled={proposed || sending} onChange={() => toggle(task.id)} aria-label={proposed ? `${titleText} already has a pending proposal` : `Select ${titleText}`} />
                          <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                        </span>
                        <span role="cell" className="chat-task-table-title" title={task.description ? safeTaskText(task.description, "") : titleText}><strong>{titleText}</strong>{task.description ? <small>{safeTaskText(task.description, "")}</small> : null}</span>
                        <span role="cell" className={overdue ? "is-overdue" : ""}>{task.dueDate ? formatWorkOsDate(task.dueDate) : "No date"}</span>
                        <span role="cell"><em className={proposed ? "is-proposed" : overdue ? "is-overdue" : "is-pending"}>{proposed ? "Proposed" : overdue ? "Overdue" : "Pending"}</em></span>
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
                const proposed = proposedIds.has(task.id);
                const selected = selectedIds.has(task.id) && !proposed;
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
                      selected ? "bg-accent-tint/50" : proposed ? "opacity-70" : "hover:bg-hover",
                    )}
                  >
                    <label className={cx("flex min-w-0 flex-1 items-start gap-2.5", proposed || sending ? "cursor-default" : "cursor-pointer")}>
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={selected}
                        disabled={proposed || sending}
                        onChange={() => toggle(task.id)}
                        aria-label={proposed ? `${titleText} already has a pending proposal` : `Select ${titleText}`}
                      />
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-white text-transparent transition-colors duration-150 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal-strong peer-disabled:opacity-40"
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
                        proposed ? "bg-accent-tint text-ink-2" : overdue ? "bg-danger-tint text-danger" : "bg-inset text-ink-2",
                      )}
                    >
                      {proposed ? "Proposed" : overdue ? "Overdue" : "Pending"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
          <small className={cx("min-w-0 flex-1 text-[11px] leading-snug", submitError ? "text-danger" : "text-ink-2")}>{hint}</small>
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
                  onClick={() => void confirmDone()}
                >
                  <Check size={14} aria-hidden="true" />{sending ? "Sending…" : "Confirm Done"}
                </button>
              </>
            ) : (
              <button
                className="task-selection-primary inline-flex min-h-[32px] items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[11.5px] font-semibold text-white transition-transform enabled:active:scale-[0.97] disabled:cursor-default disabled:bg-line disabled:text-ink-2"
                type="button"
                disabled={!canConfirm}
                onClick={() => setConfirming(true)}
              >
                <Check size={14} aria-hidden="true" />{sending ? "Sending…" : "Mark selected done"}
              </button>
            )}
          </span>
        </footer>
      </div>
    </section>
  );
}

function submittingHint(sending: boolean, confirming: boolean, selectedCount: number): string {
  if (sending) return "Creating completion proposals for your approval…";
  if (confirming) return `Confirm marking ${selectedCount} task${selectedCount === 1 ? "" : "s"} done? Proposals are created for your approval.`;
  if (selectedCount) return `${selectedCount} task${selectedCount === 1 ? "" : "s"} selected. Review them, then confirm.`;
  return "Select one or more tasks to continue.";
}
