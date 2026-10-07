import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";
import {
  ACTIVITY_INTERVALS_STALE_MS,
  DAY_DETAILS_STALE_MS,
  DAY_STALE_MS,
  HISTORICAL_STALE_MS,
  INSIGHTS_STALE_MS,
  MEMORY_STALE_MS,
  ONBOARDING_STALE_MS,
  SUGGESTIONS_STALE_MS,
  TASK_BACKLOG_STALE_MS,
  TASK_DETAILS_STALE_MS,
  TASK_HISTORY_STALE_MS,
  TASK_OPTIONS_STALE_MS,
  workOsKeys,
} from "./queryClient";
import type { ActivityIntervalCard, ActivityIntervalEnsureResult, ActivityIntervalsData, DailyPlan, DayData, EodScreenshotGallery, EodScreenshotPreparation, InsightsData, MemoryView, OnboardingData, OutstandingEodsData, PendingSuggestion, RecapNextStepsView } from "./types";
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

/** Load shared task history or a workspace-specific, globally sorted stream. */
export function useTaskHistoryQuery(options: { enabled: boolean; workspace?: boolean; sort?: TaskSort; currentDate?: string; completedOnly?: boolean }) {
  const workspace = options.workspace === true;
  return useInfiniteQuery({
    // Keep the unsorted key stable for Today, carry-over, interpretation, and
    // Stronghold snapshots. Sorted pages are separate workspace-only queries.
    queryKey: workspace
      ? [...workOsKeys.taskHistory(), options.completedOnly ? "completed" : "all", options.currentDate ?? "", options.sort?.key ?? "due", options.sort?.direction ?? "desc"]
      : workOsKeys.taskHistory(),
    enabled: options.enabled,
    staleTime: TASK_HISTORY_STALE_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: TaskHistoryPage) => lastPage.nextOffset ?? undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        view: "history",
        offset: String(pageParam),
        limit: "100",
      });
      if (workspace) {
        params.set("sort", options.sort?.key ?? "due");
        params.set("direction", options.sort?.direction ?? "desc");
        if (options.currentDate) params.set("sortDate", options.currentDate);
        if (options.completedOnly) params.set("completed", "true");
      }
      return apiRequest<TaskHistoryPage>(`/api/work-os/me/tasks?${params}`, { signal });
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

/** The employee's Activity Interval Review stream, newest interval first.
 * Bounded to the trailing 30 days so the Tasks tab can scroll history. */
export function useActivityIntervalsQuery(options: { enabled: boolean; date: string | null; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.activityIntervals(options.date ?? "none"),
    enabled: options.enabled && !!options.date,
    staleTime: ACTIVITY_INTERVALS_STALE_MS,
    refetchInterval: options.pollMs ?? false,
    queryFn: () => apiRequest<ActivityIntervalsData>(`/api/work-os/me/activity-intervals?date=${encodeURIComponent(options.date!)}&days=30`),
  });
}

/** Ensures the recap for the prompt the companion is about to show. The server
 * owns the window and evidence; the client only identifies the prompt slot. */
export function ensureActivityIntervalReview(promptDueAt: string | null, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(90_000);
  return apiRequest<ActivityIntervalEnsureResult>("/api/work-os/me/activity-intervals/ensure", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({ prompt_due_at: promptDueAt }),
  });
}

/** Looks right (confirm) or add/correct context (amend) on the employee's own
 * recap. Nothing here creates a check-in or advances the prompt cadence. */
export function decideActivityIntervalReview(intervalId: string, action: "confirm" | "amend", feedback?: string) {
  return apiRequest<{ interval: ActivityIntervalCard }>(`/api/work-os/me/activity-intervals/${encodeURIComponent(intervalId)}/decision`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ action, ...(feedback ? { feedback } : {}) }),
  });
}

/** The chat moment after an approval: generation status plus the recap's
 * next-step suggestions with their current decision state. */
export function fetchRecapNextSteps(intervalId: string) {
  return apiRequest<RecapNextStepsView>(`/api/work-os/me/activity-intervals/${encodeURIComponent(intervalId)}/next-steps`, {
    signal: AbortSignal.timeout(30_000),
  });
}

/** Owner-scoped proposal readback: reconciles a next-step decision whose accept
 * response did not settle (the apply may still be running server-side). */
export function readRecapNextStep(proposalId: string) {
  return apiRequest<{ proposal: { status?: string; failure_reason?: string | null } }>(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, {
    signal: AbortSignal.timeout(30_000),
  });
}

/** Ends the chat moment: every still-undecided suggestion is dismissed so it
 * never re-appears and nothing lingers in a queue. */
export function dismissRecapNextSteps(intervalId: string) {
  return apiRequest<{ dismissed: number }>(`/api/work-os/me/activity-intervals/${encodeURIComponent(intervalId)}/next-steps`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ action: "dismiss" }),
  });
}

/** One decision on a recap next-step suggestion. New task/subtask titles may
 * carry the employee's edit, validated server-side against the operation. */
export function decideRecapNextStep(proposalId: string, decision: "accept" | "reject", edits?: { name?: string }) {
  return apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ decision, ...(edits ? { edits } : {}) }),
  });
}

/** What Otto proposed or kept, plus the dated context it drew on. Polled while
 * the app is open so a new proposal can announce itself through the
 * notifications panel. */
export function useMemoryQuery(options: { enabled: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.memory(),
    enabled: options.enabled,
    staleTime: MEMORY_STALE_MS,
    refetchInterval: options.pollMs ?? false,
    queryFn: () => apiRequest<MemoryView>("/api/work-os/me/memory"),
  });
}

/** Keep (confirm) or reject a proposed fact. Nothing is remembered without a
 * keep, and a rejection prevents the same fact from being re-proposed. */
export function reviewMemoryFact(id: string, status: "confirmed" | "rejected") {
  return apiRequest(`/api/work-os/me/memory/${encodeURIComponent(id)}`, {
    method: "PATCH",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ status }),
  });
}

/** Forget a kept fact or one dated activity entry. */
export function forgetMemoryFact(id: string) {
  return apiRequest(`/api/work-os/me/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
}

/** Owner-scoped proposals that still need the employee: undecided, failed to
 * apply, or outdated. Recap-sourced rows are excluded here — they belong to
 * the mascot chat moment, never to this review surface. */
export async function fetchPendingSuggestions(): Promise<PendingSuggestion[]> {
  const data = await apiRequest<{ proposals: PendingSuggestion[] }>("/api/work-os/me/proposals?status=pending,failed,stale", {
    signal: AbortSignal.timeout(35_000),
  });
  return (data.proposals ?? []).filter((proposal) => !proposal.source_interval_id);
}

export function usePendingSuggestionsQuery(options: { enabled: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.suggestions(),
    enabled: options.enabled,
    staleTime: SUGGESTIONS_STALE_MS,
    refetchInterval: options.pollMs ?? false,
    queryFn: fetchPendingSuggestions,
  });
}

/** Approve (apply, or retry a failed apply) or dismiss one suggestion. */
export function decideSuggestion(proposalId: string, decision: "accept" | "reject") {
  return apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ decision }),
  });
}
