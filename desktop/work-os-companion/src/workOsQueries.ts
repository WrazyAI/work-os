import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from "@tanstack/react-query";
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
import type { TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";
import type { ActivityIntervalCard, ActivityIntervalEnsureResult, ActivityIntervalLatestData, ActivityIntervalsData, DailyPlan, DashboardWeekData, DayData, EodScreenshotGallery, EodScreenshotPreparation, InsightsData, MemoryFact, MemoryView, OnboardingData, OutstandingEodsData, PendingSuggestion, RecapNextStepsView } from "./types";
import type { TaskSort } from "./taskWorkspace";
import { validateTaskFinderFilters, type TaskFinderFilters } from "../../../src/modules/work-os/task-finder";

export type TaskDetails = {
  task: Record<string, any>;
  subtasks: Array<Record<string, any>>;
  moveTargets: Array<Record<string, any>>;
  completionEvidence?: TaskEvidenceRecord[];
  subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null };
};

export type TaskHistoryPage = {
  tasks: Array<Record<string, any>>;
  nextCursor: string | null;
  totalCount: number;
  counts?: { total: number; open: number; completed: number; overdue?: number };
  cursor?: { next: string | null };
};

/** Loaded open-backlog window plus exact counts and the next contiguous page. */
export type TaskBacklog = {
  tasks: Array<Record<string, any>>;
  counts: { total: number; open: number; completed: number; overdue?: number } | null;
  nextCursor?: string | null;
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

export async function fetchDay(options: { variant: "compact" | "details"; refreshProviders?: boolean; refreshAttendance?: boolean; date?: string; signal?: AbortSignal }): Promise<DayData> {
  const params = new URLSearchParams();
  if (options.refreshProviders) params.set("refreshProviders", "true");
  if (options.refreshAttendance) params.set("refreshAttendance", "true");
  if (options.date) params.set("date", options.date);
  if (options.variant === "compact") params.set("compact", "true");
  const timeout = AbortSignal.timeout(options.refreshProviders ? 90_000 : 35_000);
  const rawDay = await apiRequest<DayData>(`/api/work-os/me/day${params.size ? `?${params}` : ""}`, {
    // A provider refresh can legitimately take longer; a compact read is bounded.
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  return normalizeDay(rawDay);
}

export function useDayQuery(options: { enabled: boolean; variant: "compact" | "details"; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.day(options.variant),
    enabled: options.enabled,
    staleTime: options.variant === "compact" ? DAY_STALE_MS : DAY_DETAILS_STALE_MS,
    refetchInterval: options.variant === "compact" && options.pollMs ? options.pollMs : false,
    queryFn: ({ signal }) => fetchDay({ variant: options.variant, signal }),
  });
}

export async function fetchOnboarding(signal?: AbortSignal): Promise<OnboardingData> {
  return apiRequest<OnboardingData>("/api/work-os/me/onboarding", { signal });
}

export function useOnboardingQuery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: workOsKeys.onboarding(),
    enabled: options.enabled,
    staleTime: ONBOARDING_STALE_MS,
    queryFn: ({ signal }) => fetchOnboarding(signal),
  });
}

/** Load shared task history or a workspace-specific, globally sorted stream. */
export type TaskFinderSource = (filters: TaskFinderFilters, cursor: string | null, signal: AbortSignal) => Promise<TaskHistoryPage>;
/** Optimistic list membership is not valid for independently filtered finders.
 * They keep authoritative pages and share the prefix only for invalidation. */
export function updateTaskHistoryPages(client: QueryClient, updater: (current: InfiniteData<TaskHistoryPage>, completedOnly: boolean) => InfiniteData<TaskHistoryPage>) {
  for (const query of client.getQueryCache().findAll({ queryKey: workOsKeys.taskHistory() })) {
    if (query.queryKey[2] === "finder") continue;
    client.setQueryData<InfiniteData<TaskHistoryPage>>(query.queryKey, current => current ? updater(current, query.queryKey[2] === "completed") : current);
  }
}

