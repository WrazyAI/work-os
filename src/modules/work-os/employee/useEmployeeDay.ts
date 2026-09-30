"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attendanceWatchExpectation, attendanceWatchInput, attendanceWatchInterval } from "../attendance-watch";
import { fetchJson, type EmployeeDayResponse } from "./model";

/**
 * The shared day seam for the employee destinations.
 *
 * Owns the `/me/day` read, the adaptive Worktivity attendance watch, the
 * explicit provider sync (the companion's "sync now"), and the workspace-wide
 * refresh. Today, Tasks, and Review all read from this one query key so a
 * check-in completed on one destination is visible on the others without a
 * reload (design.md §14).
 */
export function useEmployeeDay(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;
  const day = useQuery<EmployeeDayResponse>({
    queryKey: ["work-os", "my-day"],
    queryFn: () => fetchJson("/api/work-os/me/day"),
    refetchInterval: 60_000,
    enabled,
  });
  // Activity alone can clock someone in or out. Re-check Worktivity on the
  // adaptive cadence and refresh the day only when the tracked state moved.
  const attendanceWatch = useQuery<{ changed?: boolean }>({
    queryKey: ["work-os", "attendance-watch"],
    queryFn: () => fetchJson("/api/work-os/attendance/observe", { method: "POST" }),
    enabled: enabled && !!day.data,
    refetchInterval: () => attendanceWatchInterval(attendanceWatchInput(day.data), Date.now()),
    staleTime: 0,
    retry: false,
  });
  const attendanceWatchSeen = useRef(0);
  useEffect(() => {
    if (!attendanceWatch.dataUpdatedAt || attendanceWatchSeen.current === attendanceWatch.dataUpdatedAt) return;
    attendanceWatchSeen.current = attendanceWatch.dataUpdatedAt;
    if (attendanceWatch.data?.changed) void queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] });
  }, [attendanceWatch.data, attendanceWatch.dataUpdatedAt, queryClient]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "task-day"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "employee-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "employee-insights"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "eod-outstanding"] }),
    ]);
  }, [queryClient]);

  // The companion's explicit provider sync: ask the server to refresh Nifty
  // and Worktivity for this day, then refetch the day every surface reads.
  const sync = useMutation({
    mutationFn: () => fetchJson<EmployeeDayResponse>("/api/work-os/me/day?refreshProviders=true&refreshAttendance=true"),
    onSuccess: () => void refresh(),
  });

  const watchExpectation = attendanceWatchExpectation(attendanceWatchInput(day.data), Date.now());
  const syncing = sync.isPending || day.data?.niftySync?.syncing === true;
  return { day, refresh, watchExpectation, sync, syncing };
}

/** The outstanding-EOD list, shared by Today's callout and Review. */
export function useOutstandingEods() {
  return useQuery({
    queryKey: ["work-os", "eod-outstanding"],
    queryFn: () => fetchJson<import("./model").OutstandingEodsResponse>("/api/work-os/me/eod/outstanding?days=14"),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
