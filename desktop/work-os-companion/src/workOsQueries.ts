import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";
import {
  DAY_DETAILS_STALE_MS,
  DAY_STALE_MS,
  HISTORICAL_STALE_MS,
  INSIGHTS_STALE_MS,
  ONBOARDING_STALE_MS,
  TASK_BACKLOG_STALE_MS,
  TASK_DETAILS_STALE_MS,
  TASK_HISTORY_STALE_MS,
  TASK_OPTIONS_STALE_MS,
  workOsKeys,
} from "./queryClient";
import type { DailyPlan, DayData, EodScreenshotGallery, EodScreenshotPreparation, InsightsData, OnboardingData, OutstandingEodsData } from "./types";
import type { TaskSort } from "./taskWorkspace";

export type TaskDetails = {
  task: Record<string, any>;
  subtasks: Array<Record<string, any>>;
  moveTargets: Array<Record<string, any>>;
  subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null };
};

export type TaskHistoryPage = { tasks: Array<Record<string, any>>; nextOffset: number | null };

/** The complete open backlog plus exact parent counts, returned whole so both
 * the dashboard carry-over tabs and the Tasks Unfinished view are complete. */
export type TaskBacklog = {
  tasks: Array<Record<string, any>>;
  counts: { total: number; open: number; completed: number } | null;
};

/** Provider sync can return a partial but otherwise usable day. Keep that
 * response renderable instead of letting a missing collection trip React. */
export function normalizeDay(rawDay: DayData): DayData {
  const plan = rawDay.plan && typeof rawDay.plan === "object"
    ? { ...rawDay.plan, items: Array.isArray(rawDay.plan.items) ? rawDay.plan.items : [] }
    : null;
  return {
    ...rawDay,
    tasks: Array.isArray(rawDay.tasks) ? rawDay.tasks : [],
    taskHistory: Array.isArray(rawDay.taskHistory) ? rawDay.taskHistory : [],
    evidence: Array.isArray(rawDay.evidence) ? rawDay.evidence : [],
    proposals: Array.isArray(rawDay.proposals) ? rawDay.proposals : [],
    plan,
    prompt: rawDay.prompt ?? { kind: null, nextPromptAt: null, required: false, reason: "" },
  };
}

export async function fetchDay(options: { variant: "compact" | "details"; refreshProviders?: boolean; refreshAttendance?: boolean; date?: string }): Promise<DayData> {
  const params = new URLSearchParams();
  if (options.refreshProviders) params.set("refreshProviders", "true");
  if (options.refreshAttendance) params.set("refreshAttendance", "true");
  if (options.date) params.set("date", options.date);
  if (options.variant === "compact") params.set("compact", "true");
  const rawDay = await apiRequest<DayData>(`/api/work-os/me/day${params.size ? `?${params}` : ""}`, {
    // A provider refresh can legitimately take longer; a compact read is bounded.
    signal: AbortSignal.timeout(options.refreshProviders ? 90_000 : 35_000),
  });
  return normalizeDay(rawDay);
}

export function useDayQuery(options: { enabled: boolean; variant: "compact" | "details"; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.day(options.variant),
    enabled: options.enabled,
    staleTime: options.variant === "compact" ? DAY_STALE_MS : DAY_DETAILS_STALE_MS,
    refetchInterval: options.variant === "compact" && options.pollMs ? options.pollMs : false,
    queryFn: () => fetchDay({ variant: options.variant }),
  });
}

export async function fetchOnboarding(): Promise<OnboardingData> {
  return apiRequest<OnboardingData>("/api/work-os/me/onboarding");
}

export function useOnboardingQuery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: workOsKeys.onboarding(),
    enabled: options.enabled,
    staleTime: ONBOARDING_STALE_MS,
    queryFn: fetchOnboarding,
  });
}

export function useTaskHistoryQuery(options: { enabled: boolean; sort: TaskSort; currentDate?: string; completedOnly?: boolean }) {
  return useInfiniteQuery({
    queryKey: [...workOsKeys.taskHistory(), options.completedOnly ? "completed" : "all", options.currentDate ?? "", options.sort.key, options.sort.direction],
    enabled: options.enabled,
    staleTime: TASK_HISTORY_STALE_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: TaskHistoryPage) => lastPage.nextOffset ?? undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        view: "history",
        offset: String(pageParam),
        limit: "100",
        sort: options.sort.key,
        direction: options.sort.direction,
      });
      if (options.currentDate) params.set("sortDate", options.currentDate);
      if (options.completedOnly) params.set("completed", "true");
      return apiRequest<TaskHistoryPage>(`/api/work-os/me/tasks?${params}`);
    },
  });
}

/** The open backlog. Servers that predate `view=open` answer it with a
 * windowed row set and no counts, so the response is capability-checked and
 * rebuilt from the assistant's pending selection instead of rendered wrong. */