export function taskFinderQueryOptions(options: { enabled: boolean; currentDate: string; filters: TaskFinderFilters; scope?: string; source?: TaskFinderSource }) {
  const filters = validateTaskFinderFilters(options.filters);
  return {
    queryKey: [...workOsKeys.taskHistory(), "finder", options.scope ?? "", options.currentDate, filters.search, filters.status, filters.from, filters.to],
    enabled: options.enabled,
    // Local adapters read mutable on-device data, not an authoritative remote
    // cache. Closing retires their pages so reopening always reads current rows.
    staleTime: options.source ? 0 : TASK_DETAILS_STALE_MS,
    gcTime: options.source ? 0 : 5 * 60_000,
    retry: 1,
    initialPageParam: null as string | null,
    getNextPageParam: (last: TaskHistoryPage) => last.nextCursor ?? last.cursor?.next ?? undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => {
      if (options.source) return options.source(filters, pageParam, signal);
      const params = new URLSearchParams({ view: "history", status: filters.status, limit: "50", sort: "due", direction: "desc", sortDate: options.currentDate });
      if (filters.search) params.set("search", filters.search);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (pageParam) params.set("cursor", pageParam);
      return apiRequest<TaskHistoryPage>(`/api/work-os/me/tasks?${params}`, { signal });
    },
  };
}

export function useTaskFinderQuery(options: Parameters<typeof taskFinderQueryOptions>[0]) {
  return useInfiniteQuery(taskFinderQueryOptions(options));
}

export function useTaskHistoryQuery(options: {
  enabled: boolean;
  workspace?: boolean;
  view?: "history" | "open" | "day";
  sort?: TaskSort;
  currentDate?: string;
  completedOnly?: boolean;
  search?: string;
  fromDate?: string;
  toDate?: string;
  excludeToday?: boolean;
}) {
  const workspace = options.workspace === true;
  const view = options.view ?? "history";
  return useInfiniteQuery({
    queryKey: workspace
      ? [...workOsKeys.taskHistory(), options.completedOnly ? "completed" : "all", view, options.currentDate ?? "", options.sort?.key ?? "due", options.sort?.direction ?? "desc", options.search ?? "", options.fromDate ?? "", options.toDate ?? "", options.excludeToday === true]
      : workOsKeys.taskHistory(),
    enabled: options.enabled,
    staleTime: TASK_HISTORY_STALE_MS,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: TaskHistoryPage) => lastPage.nextCursor ?? lastPage.cursor?.next ?? undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        view,
        limit: "50",
      });
      if (pageParam) params.set("cursor", pageParam);
      if (view === "day" && options.currentDate) params.set("date", options.currentDate);
      if (view === "open" && options.excludeToday) {
        params.set("excludeToday", "true");
        if (options.currentDate) params.set("date", options.currentDate);
      }
      if (workspace) {
        params.set("sort", options.sort?.key === "title" ? "title" : options.sort?.key ?? "due");
        params.set("direction", options.sort?.direction ?? "desc");
        if (options.currentDate) params.set("sortDate", options.currentDate);
        if (options.completedOnly && view === "history") params.set("completed", "true");
        if (options.search) params.set("search", options.search);
        if (options.fromDate) params.set("from", options.fromDate);
        if (options.toDate) params.set("to", options.toDate);
      }
      return apiRequest<TaskHistoryPage>(`/api/work-os/me/tasks?${params}`, { signal });
    },
  });
}

/** One page only. A legacy server cannot silently turn a partial list into a
 * complete backlog: it must provide the counts/cursor contract. */
