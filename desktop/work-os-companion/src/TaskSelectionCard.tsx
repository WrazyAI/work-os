import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Check, ChevronDown, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
import { formatWorkOsDate } from "./dateFormat";
import { safeTaskText } from "./taskWorkspace";
import { readStoredFlag, writeStoredFlag } from "./storedFlags";
import { cx } from "./chat/cx";
import { OverflowPanText } from "./OverflowPan";

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

/**
 * The open subtasks a task's own tick should carry with it.
 *
 * A task and its subtasks are one unit: completing the task completes the
 * subtasks beneath it, so ticking the task ticks them too and the card's
 * count, the review, and the record all say the same thing. A subtask that is
 * already done is left alone, and one that already has a pending proposal is
 * never selected again. `autoChecked` lists only the subtasks this tick added,
 * so unticking the task clears exactly those and leaves the employee's own
 * picks alone.
 */
export function selectParentSubtasks(input: {
  children: readonly TaskSelectionCardSubtask[];
  selectedIds: ReadonlySet<string>;
  proposedIds?: ReadonlySet<string>;
}): { selected: string[]; autoChecked: string[] } {
  const proposed = input.proposedIds ?? new Set<string>();
  const selected: string[] = [];
  const autoChecked: string[] = [];
  for (const child of input.children) {
    if (child.completed === true) continue;
    if (proposed.has(child.id)) continue;
    selected.push(child.id);
    if (!input.selectedIds.has(child.id)) autoChecked.push(child.id);
  }
  return { selected, autoChecked };
}

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
  /** Device-local collapse memory for a host that keeps the card mounted (the
   * floating Tasks tab). With a key the far-right disclosure collapses the
   * whole card, and the choice survives reopening the view; without one the
   * card keeps its transient list disclosure. */
  collapsePersistenceKey?: string;
};

