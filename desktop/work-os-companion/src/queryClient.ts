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
const persistenceBarriers = new WeakMap<QueryClient, () => Promise<() => void>>();

/** Sign-out is ordered after an already-started vault save, not raced with it.
 * Cancel reads (never mutations), retire queued snapshots, then erase storage. */
export async function clearWorkOsAccountCache(client: QueryClient): Promise<void> {
  const resume = await persistenceBarriers.get(client)?.();
  try {
    await client.cancelQueries();
    client.clear();
    await secureState.clearAccount();
  } finally {
    resume?.();
  }
}

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
  let stopped = false;
  let paused = false;
  let inFlight: Promise<void> | null = null;
  let saving = false;
  let dirty = false;
  let failures = 0;
  const snapshot = () => dehydrate(client, {
    shouldDehydrateQuery: (query) => query.state.status === "success" && isPersistedQueryKey(query.queryKey),
    shouldDehydrateMutation: () => false,
  });
  // Fetch/observer timestamps are not employee data. In particular a successful
  // revalidation of identical data must not rewrite the encrypted vault.
  const fingerprint = (state: ReturnType<typeof snapshot>) => JSON.stringify(
    state.queries.map((query) => [query.queryHash, query.state.data]).sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
  let saved = fingerprint(snapshot());
  const schedule = (delay = PERSIST_DEBOUNCE_MS) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void persist(); }, delay);
  };
  const persist = async () => {
    if (stopped || paused || saving || !dirty) return;
    dirty = false;
    const state = snapshot();
    const next = fingerprint(state);
    if (next === saved) return;
    saving = true;
    try {
      inFlight = secureState.saveQueryCache(JSON.stringify(state));
      await inFlight;
      saved = next;
      failures = 0;
    } catch {
      // Persistence is best-effort; the live cache remains authoritative. A
      // real change is retried with backoff instead of being silently lost.
      failures += 1;
      dirty = true;
    } finally {
      saving = false;
      inFlight = null;
      if (dirty && !stopped) schedule(failures ? Math.min(60_000, 5_000 * 2 ** Math.min(failures, 4)) : PERSIST_DEBOUNCE_MS);
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (paused || stopped) return;
    if (!isPersistedQueryKey(event.query.queryKey)) return;
    if (event.type !== "removed" && !(event.type === "updated" && event.action.type === "success")) return;
    dirty = true;
    schedule();
  });
  const barrier = async () => {
    paused = true;
    dirty = false;
    if (timer) clearTimeout(timer);
    timer = null;
    await inFlight?.catch(() => undefined);
    return () => { saved = fingerprint(snapshot()); paused = false; };
  };
  persistenceBarriers.set(client, barrier);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    if (persistenceBarriers.get(client) === barrier) persistenceBarriers.delete(client);
  };
}