export async function fetchTaskBacklog(sortDate?: string, cursor?: string | null, signal?: AbortSignal): Promise<TaskBacklog> {
  const params = new URLSearchParams({ view: "open", limit: "50" });
  if (sortDate) {
    // Unfinished excludes work already scoped to My day. The server applies the
    // same exclusion to its exact counts, so the bell/tab total is not a count
    // of loaded rows and matches the destination exactly.
    params.set("sortDate", sortDate);
    params.set("date", sortDate);
    params.set("excludeToday", "true");
  }
  if (cursor) params.set("cursor", cursor);
  const open = await apiRequest<TaskHistoryPage>(`/api/work-os/me/tasks?${params}`, { signal });
  if (!open.counts || !Array.isArray(open.tasks)) throw new Error("This workspace needs the paginated task API update. Refresh after the server is updated.");
  return { tasks: open.tasks, counts: open.counts, nextCursor: open.nextCursor ?? open.cursor?.next ?? null };
}

/** Exact open/overdue counts for the notifications bell while the employee
 * pages are hidden. One row is requested; the server still returns the full
 * aggregate counts, so no backlog page is downloaded. */
export function openTaskCountUrl(date?: string) {
  // No date is valid: the server resolves the employee's current workday, so
  // the fallback count works even while another window owns the monitor.
  const params = new URLSearchParams({ view: "open", limit: "1", excludeToday: "true" });
  if (date) { params.set("date", date); params.set("sortDate", date); }
  return `/api/work-os/me/tasks?${params}`;
}

export function useOpenTaskCountQuery(options: { enabled: boolean; date?: string }) {
  return useQuery({
    queryKey: ["work-os", "task-open-count", options.date ?? "current"],
    enabled: options.enabled,
    staleTime: TASK_BACKLOG_STALE_MS,
    refetchInterval: 60_000,
    queryFn: ({ signal }) => apiRequest<TaskHistoryPage>(openTaskCountUrl(options.date), { signal }),
  });
}

export function useTaskBacklogQuery(options: { enabled: boolean; sortDate?: string }) {
  return useInfiniteQuery({
    queryKey: [...workOsKeys.taskBacklog(), options.sortDate ?? ""],
    enabled: options.enabled && !!options.sortDate,
    staleTime: TASK_BACKLOG_STALE_MS,
    initialPageParam: null as string | null,
    getNextPageParam: (page: TaskBacklog) => page.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) => fetchTaskBacklog(options.sortDate, pageParam, signal),
    select: (data): TaskBacklog => ({ tasks: data.pages.flatMap((page) => page.tasks), counts: data.pages[0]?.counts ?? null, nextCursor: data.pages.at(-1)?.nextCursor }),
  });
}

/** Optimistic task changes preserve loaded page boundaries and cursors. New
 * rows enter only the first page; removed rows do not reset the reader. */
export function updateTaskBacklogCaches(client: QueryClient, update: (value: TaskBacklog | undefined) => TaskBacklog | undefined) {
  client.setQueriesData<InfiniteData<TaskBacklog>>({ queryKey: workOsKeys.taskBacklog() }, (current) => {
    // A cache restored from the previous build can hold the old plain object
    // at this key; never throw inside an optimistic task update because of it.
    if (!current || !Array.isArray(current.pages) || !current.pages.length) return current;
    const flat = { tasks: current.pages.flatMap((page) => page.tasks), counts: current.pages[0].counts };
    const next = update(flat);
    if (!next) return current;
    const id = (task: Record<string, any>) => String(task.id ?? task.provider_task_id);
    const rows = new Map(next.tasks.map((task) => [id(task), task]));
    const previousIds = new Set(flat.tasks.map(id));
    const inserted = next.tasks.filter((task) => !previousIds.has(id(task)));
    return { ...current, pages: current.pages.map((page, index) => ({ ...page, counts: next.counts,
      tasks: [...(index === 0 ? inserted : []), ...page.tasks.flatMap((task) => rows.has(id(task)) ? [rows.get(id(task))!] : [])],
    })) };
  });
}

export async function fetchTaskDetails(taskId: string, signal?: AbortSignal): Promise<TaskDetails> {
  return apiRequest<TaskDetails>(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { signal });
}

