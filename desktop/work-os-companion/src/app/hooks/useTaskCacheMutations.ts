import { useCallback } from "react";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { workOsKeys } from "../../queryClient";
import { patchedTaskCapabilities } from "../../taskActions";
import type { DayData } from "../../types";
import { updateTaskBacklogCaches, updateTaskHistoryPages, type TaskHistoryPage } from "../../workOsQueries";

/** Stable row identity shared by optimistic cache updates and provider-backed rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const taskRowId = (task: Record<string, any>) => String(task.provider_task_id || task.id);

export function useTaskCacheMutations(queryClient: QueryClient, taskCalendarDate: string) {
  /** Merge a partial patch into one row and keep its capability payload truthful
   * when a write moves the overdue lock: a just-completed row offers Reopen
   * immediately, and a just-reopened or rescheduled row reflects the due date
   * without waiting for a refetch. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskAfterPatch = useCallback((task: Record<string, any>, patch: Record<string, any>) => {
    const next = { ...task, ...patch };
    const affectsCapabilities = typeof patch.completed === "boolean" || "due_date" in patch;
    if (affectsCapabilities && next.capabilities && typeof next.capabilities === "object") {
      next.capabilities = patchedTaskCapabilities(next, taskCalendarDate);
    }
    return next;
  }, [taskCalendarDate]);

  /** Apply a partial task patch only to the matching provider-backed cache row. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patchTaskRow = useCallback((task: Record<string, any>, rowId: string, patch: Record<string, any>) =>
    taskRowId(task) === rowId ? taskAfterPatch(task, patch) : task,
  [taskAfterPatch]);

  /** Update every loaded sorted-history variant, then revalidate active ones so
   * completion filters and page boundaries stay authoritative after writes. */
  const updateTaskHistoryVariants = useCallback((
    updater: (current: InfiniteData<TaskHistoryPage>, completedOnly: boolean) => InfiniteData<TaskHistoryPage>,
  ) => {
    updateTaskHistoryPages(queryClient, updater);
  }, [queryClient]);

  /** Refetch active sorted-history variants after a mutation changes membership or order. */
  const revalidateTaskHistoryVariants = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory(), refetchType: "active" });
  }, [queryClient]);

  /** Surgical cache updates: a task write patches loaded rows immediately, then
   * active sorted pages revalidate so changed sort keys cannot stay misplaced. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patchTaskCaches = useCallback((rowId: string, patch: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => ({
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        tasks: page.tasks.flatMap((task) => {
          if (taskRowId(task) !== rowId) return [task];
          const next = taskAfterPatch(task, patch);
          return completedOnly && next.completed !== true ? [] : [next];
        }),
      })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.map((task) => patchTaskRow(task, rowId, patch)),
      } : current);
    }
    if (typeof patch.completed === "boolean") {
      // The confirmed task write also advances selected plan items and embedded
      // subtask rows on the server. Refresh the day so the focus meter and
      // hierarchy show that confirmed state instead of waiting for the poll.
      void queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") });
      void queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") });
    }
    if (patch.completed === true) {
      // The backlog is open-only: completing a task removes it and shifts the
      // counts immediately, then a refetch confirms the server totals.
      updateTaskBacklogCaches(queryClient, (current) => {
        if (!current || !current.counts || !current.tasks.some((task) => taskRowId(task) === rowId)) return current;
        return {
          tasks: current.tasks.filter((task) => taskRowId(task) !== rowId),
          counts: { total: Math.max(0, current.counts.total - 1), open: Math.max(0, current.counts.open - 1), completed: current.counts.completed + 1 },
        };
      });
      void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    } else {
      updateTaskBacklogCaches(queryClient, (current) => current ? {
        ...current,
        tasks: current.tasks.map((task) => patchTaskRow(task, rowId, patch)),
      } : current);
      if (patch.completed === false) void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    }
    revalidateTaskHistoryVariants();
  }, [patchTaskRow, queryClient, revalidateTaskHistoryVariants, taskAfterPatch, updateTaskHistoryVariants]);

  /** Remove a task from every loaded task-history, day, and backlog cache. */
  const removeTaskFromCaches = useCallback((rowId: string) => {
    updateTaskHistoryVariants((current) => ({
      ...current,
      pages: current.pages.map((page) => ({ ...page, tasks: page.tasks.filter((task) => taskRowId(task) !== rowId) })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.filter((task) => taskRowId(task) !== rowId),
      } : current);
    }
    updateTaskBacklogCaches(queryClient, (current) => {
      if (!current) return current;
      const tasks = current.tasks.filter((task) => taskRowId(task) !== rowId);
      if (!current.counts) return { ...current, tasks };
      const removed = current.tasks.length - tasks.length;
      return { tasks, counts: { ...current.counts, total: Math.max(0, current.counts.total - removed), open: Math.max(0, current.counts.open - removed) } };
    });
    revalidateTaskHistoryVariants();
  }, [queryClient, revalidateTaskHistoryVariants, updateTaskHistoryVariants]);

  /** Swap a pending row for the server row in the same slot, so the list
   * never loses or gains a row while the swap happens. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replaceTaskInCaches = useCallback((rowId: string, task: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => ({
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        tasks: page.tasks.flatMap((row) => {
          if (taskRowId(row) !== rowId) return [row];
          return completedOnly && task.completed !== true ? [] : [task];
        }),
      })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.map((row) => taskRowId(row) === rowId ? task : row),
      } : current);
    }
    updateTaskBacklogCaches(queryClient, (current) => current ? {
      ...current,
      tasks: current.tasks.map((row) => taskRowId(row) === rowId ? task : row),
    } : current);
    revalidateTaskHistoryVariants();
  }, [queryClient, revalidateTaskHistoryVariants, updateTaskHistoryVariants]);

  /** Optimistically insert a task into loaded list caches, respecting completed-only history variants. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertTaskIntoCaches = useCallback((task: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => {
      if (completedOnly && task.completed !== true) return current;
      if (!current.pages.length) return current;
      const exists = current.pages.some((page) => page.tasks.some((row) => taskRowId(row) === taskRowId(task)));
      if (exists) return current;
      return { ...current, pages: [{ ...current.pages[0], tasks: [task, ...current.pages[0].tasks] }, ...current.pages.slice(1)] };
    });
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => {
        if (!current) return current;
        if (current.tasks.some((row) => taskRowId(row) === taskRowId(task))) return current;
        return { ...current, tasks: [task, ...current.tasks] };
      });
    }
    updateTaskBacklogCaches(queryClient, (current) => {
      if (!current || current.tasks.some((row) => taskRowId(row) === taskRowId(task))) return current;
      if (!current.counts) return { ...current, tasks: [task, ...current.tasks] };
      return { tasks: [task, ...current.tasks], counts: { ...current.counts, total: current.counts.total + 1, open: current.counts.open + 1 } };
    });
  }, [queryClient, updateTaskHistoryVariants]);

  /** Optimistic adds are cache rows like any other, carrying `pending_status`
   * until the server record replaces them in place. Two commits (one for the
   * pending row, one for the real row) would move the list down and back up
   * around a task that never actually moved. */
  const insertPendingTaskIntoCaches = useCallback((pending: { id: string; title: string; description: string; dueDate?: string | null }) => {
    insertTaskIntoCaches({
      id: pending.id,
      title: pending.title,
      description: pending.description,
      completed: false,
      due_date: pending.dueDate ?? null,
      pending_status: "syncing",
    });
  }, [insertTaskIntoCaches]);

  return {
    taskRowId,
    updateTaskHistoryVariants,
    revalidateTaskHistoryVariants,
    patchTaskCaches,
    removeTaskFromCaches,
    replaceTaskInCaches,
    insertTaskIntoCaches,
    insertPendingTaskIntoCaches,
  };
}
