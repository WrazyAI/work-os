import { Fragment, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText } from "./taskWorkspace";
import { cx } from "./chat/cx";

export type TaskSelectionCardSubtask = {
  id: string;
  title: string;
  completed?: boolean;
};

export type TaskSelectionCardTask = {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  projectName?: string | null;
  priority?: string | null;
  state?: string;
  /** Known child count so a disclosure only appears on real parents. */
  subtaskTotal?: number;
  subtaskCompleted?: number;
  /** Children already available (the companion's day payload supplies them). */
  subtasks?: readonly TaskSelectionCardSubtask[];
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
  onMarkSelectedDone: (tasks: Array<{ id: string; title: string }>) => void | Promise<void>;
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
  /** Lazily loads a parent's subtasks the first time its row expands. */
  onLoadSubtasks?: (taskId: string) => Promise<readonly TaskSelectionCardSubtask[]>;
  /** Collapses the whole card to its summary once the thread moves on. */
  collapseWhenInactive?: boolean;
};

function statusChipClass(state: string | undefined, proposed: boolean) {
  return cx(
    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
    proposed ? "bg-accent-tint text-ink-2" : state === "overdue" ? "bg-danger-tint text-danger" : "bg-inset text-ink-2",
  );
}

/**
 * A local selection surface only. Completion is intentionally delegated to the
 * parent so this component never claims that a provider mutation succeeded.
 * Two explicit loops: checking rows only arms the footer; `Confirm Done` files
 * the proposals (design §25.7, §25.10). The card is collapsible at every state
 * from the far-right disclosure, collapses its list to a compact confirmation
 * state the moment a task is checked, expands a task into its subtasks as an
 * accordion item, and marks rows that already have proposals pending approval.
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
  onLoadSubtasks,
  collapseWhenInactive = false,
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
  const [collapsed, setCollapsed] = useState(collapseWhenInactive);
  const [listOpen, setListOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [childrenById, setChildrenById] = useState<Record<string, readonly TaskSelectionCardSubtask[] | "loading" | "error">>({});
  const [parentChoice, setParentChoice] = useState<Record<string, boolean>>({});
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const inflightRef = useRef(false);
  const uid = useId();

  const proposedKey = listedTasks.filter((task) => proposedIds.has(task.id)).map((task) => task.id).join("\u0000");

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
    setConfirming(false);
    setExpandedIds(new Set());
    setChildrenById({});
    setParentChoice({});
    setListOpen(true);
    // A list refresh must not unlock selection while a submission is in flight,
    // or the resolving request would erase choices made after it started.
    if (inflightRef.current) return;
    setSubmitState("idle");
    setSubmitError(null);
    setSentCount(0);
    setCollapsed(collapseWhenInactive);
  }, [taskIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- collapseWhenInactive is applied below

  useEffect(() => {
    if (collapseWhenInactive) setCollapsed(true);
  }, [collapseWhenInactive]);

  useEffect(() => {
    if (!proposedIds.size) return;
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => !proposedIds.has(id)));
      return next.size === current.size ? current : next;
    });
    // Only newly proposed ids matter; the set identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposedKey]);

  /** Children already known for a parent: fetched state first, then the payload. */
  const childrenOf = (task: TaskSelectionCardTask): readonly TaskSelectionCardSubtask[] | null => {
    const loaded = childrenById[task.id];
    if (Array.isArray(loaded)) return loaded;
    if (Array.isArray(task.subtasks)) return task.subtasks;
    return null;
  };
  const childState = (task: TaskSelectionCardTask): "loading" | "error" | null => {
    const loaded = childrenById[task.id];
    return loaded === "loading" || loaded === "error" ? loaded : null;
  };
  const expandable = (task: TaskSelectionCardTask) =>
    (childrenOf(task)?.length ?? 0) > 0
    || Number(task.subtaskTotal ?? 0) > 0
    || childState(task) !== null
    || (!!onLoadSubtasks && Number(task.subtaskTotal ?? 0) > 0);

  const loadChildren = async (task: TaskSelectionCardTask) => {
    if (childrenOf(task) || childState(task) === "loading" || !onLoadSubtasks) return;
    setChildrenById((current) => ({ ...current, [task.id]: "loading" }));
    try {
      const loaded = await onLoadSubtasks(task.id);
      setChildrenById((current) => ({ ...current, [task.id]: loaded }));
    } catch {
      setChildrenById((current) => ({ ...current, [task.id]: "error" }));
    }
  };

  const toggleExpanded = (task: TaskSelectionCardTask) => {
    const open = expandedIds.has(task.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    if (!open) void loadChildren(task);
  };

  const toggle = (taskId: string) => {
    if (proposedIds.has(taskId) || sending) return;
    setConfirming(false);
    setSubmitError(null);
    setParentChoice((current) => {
      const next = { ...current };
      for (const task of listedTasks) {
        if ((childrenOf(task) ?? []).some((child) => child.id === taskId)) delete next[task.id];
      }
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      // Checking anything collapses the row list into the compact confirmation
      // state; clearing the selection brings the full list back.
      setListOpen(next.size === 0);
      return next;
    });
  };

  const titleById = new Map<string, string>();
  for (const task of listedTasks) {
    titleById.set(task.id, safeTaskText(task.title, "Untitled Nifty task"));
    for (const child of childrenOf(task) ?? []) titleById.set(child.id, safeTaskText(child.title, "Untitled subtask"));
  }

  const selectedRows = [...selectedIds]
    .filter((id) => !proposedIds.has(id))
    .map((id) => ({ id, title: titleById.get(id) ?? "Untitled task" }));

  /** A parent is suggested once every open subtask beneath it is checked. */
  const parentSuggestion = (task: TaskSelectionCardTask): { include: boolean } | null => {
    const children = childrenOf(task) ?? [];
    const open = children.filter((child) => child.completed !== true);
    if (!open.length) return null;
    if (!open.every((child) => selectedIds.has(child.id) || proposedIds.has(child.id))) return null;
    if (proposedIds.has(task.id) || selectedIds.has(task.id)) return null;
    return { include: parentChoice[task.id] ?? true };
  };

  const suggestedParents = listedTasks.filter((task) => parentSuggestion(task)?.include === true);
  const submissionRows = [...selectedRows, ...suggestedParents.map((task) => ({ id: task.id, title: titleById.get(task.id) ?? "Untitled task" }))];

  const loading = status === "loading";
  const failed = status === "error";
  const sending = submitState === "sending";
  const contentId = `${uid}-content`;
  const listId = `${uid}-list`;
  const titleId = `${uid}-title`;
  const canConfirm = !loading && !failed && !sending && submissionRows.length > 0;
  const proposedCount = listedTasks.filter((task) => proposedIds.has(task.id)).length;
  const filteredTasks = listedTasks.filter((task) => filter === "all" || (filter === "overdue" ? task.state === "overdue" : task.state !== "overdue"));
  const filterOptions = [
    { key: "all" as const, label: "All", count: listedTasks.length },
    { key: "pending" as const, label: "Pending", count: listedTasks.filter((task) => task.state !== "overdue").length },
    { key: "overdue" as const, label: "Overdue", count: listedTasks.filter((task) => task.state === "overdue").length },
  ];

  const summary = taskSelectionSummaryText({ selected: submissionRows.length, proposed: proposedCount, sentCount, approvalLocation });
  const listVisible = !collapsed && listOpen;

  const toggleList = () => {
    if (collapsed) {
      setCollapsed(false);
      setListOpen(true);
      return;
    }
    setListOpen((value) => !value);
  };

  const confirmDone = async () => {
    if (!submissionRows.length || sending) return;
    const count = submissionRows.length;
    setConfirming(false);
    setSubmitError(null);
    setSubmitState("sending");
    inflightRef.current = true;
    try {
      await onMarkSelectedDone(submissionRows);
      setSentCount(count);
      setSelectedIds(new Set());
      setParentChoice({});
      setSubmitState("sent");
      setListOpen(false);
      setCollapsed(true);
    } catch (value) {
      setSubmitState("idle");
      setSubmitError(value instanceof Error ? value.message : "Could not create the completion proposals.");
    } finally {
      inflightRef.current = false;
    }
  };

  const hint = submitError
    ? submitError
    : submittingHint(sending, confirming, submissionRows.length, suggestedParents.length);

  const renderSubtasks = (task: TaskSelectionCardTask) => {
    const panelId = `${uid}-subtasks-${task.id}`;
    const children = childrenOf(task) ?? [];
    const state = childState(task);
    return (
      <div
        id={panelId}
        className="chat-task-subtasks"
        role="region"
        aria-label={`${titleById.get(task.id) ?? "Task"} subtasks`}
      >
        {state === "loading" ? (
          <p className="chat-task-subtask-state" role="status">Loading subtasks…</p>
        ) : state === "error" ? (
          <p className="chat-task-subtask-state is-error" role="alert">
            <CircleAlert size={13} aria-hidden="true" />Subtasks did not load.
            <button type="button" className="chat-task-subtask-retry" onClick={() => void loadChildren(task)}>Retry</button>
          </p>
        ) : children.length === 0 ? (
          <p className="chat-task-subtask-state">No subtasks on this task.</p>
        ) : (
          <ul className="chat-task-subtask-list">
            {children.map((child) => {
              const childTitle = safeTaskText(child.title, "Untitled subtask");
              const done = child.completed === true;
              const proposed = proposedIds.has(child.id);
              const selected = selectedIds.has(child.id) && !proposed;
              return (
                <li key={child.id} className={cx("chat-task-subtask", (selected || done) && "is-selected", proposed && "is-proposed")}>
                  <label className={cx("chat-task-check", done || proposed || sending ? "cursor-default" : "cursor-pointer")}>
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={done || selected}
                      disabled={done || proposed || sending}
                      onChange={() => toggle(child.id)}
                      aria-label={done ? `${childTitle} is already complete` : proposed ? `${childTitle} already has a pending proposal` : `Select subtask ${childTitle}`}
                    />
                    <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  </label>
                  <span className="chat-task-subtask-title">{childTitle}</span>
                  <span className={statusChipClass(undefined, proposed)}>{proposed ? "Proposed" : done ? "Done" : "Open"}</span>
                </li>
              );
            })}
          </ul>
        )}
        {parentSuggestion(task) ? (
          <label className="chat-task-parent-suggestion">
            <input
              type="checkbox"
              checked={parentSuggestion(task)!.include}
              disabled={sending}
              onChange={(event) => setParentChoice((current) => ({ ...current, [task.id]: event.target.checked }))}
            />
            <span>Also mark “{titleById.get(task.id) ?? "this task"}” done</span>
          </label>
        ) : null}
      </div>
    );
  };

  const renderListRow = (task: TaskSelectionCardTask) => {
    const titleText = titleById.get(task.id) ?? "Untitled Nifty task";
    const overdue = task.state === "overdue";
    const proposed = proposedIds.has(task.id);
    const selected = selectedIds.has(task.id) && !proposed;
    const open = expandedIds.has(task.id);
    const panelId = `${uid}-subtasks-${task.id}`;
    const children = childrenOf(task) ?? [];
    const completedChildren = children.filter((child) => child.completed === true).length;
    const total = children.length || Number(task.subtaskTotal ?? 0);
    const completed = children.length ? completedChildren : Number(task.subtaskCompleted ?? 0);
    const metadata = [
      task.projectName ? safeTaskText(task.projectName, "Nifty") : "Nifty",
      task.priority ? `${task.priority} priority` : null,
      task.dueDate ? `Due ${formatWorkOsDate(task.dueDate)}` : overdue ? "Overdue" : null,
    ].filter(Boolean).join(" · ");
    const copy = (
      <>
        <strong>{titleText}</strong>
        {task.description && <small className="chat-task-description">{safeTaskText(task.description, "No description added.")}</small>}
        <em className="chat-task-meta">{metadata}{total > 0 ? ` · ${completed}/${total} subtasks` : ""}</em>
      </>
    );
    return (
      <li key={task.id} className={cx("chat-task-row", selected && "is-selected", proposed && "is-proposed")}>
        <div className="chat-task-row-main">
          <label className={cx("chat-task-check", proposed || sending ? "cursor-default" : "cursor-pointer")}>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={selected}
              disabled={proposed || sending}
              onChange={() => toggle(task.id)}
              aria-label={proposed ? `${titleText} already has a pending proposal` : `Select ${titleText}`}
            />
            <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
          </label>
          {expandable(task) ? (
            <button
              type="button"
              className="chat-task-row-head"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggleExpanded(task)}
            >
              <span className="chat-task-row-copy">{copy}</span>
              <ChevronDown size={15} aria-hidden="true" className={cx("chat-task-chevron", open && "is-open")} />
            </button>
          ) : (
            <span className="chat-task-row-head is-static"><span className="chat-task-row-copy">{copy}</span></span>
          )}
          <span className={statusChipClass(task.state, proposed)}>{proposed ? "Proposed" : overdue ? "Overdue" : "Pending"}</span>
        </div>
        {expandable(task) && <div hidden={!open}>{renderSubtasks(task)}</div>}
      </li>
    );
  };

  const renderTableRow = (task: TaskSelectionCardTask) => {
    const titleText = titleById.get(task.id) ?? "Untitled Nifty task";
    const overdue = task.state === "overdue";
    const proposed = proposedIds.has(task.id);
    const selected = selectedIds.has(task.id) && !proposed;
    const open = expandedIds.has(task.id);
    const panelId = `${uid}-subtasks-${task.id}`;
    return (
      <Fragment key={task.id}>
        <div role="row" className={cx("chat-task-table-row", selected && "is-selected", proposed && "is-proposed")}>
          <span role="cell" className="chat-task-check">
            <label className={cx("chat-task-check-inner", proposed || sending ? "cursor-default" : "cursor-pointer")}>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={selected}
                disabled={proposed || sending}
                onChange={() => toggle(task.id)}
                aria-label={proposed ? `${titleText} already has a pending proposal` : `Select ${titleText}`}
              />
              <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </label>
          </span>
          <span role="cell" className="chat-task-table-title" title={task.description ? safeTaskText(task.description, "") : titleText}>
            {expandable(task) ? (
              <button type="button" className="chat-task-row-head" aria-expanded={open} aria-controls={panelId} onClick={() => toggleExpanded(task)}>
                <span className="chat-task-row-copy"><strong>{titleText}</strong>{task.description ? <small>{safeTaskText(task.description, "")}</small> : null}</span>
                <ChevronDown size={15} aria-hidden="true" className={cx("chat-task-chevron", open && "is-open")} />
              </button>
            ) : (
              <><strong>{titleText}</strong>{task.description ? <small>{safeTaskText(task.description, "")}</small> : null}</>
            )}
          </span>
          <span role="cell" className={overdue ? "is-overdue" : ""}>{task.dueDate ? formatWorkOsDate(task.dueDate) : "No date"}</span>
          <span role="cell"><em className={proposed ? "is-proposed" : overdue ? "is-overdue" : "is-pending"}>{proposed ? "Proposed" : overdue ? "Overdue" : "Pending"}</em></span>
          <span role="cell" title={task.projectName ?? "Nifty"}>{task.projectName ? safeTaskText(task.projectName, "Nifty") : "Nifty"}</span>
        </div>
        {expandable(task) && (
          <div role="row" className="chat-task-table-detail" hidden={!open}>
            <span role="cell">{renderSubtasks(task)}</span>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <section
      className={cx(
        "chat-task-card flex w-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-card",
        dense && "is-dense",
        presentation === "table" && "is-table",
        confirming && "is-confirming",
        collapsed && "is-collapsed",
        !listVisible && "is-list-hidden",
      )}
      aria-labelledby={titleId}
      aria-busy={loading || sending}
    >
      <header className="chat-task-head">
        <h2 id={titleId} title={title} className="chat-task-heading">{title}</h2>
        <div className="chat-task-head-actions">
          {proposedCount > 0 && (
            <span className="chat-task-pill is-proposed">{proposedCount} proposed</span>
          )}
          <output className="chat-task-pill is-selected" htmlFor={listId} aria-live="polite">
            {submissionRows.length} selected
          </output>
          <button
            type="button"
            className="chat-task-disclosure"
            aria-expanded={listVisible}
            aria-controls={listId}
            aria-label={listVisible ? `${title}: hide task list` : `${title}: show task list`}
            title={listVisible ? "Collapse tasks" : "Expand tasks"}
            onClick={toggleList}
          >
            <ChevronDown size={16} aria-hidden="true" className={cx("chat-task-chevron", listVisible && "is-open")} />
          </button>
        </div>
      </header>

      {submitError && (
        <p className="chat-task-notice is-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {submitError}
        </p>
      )}

      {submitState === "sent" && (
        <p className="chat-task-notice is-receipt" role="status">
          <Check size={13} aria-hidden="true" />
          <span>{summary}</span>
          {onReview && (
            <button type="button" className="chat-task-review" onClick={onReview}>{reviewLabel}</button>
          )}
        </p>
      )}

      <div id={contentId} className="chat-task-body" hidden={collapsed}>
        {degraded && !loading && !failed && (
          <p className="chat-task-notice is-degraded" role="status">
            <AlertTriangle size={13} aria-hidden="true" />
            Showing the last available task details.
          </p>
        )}

        <div id={listId} className="chat-task-list" hidden={!listOpen}>
          {loading ? (
            <div className="chat-task-skeleton" role="status">
              <span /><span /><span />
              <span className="sr-only">Loading tasks</span>
            </div>
          ) : failed ? (
            <div className="chat-task-blank" role="alert">
              <span className="chat-turn-mark bg-danger-tint text-danger"><CircleAlert size={15} aria-hidden="true" /></span>
              <strong>Tasks are unavailable</strong>
              <p>{errorMessage}</p>
              {onRetry && (
                <button type="button" className="chat-task-retry" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Try again</button>
              )}
            </div>
          ) : listedTasks.length === 0 ? (
            <div className="chat-task-blank">
              <span className="chat-turn-mark"><ListChecks size={15} aria-hidden="true" /></span>
              <strong>{emptyTitle}</strong>
              <p>{emptyMessage}</p>
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
                  {filteredTasks.map((task) => renderTableRow(task))}
                </div>
              ) : (
                <div className="chat-task-filter-empty" role="status"><ListChecks size={16} aria-hidden="true" /><strong>No {filter} tasks</strong><span>Choose another filter to see the remaining work.</span></div>
              )}
            </div>
          ) : (
            <ul className="chat-task-list-rows">{listedTasks.map((task) => renderListRow(task))}</ul>
          )}
        </div>

        <footer className="chat-task-footer">
          <small className={cx("chat-task-hint", submitError && "is-error")}>{hint}</small>
          <span className="chat-task-actions">
            {confirming ? (
              <>
                <button className="task-selection-secondary" type="button" onClick={() => setConfirming(false)}>Back</button>
                <button className="task-selection-primary" type="button" disabled={!canConfirm} onClick={() => void confirmDone()}>
                  <Check size={14} aria-hidden="true" />{sending ? "Sending…" : "Confirm Done"}
                </button>
              </>
            ) : (
              <button className="task-selection-primary" type="button" disabled={!canConfirm} onClick={() => setConfirming(true)}>
                <Check size={14} aria-hidden="true" />{sending ? "Sending…" : "Mark selected done"}
              </button>
            )}
          </span>
        </footer>
      </div>
    </section>
  );
}

function submittingHint(sending: boolean, confirming: boolean, selectedCount: number, suggestedParents: number): string {
  if (sending) return "Creating completion proposals for your approval…";
  if (confirming) {
    const parents = suggestedParents ? ` plus ${suggestedParents} parent task${suggestedParents === 1 ? "" : "s"}` : "";
    return `Confirm marking ${selectedCount} item${selectedCount === 1 ? "" : "s"} done${parents}? Proposals are created for your approval.`;
  }
  if (selectedCount) return `${selectedCount} item${selectedCount === 1 ? "" : "s"} selected. Review them, then confirm.`;
  return "Select one or more tasks to continue.";
}