export function useTaskDetailsQuery(options: { taskId: string | null }) {
  return useQuery({
    queryKey: workOsKeys.taskDetails(options.taskId ?? "none"),
    enabled: !!options.taskId,
    staleTime: TASK_DETAILS_STALE_MS,
    queryFn: ({ signal }) => fetchTaskDetails(options.taskId!, signal),
  });
}

export function useInsightsQuery(options: { enabled: boolean; range: "day" | "7d" | "30d"; through: string }) {
  return useQuery({
    queryKey: workOsKeys.insights(options.range, options.through),
    enabled: options.enabled && !!options.through,
    staleTime: INSIGHTS_STALE_MS,
    queryFn: ({ signal }) => apiRequest<InsightsData>(`/api/work-os/me/insights?range=${options.range}&through=${encodeURIComponent(options.through)}`, { signal }),
  });
}

/** Today's small margin widget. Distinct key from the full insight report so
 * opening Insights cannot replace it with a larger, incompatible payload. */
export function dashboardInsightsUrl(through: string) {
  return `/api/work-os/me/insights?range=7d&summary=1&through=${encodeURIComponent(through)}`;
}

export function useDashboardInsightsQuery(options: { enabled: boolean; through: string }) {
  return useQuery({
    // Nest under the full insights prefix so task writes that invalidate
    // ["work-os","insights"] mark the weekly widget stale as well.
    queryKey: [...workOsKeys.insights("7d", options.through).slice(0, 2), "dashboard", options.through],
    enabled: options.enabled && !!options.through,
    staleTime: INSIGHTS_STALE_MS,
    queryFn: ({ signal }) => apiRequest<DashboardWeekData>(dashboardInsightsUrl(options.through), { signal }),
  });
}

export async function fetchHistoricalDay(date: string): Promise<{ plan: DailyPlan | null; tasks: Array<Record<string, any>> }> {
  const planResult = await apiRequest<{ plan: DailyPlan | null }>(`/api/work-os/me/plan?date=${encodeURIComponent(date)}`);
  return { plan: planResult.plan, tasks: [] };
}