export async function fetchTaskBacklog(): Promise<TaskBacklog> {
  const open = await apiRequest<TaskBacklog & { counts?: unknown }>("/api/work-os/me/tasks?view=open");
  if (open && open.counts) return open;
  const pending = await apiRequest<{ tasks?: Array<Record<string, any>> }>("/api/work-os/me/tasks?view=pending&limit=100");
  const tasks = Array.isArray(pending?.tasks) ? pending.tasks.filter((task) => task.completed !== true) : [];
  return { tasks, counts: null };
}

export function useTaskBacklogQuery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: workOsKeys.taskBacklog(),
    enabled: options.enabled,
    staleTime: TASK_BACKLOG_STALE_MS,
    queryFn: () => fetchTaskBacklog(),
  });
}

export async function fetchTaskDetails(taskId: string): Promise<TaskDetails> {
  return apiRequest<TaskDetails>(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`);
}

export function useTaskDetailsQuery(options: { taskId: string | null }) {
  return useQuery({
    queryKey: workOsKeys.taskDetails(options.taskId ?? "none"),
    enabled: !!options.taskId,
    staleTime: TASK_DETAILS_STALE_MS,
    queryFn: () => fetchTaskDetails(options.taskId!),
  });
}

export function useInsightsQuery(options: { enabled: boolean; range: "day" | "7d" | "30d"; through: string }) {
  return useQuery({
    queryKey: workOsKeys.insights(options.range, options.through),
    enabled: options.enabled && !!options.through,
    staleTime: INSIGHTS_STALE_MS,
    queryFn: () => apiRequest<InsightsData>(`/api/work-os/me/insights?range=${options.range}&through=${encodeURIComponent(options.through)}`),
  });
}

export async function fetchHistoricalDay(date: string): Promise<{ plan: DailyPlan | null; tasks: Array<Record<string, any>> }> {
  const [planResult, taskResult] = await Promise.all([
    apiRequest<{ plan: DailyPlan | null }>(`/api/work-os/me/plan?date=${encodeURIComponent(date)}`),
    apiRequest<{ tasks: Array<Record<string, any>> }>(`/api/work-os/me/tasks?view=day&date=${encodeURIComponent(date)}&limit=100`),
  ]);
  return { plan: planResult.plan, tasks: taskResult.tasks };
}

export function useHistoricalDayQuery(options: { date: string; currentDate: string }) {
  return useQuery({
    queryKey: workOsKeys.historicalDay(options.date),
    enabled: !!options.date && options.date !== options.currentDate,
    staleTime: HISTORICAL_STALE_MS,
    queryFn: () => fetchHistoricalDay(options.date),
  });
}

export function useTaskOptionsQuery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: workOsKeys.taskOptions(),
    enabled: options.enabled,
    staleTime: TASK_OPTIONS_STALE_MS,
    queryFn: () => apiRequest<{ people: Array<{ id: string; displayName: string; email: string | null }> }>("/api/work-os/me/tasks?view=options"),
  });
}

/** Historical day payload for drafting an EOD on a day other than today. */
export function useReportDayQuery(options: { date: string | null; currentDate: string }) {
  return useQuery({
    queryKey: workOsKeys.reportDay(options.date ?? "none"),
    enabled: !!options.date && options.date !== options.currentDate,
    staleTime: DAY_DETAILS_STALE_MS,
    queryFn: () => fetchDay({ variant: "details", date: options.date! }),
  });
}

export function useOutstandingEodsQuery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: workOsKeys.outstandingEods(),
    enabled: options.enabled,
    staleTime: DAY_DETAILS_STALE_MS,
    queryFn: () => apiRequest<OutstandingEodsData>("/api/work-os/me/eod/outstanding?days=14"),
  });
}

/** Viewable screenshot frames for one day, used by the EOD composer gallery.
 * Polling is scoped to an active on-demand preparation: frames that keep
 * failing stay `pending` by design, so an unconditional interval would poll
 * forever. After preparation finishes the query is invalidated instead. */
export function useEodScreenshotsQuery(options: { enabled: boolean; date: string | null; pollWhilePending?: boolean }) {
  return useQuery({
    queryKey: workOsKeys.eodScreenshots(options.date ?? "none"),
    enabled: options.enabled && !!options.date,
    staleTime: DAY_DETAILS_STALE_MS,
    refetchInterval: (query) => options.pollWhilePending && ((query.state.data as EodScreenshotGallery | undefined)?.pending ?? 0) > 0 ? 5_000 : false,
    queryFn: () => apiRequest<EodScreenshotGallery>(`/api/work-os/me/eod/screenshots?date=${encodeURIComponent(options.date!)}`),
  });
}

/** One bounded, interactive Worktivity analysis batch for the EOD day. The
 * composer runs this while the waiting state is visible and stops early when
 * the employee chooses to draft anyway. */
export function prepareEodScreenshots(date: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(45_000);
  return apiRequest<EodScreenshotPreparation>("/api/work-os/me/eod/screenshots/prepare", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({ date, max_frames: 6 }),
  });
}
