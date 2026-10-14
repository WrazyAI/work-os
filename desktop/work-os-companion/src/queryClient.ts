import { QueryClient, dehydrate, hydrate, type QueryKey } from "@tanstack/react-query";
import { secureState } from "./vault";

/** Shared TTLs. Reads stay cached and are revalidated in the background instead
 * of refetching on every view change or action. */
export const DAY_STALE_MS = 60_000;
export const DAY_DETAILS_STALE_MS = 2 * 60_000;
export const TASK_HISTORY_STALE_MS = 5 * 60_000;
export const TASK_BACKLOG_STALE_MS = 60_000;
export const TASK_DETAILS_STALE_MS = 60_000;
export const INSIGHTS_STALE_MS = 5 * 60_000;
export const ONBOARDING_STALE_MS = 30 * 60_000;
export const TASK_OPTIONS_STALE_MS = 10 * 60_000;
export const HISTORICAL_STALE_MS = 10 * 60_000;
export const ACTIVITY_INTERVALS_STALE_MS = 60_000;
export const MEMORY_STALE_MS = 60_000;
export const SUGGESTIONS_STALE_MS = 60_000;

export const workOsKeys = {
  day: (variant: "compact" | "details") => ["work-os", "day", variant] as const,
  taskHistory: () => ["work-os", "task-history"] as const,
  taskBacklog: () => ["work-os", "task-backlog"] as const,
  taskDetails: (taskId: string) => ["work-os", "task", taskId] as const,
  insights: (range: string, through: string) => ["work-os", "insights", range, through] as const,
  historicalDay: (date: string) => ["work-os", "historical", date] as const,
  reportDay: (date: string) => ["work-os", "report-day", date] as const,
  outstandingEods: () => ["work-os", "eod-outstanding"] as const,
  eodScreenshots: (date: string) => ["work-os", "eod-screenshots", date] as const,
  onboarding: () => ["work-os", "onboarding"] as const,
  taskOptions: () => ["work-os", "task-options"] as const,
  activityIntervals: (date: string) => ["work-os", "activity-intervals", date] as const,
  memory: () => ["work-os", "memory"] as const,
  suggestions: () => ["work-os", "suggestions"] as const,
};

const PERSISTED_ROOT = "work-os";

export function isPersistedQueryKey(key: QueryKey): boolean {
  // Administration reads (roster, evidence, review state, organization
  // settings) stay out of the on-disk cache: they belong to the workspace
  // record, not to this device's employee session.
  return key[0] === PERSISTED_ROOT && key[1] !== "admin";
}

export function createWorkOsQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DAY_STALE_MS,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/** The app-wide client. Module scope so Tauri event listeners, the avatar
 * window, and non-React helpers can invalidate the same cache. */
export const workOsQueryClient = createWorkOsQueryClient();

const PERSIST_DEBOUNCE_MS = 2_500;

/** Restores the last cached work state so the first paint shows real content
 * while background revalidation runs. A corrupt cache never blocks boot. */
export async function restoreWorkOsQueryCache(client: QueryClient): Promise<void> {
  try {
    const snapshot = await secureState.queryCache();
    if (!snapshot?.state) return;
    hydrate(client, JSON.parse(snapshot.state));
  } catch {
    // Ignore: revalidation will refill the cache.
  }
}

/** Persists the filtered cache to the Stronghold vault, debounced. */
export function startWorkOsQueryPersistence(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persist = async () => {
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (query) => query.state.status === "success" && isPersistedQueryKey(query.queryKey),
      });
      await secureState.saveQueryCache(JSON.stringify(state));
    } catch {
      // Persistence is best-effort; the live cache remains authoritative.
    }
  };
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void persist(), PERSIST_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