function statusChipClass(state: string | undefined, proposed: boolean) {
  return cx(
    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
    proposed ? "is-proposed bg-accent-tint text-ink-2" : state === "overdue" ? "is-overdue bg-danger-tint text-danger" : "bg-inset text-ink-2",
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
 *
 * A task and its subtasks are one unit here, the way they are in the record:
 * completing a task completes the open subtasks beneath it. Checking a task
 * therefore checks those subtasks, and unticking either one clears the other,
 * so the count, the review, and the record never disagree about what a done
 * task carries with it.
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
  collapsePersistenceKey,
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
  const [collapsed, setCollapsed] = useState(() => collapseWhenInactive || readStoredFlag(collapsePersistenceKey));
  const [listOpen, setListOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [childrenById, setChildrenById] = useState<Record<string, readonly TaskSelectionCardSubtask[] | "loading" | "error">>({});
  /** The subtasks each task ticked for itself, so unticking it clears exactly those. */
  const [autoCheckedByParent, setAutoCheckedByParent] = useState<Record<string, string[]>>({});
  const childrenLoadRef = useRef<Record<string, Promise<readonly TaskSelectionCardSubtask[] | null>>>({});
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
    setAutoCheckedByParent({});
    setParentChoice({});
    setListOpen(true);
    // A list refresh must not unlock selection while a submission is in flight,
    // or the resolving request would erase choices made after it started.
    if (inflightRef.current) return;
    setSubmitState("idle");
    setSubmitError(null);
    setSentCount(0);
    // A keyed card reads its stored choice once at mount; a task refresh keeps
    // whatever the employee (or the post-submit receipt) set since, so the card
    // never reopens itself after filing completions.
    setCollapsed((current) => (collapsePersistenceKey ? current : collapseWhenInactive));
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

  /** Loads a parent's subtasks the first time its row expands, and hands the
   * loaded list back so a selection can carry them with it. */
  const loadChildren = async (task: TaskSelectionCardTask): Promise<readonly TaskSelectionCardSubtask[] | null> => {
    const known = childrenOf(task);
    if (known) return known;
    if (!onLoadSubtasks) return null;
    const inflight = childrenLoadRef.current[task.id];
    if (inflight) return inflight;
    setChildrenById((current) => ({ ...current, [task.id]: "loading" }));
    const promise = (async () => {
      try {
        const loaded = await onLoadSubtasks(task.id);
        setChildrenById((current) => ({ ...current, [task.id]: loaded }));
        return loaded;
      } catch {
        setChildrenById((current) => ({ ...current, [task.id]: "error" }));
        return null;
      } finally {
        delete childrenLoadRef.current[task.id];
      }
    })();
    childrenLoadRef.current[task.id] = promise;
    return promise;
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

  const toggle = async (taskId: string) => {
    if (proposedIds.has(taskId) || sending) return;
    const checking = !selectedIds.has(taskId);
    setConfirming(false);
    setSubmitError(null);
    setParentChoice((current) => {
      const next = { ...current };
      for (const task of listedTasks) {
        if ((childrenOf(task) ?? []).some((child) => child.id === taskId)) delete next[task.id];
      }
      return next;
    });

    const task = listedTasks.find((candidate) => candidate.id === taskId) ?? null;
    const parent = listedTasks.find((candidate) => (childrenOf(candidate) ?? []).some((child) => child.id === taskId)) ?? null;

    if (!checking) {
      // Unticking a task unticks the subtasks it ticked. Unticking a subtask
      // unticks the task above it, so a task and its subtasks always move
      // together: a task that is done carries its subtasks with it.
      const ownTicks = autoCheckedByParent[taskId] ?? [];
      const parentTicks = parent ? (autoCheckedByParent[parent.id] ?? []) : [];
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        for (const id of ownTicks) next.delete(id);
        if (parent && next.has(parent.id)) {
          next.delete(parent.id);
          for (const id of parentTicks) next.delete(id);
        }
        return next;
      });
      setAutoCheckedByParent((current) => {
        const next = { ...current };
        delete next[taskId];
        if (parent) delete next[parent.id];
        return next;
      });
      return;
    }

    // Checking a task checks the open subtasks beneath it. The task ticks
    // straight away; the subtasks join as soon as they are known.
    setSelectedIds((current) => {
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
    if (!task || !expandable(task)) return;
    // Checking a parent expands it so its subtasks are immediately visible.
    setExpandedIds((current) => (current.has(taskId) ? current : new Set([...current, taskId])));
    const children = await loadChildren(task);
    if (!children) return;
    const { selected, autoChecked } = selectParentSubtasks({ children, selectedIds, proposedIds });
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of selected) next.add(id);
      return next;
    });
    setAutoCheckedByParent((current) => ({ ...current, [taskId]: autoChecked }));
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
  const pendingCount = listedTasks.filter((task) => task.state !== "overdue").length;
  const overdueCount = listedTasks.filter((task) => task.state === "overdue").length;
  // Collapsed cards keep a one-line account of the work instead of a bare title
  // (design §25.7): the selection when there is one, otherwise the open counts.
  const headerSummary = submissionRows.length || proposedCount
    ? taskSelectionSummaryText({ selected: submissionRows.length, proposed: proposedCount, sentCount: 0, approvalLocation })
    : [pendingCount ? `${pendingCount} pending` : null, overdueCount ? `${overdueCount} overdue` : null].filter(Boolean).join(" · ");
  const listVisible = !collapsed && listOpen;

  const toggleList = () => {
    // A keyed card collapses whole: the far-right disclosure is the employee's
    // device-local memory of how much space the card should take, not a
    // transient list toggle. Unkeyed cards keep the list-only behavior.
    if (collapsePersistenceKey) {
      const next = !collapsed;
      setCollapsed(next);
      setListOpen(true);
      writeStoredFlag(collapsePersistenceKey, next);
      return;
    }
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
                <li key={child.id} className={cx("chat-task-subtask", (selected || done) && "is-selected", proposed && "is-proposed")} data-pan-row="true">
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
                  <span className="chat-task-subtask-title"><OverflowPanText>{childTitle}</OverflowPanText></span>
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
        <strong><OverflowPanText>{titleText}</OverflowPanText></strong>
        {task.description && <small className="chat-task-description"><OverflowPanText pan={false}>{safeTaskText(task.description, "No description added.")}</OverflowPanText></small>}
        <em className="chat-task-meta">{metadata}{total > 0 ? ` · ${completed}/${total} subtasks` : ""}</em>
      </>
    );
    return (
      <li key={task.id} className={cx("chat-task-row", selected && "is-selected", proposed && "is-proposed")}>
        <div className="chat-task-row-main" data-pan-row="true">
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
        <div role="row" className={cx("chat-task-table-row", selected && "is-selected", proposed && "is-proposed")} data-pan-row="true">
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
          <span role="cell" className="chat-task-table-title">
            {expandable(task) ? (
              <button type="button" className="chat-task-row-head" aria-expanded={open} aria-controls={panelId} onClick={() => toggleExpanded(task)}>
                <span className="chat-task-row-copy"><strong><OverflowPanText>{titleText}</OverflowPanText></strong>{task.description ? <small><OverflowPanText pan={false}>{safeTaskText(task.description, "")}</OverflowPanText></small> : null}</span>
                <ChevronDown size={15} aria-hidden="true" className={cx("chat-task-chevron", open && "is-open")} />
              </button>
            ) : (
              <><strong><OverflowPanText>{titleText}</OverflowPanText></strong>{task.description ? <small><OverflowPanText pan={false}>{safeTaskText(task.description, "")}</OverflowPanText></small> : null}</>
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
      data-workos-tool-surface="task-selection"
      data-workos-tool-state={failed ? "error" : loading ? "loading" : sending ? "submitting" : submitState === "sent" ? "receipt" : listedTasks.length === 0 ? "empty" : "ready"}
      style={{ "--chat-task-list-max-height": `${maxHeight}px` } as CSSProperties}
    >
      <header className="chat-task-head">
        <h2 id={titleId} title={title} className="chat-task-heading">
          <span className="chat-task-heading-text">{title}</span>
          {!listVisible && !submissionRows.length && headerSummary && <small className="chat-task-summary">{headerSummary}</small>}
        </h2>
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
            <div className="chat-task-loading" role="status">
              <p className="chat-task-loading-row">
                <span className="chat-working-spinner" aria-hidden="true" />
                <span>Loading tasks</span>
              </p>
              <div className="chat-task-skeleton" aria-hidden="true">
                <span><span className="chat-task-skeleton-title" /><span className="chat-task-skeleton-meta" /></span>
                <span><span className="chat-task-skeleton-title" /><span className="chat-task-skeleton-meta" /></span>
                <span><span className="chat-task-skeleton-title" /><span className="chat-task-skeleton-meta" /></span>
              </div>
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