export function useHistoricalDayQuery(options: { enabled?: boolean; date: string; currentDate: string }) {
  return useQuery({
    queryKey: workOsKeys.historicalDay(options.date),
    enabled: options.enabled !== false && !!options.date && options.date !== options.currentDate,
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
export function useReportDayQuery(options: { enabled?: boolean; date: string | null; currentDate: string }) {
  return useQuery({
    queryKey: workOsKeys.reportDay(options.date ?? "none"),
    enabled: options.enabled !== false && !!options.date && options.date !== options.currentDate,
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
/** One recap page (design §9.2): tall cards, so the stream asks for a small
 * contiguous page and appends the next one only on the explicit control. */
export const ACTIVITY_INTERVALS_PAGE_SIZE = 12;

/** The recap page URL: the bounded first page, or the next page behind its
 * keyset cursor. */
export function activityIntervalsUrl(date: string, cursor: string | null): string {
  return `/api/work-os/me/activity-intervals?date=${encodeURIComponent(date)}&days=30&limit=${ACTIVITY_INTERVALS_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
}

/** Owner-scoped newest ready recap plus the pending count. The floating
 * companion can surface the latest without loading the 30-day page. */
export function latestActivityIntervalUrl() {
  return "/api/work-os/me/activity-intervals/latest" as const;
}

export function fetchLatestActivityInterval(signal?: AbortSignal): Promise<ActivityIntervalLatestData> {
  const timeout = AbortSignal.timeout(20_000);
  return apiRequest<ActivityIntervalLatestData>(latestActivityIntervalUrl(), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

export function useLatestActivityIntervalQuery(options: { enabled: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: workOsKeys.activityIntervalLatest(),
    enabled: options.enabled,
    staleTime: 15_000,
    refetchInterval: options.pollMs ?? false,
    queryFn: ({ signal }) => fetchLatestActivityInterval(signal),
  });
}

/** Live notices own only the latest page, never the history observer. With no
 * day loaded (mapped Admin), the server resolves the employee's local date. */
export function activityIntervalNotificationOptions(options: { enabled: boolean; date: string | null; pollMs?: number }) {
  return {
    queryKey: [...workOsKeys.activityIntervals(options.date ?? "current"), "notification"],
    enabled: options.enabled,
    staleTime: ACTIVITY_INTERVALS_STALE_MS,
    refetchInterval: options.pollMs ?? (false as const),
    queryFn: ({ signal }: { signal: AbortSignal }) => apiRequest<ActivityIntervalsData>(
      `/api/work-os/me/activity-intervals?days=30&limit=${ACTIVITY_INTERVALS_PAGE_SIZE}${options.date ? `&date=${encodeURIComponent(options.date)}` : ""}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) },
    ),
  };
}

export function useActivityIntervalNotificationQuery(options: { enabled: boolean; date: string | null; pollMs?: number }) {
  return useQuery(activityIntervalNotificationOptions(options));
}

export function useActivityIntervalsQuery(options: { enabled: boolean; date: string | null; pollMs?: number }) {
  return useInfiniteQuery({
    queryKey: workOsKeys.activityIntervals(options.date ?? "none"),
    enabled: options.enabled && !!options.date,
    staleTime: ACTIVITY_INTERVALS_STALE_MS,
    refetchInterval: (query) => (query.state.data?.pages.length ?? 0) <= 1 ? options.pollMs ?? false : false,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ActivityIntervalsData) => lastPage.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) => {
      // Keep the query's cancellation signal and the request's own deadline:
      // a bare query signal would otherwise remove apiRequest's timeout.
      const timeout = AbortSignal.timeout(20_000);
      return apiRequest<ActivityIntervalsData>(
        activityIntervalsUrl(options.date!, pageParam),
        { signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
      );
    },
  });
}

/** Ensures the recap for the prompt the companion is about to show. The server
 * owns the window and evidence; the client only identifies the prompt slot. */
/** A recap can spend a minute analysing a backlog of screenshots before the
 * synthesis call starts. The old 90-second cutoff abandoned requests that
 * finished seconds later, so the companion delivered a generic check-in even
 * though the recap was ready. Leave room for the full pipeline. */
export const ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS = 180_000;

export function ensureActivityIntervalReview(promptDueAt: string | null, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS);
  return apiRequest<ActivityIntervalEnsureResult>("/api/work-os/me/activity-intervals/ensure", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({ prompt_due_at: promptDueAt }),
  });
}

/** Request body for an employee recap decision. `expectedReviewVersion` comes
 * from the interval's immutable review version (0 while inferred), never from
 * the generation `revision`; it is omitted for older servers that do not expose
 * one, keeping the legacy retry/conflict behavior. */
export function activityIntervalDecisionBody(action: "confirm" | "amend", feedback?: string, expectedReviewVersion?: number) {
  return {
    action,
    ...(feedback ? { feedback } : {}),
    ...(typeof expectedReviewVersion === "number" && Number.isSafeInteger(expectedReviewVersion) && expectedReviewVersion >= 0
      ? { expectedReviewVersion } : {}),
  };
}

/** Looks right (confirm) or add/correct context (amend) on the employee's own
 * recap. Nothing here creates a check-in or advances the prompt cadence. */
export function decideActivityIntervalReview(intervalId: string, action: "confirm" | "amend", feedback?: string, expectedReviewVersion?: number) {
  return apiRequest<{ interval: ActivityIntervalCard }>(`/api/work-os/me/activity-intervals/${encodeURIComponent(intervalId)}/decision`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(activityIntervalDecisionBody(action, feedback, expectedReviewVersion)),
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
  return apiRequest<{ fact: Pick<MemoryFact, "id" | "review_status"> }>(`/api/work-os/me/memory/${encodeURIComponent(id)}`, {
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
